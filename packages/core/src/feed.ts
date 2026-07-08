import type { Incident, IncidentState } from './incidents'
import { latestUpdate, orderedUpdates } from './incidents'

/**
 * Everything the {@link buildRssFeed}/{@link buildAtomFeed} generators need
 * beyond the incidents themselves. All URLs are absolute; the endpoint derives
 * them from the incoming request so a self-hosted deploy gets its own origin.
 */
export interface FeedMeta {
  /** Status page display name, e.g. "statusbeam Demo". */
  name: string
  /** Absolute origin of the status page, no trailing slash, e.g. "https://demo.statusbeam.dev". */
  siteUrl: string
  /** Absolute URL of this feed document itself, e.g. "https://demo.statusbeam.dev/feed.atom". */
  feedUrl: string
  /**
   * Feed build time in ms since the epoch (populates `<updated>` / `lastBuildDate`).
   * Injectable so generated output is deterministic in tests; defaults to now.
   */
  now?: number
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** Human-readable, capitalized labels for the update state shown in each entry. */
const STATE_LABEL: Record<IncidentState, string> = {
  investigating: 'Investigating',
  identified: 'Identified',
  monitoring: 'Monitoring',
  resolved: 'Resolved',
}

/**
 * Escape the five XML predefined entities. Used for BOTH roles in the feed:
 * escaping attribute/text values, and (applied a second time) escaping the whole
 * HTML content blob embedded in `<content type="html">` / `<description>`. HTML's
 * and XML's special-character sets coincide here, so one function serves both and
 * the double application produces the correct entity-in-entity encoding.
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Format an ISO timestamp as `Mon DD, YYYY - HH:MM UTC` (the compact, UTC form
 * Statuspage.io uses inside each update line). Built from UTC getters rather than
 * `Intl` so the output is stable across runtimes and locales. Returns the input
 * unchanged when it isn't a parseable date.
 */
function formatUpdateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) {
    return iso
  }
  const mon = MONTHS[d.getUTCMonth()]
  const day = String(d.getUTCDate()).padStart(2, '0')
  const year = d.getUTCFullYear()
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${mon} ${day}, ${year} - ${hh}:${mm} UTC`
}

/**
 * Parse an ISO timestamp to epoch ms, or `fallback` when it isn't a valid date.
 * KV incident records are only type-asserted, never validated (see
 * `getIncidents`), so a single malformed timestamp must not throw
 * (`Date#toISOString()` raises `RangeError`) or corrupt the output — every date
 * that reaches the feed goes through here first, mirroring the NaN guard
 * {@link formatUpdateTime} already applies to the display timestamps.
 */
function toMs(iso: string, fallback: number): number {
  const ms = new Date(iso).getTime()
  return Number.isNaN(ms) ? fallback : ms
}

/**
 * Resolve the feed's build time (ms) from the optional injectable `meta.now`,
 * falling back to the current time. Validates the resulting {@link Date}, not
 * just `Number.isFinite(now)` — a finite but out-of-range value (e.g. `1e20`)
 * still yields an invalid Date that would throw in `toISOString()` / emit the
 * literal "Invalid Date" in `toUTCString()`.
 */
function resolveBuildMs(now: number | undefined): number {
  if (now === undefined) {
    return Date.now()
  }
  const ms = new Date(now).getTime()
  return Number.isNaN(ms) ? Date.now() : ms
}

/**
 * The timestamp a feed reader should sort/display the incident by: its most
 * recent update, falling back to resolution then start. Drives both feed
 * ordering and each item's `pubDate` / `<updated>`.
 */
function incidentUpdatedAt(incident: Incident): string {
  return latestUpdate(incident)?.createdAt ?? incident.resolvedAt ?? incident.startedAt
}

/** Incidents newest-activity-first (by {@link incidentUpdatedAt}), non-mutating. */
export function sortIncidentsForFeed(incidents: Incident[]): Incident[] {
  // `toMs(..., 0)` keeps the comparator total: a malformed timestamp sorts to
  // the epoch instead of poisoning the sort with a `NaN` return.
  return [...incidents].sort(
    (a, b) => toMs(incidentUpdatedAt(b), 0) - toMs(incidentUpdatedAt(a), 0),
  )
}

/**
 * Render an incident's updates as the HTML blob shown in a feed item — newest
 * update first, each `<p><small>time</small><br /><strong>State</strong> - body</p>`,
 * matching the Statuspage.io/incident.io layout. Bodies are XML-escaped here so a
 * literal `<` in an operator message renders as text once the reader unescapes
 * the outer `type="html"` content.
 */
export function incidentContentHtml(incident: Incident): string {
  const newestFirst = orderedUpdates(incident).reverse()
  return newestFirst
    .map(u =>
      `<p><small>${formatUpdateTime(u.createdAt)}</small><br /><strong>${STATE_LABEL[u.state]}</strong> - ${escapeXml(u.body)}</p>`,
    )
    .join('')
}

/** Host of the status page, for the `tag:` URI scheme; the raw value on a parse failure. */
function feedHost(siteUrl: string): string {
  try {
    return new URL(siteUrl).host
  }
  catch {
    return siteUrl
  }
}

/**
 * A stable, globally-unique `tag:` URI for an incident (or the feed itself when
 * `id` is omitted), following the scheme Statuspage.io emits, e.g.
 * `tag:demo.statusbeam.dev,2005:Incident/2`. The `2005` is the tag-scheme epoch
 * Statuspage uses verbatim; it only needs to be constant for the URI to stay stable.
 */
function tagUri(host: string, id?: number): string {
  // A WHATWG-parsed `.host` can't contain XML metacharacters, but `feedHost`
  // falls back to the raw `siteUrl` on a parse failure — escape here so this
  // (the one output the builders don't escape at the call site) can't break
  // well-formedness, keeping the "everything reaching output is escaped" invariant total.
  const safeHost = escapeXml(host)
  return id === undefined ? `tag:${safeHost},2005:/history` : `tag:${safeHost},2005:Incident/${id}`
}

/**
 * Build an Atom 1.0 incident-history feed (the `feed.atom` / `history.atom`
 * document). One `<entry>` per incident, newest activity first, each carrying its
 * full update timeline as escaped HTML content.
 */
export function buildAtomFeed(incidents: Incident[], meta: FeedMeta): string {
  const host = feedHost(meta.siteUrl)
  const updated = new Date(resolveBuildMs(meta.now)).toISOString()

  const entries = sortIncidentsForFeed(incidents).map(inc =>
    [
      '  <entry>',
      `    <id>${tagUri(host, inc.id)}</id>`,
      `    <title>${escapeXml(inc.title)}</title>`,
      // Malformed timestamps fall back to the epoch (0), matching
      // `sortIncidentsForFeed` — a dead record stays put and reads as old,
      // rather than masquerading as freshly-built on every rebuild.
      `    <published>${new Date(toMs(inc.startedAt, 0)).toISOString()}</published>`,
      `    <updated>${new Date(toMs(incidentUpdatedAt(inc), 0)).toISOString()}</updated>`,
      `    <link rel="alternate" type="text/html" href="${escapeXml(`${meta.siteUrl}/`)}"/>`,
      `    <content type="html">${escapeXml(incidentContentHtml(inc))}</content>`,
      '  </entry>',
    ].join('\n'),
  )

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <id>${tagUri(host)}</id>`,
    `  <title>${escapeXml(meta.name)} - Incident History</title>`,
    `  <updated>${updated}</updated>`,
    `  <author><name>${escapeXml(meta.name)}</name></author>`,
    `  <link rel="alternate" type="text/html" href="${escapeXml(meta.siteUrl)}"/>`,
    `  <link rel="self" type="application/atom+xml" href="${escapeXml(meta.feedUrl)}"/>`,
    ...entries,
    '</feed>',
    '',
  ].join('\n')
}

/**
 * Build an RSS 2.0 incident-history feed (the `feed.rss` / `history.rss`
 * document). One `<item>` per incident, newest activity first, each carrying its
 * full update timeline as escaped HTML in `<description>`.
 */
export function buildRssFeed(incidents: Incident[], meta: FeedMeta): string {
  const host = feedHost(meta.siteUrl)
  const buildDate = new Date(resolveBuildMs(meta.now)).toUTCString()

  const items = sortIncidentsForFeed(incidents).map(inc =>
    [
      '    <item>',
      `      <title>${escapeXml(inc.title)}</title>`,
      `      <link>${escapeXml(`${meta.siteUrl}/`)}</link>`,
      `      <guid isPermaLink="false">${tagUri(host, inc.id)}</guid>`,
      // Epoch fallback for a malformed timestamp (see `buildAtomFeed`).
      `      <pubDate>${new Date(toMs(incidentUpdatedAt(inc), 0)).toUTCString()}</pubDate>`,
      `      <description>${escapeXml(incidentContentHtml(inc))}</description>`,
      '    </item>',
    ].join('\n'),
  )

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${escapeXml(meta.name)} - Incident History</title>`,
    `    <link>${escapeXml(meta.siteUrl)}</link>`,
    `    <description>${escapeXml(`Incident history for ${meta.name}`)}</description>`,
    `    <atom:link href="${escapeXml(meta.feedUrl)}" rel="self" type="application/rss+xml"/>`,
    `    <lastBuildDate>${buildDate}</lastBuildDate>`,
    ...items,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n')
}
