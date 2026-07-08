#!/usr/bin/env bash
# smoke.sh — launch the StatusBeam status page (apps/web) in Astro dev and drive
# it end-to-end: assert the bare-`/` locale redirect, the sample-data render, and
# the JSON API, then screenshot two locales through the org-standard browser
# backend.
#
# The app falls back to built-in SAMPLE data (src/lib/data.ts) when no Cloudflare
# KV binding is present, so this runs fully offline — no D1/KV, no `wrangler
# login`, no network.
#
# Browser backend selection follows Skill("please:browser-backend"):
#   orca (inside an Orca worktree) → chromium-cli → agent-browser.
# This session was authored on the `orca` backend (Orca's embedded browser drives
# an internal agent-browser); the other two branches are the documented fallbacks
# for non-Orca machines. Never mix backends, and never use headless system Chrome
# here — on macOS it fights the interactive Chrome and leaves unreaped processes.
#
# Usage (from apps/web/):
#   .claude/skills/run-statusbeam-web/smoke.sh          # start → assert → screenshot → stop
#   KEEP_SERVER=1 .claude/skills/run-statusbeam-web/smoke.sh   # leave dev server running
#
# Screenshots land in $OUT (default /tmp/sb-web). Exit 0 = every assertion passed.
set -uo pipefail

WEB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$WEB_DIR"
OUT="${OUT:-/tmp/sb-web}"; mkdir -p "$OUT"
pass=0 fail=0

check() { # <label> <condition-cmd...>
  local label="$1"; shift
  if "$@"; then printf '  ✓ %s\n' "$label"; ((pass++));
  else printf '  ✗ %s\n' "$label"; ((fail++)); fi
}

# ── Pick the browser backend (Skill: please:browser-backend) ─────────────────
select_backend() {
  if { [[ "${TERM_PROGRAM:-}" == "Orca" ]] || [[ -n "${ORCA_WORKTREE_ID:-}" ]]; } \
     && { command -v orca >/dev/null 2>&1 || command -v orca-ide >/dev/null 2>&1; }; then
    echo orca
  elif command -v chromium-cli >/dev/null 2>&1; then echo chromium-cli
  elif command -v agent-browser >/dev/null 2>&1; then echo agent-browser
  else echo none; fi
}

# shoot <locale-seg> <wait-text> <outfile> — navigate and save a full-page PNG
# through whichever backend was selected. Returns success iff a file landed.
shoot() {
  local seg="$1" needle="$2" outfile="$3"; rm -f "$outfile"
  case "$BACKEND" in
    orca)
      # `full-screenshot --json` returns { data: <base64>, format }.
      orca goto --url "$URL$seg" --json >/dev/null 2>&1 \
        || orca tab create --url "$URL$seg" --json >/dev/null 2>&1   # first call: no tab yet
      orca wait --text "$needle" --json >/dev/null 2>&1
      orca full-screenshot --json 2>/dev/null \
        | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const r=(JSON.parse(s).result)||{};if(!r.data)process.exit(1);require("fs").writeFileSync(process.argv[1],Buffer.from(r.data,"base64"))}catch{process.exit(1)}})' "$outfile"
      ;;
    chromium-cli)
      chromium-cli >/dev/null 2>&1 <<EOF
open $URL$seg
wait text=$needle
screenshot --full $outfile
EOF
      ;;
    agent-browser)
      # Verified command shapes from `agent-browser skills get core`.
      agent-browser open "$URL$seg" >/dev/null 2>&1
      agent-browser wait --text "$needle" >/dev/null 2>&1 || true
      agent-browser screenshot "$outfile" --full >/dev/null 2>&1
      ;;
  esac
  [[ -s "$outfile" ]]
}

# Close only the Orca tabs pointing at our own dev server — never a tab the user
# had open (shoot() may `orca goto` an existing tab). Targets the stable
# browserPageId, so it's index-shift-safe.
close_orca_tabs() {
  [[ -n "${URL:-}" ]] || return 0
  orca tab list --json 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const r=JSON.parse(s).result||{};for(const t of (r.tabs||[]))if((t.url||"").startsWith(process.argv[1]))console.log(t.browserPageId)}catch{}})' "$URL" \
    | while read -r pid; do orca tab close --page "$pid" >/dev/null 2>&1 || true; done
}

cleanup() {
  # KEEP_SERVER leaves everything up — the browser session too, not just the server.
  [[ "${KEEP_SERVER:-0}" == 1 ]] && return 0
  case "${BACKEND:-}" in
    agent-browser) agent-browser close >/dev/null 2>&1 || true ;;
    orca)          close_orca_tabs ;;
  esac
  bunx astro dev stop >/dev/null 2>&1 || true
}
trap cleanup EXIT

# ── Launch the Astro dev daemon ──────────────────────────────────────────────
# Port: Astro prints its chosen port to the log (it auto-bumps when 4321 is
# taken), so we read it from there rather than hardcoding. General resolution
# order when a log isn't available: explicit flag → project docs → package.json
# dev script → .env PORT → 3000. (See Skill: please:browser-backend.)
echo "▸ Starting astro dev…"
bunx astro dev stop >/dev/null 2>&1 || true   # clear any stale daemon
bun run dev >|"$OUT/dev.log" 2>&1 || true      # `astro dev` daemonizes and returns
URL=""
for _ in $(seq 1 60); do
  URL="$(grep -oE 'http://localhost:[0-9]+' "$OUT/dev.log" | head -1)"
  [[ -n "$URL" ]] && curl -sf -o /dev/null "$URL/en/" && break
  sleep 0.5
done
[[ -n "$URL" ]] || { echo "✗ dev server never came up"; cat "$OUT/dev.log"; exit 1; }
echo "  server: $URL"

# ── Assert behavior via curl (no browser needed) ─────────────────────────────
echo "▸ Asserting HTTP behavior…"
# Bare `/` negotiates locale in middleware.ts and 302s to a prefixed locale.
code=$(curl -s -o /dev/null -w '%{http_code}' "$URL/"); loc=$(curl -s -o /dev/null -w '%header{location}' "$URL/")
check "bare / redirects (302 → /en/)"   test "$code" = 302
check "  … Location is /en/"            test "$loc" = /en/
# The rendered page carries the SAMPLE fallback data.
body="$(curl -s "$URL/en/")"
check "/en/ renders sample sites (Website + CDN)" bash -c 'grep -q Website <<<"$1" && grep -q CDN <<<"$1"' _ "$body"
check "/en/ shows the sample incident"  grep -q "Elevated API error rates" <<<"$body"
# The public JSON status API.
api="$(curl -s "$URL/api/status.json")"
check "/api/status.json is degraded-status JSON" grep -q '"status":"degraded"' <<<"$api"

# ── Screenshot two locales through the selected backend ──────────────────────
BACKEND="$(select_backend)"
echo "▸ Screenshotting locales (backend: $BACKEND)…"
if [[ "$BACKEND" == none ]]; then
  echo "  ! no browser backend — install one: npm i -g agent-browser && agent-browser install"
  echo "    (HTTP assertions above still cover the render)"
else
  check "screenshot /en/ → $OUT/status-en.png" shoot "/en/" "Website"  "$OUT/status-en.png"
  check "screenshot /ko/ → $OUT/status-ko.png" shoot "/ko/" "성능 저하" "$OUT/status-ko.png"
fi

echo
echo "▸ Summary: $pass passed, $fail failed. Screenshots in $OUT/"
[[ "$fail" == 0 ]]
