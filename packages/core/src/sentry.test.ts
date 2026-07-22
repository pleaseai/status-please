import type { FetchLike } from './check'
import { describe, expect, it } from 'bun:test'
import { siteSchema } from './config'
import { checkSentry, DEFAULT_SENTRY_QUERY, sentryIssuesSchema, sentryIssuesUrl } from './sentry'

/** A `check: sentry` site with the poll-backstop block configured. */
const pollSite = siteSchema.parse({
  name: 'API',
  url: 'https://api.example.com',
  check: 'sentry',
  sentry: { org: 'acme', project: 'api' },
})

/** A webhook-only `check: sentry` site (no poll config). */
const webhookOnlySite = siteSchema.parse({ name: 'API', url: 'https://api.example.com', check: 'sentry' })

/** Resolve to a Sentry Issues API response with the given JSON body. */
function issuesResponse(body: unknown, status = 200): FetchLike {
  return () => Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  }))
}

describe('sentryIssuesUrl', () => {
  it('builds the org issues endpoint with the default query and project', () => {
    const url = new URL(sentryIssuesUrl(pollSite))
    expect(url.origin).toBe('https://sentry.io')
    expect(url.pathname).toBe('/api/0/organizations/acme/issues/')
    expect(url.searchParams.get('query')).toBe(DEFAULT_SENTRY_QUERY)
    expect(url.searchParams.get('project')).toBe('api')
    expect(url.searchParams.get('limit')).toBe('1')
  })

  it('honors a host override and a custom query, and omits project when absent', () => {
    const site = siteSchema.parse({
      name: 'API',
      url: 'https://api.example.com',
      check: 'sentry',
      sentry: { org: 'acme', host: 'https://us.sentry.io/', query: 'is:unresolved api.example.com' },
    })
    const url = new URL(sentryIssuesUrl(site))
    expect(url.origin).toBe('https://us.sentry.io')
    expect(url.searchParams.get('query')).toBe('is:unresolved api.example.com')
    expect(url.searchParams.has('project')).toBe(false)
  })

  it('throws for a site without a sentry block', () => {
    expect(() => sentryIssuesUrl(webhookOnlySite)).toThrow()
  })
})

describe('sentryIssuesSchema', () => {
  it('accepts an empty array and an array of partial issues', () => {
    expect(sentryIssuesSchema.safeParse([]).success).toBe(true)
    expect(sentryIssuesSchema.safeParse([{ id: '1', status: 'unresolved' }]).success).toBe(true)
  })

  it('rejects a non-array body', () => {
    expect(sentryIssuesSchema.safeParse({ detail: 'Invalid token' }).success).toBe(false)
  })
})

describe('checkSentry', () => {
  it('reports down without hitting the network when no token is provided', async () => {
    let called = false
    const result = await checkSentry(pollSite, {
      fetchImpl: () => {
        called = true
        return Promise.resolve(new Response('[]'))
      },
      now: () => 0,
    })
    expect(called).toBe(false)
    expect(result.status).toBe('down')
    expect(result.code).toBe(0)
    expect(result.error).toContain('SENTRY_AUTH_TOKEN')
  })

  it('reports up when the issue search returns no unresolved outages', async () => {
    const result = await checkSentry(pollSite, { fetchImpl: issuesResponse([]), now: () => 0, token: 't' })
    expect(result.status).toBe('up')
    expect(result.code).toBe(200)
    expect(result.slug).toBe('api')
  })

  it('reports down when an unresolved outage issue exists', async () => {
    const result = await checkSentry(pollSite, {
      fetchImpl: issuesResponse([{ id: '9', status: 'unresolved', title: 'Uptime check failed for api.example.com' }]),
      now: () => 0,
      token: 't',
    })
    expect(result.status).toBe('down')
    expect(result.code).toBe(200)
  })

  it('sends the auth token as a Bearer header', async () => {
    const seen: { authorization: string | null } = { authorization: null }
    const fetchImpl: FetchLike = (_url, init) => {
      seen.authorization = new Headers(init?.headers).get('authorization')
      return Promise.resolve(new Response('[]', { status: 200 }))
    }
    await checkSentry(pollSite, { fetchImpl, now: () => 0, token: 'sk-abc' })
    expect(seen.authorization).toBe('Bearer sk-abc')
  })

  it('reports down with code 0 when the request throws', async () => {
    const result = await checkSentry(pollSite, {
      fetchImpl: () => Promise.reject(new Error('network')),
      now: () => 0,
      token: 't',
    })
    expect(result.status).toBe('down')
    expect(result.code).toBe(0)
    expect(result.error).toBe('network')
  })

  it('reports down preserving the real HTTP code on a non-2xx response', async () => {
    const result = await checkSentry(pollSite, { fetchImpl: issuesResponse({ detail: 'nope' }, 403), now: () => 0, token: 't' })
    expect(result.status).toBe('down')
    expect(result.code).toBe(403)
    expect(result.error).toContain('403')
  })

  it('reports down when the payload is the wrong shape', async () => {
    const result = await checkSentry(pollSite, { fetchImpl: issuesResponse({ not: 'an array' }), now: () => 0, token: 't' })
    expect(result.status).toBe('down')
    expect(result.code).toBe(200)
    expect(result.error).toContain('validation')
  })
})
