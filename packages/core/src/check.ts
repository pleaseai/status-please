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
 * Only HTTP checks are implemented here; `tcp`/`ssl` are handled by the Worker
 * runtime and tracked in the roadmap.
 */
export async function checkSite(
  site: Site,
  deps: { fetchImpl?: FetchLike, now?: () => number } = {},
): Promise<CheckResult> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const now = deps.now ?? Date.now
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
