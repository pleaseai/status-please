import type { Site } from './config'
import type { CheckResult, CheckStatus } from './types'

/** Minimal fetch signature so callers (and tests) can pass any compatible impl. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

/**
 * Derive a check status from a completed HTTP response.
 * `up` when the code is expected and fast enough, `degraded` when it is
 * expected but slow, `down` otherwise.
 */
export function deriveStatus(
  code: number,
  responseTime: number,
  site: Pick<Site, 'expectedStatusCodes' | 'maxResponseTime'>,
): CheckStatus {
  if (!site.expectedStatusCodes.includes(code)) {
    return 'down'
  }
  if (responseTime > site.maxResponseTime) {
    return 'degraded'
  }
  return 'up'
}

/**
 * Run one check for a site. Injectable `fetchImpl` and `now` keep this pure and
 * testable; the Worker passes the platform `fetch`.
 *
 * Dispatches on `site.check`: `statuspage` reads an Atlassian Statuspage JSON
 * API; every other kind (`http`/`tcp`/`ssl`) currently falls through to a plain
 * HTTP fetch. `tcp`/`ssl` runtime probing is tracked in the roadmap.
 */
export async function checkSite(
  site: Site,
  deps: { fetchImpl?: FetchLike, now?: () => number } = {},
): Promise<CheckResult> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const now = deps.now ?? Date.now
  if (site.check === 'statuspage') {
    return checkStatuspage(site, fetchImpl, now)
  }
  return checkHttp(site, fetchImpl, now)
}

/** Plain HTTP check: fetch the URL and grade by status code and latency. */
async function checkHttp(site: Site, fetchImpl: FetchLike, now: () => number): Promise<CheckResult> {
  const start = now()

  try {
    const res = await fetchImpl(site.url, {
      method: site.method,
      redirect: 'follow',
    })
    const responseTime = now() - start
    return {
      slug: site.slug,
      status: deriveStatus(res.status, responseTime, site),
      code: res.status,
      responseTime,
      checkedAt: new Date(start).toISOString(),
    }
  }
  catch (err) {
    return {
      slug: site.slug,
      status: 'down',
      code: 0,
      responseTime: now() - start,
      checkedAt: new Date(start).toISOString(),
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/** Atlassian Statuspage component `status` → our {@link CheckStatus}. */
const STATUSPAGE_COMPONENT_STATUS: Record<string, CheckStatus> = {
  operational: 'up',
  degraded_performance: 'degraded',
  partial_outage: 'degraded',
  major_outage: 'down',
  under_maintenance: 'degraded',
}

/** Atlassian Statuspage overall page `indicator` → our {@link CheckStatus}. */
const STATUSPAGE_INDICATOR_STATUS: Record<string, CheckStatus> = {
  none: 'up',
  minor: 'degraded',
  major: 'down',
  critical: 'down',
  maintenance: 'degraded',
}

/** The slice of an Atlassian Statuspage `summary.json` payload we rely on. */
export interface StatuspageSummary {
  status?: { indicator?: string, description?: string }
  components?: Array<{ id?: string, name?: string, status?: string }>
}

/**
 * Resolve the `summary.json` API URL for a configured Statuspage `url`. A bare
 * page URL (`https://status.claude.com`) gets `/api/v2/summary.json` appended;
 * a URL already pointing at an `/api/v2/*.json` endpoint is used verbatim.
 */
export function statuspageSummaryUrl(url: string): string {
  if (/\/api\/v2\/[^/]+\.json$/.test(url)) {
    return url
  }
  // Strip trailing slashes with a linear character scan rather than a
  // backtracking regex (`/\/+$/` is a polynomial-ReDoS pattern on inputs with
  // many trailing slashes — flagged by CodeQL js/polynomial-redos).
  let end = url.length
  while (end > 0 && url.charCodeAt(end - 1) === 47 /* '/' */) {
    end--
  }
  return `${url.slice(0, end)}/api/v2/summary.json`
}

/**
 * Grade a Statuspage `summary.json` payload. With a `component` (matched by id
 * or case-insensitive name) the single component's status wins; otherwise the
 * page's overall `indicator` is used. Unknown status strings map to `degraded`
 * (something is off, but not clearly an outage). Throws when a named component
 * isn't present so the caller records it as `down` with a clear error.
 */
export function deriveStatuspageStatus(summary: StatuspageSummary, component?: string): CheckStatus {
  if (component !== undefined) {
    const target = component.trim().toLowerCase()
    const match = summary.components?.find(
      c => c.id === component || c.name?.trim().toLowerCase() === target,
    )
    if (!match) {
      throw new Error(`Statuspage component not found: ${component}`)
    }
    return STATUSPAGE_COMPONENT_STATUS[match.status ?? ''] ?? 'degraded'
  }
  return STATUSPAGE_INDICATOR_STATUS[summary.status?.indicator ?? ''] ?? 'degraded'
}

/**
 * Statuspage check: fetch the page's `summary.json` and map the overall
 * indicator (or a single configured `component`) to a {@link CheckStatus}.
 * `responseTime` measures the API call, not the monitored service, so it does
 * not affect the verdict — the status comes entirely from the payload.
 */
async function checkStatuspage(site: Site, fetchImpl: FetchLike, now: () => number): Promise<CheckResult> {
  const start = now()
  const url = statuspageSummaryUrl(site.url)
  const checkedAt = new Date(start).toISOString()

  // Phase 1: the network round-trip. A throw here means the request never
  // completed, so `code: 0` is the honest signal (per CheckResult.code).
  let res: Response
  try {
    res = await fetchImpl(url, { method: 'GET', redirect: 'follow' })
  }
  catch (err) {
    return {
      slug: site.slug,
      status: 'down',
      code: 0,
      responseTime: now() - start,
      checkedAt,
      error: err instanceof Error ? err.message : String(err),
    }
  }

  const responseTime = now() - start
  if (!res.ok) {
    return { slug: site.slug, status: 'down', code: res.status, responseTime, checkedAt, error: `Statuspage API returned ${res.status}` }
  }

  // Phase 2: parse and grade. The request already completed, so preserve the
  // real HTTP status in `code` — a failure here (malformed body, unknown
  // component) is a payload/config problem, distinct from a network outage,
  // and collapsing it to `code: 0` would make a persistent misconfiguration
  // look like transient flakiness in the persisted history.
  try {
    const summary = (await res.json()) as StatuspageSummary
    if (typeof summary !== 'object' || summary === null) {
      return { slug: site.slug, status: 'down', code: res.status, responseTime, checkedAt, error: 'Statuspage summary.json was not a JSON object' }
    }
    return {
      slug: site.slug,
      status: deriveStatuspageStatus(summary, site.component),
      code: res.status,
      responseTime,
      checkedAt,
    }
  }
  catch (err) {
    return {
      slug: site.slug,
      status: 'down',
      code: res.status,
      responseTime,
      checkedAt,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
