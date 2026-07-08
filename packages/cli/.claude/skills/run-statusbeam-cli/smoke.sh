#!/usr/bin/env bash
# smoke.sh — build and drive the statusbeam CLI end-to-end, asserting exit codes
# and output. This is the agent-facing driver for `packages/cli`: it exercises the
# real built binary (arg parsing, help/version, error paths, prerequisite gates)
# and then the internal pure functions via direct invocation (the layer most PRs
# touch). No Cloudflare account or network needed — every path here is offline.
#
# Usage (from packages/cli/):
#   .claude/skills/run-statusbeam-cli/smoke.sh          # build + drive + direct-invoke
#   .claude/skills/run-statusbeam-cli/smoke.sh --no-build # skip the build step
#
# Exit 0 = every assertion passed. Non-zero = the first failing assertion.
set -uo pipefail

# Resolve packages/cli/ regardless of where this is invoked from.
CLI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$CLI_DIR"

BIN="$CLI_DIR/dist/cli.js"
pass=0 fail=0

# assert_code <expected-exit> <label> -- <command...>
assert_code() {
  local want="$1" label="$2"; shift 3   # drop want, label, and the "--"
  local out; out="$("$@" 2>&1)"; local got=$?
  if [[ "$got" == "$want" ]]; then
    printf '  ✓ %s (exit %s)\n' "$label" "$got"; ((pass++))
  else
    printf '  ✗ %s: expected exit %s, got %s\n' "$label" "$want" "$got"
    printf '    output: %s\n' "$out"; ((fail++))
  fi
}

# assert_contains <label> <needle> -- <command...>
assert_contains() {
  local label="$1" needle="$2"; shift 3
  local out; out="$("$@" 2>&1)"
  if [[ "$out" == *"$needle"* ]]; then
    printf '  ✓ %s (found "%s")\n' "$label" "$needle"; ((pass++))
  else
    printf '  ✗ %s: output missing "%s"\n' "$label" "$needle"
    printf '    output: %s\n' "$out"; ((fail++))
  fi
}

# ── Build ──────────────────────────────────────────────────────────────────
if [[ "${1:-}" != "--no-build" ]]; then
  echo "▸ Building CLI (bun run build)…"
  bun run build >/dev/null || { echo "✗ build failed"; exit 1; }
fi
[[ -x "$BIN" ]] || { echo "✗ $BIN not found — run without --no-build"; exit 1; }

# ── Drive the real binary ────────────────────────────────────────────────────
echo "▸ Driving the built binary…"
assert_code    0 "--version"              -- node "$BIN" --version
assert_contains  "--help lists commands"  "statusbeam setup" -- node "$BIN" --help
assert_code    0 "no args prints help"    -- node "$BIN"
assert_code    1 "unknown command"        -- node "$BIN" frobnicate
assert_code    1 "unknown option"         -- node "$BIN" --bogus
assert_code    1 "--cwd missing value"    -- node "$BIN" setup --cwd --yes

# Prerequisite gates: setup/deploy against an unscaffolded dir must die clearly,
# not crash — this is the command layer running without any Cloudflare auth.
EMPTY="$(mktemp -d)"
assert_contains "setup gate (missing wrangler)" "Scaffold a project first" \
  -- node "$BIN" setup --cwd "$EMPTY" --yes
assert_contains "deploy gate (missing config)"  "status.config.yml" \
  -- node "$BIN" deploy --cwd "$EMPTY"
rm -rf "$EMPTY"

# ── Direct-invoke internal functions ─────────────────────────────────────────
# The layer most PRs touch: pure helpers in src/commands + src/lib. Imported and
# called straight from TS source — no build, no full CLI dispatch, no network.
echo "▸ Direct-invoking internal functions…"
DI="$CLI_DIR/.smoke-direct-invoke.mjs"
cat > "$DI" <<EOF
import { detectPackageManager, upgradeArgs } from '$CLI_DIR/src/commands/update.ts'
import { injectIds, normalizeDomain } from '$CLI_DIR/src/lib/apply-config.ts'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const dir = mkdtempSync(join(tmpdir(), 'sb-'))
writeFileSync(join(dir, 'bun.lock'), '')
const checks = [
  ['detectPackageManager(bun.lock)', detectPackageManager(dir), 'bun'],
  ['upgradeArgs(bun)[0]',            upgradeArgs('bun')[0], 'update'],
  ['upgradeArgs(yarn,berry)[0]',     upgradeArgs('yarn', true)[0], 'up'],
  ['upgradeArgs(yarn,classic)[0]',   upgradeArgs('yarn', false)[0], 'upgrade'],
  ['injectIds splices id',           injectIds('{"binding":"DB","database_id":"REPLACE_WITH_D1_ID"}', 'abc-123').includes('abc-123'), true],
  ['normalizeDomain(https://x.dev/)', normalizeDomain('https://x.dev/'), 'x.dev'],
]
let bad = 0
for (const [label, got, want] of checks) {
  const ok = got === want
  console.log(\`  \${ok ? '✓' : '✗'} \${label} = \${JSON.stringify(got)}\`)
  if (!ok) bad++
}
process.exit(bad === 0 ? 0 : 1)
EOF
if NODE_ENV=test bun run "$DI"; then ((pass++)); else ((fail++)); fi
rm -f "$DI"

# ── Test suite ───────────────────────────────────────────────────────────────
echo "▸ Running the unit test suite (bun test)…"
if bun test >/dev/null 2>&1; then
  echo "  ✓ bun test passed"; ((pass++))
else
  echo "  ✗ bun test failed"; ((fail++))
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo
echo "▸ Summary: $pass passed, $fail failed"
[[ "$fail" == 0 ]]
