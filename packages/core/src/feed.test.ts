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

  it('returns an empty string for a nullish value (type-asserted KV records)', () => {
    expect(escapeXml(null)).toBe('')
    expect(escapeXml(undefined)).toBe('')
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

  it('sorts an updateless incident by resolvedAt over startedAt', () => {
    // startedAt is old, but resolvedAt is the most recent activity → sorts first.
    const resolved = incident({ id: 5, updates: [], startedAt: '2026-01-01T00:00:00.000Z', resolvedAt: '2026-03-01T00:00:00.000Z' })
    const other = incident({ id: 6, updates: [update(1, 'investigating', '2026-02-01T00:00:00.000Z')] })
    expect(sortIncidentsForFeed([other, resolved]).map(i => i.id)).toEqual([5, 6])
  })

  it('keeps the comparator total when a timestamp is unparseable (no NaN poisoning)', () => {
    const bad = incident({ id: 7, updates: [update(1, 'investigating', 'not-a-date')] })
    const good = incident({ id: 8 })
    // The malformed one sorts to the epoch (last), the valid one stays ahead.
    expect(sortIncidentsForFeed([bad, good]).map(i => i.id)).toEqual([8, 7])
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

  it('escapes a malformed createdAt in the timestamp slot (no raw markup after decode)', () => {
    // An unparseable createdAt containing markup must be escaped like the body,
    // not passed through raw into the <small> slot.
    const html = incidentContentHtml(incident({
      updates: [update(1, 'investigating', '<script>&', 'body')],
    }))
    expect(html).toContain('<small>&lt;script&gt;&amp;</small>')
    expect(html).not.toContain('<small><script>&</small>')
  })

  it('does not crash when an update body is missing (nullish from bad KV)', () => {
    const broken = incident({ updates: [{ id: 1, incidentId: 2, state: 'investigating', body: undefined as unknown as string, createdAt: '2026-01-01T00:00:00.000Z' }] })
    expect(() => incidentContentHtml(broken)).not.toThrow()
    expect(incidentContentHtml(broken)).toContain('<strong>Investigating</strong> - </p>')
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

describe('feed robustness', () => {
  it('escapes XML metacharacters in the incident title and page name (not just the body)', () => {
    const meta = { ...META, name: 'Acme & <Co>' }
    const inc = incident({ title: 'API & DB "outage" <down>' })
    for (const xml of [buildAtomFeed([inc], meta), buildRssFeed([inc], meta)]) {
      expect(xml).toContain('API &amp; DB &quot;outage&quot; &lt;down&gt;')
      expect(xml).not.toContain('API & DB "outage" <down>')
      expect(xml).toContain('Acme &amp; &lt;Co&gt;')
    }
  })

  it('does not crash when an incident title is missing (nullish from bad KV)', () => {
    const broken = incident({ title: undefined as unknown as string })
    expect(() => buildAtomFeed([broken], META)).not.toThrow()
    expect(() => buildRssFeed([broken], META)).not.toThrow()
    // Both flavors render an empty title element rather than "undefined".
    expect(buildAtomFeed([broken], META)).toContain('<title></title>')
    expect(buildRssFeed([broken], META)).toContain('<title></title>')
  })

  it('does not throw or emit "Invalid Date" when an incident timestamp is unparseable', () => {
    const broken = incident({ startedAt: 'not-a-date', resolvedAt: null, updates: [update(1, 'investigating', 'nonsense')] })
    // Atom's toISOString() would RangeError, RSS's toUTCString() would emit
    // "Invalid Date" — both fall back to the epoch (stable across rebuilds,
    // consistent with the sort fallback) instead.
    const atom = buildAtomFeed([broken], META)
    expect(atom).not.toContain('Invalid Date')
    expect(atom).toContain('<published>1970-01-01T00:00:00.000Z</published>')
    const rss = buildRssFeed([broken], { ...META, feedUrl: 'https://demo.statusbeam.dev/feed.rss' })
    expect(rss).not.toContain('Invalid Date')
    expect(rss).toContain('<pubDate>Thu, 01 Jan 1970 00:00:00 GMT</pubDate>')
  })

  it('does not throw or emit "Invalid Date" for a non-finite or out-of-range `now`', () => {
    // Number.isFinite(1e20) is true, but new Date(1e20) is an invalid Date —
    // the build-time guard must validate the Date, not just the number.
    for (const now of [Number.NaN, Number.POSITIVE_INFINITY, 1e20]) {
      expect(() => buildAtomFeed([incident()], { ...META, now })).not.toThrow()
      expect(buildRssFeed([incident()], { ...META, now })).not.toContain('Invalid Date')
    }
  })

  it('escapes the tag: URI host when siteUrl is unparseable (feedHost raw fallback)', () => {
    // An unparseable siteUrl makes feedHost return the raw string; without
    // escaping in tagUri, `&`/`<` would break the <id>/<guid> XML.
    const meta = { ...META, siteUrl: 'not-a-url & <x>' }
    const atom = buildAtomFeed([incident()], meta)
    expect(atom).toContain('<id>tag:not-a-url &amp; &lt;x&gt;,2005:/history</id>')
    expect(atom).not.toContain('not-a-url & <x>,2005')
    const rss = buildRssFeed([incident()], meta)
    expect(rss).toContain('<guid isPermaLink="false">tag:not-a-url &amp; &lt;x&gt;,2005:Incident/2</guid>')
  })

  it('produces a valid, entry-less envelope for an empty incident list', () => {
    const atom = buildAtomFeed([], META)
    expect(atom).toContain('<feed xmlns="http://www.w3.org/2005/Atom">')
    expect(atom).not.toContain('<entry>')
    const rss = buildRssFeed([], META)
    expect(rss).toContain('<channel>')
    expect(rss).not.toContain('<item>')
  })
})
