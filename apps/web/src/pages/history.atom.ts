import type { APIRoute } from 'astro'
import { feedResponse } from '../lib/feed'

// On-demand: reads the live KV incident timeline at the edge, fronted by Workers Cache.
export const prerender = false

/** Atom 1.0 incident-history feed — Statuspage.io-style `history.atom` alias of `/feed.atom`. */
export const GET: APIRoute = context => feedResponse('atom', context)
