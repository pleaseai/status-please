/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

// Bindings for `import { env } from 'cloudflare:workers'` (Astro 7 removed
// `Astro.locals.runtime`). `env` is typed by the global `Cloudflare.Env`
// namespace, so augment that. STATUS_KV is optional because `astro dev` runs
// without the binding — the single source of truth for the guard in data.ts.
declare namespace Cloudflare {
  interface Env {
    DB: D1Database
    STATUS_KV?: KVNamespace
  }
}
