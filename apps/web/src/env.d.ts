/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

// Bindings this app reads at the edge. Mirrors the check Worker's Env
// (apps/worker/src/env.ts); kept in sync manually to avoid a cross-app import.
interface RuntimeEnv {
  DB: D1Database
  STATUS_KV: KVNamespace
}

declare namespace App {
  interface Locals {
    runtime?: {
      env?: Partial<RuntimeEnv>
    }
  }
}
