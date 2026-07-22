import type { CheckResult, CheckStatus } from '@statusbeam/core'
import type { Env } from './env'
import { deriveSentryWebhookStatus, deriveStatuspageWebhookStatus, sentryWebhookSchema, statuspageWebhookSchema } from '@statusbeam/core'
import { ingest, loadConfig } from './ingest'

/** Webhook providers StatusBeam accepts inbound pushes from. */
export type WebhookProvider = 'statuspage' | 'sentry'

const PROVIDERS: readonly WebhookProvider[] = ['statuspage', 'sentry']

/**
 * Match an inbound webhook route `/webhooks/:provider/:slug` and return the
 * provider + site slug, or `null` for any other path. Pure so it's unit-tested
 * without a running Worker. Empty segments (leading/trailing slashes) are
 * ignored, so both `/webhooks/sentry/api` and a trailing-slash variant resolve to
 * the same route. `:provider` must be one we support (`statuspage`/`sentry`),
 * otherwise the path doesn't match.
 */
export function parseWebhookPath(pathname: string): { provider: WebhookProvider, slug: string } | null {
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length === 3 && parts[0] === 'webhooks' && parts[2] && (PROVIDERS as readonly string[]).includes(parts[1]!)) {
    return { provider: parts[1] as WebhookProvider, slug: parts[2] }
  }
  return null
}

/**
 * Constant-time string equality — compares every character so the time taken
 * doesn't leak how many leading characters of the secret were correct. A length
 * mismatch short-circuits (the length itself isn't the secret). Used to check
 * the webhook `?token=` against {@link Env.WEBHOOK_SECRET}.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false
  }
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

/**
 * Grade a provider's inbound payload for one site: parse it against the
 * provider's schema and map it to a `CheckStatus`. Returns `{ status }` on a
 * gradeable event, `{ status: null }` when the event doesn't concern this site
 * (caller acks with 204), or `{ error }` when the payload is the wrong shape
 * (caller returns 400). The site's `check` kind is assumed to match `provider`
 * (checked by the caller).
 */
function gradePayload(provider: WebhookProvider, body: unknown, site: { component?: string }):
  | { status: CheckStatus | null }
  | { error: 'invalid-payload', reason: string } {
  if (provider === 'sentry') {
    const parsed = sentryWebhookSchema.safeParse(body)
    if (!parsed.success) {
      return { error: 'invalid-payload', reason: parsed.error.message }
    }
    return { status: deriveSentryWebhookStatus(parsed.data) }
  }
  const parsed = statuspageWebhookSchema.safeParse(body)
  if (!parsed.success) {
    return { error: 'invalid-payload', reason: parsed.error.message }
  }
  return { status: deriveStatuspageWebhookStatus(parsed.data, site) }
}

/**
 * Handle an inbound provider webhook (Atlassian Statuspage or Sentry) and, when
 * it carries a status for the addressed site, run it through the same
 * {@link ingest} pipeline as the cron loop — giving near-real-time updates while
 * cron remains the backstop (for Sentry, cron is the backstop only when a
 * `sentry:` block + `SENTRY_AUTH_TOKEN` enable polling; otherwise the webhook is
 * the sole source).
 *
 * Owns all routing so the Worker's `fetch` can delegate unconditionally:
 * - non-webhook path → 404, non-POST → 405
 * - bad/absent `?token=` (vs `WEBHOOK_SECRET`) → 401
 * - unknown slug, or a site whose `check` kind doesn't match the route provider → 404
 * - malformed JSON / wrong-shaped payload → 400
 * - a valid event that isn't about this site (a different component, an ignored
 *   issue) → 204 (ack, so the sender doesn't retry)
 * - otherwise ingest and return 200
 */
export async function handleWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url)
  const route = parseWebhookPath(url.pathname)
  if (!route) {
    return new Response('Not found', { status: 404 })
  }
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  // Authenticate on the URL's `?token=` (Statuspage subscriber webhooks can't set
  // custom headers, but you control the URL you register; Sentry webhooks can, but
  // sharing one scheme keeps both providers on the same fail-closed path). An
  // unset secret fails closed — the endpoint is never open.
  const token = url.searchParams.get('token') ?? ''
  if (!env.WEBHOOK_SECRET || !timingSafeEqual(token, env.WEBHOOK_SECRET)) {
    // Log for operator visibility (brute-force attempts) — never the token/secret.
    console.warn(`webhook: rejected unauthenticated request for slug "${route.slug}"`)
    return new Response('Unauthorized', { status: 401 })
  }

  const config = await loadConfig(env)
  const site = config.sites.find(s => s.slug === route.slug)
  // incident.io status pages are Statuspage-compatible — same payload, graded by
  // the same {@link deriveStatuspageWebhookStatus} — so a `check: incidentio` site
  // is a valid target for the `statuspage` webhook route. Any other provider must
  // match its check kind exactly.
  const checkMatchesProvider = route.provider === 'statuspage'
    ? site?.check === 'statuspage' || site?.check === 'incidentio'
    : site?.check === route.provider
  if (!site || !checkMatchesProvider) {
    // Usually a misregistered webhook URL (wrong slug, or the provider doesn't
    // match the site's check kind) — surface it so the operator can fix it.
    console.warn(`webhook: unknown or non-${route.provider} slug "${route.slug}"`)
    return new Response('Unknown site', { status: 404 })
  }

  let body: unknown
  try {
    body = await request.json()
  }
  catch {
    console.warn(`webhook: invalid JSON body for slug "${route.slug}"`)
    return new Response('Invalid JSON', { status: 400 })
  }
  const graded = gradePayload(route.provider, body, site)
  if ('error' in graded) {
    // Payload-shape drift (a provider API change) shows up here, not as an outage.
    // Include the Zod reason so an operator can see exactly which field drifted.
    console.warn(`webhook: payload failed validation for slug "${route.slug}": ${graded.reason}`)
    return new Response('Invalid payload', { status: 400 })
  }

  if (graded.status === null) {
    // 204 must have a null body (a body would throw at construction).
    return new Response(null, { status: 204 })
  }

  // `responseTime`/`code` mirror the polling adapter: the verdict comes from the
  // payload, not from timing the API call — 200 marks a payload received and
  // graded (distinct from the cron path's `code: 0` network failures).
  const result: CheckResult = {
    slug: site.slug,
    status: graded.status,
    code: 200,
    responseTime: 0,
    checkedAt: new Date().toISOString(),
  }
  await ingest(env, config, [result], ctx)
  return new Response('OK', { status: 200 })
}
