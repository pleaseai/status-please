/**
 * Write account-specific settings into a wrangler.jsonc file, idempotently and
 * without disturbing comments. Ported from scripts/apply-config.ts (which was
 * monorepo-coupled via env vars) into explicit, path-driven functions the CLI
 * calls against the *user's* wrangler configs.
 *
 * JSONC keeps comments, so every edit is a targeted string replacement (not a
 * JSON parse/stringify, which would strip them). Every replacement that splices
 * in an external value uses a replacer function, never a replacement string, so a
 * `$` in the value (`$&`, `$1`, …) can't be misread as a special pattern.
 */
import { readFile, writeFile } from 'node:fs/promises'

// Markers wrap the managed networking block so re-runs find and replace exactly
// what a previous run wrote, regardless of which branch it took.
const MARK_START = '// >>> networking (managed by statusbeam) >>>'
const MARK_END = '// <<< networking (managed by statusbeam) <<<'

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Set the D1 database_id and KV namespace id in a wrangler config. Replaces the
 * field's value whether it's still the committed REPLACE_WITH placeholder or a
 * previously injected id — so re-running `setup` after a resource is recreated
 * updates the stale id instead of silently leaving it (the placeholder-only
 * approach would no-op once the placeholder was gone). Values are spliced via a
 * replacer function so a `$` in the id can't be read as a `$&`/`$1` pattern.
 */
export function injectIds(s: string, d1?: string, kv?: string): string {
  if (d1) {
    // `database_id` is a unique key, so match it directly.
    s = s.replace(/("database_id"\s*:\s*")[^"]*(")/, (_m, p, q) => `${p}${d1}${q}`)
  }
  if (kv) {
    // Scope to the kv_namespaces block so the generic `"id"` key can't match
    // some other `"id"` elsewhere in the config.
    s = s.replace(/("kv_namespaces"\s*:\s*\[[\s\S]*?"id"\s*:\s*")[^"]*(")/, (_m, p, q) => `${p}${kv}${q}`)
  }
  return s
}

function networkingBlock(domain: string): string {
  if (domain) {
    return [
      `  ${MARK_START}`,
      `  // Custom domain: Cloudflare provisions the proxied DNS record + edge`,
      `  // cert automatically (the zone must live in this Cloudflare account).`,
      `  // "workers_dev" keeps the generated *.workers.dev URL as a fallback.`,
      `  "routes": [{ "pattern": ${JSON.stringify(domain)}, "custom_domain": true }],`,
      `  "workers_dev": true,`,
      `  ${MARK_END}`,
    ].join('\n')
  }
  return [
    `  ${MARK_START}`,
    `  // No custom domain: the page is served from the generated *.workers.dev`,
    `  // URL. Re-run \`statusbeam setup\` to attach a custom domain later.`,
    `  "workers_dev": true,`,
    `  ${MARK_END}`,
  ].join('\n')
}

/**
 * Rewrite the web config's networking block from a custom domain (empty →
 * .workers.dev). Throws if it can't place the block, so a silent no-op can't let
 * a deploy ship the wrong (demo) domain.
 */
export function setNetworking(s: string, domain: string): string {
  const block = networkingBlock(domain)

  const managed = new RegExp(`[ \\t]*${esc(MARK_START)}[\\s\\S]*?${esc(MARK_END)}`)
  if (managed.test(s)) {
    return s.replace(managed, () => block)
  }

  // First run against a template: replace the shipped "Custom domain:" comment + routes line.
  const shipped = /[ \t]*\/\/ Custom domain:[\s\S]*?"routes"\s*:\s*\[[\s\S]*?\],/
  if (shipped.test(s)) {
    return s.replace(shipped, () => block)
  }

  // Neither present: insert after the compatibility_flags line, a stable anchor.
  const anchor = /("compatibility_flags"\s*:\s*\[[^\]]*\],)/
  if (anchor.test(s)) {
    return s.replace(anchor, (_m, p1) => `${p1}\n\n${block}`)
  }

  throw new Error(
    'could not place the networking block in the web wrangler config (no marker, '
    + '"// Custom domain:" comment, or compatibility_flags anchor found). Edit it by hand, then re-run.',
  )
}

/**
 * Replace the single cron expression inside "crons": [ "..." ] (worker config).
 * Throws if the array isn't found, so a dropped schedule can't pass silently.
 */
export function setCron(s: string, cron: string): string {
  const re = /("crons"\s*:\s*\[\s*)"[^"]*"(\s*\])/
  if (!re.test(s)) {
    throw new Error(
      'could not set the cron expression in the worker wrangler config ("crons" array not '
      + 'found in the expected shape). Edit it by hand, then re-run.',
    )
  }
  return s.replace(re, (_m, p1, p2) => `${p1}${JSON.stringify(cron)}${p2}`)
}

/** Read a file, apply a transform, write it back only if changed. */
export async function edit(path: string, fn: (s: string) => string): Promise<boolean> {
  const before = await readFile(path, 'utf8')
  const after = fn(before)
  if (after !== before) {
    await writeFile(path, after)
    return true
  }
  return false
}

/**
 * Read a single string value out of a JSONC file by key. Scans line by line and
 * skips whole-line comments so a commented-out `// "database_name": "old"` can't
 * shadow the real value (the templates ship such commented examples).
 */
export async function readJsoncString(path: string, key: string): Promise<string | undefined> {
  const s = await readFile(path, 'utf8')
  const re = new RegExp(`"${esc(key)}"\\s*:\\s*"([^"]*)"`)
  for (const line of s.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      continue
    }
    const m = trimmed.match(re)
    if (m) {
      return m[1]
    }
  }
  return undefined
}
