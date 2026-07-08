import type { APIRoute } from 'astro'
import { feedResponse } from '../lib/feed'

// On-demand: reads the live KV incident timeline at the edge, fronted by Workers Cache.
export const prerender = false

/** RSS 2.0 incident-history feed (incident.io/OpenAI-style `feed.rss` route). */
export const GET: APIRoute = context => feedResponse('rss', context)
