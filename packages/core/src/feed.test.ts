import type { Incident, IncidentState, IncidentUpdate } from './incidents'
import { describe, expect, it } from 'bun:test'
import { buildAtomFeed, buildRssFeed, escapeXml, incidentContentHtml, sortIncidentsForFeed } from './feed'

function update(id: number, state: IncidentState, createdAt: string, body = `${state} body`): IncidentUpdate {
  return { id, incidentId: 1, state, body, createdAt }
}

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: 2,
    slug: 'api',
    title: 'Elevated API error rates',
    severity: 'degraded',
    startedAt: '2026-01-01T00:00:00.000Z',
    resolvedAt: null,
    updates: [
      update(1, 'investigating', '2026-01-01T00:00:00.000Z', 'Investigating a spike in 5xx.'),
      update(2, 'identified', '2026-01-01T01:00:00.000Z', 'A slow upstream is the cause.'),
    ],
    ...overrides,
  }
}

const META = {
  name: 'statusbeam Demo',
  siteUrl: 'https://demo.statusbeam.dev',
  feedUrl: 'https://demo.statusbeam.dev/feed.atom',
  now: Date.parse('2026-01-02T00:00:00.000Z'),
}

describe('escapeXml', () => {
  it('escapes the five predefined entities', () => {
    expect(escapeXml(`a & b < c > d " e ' f`)).toBe('a &amp; b &lt; c &gt; d &quot; e &apos; f')
  })
})

describe('sortIncidentsForFeed', () => {
  it('orders by most recent update, newest first, without mutating the input', () => {
    const older = incident({ id: 1, updates: [update(9, 'resolved', '2026-01-01T00:30:00.000Z')] })
    const newer = incident({ id: 2 }) // latest update at 01:00
    const input = [older, newer]
    const sorted = sortIncidentsForFeed(input)
    expect(sorted.map(i => i.id)).toEqual([2, 1])
    expect(input.map(i => i.id)).toEqual([1, 2])
  })

  it('falls back to resolvedAt then startedAt when an incident has no updates', () => {
    const noUpdates = incident({ id: 3, updates: [], startedAt: '2026-02-01T00:00:00.000Z' })
    const withUpdate = incident({ id: 4 })
    expect(sortIncidentsForFeed([withUpdate, noUpdates]).map(i => i.id)).toEqual([3, 4])
  })
})

describe('incidentContentHtml', () => {
  it('renders updates newest-first with state label, UTC time, and escaped body', () => {
    const html = incidentContentHtml(incident({
      updates: [update(1, 'investigating', '2026-01-01T00:00:00.000Z', 'a < b & c')],
    }))
    expect(html).toBe('<p><small>Jan 01, 2026 - 00:00 UTC</small><br /><strong>Investigating</strong> - a &lt; b &amp; c</p>')
  })

  it('places the most recent update first', () => {
    const html = incidentContentHtml(incident())
    expect(html.indexOf('Identified')).toBeLessThan(html.indexOf('Investigating'))
  })
})

describe('buildAtomFeed', () => {
  const xml = buildAtomFeed([incident()], META)

  it('emits a well-formed Atom envelope with tag: URIs and self/alternate links', () => {
    expect(xml).toStartWith('<?xml version="1.0" encoding="UTF-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">')
    expect(xml).toContain('<id>tag:demo.statusbeam.dev,2005:/history</id>')
    expect(xml).toContain('<title>statusbeam Demo - Incident History</title>')
    expect(xml).toContain('<updated>2026-01-02T00:00:00.000Z</updated>')
    expect(xml).toContain('<link rel="self" type="application/atom+xml" href="https://demo.statusbeam.dev/feed.atom"/>')
    expect(xml).toContain('<link rel="alternate" type="text/html" href="https://demo.statusbeam.dev"/>')
  })

  it('emits one entry per incident with a tag: id, published/updated, and html content', () => {
    expect(xml).toContain('<id>tag:demo.statusbeam.dev,2005:Incident/2</id>')
    expect(xml).toContain('<published>2026-01-01T00:00:00.000Z</published>')
    expect(xml).toContain('<updated>2026-01-01T01:00:00.000Z</updated>')
    // Content HTML is entity-escaped for embedding in type="html".
    expect(xml).toContain('<content type="html">&lt;p&gt;')
  })
})

describe('buildRssFeed', () => {
  const xml = buildRssFeed([incident()], { ...META, feedUrl: 'https://demo.statusbeam.dev/feed.rss' })

  it('emits a well-formed RSS 2.0 channel with an atom:self link and RFC-822 build date', () => {
    expect(xml).toStartWith('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"')
    expect(xml).toContain('<title>statusbeam Demo - Incident History</title>')
    expect(xml).toContain('<atom:link href="https://demo.statusbeam.dev/feed.rss" rel="self" type="application/rss+xml"/>')
    expect(xml).toContain('<lastBuildDate>Fri, 02 Jan 2026 00:00:00 GMT</lastBuildDate>')
  })

  it('emits one item per incident with a non-permalink guid, pubDate, and escaped description', () => {
    expect(xml).toContain('<guid isPermaLink="false">tag:demo.statusbeam.dev,2005:Incident/2</guid>')
    expect(xml).toContain('<pubDate>Thu, 01 Jan 2026 01:00:00 GMT</pubDate>')
    expect(xml).toContain('<description>&lt;p&gt;')
    expect(xml).toContain('<link>https://demo.statusbeam.dev/</link>')
  })
})
