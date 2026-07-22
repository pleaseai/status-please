import type { Env } from './env'
import { describe, expect, it } from 'bun:test'
import { handleWebhook } from './webhook'

/**
 * A minimal in-memory {@link Env} + {@link ExecutionContext} so the webhook
 * handler's routing/auth/dispatch can be driven under bun:test without a
 * Cloudflare runtime (no miniflare). The KV holds the config YAML (and the
 * summary the ingest pipeline reads/writes); the D1 stub records the check-row
 * INSERT binds and returns an empty history so `writeSummary` runs end to end.
 */
function makeEnv(secret: string | undefined) {
  const kv = new Map<string, string>([
    [
      'config',
      `name: Test
sites:
  - name: Claude API
    url: https://status.claude.com
    check: statuspage
    component: Claude API (api.anthropic.com)
  - name: Website
    url: https://example.com
    check: http
theme:
  darkMode: true
`,
    ],
  ])
  const inserted: unknown[][] = []
  const env = {
    WEBHOOK_SECRET: secret,
    STATUS_KV: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => {
        kv.set(k, v)
      },
    },
    DB: {
      batch: async (stmts: unknown[]) => stmts,
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => {
          if (sql.includes('INSERT INTO checks')) {
            inserted.push(args)
          }
          return { all: async () => ({ results: [] }) }
        },
      }),
    },
  } as unknown as Env
  const waited: Promise<unknown>[] = []
  const ctx = {
    waitUntil: (p: Promise<unknown>) => {
      waited.push(p)
    },
    passThroughOnException: () => {},
  } as unknown as ExecutionContext
  return { env, ctx, kv, inserted, waited }
}

/** A component_update payload that maps the configured component to `down`. */
const majorOutage = {
  page: { id: 'p1', status_indicator: 'major' },
  component_update: { component_id: 'abc', new_status: 'major_outage' },
  component: { id: 'abc', name: 'Claude API (api.anthropic.com)', status: 'major_outage' },
}

function post(path: string, body?: unknown): Request {
  return new Request(`https://worker.example${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('handleWebhook — routing', () => {
  it('404s an unrelated path', async () => {
    const { env, ctx } = makeEnv('s3cret')
    const res = await handleWebhook(new Request('https://worker.example/'), env, ctx)
    expect(res.status).toBe(404)
  })

  it('405s a non-POST method on the webhook route', async () => {
    const { env, ctx } = makeEnv('s3cret')
    const res = await handleWebhook(new Request('https://worker.example/webhooks/statuspage/claude-api?token=s3cret'), env, ctx)
    expect(res.status).toBe(405)
  })
})

describe('handleWebhook — auth', () => {
  it('401s when WEBHOOK_SECRET is unset (fails closed)', async () => {
    const { env, ctx } = makeEnv(undefined)
    const res = await handleWebhook(post('/webhooks/statuspage/claude-api?token=anything', majorOutage), env, ctx)
    expect(res.status).toBe(401)
  })

  it('401s on a wrong token', async () => {
    const { env, ctx } = makeEnv('s3cret')
    const res = await handleWebhook(post('/webhooks/statuspage/claude-api?token=WRONG', majorOutage), env, ctx)
    expect(res.status).toBe(401)
  })

  it('401s on a missing token', async () => {
    const { env, ctx } = makeEnv('s3cret')
    const res = await handleWebhook(post('/webhooks/statuspage/claude-api', majorOutage), env, ctx)
    expect(res.status).toBe(401)
  })
})

describe('handleWebhook — site lookup', () => {
  it('404s an unknown slug', async () => {
    const { env, ctx } = makeEnv('s3cret')
    const res = await handleWebhook(post('/webhooks/statuspage/nope?token=s3cret', majorOutage), env, ctx)
    expect(res.status).toBe(404)
  })

  it('404s a slug that is not a statuspage check', async () => {
    const { env, ctx } = makeEnv('s3cret')
    const res = await handleWebhook(post('/webhooks/statuspage/website?token=s3cret', majorOutage), env, ctx)
    expect(res.status).toBe(404)
  })
})

describe('handleWebhook — payload', () => {
  it('400s on a malformed JSON body', async () => {
    const { env, ctx } = makeEnv('s3cret')
    const req = new Request('https://worker.example/webhooks/statuspage/claude-api?token=s3cret', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    })
    const res = await handleWebhook(req, env, ctx)
    expect(res.status).toBe(400)
  })

  it('400s on a wrong-shaped payload', async () => {
    const { env, ctx } = makeEnv('s3cret')
    const res = await handleWebhook(post('/webhooks/statuspage/claude-api?token=s3cret', { page: 'oops' }), env, ctx)
    expect(res.status).toBe(400)
  })

  it('204s a valid event about a different component (ignored)', async () => {
    const { env, ctx, inserted } = makeEnv('s3cret')
    const other = { component: { id: 'def', name: 'claude.ai', status: 'operational' } }
    const res = await handleWebhook(post('/webhooks/statuspage/claude-api?token=s3cret', other), env, ctx)
    expect(res.status).toBe(204)
    // Ignored events must not write a check row.
    expect(inserted.length).toBe(0)
  })
})

describe('handleWebhook — ingest', () => {
  it('200s a matching event and records the mapped check row + summary', async () => {
    const { env, ctx, inserted, kv } = makeEnv('s3cret')
    const res = await handleWebhook(post('/webhooks/statuspage/claude-api?token=s3cret', majorOutage), env, ctx)
    expect(res.status).toBe(200)

    // One check row for this slug, with the mapped status.
    expect(inserted.length).toBe(1)
    const [slug, status] = inserted[0] as [string, string]
    expect(slug).toBe('claude-api')
    expect(status).toBe('down')

    // The snapshot the status page reads was rewritten with the new status.
    const summary = JSON.parse(kv.get('summary')!) as { slug: string, status: string }[]
    expect(summary.find(s => s.slug === 'claude-api')?.status).toBe('down')
  })
})
