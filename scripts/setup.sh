#!/usr/bin/env bash
#
# setup.sh — interactive one-shot setup + deploy for a status-please fork.
#
# The "Deploy to Cloudflare" button can't deploy this monorepo (two Workers +
# a shared workspace package), so this script is the guided alternative. It
# walks DEPLOYMENT.md §1–7 for a local operator: provisions D1 + KV, asks a
# couple of wrangler questions (custom domain, cron), wires everything into the
# committed config, applies the schema, uploads your config, and deploys both
# Workers. Every step is idempotent — safe to re-run.
#
# Usage:
#   bun run setup                 # interactive
#   bun run setup -- --yes        # non-interactive, accept every default
#   bun run setup -- --skip-deploy  # provision + configure only, don't deploy
#
# Prereqs: bun, and Cloudflare auth (`bunx wrangler login`, or export
# CLOUDFLARE_API_TOKEN [+ CLOUDFLARE_ACCOUNT_ID if the token spans accounts]).

set -euo pipefail

# --- run from the repo root regardless of where it's invoked ---------------
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DB_NAME="status-please"
ASSUME_YES=0
SKIP_DEPLOY=0

for arg in "$@"; do
  case "$arg" in
    --) ;;  # bare separator (e.g. from `bash scripts/setup.sh -- --yes`) — ignore
    -y|--yes) ASSUME_YES=1 ;;
    --skip-deploy) SKIP_DEPLOY=1 ;;
    -h|--help)
      cat <<'USAGE'
setup.sh — interactive setup + deploy for a status-please fork.

Provisions D1 + KV, asks a couple of wrangler questions (custom domain, cron),
wires everything into the committed config, applies the D1 schema, uploads your
status.config.yml, and deploys both Workers. Every step is idempotent.

Usage:
  bun run setup                    # interactive
  bun run setup -- --yes           # non-interactive, accept every default
  bun run setup -- --skip-deploy   # provision + configure only, don't deploy

Prereqs: bun, and Cloudflare auth (`bunx wrangler login`, or export
CLOUDFLARE_API_TOKEN [+ CLOUDFLARE_ACCOUNT_ID if the token spans accounts]).
USAGE
      exit 0 ;;
    *) echo "Unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

# Interactive only on a real TTY and when the user hasn't opted out.
INTERACTIVE=0
if [ "$ASSUME_YES" -eq 0 ] && [ -t 0 ]; then INTERACTIVE=1; fi

# --- pretty logging --------------------------------------------------------
if [ -t 1 ]; then B=$'\033[1m'; DIM=$'\033[2m'; GRN=$'\033[32m'; YLW=$'\033[33m'; RED=$'\033[31m'; RST=$'\033[0m'
else B=""; DIM=""; GRN=""; YLW=""; RED=""; RST=""; fi
STEP=0
step() { STEP=$((STEP + 1)); printf '\n%s▸ %s. %s%s\n' "$B" "$STEP" "$1" "$RST"; }
info() { printf '  %s\n' "$1"; }
ok()   { printf '  %s✓ %s%s\n' "$GRN" "$1" "$RST"; }
warn() { printf '  %s! %s%s\n' "$YLW" "$1" "$RST"; }
die()  { printf '\n%s✗ %s%s\n' "$RED" "$1" "$RST" >&2; exit 1; }

ask() { # ask <prompt> <default> <var>
  local prompt="$1" def="$2" __var="$3" reply
  if [ "$INTERACTIVE" -eq 0 ]; then printf -v "$__var" '%s' "$def"; return; fi
  # `|| true`: a closed stdin / Ctrl-D returns non-zero from read; fall back to
  # the default instead of aborting the whole script via `set -e`.
  if [ -n "$def" ]; then read -rp "  $prompt [$def]: " reply || true; else read -rp "  $prompt: " reply || true; fi
  printf -v "$__var" '%s' "${reply:-$def}"
}

wr() { bunx wrangler "$@"; }  # workspace-local wrangler, no global install needed

# --- 0. prerequisites ------------------------------------------------------
step "Checking prerequisites"
command -v bun >/dev/null 2>&1 || die "bun is not installed — see https://bun.sh"
if [ ! -d node_modules ]; then
  # --ignore-scripts: don't run dependency lifecycle scripts on install (matches
  # the CI deploy). The build + wrangler bundling don't need them.
  info "Installing workspace dependencies…"; bun install --ignore-scripts
fi
if ! wr whoami >/dev/null 2>&1; then
  die "Not authenticated with Cloudflare. Run 'bunx wrangler login' (or export CLOUDFLARE_API_TOKEN) and re-run."
fi
ok "bun + Cloudflare auth ready"

# --- 1. provision D1 + KV (idempotent) -------------------------------------
step "Provisioning D1 + KV"

# Distinguish "wrangler call failed" from "resource not found":
#   - capture only stdout (the JSON); a non-zero wrangler exit (expired auth,
#     network, API error) makes the function return non-zero so the caller can
#     abort, instead of the failure being masked and misread as "not found"
#     (which would take the wrong create-a-duplicate branch).
#   - a successful-but-empty/unparseable result → empty stdout, exit 0 → the
#     caller's `-n` check drives the create path. The JSON.parse is still guarded
#     so a surprising payload can't dump a Bun stack trace.
lookup_d1() {
  local json
  json="$(wr d1 list --json 2>/dev/null)" || return 1
  printf '%s' "$json" | DB_NAME="$DB_NAME" bun -e '
    try {
      const text = (await Bun.stdin.text()).trim();
      if (!text) process.exit(0);
      const a = JSON.parse(text);
      const d = Array.isArray(a) ? a.find(x => x.name === process.env.DB_NAME) : null;
      process.stdout.write(d ? String(d.uuid || d.id || "") : "");
    } catch { process.exit(1); } // non-empty but unparseable → fail, do not misread as "not found"
  '
}
lookup_kv() {
  local json
  json="$(wr kv namespace list --json 2>/dev/null)" || return 1
  printf '%s' "$json" | bun -e '
    try {
      const text = (await Bun.stdin.text()).trim();
      if (!text) process.exit(0);
      const a = JSON.parse(text);
      const k = Array.isArray(a) ? a.find(x => String(x.title || "").endsWith("STATUS_KV")) : null;
      process.stdout.write(k ? String(k.id) : "");
    } catch { process.exit(1); } // non-empty but unparseable → fail, do not misread as "not found"
  '
}

AUTH_HINT="check your Cloudflare auth ('bunx wrangler login' or CLOUDFLARE_API_TOKEN) and retry"

D1_ID="$(lookup_d1)" || die "Could not query D1 (wrangler d1 list failed) — $AUTH_HINT."
if [ -z "$D1_ID" ]; then
  info "Creating D1 database '$DB_NAME'…"; wr d1 create "$DB_NAME" >/dev/null
  D1_ID="$(lookup_d1)" || die "Could not query D1 after create — $AUTH_HINT."
else
  info "D1 '$DB_NAME' already exists — reusing."
fi
[ -n "$D1_ID" ] || die "Could not determine the D1 database id."
ok "D1 database_id: $D1_ID"

KV_ID="$(lookup_kv)" || die "Could not query KV (wrangler kv namespace list failed) — $AUTH_HINT."
if [ -z "$KV_ID" ]; then
  info "Creating KV namespace 'STATUS_KV'…"
  wr kv namespace create STATUS_KV --config apps/worker/wrangler.jsonc >/dev/null
  KV_ID="$(lookup_kv)" || die "Could not query KV after create — $AUTH_HINT."
else
  info "KV namespace 'STATUS_KV' already exists — reusing."
fi
[ -n "$KV_ID" ] || die "Could not determine the KV namespace id."
ok "KV namespace id: $KV_ID"

# --- 2. wrangler settings (interactive) ------------------------------------
step "Wrangler settings"
CUSTOM_DOMAIN=""
ask "Custom domain for the status page (blank = use *.workers.dev)" "" CUSTOM_DOMAIN
CRON=""
ask "Cron schedule for checks" "*/5 * * * *" CRON
if [ -n "$CUSTOM_DOMAIN" ]; then info "Domain: $CUSTOM_DOMAIN"; else info "No custom domain — the page will use its *.workers.dev URL."; fi
info "Cron:   $CRON"

step "Writing settings into wrangler.jsonc"
D1_ID="$D1_ID" KV_ID="$KV_ID" CRON="$CRON" \
  SET_NETWORKING=1 CUSTOM_DOMAIN="$CUSTOM_DOMAIN" \
  bun scripts/apply-config.ts
ok "apps/worker + apps/web wrangler.jsonc configured"

# --- 3. status.config.yml --------------------------------------------------
step "Your service list (status.config.yml)"
if [ -f status.config.yml ]; then
  info "status.config.yml already exists — leaving it untouched."
else
  cp status.config.example.yml status.config.yml
  ok "Created status.config.yml from the example."
  PAGE_NAME=""
  ask "Status page name" "Acme Status" PAGE_NAME
  if [ -n "$PAGE_NAME" ]; then
    PAGE_NAME="$PAGE_NAME" bun -e '
      let s = await Bun.file("status.config.yml").text();
      // JSON.stringify → a double-quoted YAML scalar, so a name containing ":",
      // "#", a leading "@", or quotes stays valid YAML. Passing it via a
      // replacer function (not a string) also keeps a "$" from being read as a
      // $-pattern by String.replace.
      s = s.replace(/^name:.*$/m, () => "name: " + JSON.stringify(process.env.PAGE_NAME));
      await Bun.write("status.config.yml", s);
    '
  fi
  if [ "$INTERACTIVE" -eq 1 ]; then
    warn "Edit status.config.yml now and list the services you want to monitor."
    read -rp "  Press Enter when it's ready (Ctrl-C to abort)… " _ || true
  fi
fi

if [ "$SKIP_DEPLOY" -eq 1 ]; then
  step "Done (setup only)"
  ok "Provisioned + configured. Run 'bun run deploy' when you're ready to ship."
  exit 0
fi

# --- 4. deploy (reuses the same tasks CI runs) -----------------------------
step "Applying the D1 schema"
bun run --filter '@status-please/worker' db:apply:remote
ok "Schema applied"

step "Uploading status.config.yml to KV"
bun run --filter '@status-please/worker' kv:config
ok "Config uploaded"

step "Deploying the check Worker + status page"
bun run deploy
ok "Deployed"

# --- next steps ------------------------------------------------------------
printf '\n%s✓ status-please is live.%s\n' "$GRN$B" "$RST"
cat <<EOF
${DIM}
Next:
  • The cron runs every few minutes — the page shows sample data until the
    first check writes a real snapshot. Force one now from the Cloudflare
    dashboard → Workers → status-please-worker → Cron Triggers → Trigger.
  • Instant cache purge (optional): set the two secrets on the check Worker
      bunx wrangler secret put CF_API_TOKEN --config apps/worker/wrangler.jsonc
      bunx wrangler secret put CF_ZONE_ID   --config apps/worker/wrangler.jsonc
  • Re-run 'bun run setup' any time to change the domain, cron, or redeploy.
  • Commit the updated wrangler.jsonc + status.config.yml to your fork.
Full runbook: DEPLOYMENT.md${RST}
EOF
