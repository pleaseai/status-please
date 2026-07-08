import { describe, expect, it } from 'bun:test'
import { injectIds, normalizeDomain, setCron, setNetworking } from './apply-config'

const WORKER = `{
  // worker config
  "name": "my-status-worker",
  "compatibility_flags": ["nodejs_compat"],
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "statusbeam",
      "database_id": "REPLACE_WITH_D1_DATABASE_ID"
    }
  ],
  "kv_namespaces": [
    {
      "binding": "STATUS_KV",
      "id": "REPLACE_WITH_KV_NAMESPACE_ID"
    }
  ],
  "crons": [ "*/5 * * * *" ]
}`

const WEB = `{
  "name": "my-status-web",
  "compatibility_flags": ["nodejs_compat"],
  // Custom domain: the shipped example line.
  "routes": [{ "pattern": "demo.example.com", "custom_domain": true }],
  "workers_dev": true
}`

describe('injectIds', () => {
  it('replaces the D1 and KV placeholder ids', () => {
    const out = injectIds(WORKER, 'd1-abc', 'kv-xyz')
    expect(out).toContain('"database_id": "d1-abc"')
    expect(out).toContain('"id": "kv-xyz"')
    expect(out).not.toContain('REPLACE_WITH')
  })

  it('re-injects over a previously written id (A → B)', () => {
    const once = injectIds(WORKER, 'd1-a', 'kv-a')
    const twice = injectIds(once, 'd1-b', 'kv-b')
    expect(twice).toContain('"database_id": "d1-b"')
    expect(twice).toContain('"id": "kv-b"')
    expect(twice).not.toContain('d1-a')
    expect(twice).not.toContain('kv-a')
  })

  it('does not touch a KV namespace that is not STATUS_KV', () => {
    const cfg = `{
      "kv_namespaces": [
        { "binding": "OTHER", "id": "keep-me" },
        { "binding": "STATUS_KV", "id": "REPLACE_WITH_KV_NAMESPACE_ID" }
      ]
    }`
    const out = injectIds(cfg, undefined, 'kv-new')
    expect(out).toContain('"id": "keep-me"')
    expect(out).toContain('"id": "kv-new"')
  })

  it('leaves the config unchanged when no ids are given', () => {
    expect(injectIds(WORKER)).toBe(WORKER)
  })
})

describe('setCron', () => {
  it('rewrites the cron expression', () => {
    const out = setCron(WORKER, '0 * * * *')
    expect(out).toContain('"crons": [ "0 * * * *" ]')
  })

  it('throws when the crons array is absent', () => {
    expect(() => setCron('{ "name": "x" }', '0 * * * *')).toThrow()
  })
})

describe('setNetworking', () => {
  it('writes a custom-domain route from the shipped example line', () => {
    const out = setNetworking(WEB, 'status.example.com')
    expect(out).toContain('"pattern": "status.example.com"')
    expect(out).toContain('managed by statusbeam')
  })

  it('is idempotent — a second run replaces the managed block', () => {
    const once = setNetworking(WEB, 'a.example.com')
    const twice = setNetworking(once, 'b.example.com')
    expect(twice).toContain('b.example.com')
    expect(twice).not.toContain('a.example.com')
  })

  it('drops the route when the domain is empty', () => {
    const out = setNetworking(WEB, '')
    expect(out).not.toContain('"routes"')
    expect(out).toContain('workers_dev')
  })

  it('inserts the block after compatibility_flags when no marker/comment exists', () => {
    const bare = `{
      "name": "x",
      "compatibility_flags": ["nodejs_compat"],
      "workers_dev": true
    }`
    const out = setNetworking(bare, 'status.example.com')
    expect(out).toContain('"compatibility_flags"')
    expect(out).toContain('"pattern": "status.example.com"')
    expect(out).toContain('managed by statusbeam')
  })

  it('throws when there is no marker, shipped comment, or anchor to place the block', () => {
    expect(() => setNetworking('{ "name": "x" }', 'status.example.com')).toThrow()
  })
})

describe('normalizeDomain', () => {
  it('strips protocol and path', () => {
    expect(normalizeDomain('https://status.example.com/')).toBe('status.example.com')
    expect(normalizeDomain('http://status.example.com/path/x')).toBe('status.example.com')
  })

  it('passes a bare host through and trims whitespace', () => {
    expect(normalizeDomain('  status.example.com  ')).toBe('status.example.com')
  })

  it('keeps an empty answer empty', () => {
    expect(normalizeDomain('')).toBe('')
    expect(normalizeDomain('   ')).toBe('')
  })
})
