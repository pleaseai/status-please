#!/usr/bin/env bun
/**
 * apply-config.ts — write account-specific settings into the two wrangler.jsonc
 * files, idempotently and without disturbing their comments.
 *
 * Driven entirely by env vars so `scripts/setup.sh` stays the single source of
 * prompts. JSONC keeps comments, so we do targeted string edits (not JSON
 * parse/stringify, which would strip them):
 *
 *   D1_ID / KV_ID        replace the committed REPLACE_WITH_* placeholders (both files)
 *   SET_NETWORKING=1     rewrite the web app's networking block from CUSTOM_DOMAIN
 *                        (a value → custom-domain route; empty → *.workers.dev)
 *   CRON                 replace the worker's cron expression (worker file)
 *
 * Every edit is a no-op when the target already matches, so re-running setup is
 * safe.
 */

const WORKER = "apps/worker/wrangler.jsonc";
const WEB = "apps/web/wrangler.jsonc";

// Markers wrap the managed networking block so re-runs find and replace exactly
// what a previous run wrote, regardless of which branch it took.
const MARK_START = "// >>> networking (managed by scripts/setup.sh) >>>";
const MARK_END = "// <<< networking (managed by scripts/setup.sh) <<<";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function edit(path: string, fn: (s: string) => string): Promise<void> {
  const before = await Bun.file(path).text();
  const after = fn(before);
  if (after !== before) {
    await Bun.write(path, after);
    console.log(`  updated ${path}`);
  }
}

function injectIds(s: string): string {
  const d1 = process.env.D1_ID;
  const kv = process.env.KV_ID;
  if (d1) s = s.replaceAll("REPLACE_WITH_D1_DATABASE_ID", d1);
  if (kv) s = s.replaceAll("REPLACE_WITH_KV_NAMESPACE_ID", kv);
  return s;
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
    ].join("\n");
  }
  return [
    `  ${MARK_START}`,
    `  // No custom domain: the page is served from the generated *.workers.dev`,
    `  // URL. Re-run scripts/setup.sh to attach a custom domain later.`,
    `  "workers_dev": true,`,
    `  ${MARK_END}`,
  ].join("\n");
}

function setNetworking(s: string): string {
  if (process.env.SET_NETWORKING !== "1") return s;
  const block = networkingBlock(process.env.CUSTOM_DOMAIN ?? "");

  // A managed block already present → replace it.
  const managed = new RegExp(`[ \\t]*${esc(MARK_START)}[\\s\\S]*?${esc(MARK_END)}`);
  if (managed.test(s)) return s.replace(managed, block);

  // First run: replace the shipped "Custom domain:" comment + routes line.
  const shipped = /[ \t]*\/\/ Custom domain:[\s\S]*?"routes"\s*:\s*\[[\s\S]*?\],/;
  if (shipped.test(s)) return s.replace(shipped, block);

  // Neither present (e.g. routes were hand-removed): insert after the
  // compatibility_flags line, a stable anchor in both files.
  const anchor = /("compatibility_flags"\s*:\s*\[[^\]]*\],)/;
  if (anchor.test(s)) return s.replace(anchor, `$1\n\n${block}`);

  console.warn(`  warning: could not place networking block in ${WEB}; edit it by hand`);
  return s;
}

function setCron(s: string): string {
  const cron = process.env.CRON;
  if (!cron) return s;
  // Replace the single expression inside "crons": [ "..." ].
  return s.replace(/("crons"\s*:\s*\[\s*)"[^"]*"(\s*\])/, `$1${JSON.stringify(cron)}$2`);
}

await edit(WORKER, (s) => setCron(injectIds(s)));
await edit(WEB, (s) => setNetworking(injectIds(s)));
