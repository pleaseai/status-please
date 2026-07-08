import type { CheckResult } from '@statusbeam/core'
import type { Env } from './env'
import { deriveStatuspageWebhookStatus, statuspageWebhookSchema } from '@statusbeam/core'
import { ingest, loadConfig } from './ingest'

/**
 * Match the inbound Statuspage webhook route `/webhooks/statuspage/:slug` and
 * return the site slug, or `null` for any other path. Pure so it's unit-tested
 * without a running Worker. Empty segments (leading/trailing slashes) are
 * ignored, so both `/webhooks/statuspage/claude` and a trailing-slash variant
 * resolve to the same slug.
 */
export function parseWebhookPath(pathname: string): { slug: string } | null {
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length === 3 && parts[0] === 'webhooks' && parts[1] === 'statuspage' && parts[2]) {
    return { slug: parts[2] }
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
 * Handle an inbound Atlassian Statuspage subscriber webhook and, when it carries
 * a status for the addressed site, run it through the same {@link ingest}
 * pipeline as the cron loop — giving near-real-time updates while cron remains
 * the backstop.
 *
 * Owns all routing so the Worker's `fetch` can delegate unconditionally:
 * - non-webhook path → 404, non-POST → 405
 * - bad/absent `?token=` (vs `WEBHOOK_SECRET`) → 401
 * - unknown slug or a site that isn't a `statuspage` check → 404
 * - malformed JSON / wrong-shaped payload → 400
 * - a valid event that isn't about this site (a different component) → 204 (ack,
 *   so Statuspage doesn't retry)
 * - otherwise ingest and return 200
 */
export async function handleStatuspageWebhook(
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

  // Authenticate on the URL's `?token=` (Statuspage subscriber webhooks can't
  // set custom headers, but you control the URL you register). An unset secret
  // fails closed — the endpoint is never open.
  const token = url.searchParams.get('token') ?? ''
  if (!env.WEBHOOK_SECRET || !timingSafeEqual(token, env.WEBHOOK_SECRET)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const config = await loadConfig(env)
  const site = config.sites.find(s => s.slug === route.slug)
  if (!site || site.check !== 'statuspage') {
    return new Response('Unknown site', { status: 404 })
  }

  let body: unknown
  try {
    body = await request.json()
  }
  catch {
    return new Response('Invalid JSON', { status: 400 })
  }
  const parsed = statuspageWebhookSchema.safeParse(body)
  if (!parsed.success) {
    return new Response('Invalid payload', { status: 400 })
  }

  const status = deriveStatuspageWebhookStatus(parsed.data, site)
  if (status === null) {
    // 204 must have a null body (a body would throw at construction).
    return new Response(null, { status: 204 })
  }

  // `responseTime`/`code` mirror the polling adapter: the verdict comes from the
  // payload, not from timing the API call — 200 marks a payload received and
  // graded (distinct from the cron path's `code: 0` network failures).
  const result: CheckResult = {
    slug: site.slug,
    status,
    code: 200,
    responseTime: 0,
    checkedAt: new Date().toISOString(),
  }
  await ingest(env, config, [result], ctx)
  return new Response('OK', { status: 200 })
}
