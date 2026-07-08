/**
 * Wrangler operations the CLI needs, wrapping the wrangler bin that ships with
 * @statusbeam/web. Provisioning (D1 + KV lookup/create) is the TS port of
 * setup.sh's lookup_d1/lookup_kv + create branches, kept idempotent: look up by
 * name/binding first, create only when absent.
 */
import { capture, run } from './run'

export interface Wrangler {
  /** node/bun executable used to launch the resolved wrangler bin. */
  runtime: string
  /** absolute path to the wrangler bin. */
  bin: string
}

function args(w: Wrangler, rest: string[]): [string, string[]] {
  return [w.runtime, [w.bin, ...rest]]
}

/** True when wrangler can reach an authenticated Cloudflare account. */
export async function isAuthenticated(w: Wrangler): Promise<boolean> {
  const [cmd, a] = args(w, ['whoami'])
  const res = await capture(cmd, a, { allowFailure: true })
  return res.code === 0
}

/**
 * D1 database id for `name`, or undefined if it doesn't exist. Throws on a
 * wrangler failure (expired auth, network) so the caller doesn't misread a failed
 * query as "not found" and create a duplicate.
 */
export async function lookupD1(w: Wrangler, name: string): Promise<string | undefined> {
  const [cmd, a] = args(w, ['d1', 'list', '--json'])
  const res = await capture(cmd, a)
  const text = res.stdout.trim()
  if (!text) {
    return undefined
  }
  // wrangler can print a warning/error banner instead of JSON (expired session,
  // network); surface that as a clear error rather than a raw SyntaxError.
  let list: Array<{ name?: string, uuid?: string, id?: string }>
  try {
    list = JSON.parse(text)
  }
  catch {
    throw new Error(`could not parse the D1 list from wrangler (expected JSON). Output:\n${text}`)
  }
  const db = Array.isArray(list) ? list.find(x => x.name === name) : undefined
  return db ? (db.uuid ?? db.id ?? undefined) : undefined
}

export async function createD1(w: Wrangler, name: string): Promise<void> {
  const [cmd, a] = args(w, ['d1', 'create', name])
  await run(cmd, a)
}

/**
 * KV namespace id for the `STATUS_KV` binding, or undefined. `createKv` runs
 * `kv namespace create STATUS_KV` with no --env/--preview, so wrangler titles the
 * namespace exactly `STATUS_KV` (title = `${env}${binding}${preview}`, see
 * wrangler's kv-namespace-create handler) — not `${workerName}-STATUS_KV`. Match
 * the title exactly so an unrelated namespace like `MY_STATUS_KV` can't be picked
 * up. Throws on a non-JSON wrangler response rather than crashing on parse.
 */
export async function lookupKv(w: Wrangler): Promise<string | undefined> {
  const [cmd, a] = args(w, ['kv', 'namespace', 'list', '--json'])
  const res = await capture(cmd, a)
  const text = res.stdout.trim()
  if (!text) {
    return undefined
  }
  let list: Array<{ id?: string, title?: string }>
  try {
    list = JSON.parse(text)
  }
  catch {
    throw new Error(`could not parse the KV namespace list from wrangler (expected JSON). Output:\n${text}`)
  }
  const ns = Array.isArray(list) ? list.find(x => x.title === 'STATUS_KV') : undefined
  return ns?.id
}

export async function createKv(w: Wrangler, configPath: string): Promise<void> {
  const [cmd, a] = args(w, ['kv', 'namespace', 'create', 'STATUS_KV', '--config', configPath])
  await run(cmd, a)
}

/** Apply the D1 schema remotely (idempotent — CREATE TABLE IF NOT EXISTS). */
export async function applySchema(w: Wrangler, dbName: string, schemaPath: string, configPath: string): Promise<void> {
  const [cmd, a] = args(w, ['d1', 'execute', dbName, '--remote', '--file', schemaPath, '--yes', '--config', configPath])
  await run(cmd, a)
}

/** Upload the status config YAML into the KV `config` key. */
export async function uploadConfig(w: Wrangler, configYamlPath: string, wranglerConfigPath: string): Promise<void> {
  const [cmd, a] = args(w, ['kv', 'key', 'put', 'config', '--binding', 'STATUS_KV', '--path', configYamlPath, '--remote', '--config', wranglerConfigPath])
  await run(cmd, a)
}

/** Deploy a Worker from `cwd` using the given wrangler config. */
export async function deploy(w: Wrangler, configPath: string, cwd: string): Promise<void> {
  const [cmd, a] = args(w, ['deploy', '--config', configPath])
  await run(cmd, a, { cwd })
}
