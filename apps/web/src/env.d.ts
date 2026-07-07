/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

// Bindings are accessed via `import { env } from 'cloudflare:workers'`
// (Astro 7 removed `Astro.locals.runtime`). Mirrors the check Worker's Env
// (apps/worker/src/env.ts).
declare module 'cloudflare:workers' {
  interface Env {
    DB: D1Database
    STATUS_KV: KVNamespace
  }
}
