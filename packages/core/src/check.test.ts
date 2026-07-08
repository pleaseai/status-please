import { describe, expect, it } from 'bun:test'
import { checkSite, deriveStatus, deriveStatuspageStatus, statuspageSummaryUrl } from './check'
import { siteSchema } from './config'

const site = siteSchema.parse({ name: 'Example', url: 'https://example.com' })

/** A minimal Statuspage summary.json body for the given indicator/components. */
function statuspageResponse(body: unknown): () => Promise<Response> {
  return () => Promise.resolve(new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }))
}

const claudeSummary = {
  status: { indicator: 'none', description: 'All Systems Operational' },
  components: [
    { id: 'abc', name: 'Claude API (api.anthropic.com)', status: 'major_outage' },
    { id: 'def', name: 'claude.ai', status: 'degraded_performance' },
  ],
}

describe('deriveStatus', () => {
  it('is up for an expected, fast response', () => {
    expect(deriveStatus(200, 100, site)).toBe('up')
  })

  it('is degraded when slower than maxResponseTime', () => {
    expect(deriveStatus(200, site.maxResponseTime + 1, site)).toBe('degraded')
  })

  it('is down for an unexpected status code', () => {
    expect(deriveStatus(500, 100, site)).toBe('down')
  })
})

describe('checkSite', () => {
  it('reports down when the request throws', async () => {
    const result = await checkSite(site, {
      fetchImpl: () => Promise.reject(new Error('network')),
      now: () => 0,
    })
    expect(result.status).toBe('down')
    expect(result.code).toBe(0)
    expect(result.error).toBe('network')
  })

  it('maps a successful fetch to a check result', async () => {
    let t = 0
    const result = await checkSite(site, {
      fetchImpl: () => Promise.resolve(new Response('', { status: 200 })),
      now: () => (t += 50),
    })
    expect(result.status).toBe('up')
    expect(result.code).toBe(200)
    expect(result.slug).toBe('example')
  })
})

describe('statuspageSummaryUrl', () => {
  it('appends the API path to a bare page URL', () => {
    expect(statuspageSummaryUrl('https://status.claude.com'))
      .toBe('https://status.claude.com/api/v2/summary.json')
  })

  it('strips a trailing slash before appending', () => {
    expect(statuspageSummaryUrl('https://www.vercel-status.com/'))
      .toBe('https://www.vercel-status.com/api/v2/summary.json')
  })

  it('leaves an explicit api/v2 endpoint untouched', () => {
    const url = 'https://status.claude.com/api/v2/status.json'
    expect(statuspageSummaryUrl(url)).toBe(url)
  })
})

describe('deriveStatuspageStatus', () => {
  it('maps the overall indicator when no component is given', () => {
    expect(deriveStatuspageStatus({ status: { indicator: 'none' } })).toBe('up')
    expect(deriveStatuspageStatus({ status: { indicator: 'minor' } })).toBe('degraded')
    expect(deriveStatuspageStatus({ status: { indicator: 'critical' } })).toBe('down')
  })

  it('reads a specific component by case-insensitive name', () => {
    expect(deriveStatuspageStatus(claudeSummary, 'claude api (api.anthropic.com)')).toBe('down')
    expect(deriveStatuspageStatus(claudeSummary, 'claude.ai')).toBe('degraded')
  })

  it('reads a specific component by id', () => {
    expect(deriveStatuspageStatus(claudeSummary, 'abc')).toBe('down')
  })

  it('throws when a named component is missing', () => {
    expect(() => deriveStatuspageStatus(claudeSummary, 'nonexistent')).toThrow(/not found/)
  })

  it('falls back to degraded for unknown status strings', () => {
    expect(deriveStatuspageStatus({ status: { indicator: 'weird' } })).toBe('degraded')
    expect(deriveStatuspageStatus({ components: [{ name: 'X', status: 'weird' }] }, 'X')).toBe('degraded')
  })
})

describe('checkSite (statuspage)', () => {
  const pageSite = siteSchema.parse({ name: 'Claude', url: 'https://status.claude.com', check: 'statuspage' })
  const componentSite = siteSchema.parse({
    name: 'Claude API',
    url: 'https://status.claude.com',
    check: 'statuspage',
    component: 'Claude API (api.anthropic.com)',
  })

  it('grades the overall page indicator', async () => {
    const result = await checkSite(pageSite, { fetchImpl: statuspageResponse(claudeSummary), now: () => 0 })
    expect(result.status).toBe('up')
    expect(result.code).toBe(200)
    expect(result.slug).toBe('claude')
  })

  it('grades a single configured component', async () => {
    const result = await checkSite(componentSite, { fetchImpl: statuspageResponse(claudeSummary), now: () => 0 })
    expect(result.status).toBe('down')
    expect(result.slug).toBe('claude-api')
  })

  it('fetches the derived summary.json endpoint', async () => {
    let requested = ''
    await checkSite(pageSite, {
      fetchImpl: (url) => {
        requested = url
        return statuspageResponse(claudeSummary)()
      },
      now: () => 0,
    })
    expect(requested).toBe('https://status.claude.com/api/v2/summary.json')
  })

  it('reports down on a non-2xx API response', async () => {
    const result = await checkSite(pageSite, {
      fetchImpl: () => Promise.resolve(new Response('nope', { status: 503 })),
      now: () => 0,
    })
    expect(result.status).toBe('down')
    expect(result.code).toBe(503)
    expect(result.error).toContain('503')
  })

  it('reports down when the fetch throws', async () => {
    const result = await checkSite(pageSite, {
      fetchImpl: () => Promise.reject(new Error('network')),
      now: () => 0,
    })
    expect(result.status).toBe('down')
    expect(result.code).toBe(0)
    expect(result.error).toBe('network')
  })
})
