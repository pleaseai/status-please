import { describe, expect, it } from 'bun:test'
import { checkSite, deriveStatus } from './check'
import { siteSchema } from './config'

const site = siteSchema.parse({ name: 'Example', url: 'https://example.com' })

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
