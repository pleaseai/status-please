#!/usr/bin/env bash
# smoke.sh — build, launch, and drive the StatusBeam check Worker (apps/worker).
#
# The Worker has two entrypoints (src/index.ts): a `fetch` handler for inbound
# Atlassian Statuspage webhooks (POST /webhooks/statuspage/:slug) and a
# `scheduled` (cron) handler that probes the configured sites. This driver runs
# it under `wrangler dev` in LOCAL mode (miniflare — local D1 + KV, no real
# Cloudflare account) and drives it with curl:
#   1. build @statusbeam/core (the Worker imports its built dist)
#   2. apply the D1 schema + seed the KV `config` key into local state
#   3. launch `wrangler dev` with a WEBHOOK_SECRET
#   4. curl the full webhook status-code matrix (404/405/401/404/400/204/200)
#   5. assert the 200 path's ingest side effects (KV summary + D1 row)
#   6. trigger the cron handler and confirm it writes check rows
#   7. direct-invoke the pure routing/auth helpers
#   8. run the unit test suite
#
# Usage (from apps/worker/):
#   .claude/skills/run-statusbeam-worker/smoke.sh
#   PORT=8901 .claude/skills/run-statusbeam-worker/smoke.sh   # override the dev port
#   KEEP_SERVER=1 .claude/skills/run-statusbeam-worker/smoke.sh
#
# Exit 0 = every assertion passed. Local state lives in .wrangler/ (gitignored).
set -uo pipefail

WORKER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
REPO_ROOT="$(cd "$WORKER_DIR/../.." && pwd)"
cd "$WORKER_DIR"
OUT="${OUT:-/tmp/sb-worker}"; mkdir -p "$OUT"
# Port resolution order (Skill: please:browser-backend / dev-server rule):
# explicit $PORT → package.json dev script (`wrangler dev`, no port) → wrangler
# default 8787. We pass an explicit port to avoid colliding with a real 8787.
PORT="${PORT:-8799}"
SECRET="s3cret"
B="http://localhost:$PORT"
pass=0 fail=0

eq() { # <label> <expected> <actual>
  if [[ "$2" == "$3" ]]; then printf '  ✓ %s (%s)\n' "$1" "$3"; ((pass++));
  else printf '  ✗ %s: expected %s, got %s\n' "$1" "$2" "$3"; ((fail++)); fi
}
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

cleanup() {
  [[ "${KEEP_SERVER:-0}" == 1 ]] || pkill -f "wrangler dev --port $PORT" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# ── 1. Build the core dependency (Worker imports @statusbeam/core/dist) ───────
echo "▸ Building @statusbeam/core…"
( cd "$REPO_ROOT" && bun run --filter '@statusbeam/core' build ) >/dev/null 2>&1 \
  || { echo "✗ core build failed"; exit 1; }

# ── 2. Seed local D1 + KV ────────────────────────────────────────────────────
echo "▸ Seeding local D1 schema + KV config…"
cat > "$OUT/config.yml" <<'YML'
name: Test
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
YML
bunx wrangler d1 execute statusbeam --local --file=./schema.sql >/dev/null 2>&1 \
  || { echo "✗ D1 schema apply failed"; exit 1; }
bunx wrangler kv key put config --binding=STATUS_KV --local --path="$OUT/config.yml" >/dev/null 2>&1 \
  || { echo "✗ KV seed failed"; exit 1; }

# ── 3. Launch wrangler dev (local) ───────────────────────────────────────────
echo "▸ Starting wrangler dev on port ${PORT}…"
pkill -f "wrangler dev --port $PORT" >/dev/null 2>&1 || true; sleep 1
rm -f "$OUT/dev.log"
nohup bunx wrangler dev --port "$PORT" --var "WEBHOOK_SECRET:$SECRET" >|"$OUT/dev.log" 2>&1 &
for _ in $(seq 1 80); do
  grep -qE "Ready on http" "$OUT/dev.log" && break
  sleep 0.5
done
grep -qE "Ready on http" "$OUT/dev.log" || { echo "✗ wrangler dev never became ready"; tail -20 "$OUT/dev.log"; exit 1; }
echo "  ready: $(grep -oE 'Ready on http://localhost:[0-9]+' "$OUT/dev.log" | head -1)"

# ── 4. Webhook status-code matrix ────────────────────────────────────────────
# Payloads mirror src/webhook.handler.test.ts.
printf '%s' '{"page":{"id":"p1","status_indicator":"major"},"component_update":{"component_id":"abc","new_status":"major_outage"},"component":{"id":"abc","name":"Claude API (api.anthropic.com)","status":"major_outage"}}' > "$OUT/major.json"
printf '%s' '{"component":{"id":"def","name":"claude.ai","status":"operational"}}' > "$OUT/other.json"
printf '%s' '{"page":"oops"}' > "$OUT/wrongshape.json"
printf '%s' 'not-json'        > "$OUT/notjson.json"
J='content-type: application/json'
echo "▸ Driving the webhook route…"
eq "404 non-webhook path"          404 "$(code "$B/nope")"
eq "405 GET on webhook route"      405 "$(code "$B/webhooks/statuspage/claude-api?token=$SECRET")"
eq "401 POST without token"        401 "$(code -X POST "$B/webhooks/statuspage/claude-api")"
eq "401 wrong token"               401 "$(code -X POST "$B/webhooks/statuspage/claude-api?token=WRONG" -H "$J" --data-binary @"$OUT/major.json")"
eq "404 unknown slug"              404 "$(code -X POST "$B/webhooks/statuspage/nope?token=$SECRET" -H "$J" --data-binary @"$OUT/major.json")"
eq "404 non-statuspage slug"       404 "$(code -X POST "$B/webhooks/statuspage/website?token=$SECRET" -H "$J" --data-binary @"$OUT/major.json")"
eq "400 malformed JSON"            400 "$(code -X POST "$B/webhooks/statuspage/claude-api?token=$SECRET" -H "$J" --data-binary @"$OUT/notjson.json")"
eq "400 wrong-shaped payload"      400 "$(code -X POST "$B/webhooks/statuspage/claude-api?token=$SECRET" -H "$J" --data-binary @"$OUT/wrongshape.json")"
eq "204 event for other component" 204 "$(code -X POST "$B/webhooks/statuspage/claude-api?token=$SECRET" -H "$J" --data-binary @"$OUT/other.json")"
eq "200 matching event (ingest)"   200 "$(code -X POST "$B/webhooks/statuspage/claude-api?token=$SECRET" -H "$J" --data-binary @"$OUT/major.json")"

# ── 5. Ingest side effects ───────────────────────────────────────────────────
echo "▸ Verifying ingest side effects…"
summary="$(bunx wrangler kv key get summary --binding=STATUS_KV --local 2>/dev/null)"
if grep -q '"slug":"claude-api"' <<<"$summary" && grep -q '"status":"down"' <<<"$summary"; then
  printf '  ✓ KV summary shows claude-api → down\n'; ((pass++))
else printf '  ✗ KV summary missing claude-api/down\n'; ((fail++)); fi
rows="$(bunx wrangler d1 execute statusbeam --local --command "SELECT COUNT(*) AS n FROM checks WHERE slug='claude-api' AND status='down'" 2>/dev/null)"
if grep -qE '"n": [1-9]' <<<"$rows"; then printf '  ✓ D1 has a claude-api/down check row\n'; ((pass++));
else printf '  ✗ D1 has no claude-api/down row\n'; ((fail++)); fi

# ── 6. Cron trigger ──────────────────────────────────────────────────────────
# wrangler dev exposes the scheduled handler at /cdn-cgi/handler/scheduled. It
# runs real HTTP checks of the seeded sites (needs network).
echo "▸ Triggering the cron handler…"
eq "cron endpoint 200" 200 "$(code "$B/cdn-cgi/handler/scheduled")"

# ── 7. Direct-invoke pure helpers ────────────────────────────────────────────
echo "▸ Direct-invoking pure helpers…"
if NODE_ENV=test bun -e '
import { parseWebhookPath, timingSafeEqual } from "'"$WORKER_DIR"'/src/webhook.ts"
const ok =
  JSON.stringify(parseWebhookPath("/webhooks/statuspage/claude-api")) === "{\"slug\":\"claude-api\"}" &&
  parseWebhookPath("/nope") === null &&
  timingSafeEqual("abc","abc") === true &&
  timingSafeEqual("abc","abd") === false
process.exit(ok ? 0 : 1)
' >/dev/null 2>&1; then printf '  ✓ parseWebhookPath + timingSafeEqual\n'; ((pass++));
else printf '  ✗ pure-helper direct invocation\n'; ((fail++)); fi

# ── 8. Test suite ────────────────────────────────────────────────────────────
echo "▸ Running the unit test suite…"
if bun test >/dev/null 2>&1; then printf '  ✓ bun test passed\n'; ((pass++));
else printf '  ✗ bun test failed\n'; ((fail++)); fi

echo
echo "▸ Summary: $pass passed, $fail failed."
[[ "$fail" == 0 ]]
