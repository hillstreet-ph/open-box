#!/usr/bin/env bash
# Harness for .github/workflows/openbox-deploy-railway.yml.
#   1. extracts every step's `run:` body verbatim from the shipped YAML,
#      substituting only the ${{ }} expressions the runner would resolve
#   2. executes those shipped bodies against a mock Railway GraphQL API and a
#      mock Open-Box origin.
# Shipped code is what runs — no transcriptions.
set -uo pipefail
# Runs from any checkout: the mocks are next to this file, the workflow is found
# through the repo root, and scratch state goes to a throwaway WORK dir.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO=${REPO:-"$(cd "$HERE/../../.." && pwd)"}
WORK=${WORK:-/tmp/rwh}
mkdir -p "$WORK" || exit 1
cd "$WORK" || exit 1
YAML="$REPO/.github/workflows/openbox-deploy-railway.yml"
[ -f "$YAML" ] || { echo "harness: workflow not found at $YAML"; exit 1; }
RP=8471          # mock Railway API
OG=8472          # mock origin used for the "edge is down" cases
OGUP=8473        # mock origin, healthy
CF=8474          # mock Cloudflare Workers API
fail=0
ok() { echo "PASS  $1"; }
ko() { echo "FAIL  $1 -- $2"; fail=1; }
has()   { grep -qs -- "$1" stdout.txt stderr.txt; }
hasnt() { ! grep -qs -- "$1" stdout.txt stderr.txt; }

# ------------------------------------------------------------------ extraction
ruby -ryaml -e '
yaml, dir = ARGV
doc = YAML.load_file(yaml)
Dir.glob(File.join(dir, "step_*.sh")).each { |f| File.delete(f) }
doc["jobs"].values.first["steps"].each do |s|
  next unless s["run"]
  body = s["run"].dup
  body.gsub!("${{ job.status }}", "failure")
  body.gsub!("${{ inputs.mode }}", "provision and verify")
  body.gsub!("${{ github.actor }}", "harness")
  body.gsub!(/\$\{\{[^}]*\}\}/, "harness-value")
  id = (s["id"] || s["name"]).to_s.gsub(/[^A-Za-z0-9]+/, "_").gsub(/^_+|_+$/, "")
  File.write(File.join(dir, "step_#{id}.sh"), body)
end' "$YAML" "$WORK" || { echo "extraction failed"; exit 1; }

TGT=step_target.sh
BEF=step_before.sh
IMG=step_image.sh
ROL=step_roll.sh
PRV=step_provision.sh
WAT=step_Wait_for_the_deployment_to_report_ready.sh
GAT=step_gate.sh
EDG=step_edge.sh
EDGATE=step_Production_gate_Cloudflare_edge.sh
PUB=step_Publish_the_channel_build_Docker_Hub_manifest_copy.sh
RTO=step_Confirm_the_rotation_precondition.sh
BIN=step_Check_required_bindings.sh
REP=step_Report_the_running_artifact.sh
CLN=step_Clear_Railway_and_Cloudflare_credential_files.sh
for f in "$TGT" "$BEF" "$IMG" "$ROL" "$PRV" "$WAT" "$GAT" "$EDG" "$EDGATE" "$PUB" "$RTO" "$BIN" "$REP" "$CLN"; do
  [ -f "$f" ] || { echo "harness: extracted $f is missing"; exit 1; }
done

# ------------------------------------------------------------------- fixtures
cat > state_clean.json <<'JSON'
{
  "project_id": "prj-openbox",
  "project_name": "open-box",
  "environments": [{"id": "env-prod", "name": "Production"}, {"id": "env-prev", "name": "Preview"}],
  "services": [{"id": "svc-old", "name": "open-box", "image": "hillstreet/open-box:railway",
                "latest_deployment": "dep-old", "status": "SUCCESS",
                "healthcheckPath": null, "volumeCount": 0,
                "domains": ["open-box-production.up.railway.app"]}],
  "deployments_by_id": {"dep-old": {"status": "SUCCESS"}, "dep-new": {"status": "BUILDING"}},
  "variables": {}
}
JSON
export RW_MOCK_STATE="$WORK/state.json"
export RW_MOCK_LOG="$WORK/reqs.log"
printf 'Authorization: Bearer harness-token\n' > /tmp/rw.header
chmod 600 /tmp/rw.header

# The Cloudflare fixture mirrors the shapes read from the live open-box-gateway
# Worker on 2026-11-05: one ai binding, one kv_namespace, one unreadable
# secret_text, four plain_text variables, ORIGIN_URL still naming the retired
# Zeabur host, plus a zone route that the settings PATCH must not disturb.
cat > cf_state_clean.json <<'JSON'
{
  "accounts": [{"id": "acc-hillstreet", "name": "HillStreet"}, {"id": "acc-other", "name": "Other"}],
  "worker_accounts": {"open-box-gateway": ["acc-hillstreet"], "foreign-worker": ["acc-other"]},
  "workers": [
    {"name": "open-box-gateway", "tag": "ed09dd4a680d4aa5bb06c1e0e67a1474",
     "bindings": [
       {"type": "ai", "name": "AI"},
       {"type": "kv_namespace", "name": "AI_CONFIG", "namespace_id": "c400d6e5e1bf44fc96a6ae32f09b5bd1"},
       {"type": "secret_text", "name": "AI_CONFIG_KEY"},
       {"type": "plain_text", "name": "APP_NAME", "text": "Open-Box"},
       {"type": "plain_text", "name": "AUTH_REQUIRED", "text": "false"},
       {"type": "plain_text", "name": "ORIGIN_URL", "text": "https://open-box-space.zeabur.app"},
       {"type": "plain_text", "name": "SUPABASE_URL", "text": "https://example.supabase.co"}
     ]},
    {"name": "foreign-worker", "tag": "ffff", "bindings": [{"type": "plain_text", "name": "ORIGIN_URL", "text": "https://elsewhere.example"}]}
  ],
  "zones": [{"id": "zone-1", "name": "open-box.space"}],
  "routes": [{"id": "r1", "zone_id": "zone-1", "pattern": "open-box.space/*", "script": "open-box-gateway"}]
}
JSON
export CF_MOCK_STATE="$WORK/cf_state.json"
export CF_MOCK_LOG="$WORK/cf_reqs.log"
reset_cf() { cp cf_state_clean.json cf_state.json; }

wait_up() {
  local n=0
  while [ "$n" -lt 40 ]; do
    curl -sf -m 1 "http://127.0.0.1:$1/ping" >/dev/null 2>&1 && return 0
    n=$((n+1)); sleep 0.2
  done
  return 1
}
# block until nothing accepts on the port any more, so a killed server can
# never answer for the next profile
port_free() {
  local n=0
  while python3 -c "
import socket,sys
s=socket.socket()
sys.exit(0 if s.connect_ex(('127.0.0.1',$1))==0 else 1)"; do
    [ "$n" -ge 40 ] && return 1
    n=$((n+1)); sleep 0.15
  done
  return 0
}
# the Railway mock is POST-only, so readiness is a socket check, not a GET
port_up() {
  local n=0
  until python3 -c "
import socket,sys
s=socket.socket()
s.settimeout(1)
sys.exit(0 if s.connect_ex(('127.0.0.1',$1))==0 else 1)"; do
    [ "$n" -ge 40 ] && return 1
    n=$((n+1)); sleep 0.15
  done
  return 0
}
start_railway() {
  pkill -f "mock_railway.py $RP" 2>/dev/null
  port_free "$RP" || { echo "harness: port $RP never freed"; exit 1; }
  python3 "$HERE/mock_railway.py" "$RP" >/dev/null 2>&1 &
  port_up "$RP" || { echo "harness: mock Railway did not start"; exit 1; }
}
start_cloudflare() {
  pkill -f "mock_cloudflare.py $CF" 2>/dev/null
  port_free "$CF" || { echo "harness: port $CF never freed"; exit 1; }
  python3 "$HERE/mock_cloudflare.py" "$CF" >/dev/null 2>&1 &
  port_up "$CF" || { echo "harness: mock Cloudflare did not start"; exit 1; }
}
use_cf_profile() { export CF_MOCK_PROFILE="$1"; start_cloudflare; }
# the mock fixes its profile at process start, so every profile change restarts
use_profile() { export RW_MOCK_PROFILE="$1"; start_railway; }
start_origin() { # port  KEY=value ...
  local port="$1"; shift
  pkill -f "mock_origin.py $port" 2>/dev/null
  port_free "$port" || true
  env "$@" python3 "$HERE/mock_origin.py" "$port" >/dev/null 2>&1 &
  wait_up "$port"
}
reset_state() { cp state_clean.json state.json; }
drop_services() {
  python3 -c '
import json, os
st=json.load(open(os.environ["RW_MOCK_STATE"])); st["services"]=[]; json.dump(st,open(os.environ["RW_MOCK_STATE"],"w"))'
}
no_domains() {
  python3 -c '
import json, os
st=json.load(open(os.environ["RW_MOCK_STATE"])); st["services"][0]["domains"]=[]; json.dump(st,open(os.environ["RW_MOCK_STATE"],"w"))'
}
set_deployment() { # id status [message]
  python3 -c '
import json,sys,os
st=json.load(open(os.environ["RW_MOCK_STATE"]))
st["services"][0]["latest_deployment"]=sys.argv[1]
st["services"][0]["status"]=sys.argv[2]
st["deployments_by_id"][sys.argv[1]]={"status":sys.argv[2],"message":sys.argv[3] if len(sys.argv)>3 else "Deployed"}
json.dump(st,open(os.environ["RW_MOCK_STATE"],"w"))' "$1" "$2" "${3:-}"
}
mark_crashed() {
  python3 -c '
import json, os
st=json.load(open(os.environ["RW_MOCK_STATE"]))
st["services"][0]["status"]="CRASHED"
st["deployments_by_id"]["dep-new"]={"status":"CRASHED","message":"exit code 1"}
json.dump(st,open(os.environ["RW_MOCK_STATE"],"w"))'
}

run_step() { # file [VAR=val ...]
  local file="$1"; shift
  : > out.txt; : > reqs.log; : > cf_reqs.log; : > stdout.txt; : > stderr.txt
  env HOME="$WORK" GITHUB_OUTPUT="$WORK/out.txt" GITHUB_STEP_SUMMARY="$WORK/summary.md" \
    SITE_URL="http://127.0.0.1:$OG" \
    RAILWAY_API="http://127.0.0.1:$RP/graphql/v2" RAILWAY_HEADER=/tmp/rw.header \
    RAILWAY_TOKEN=harness-token \
    RAILWAY_GQL_TIMEOUT=8 RAILWAY_READY_DEADLINE_SEC=12 RAILWAY_READY_POLL_SEC=4 \
    DOCKERHUB_NAMESPACE=hillstreet IMAGE_NAME=open-box CHANNEL_TAG=railway \
    PROJECT_ID=prj-openbox EXPECTED_PROJECT_NAME=open-box \
    ENVIRONMENT_NAME=Production SERVICE_NAME=open-box MOUNT_PATH=/opt/openlist/data \
    ORIGIN_OVERRIDE="" RETIRED_ZEABUR_PROJECT_ID=ymhiwerqyegvondndkjn \
    CLOUDFLARE_API="http://127.0.0.1:$CF/client/v4" CLOUDFLARE_HEADER=/tmp/cf.header \
    CLOUDFLARE_API_KEY=cfkey CLOUDFLARE_EMAIL=cf@example.com \
    CLOUDFLARE_ACCOUNT_ID=acc-hillstreet CF_TIMEOUT=5 VERIFY_ONLY=false \
    WORKER_NAME=open-box-gateway \
    MODE="promote and verify" DB_DSN="postgres://u:p@h/db" \
    "$@" bash "$file" >stdout.txt 2>stderr.txt
  RC=$?
}
show() { echo "rc=$RC out:$(tail -3 stdout.txt | tr '\n' '|') err:$(tail -3 stderr.txt | tr '\n' '|')"; }
gate_run() { # origin-port [extra env]
  # Runs the shipped halves in the shipped order: the Railway gate, then the
  # edge gate with whatever the cutover reported (EDGE_WRITE, defaulted here).
  # A Railway-gate failure stops, because that is what the runner does.
  local port="$1"; shift
  run_step "$GAT" ORIGIN_URL="http://127.0.0.1:$port" \
    EXPECTED_TAG=main-1e7093f BEFORE_VERSION="" BEFORE_ASSETS="" \
    EXPECTED_FRONTEND_ASSET=index-DXZYoYrc.js EXPECTED_SITE_NAME=Open-Box \
    VERIFY_ONLY=false SITE_URL="http://127.0.0.1:$port" "$@"
  [ "$RC" = 0 ] || return 0
  run_step "$EDGATE" ORIGIN_URL="http://127.0.0.1:$port" \
    EXPECTED_TAG=main-1e7093f EXPECTED_FRONTEND_ASSET=index-DXZYoYrc.js \
    EDGE_WRITE="${EDGE_WRITE:-unchanged}" WORKER_NAME=open-box-gateway \
    SITE_URL="http://127.0.0.1:$port" "$@"
}

reset_state
use_profile existing

# T1 — target resolves project/environment/service/deployment/domain
run_step "$TGT"
if [ "$RC" = 0 ] \
   && grep -q '^service_id=svc-old$' out.txt \
   && grep -q '^environment_id=env-prod$' out.txt \
   && grep -q '^before_deployment_id=dep-old$' out.txt \
   && grep -q '^before_image=hillstreet/open-box:railway$' out.txt \
   && grep -q '^origin_url=https://open-box-production.up.railway.app$' out.txt \
   && grep -qx 'Bearer harness-token' reqs.log; then
  ok "T1 target resolves service, deployment id, channel image and origin; bearer sent from a header file"
else ko "T1 target" "$(show) out=$(tr '\n' ' ' < out.txt)"; fi

# T2 — provision mode tolerates a missing service
reset_state; drop_services
run_step "$TGT" MODE="provision and verify"
if [ "$RC" = 0 ] && grep -q '^service_id=$' out.txt && grep -q '^origin_url=$' out.txt \
   && has 'does not exist yet'; then
  ok "T2 target in provision mode tolerates a missing service and origin"
else ko "T2 provision target" "$(show)"; fi

# T3 — refuse a foreign project
use_profile bad_project
run_step "$TGT"
if [ "$RC" != 0 ] && has 'someone-elses-app' && has 'Refusing to write'; then
  ok "T3 target refuses to write to a project it does not own"
else ko "T3 project guard" "$(show)"; fi

# T4 — domain discovery falls back to serviceDomain
reset_state; use_profile domains_single
run_step "$TGT"
if [ "$RC" = 0 ] && grep -q '^origin_url=https://open-box-production.up.railway.app$' out.txt \
   && has 'discovered service domain: open-box-production'; then
  ok "T4 domain discovery falls back to the singular serviceDomain query"
else ko "T4 fallback" "$(show)"; fi

# T5 — promote mode fails loudly when no origin exists
reset_state; use_profile no_domain; no_domains
run_step "$TGT"
if [ "$RC" != 0 ] && has 'no public domain found'; then
  ok "T5 promote mode refuses to continue with no resolvable origin"
else ko "T5 no origin" "$(show)"; fi

# T5b — vars.RAILWAY_ORIGIN_URL overrides discovery
run_step "$TGT" ORIGIN_OVERRIDE="https://box.example.com"
if [ "$RC" = 0 ] && grep -q '^origin_url=https://box.example.com$' out.txt; then
  ok "T5b an explicit RAILWAY_ORIGIN_URL wins over discovery"
else ko "T5b origin override" "$(show)"; fi

# T6 — roll captures the NEW deployment id
reset_state; use_profile existing
run_step "$ROL" BEFORE_DEPLOYMENT_ID=dep-old SERVICE_ID=svc-old ENVIRONMENT_ID=env-prod \
  ORIGIN_URL="http://127.0.0.1:$OG"
if [ "$RC" = 0 ] && grep -q '^deployment_id=dep-new$' out.txt && grep -q '^service_id=svc-old$' out.txt; then
  ok "T6 roll records the new deployment id instead of the previous one"
else ko "T6 roll" "$(show)"; fi

# T6b — roll refuses when Railway never starts a new deployment
reset_state; use_profile stale
run_step "$ROL" BEFORE_DEPLOYMENT_ID=dep-old SERVICE_ID=svc-old ENVIRONMENT_ID=env-prod \
  ORIGIN_URL="http://127.0.0.1:$OG"
if [ "$RC" != 0 ] && has 'no new deployment appeared'; then
  ok "T6b roll refuses to claim a promotion Railway never accepted"
else ko "T6b stale roll" "$(show)"; fi

# T7 — wait keeps polling when the named bundle is not the one served
use_profile existing
set_deployment dep-new SUCCESS
start_origin "$OG" RW_ORIGIN_ASSET=index-OLDOLDOLD.js
run_step "$WAT" DEPLOYMENT_ID=dep-new SERVICE_ID=svc-old ENVIRONMENT_ID=env-prod \
  ORIGIN_URL="http://127.0.0.1:$OG" EXPECTED_FRONTEND_ASSET=index-DXZYoYrc.js
if [ "$RC" != 0 ] && has 'not served yet' && has 'never reached a serving state'; then
  ok "T7 wait times out rather than accepting a SUCCESS that serves the old bundle"
else ko "T7 wrong bundle" "$(show)"; fi

# T8 — wait exits when the named bundle is actually served
start_origin "$OGUP" RW_ORIGIN_ASSET=index-DXZYoYrc.js
run_step "$WAT" DEPLOYMENT_ID=dep-new SERVICE_ID=svc-old ENVIRONMENT_ID=env-prod \
  ORIGIN_URL="http://127.0.0.1:$OGUP" EXPECTED_FRONTEND_ASSET=index-DXZYoYrc.js
if [ "$RC" = 0 ] && has 'serves the expected index-DXZYoYrc.js'; then
  ok "T8 wait clears only on the named bundle at the origin"
else ko "T8 named bundle" "$(show)"; fi

# T9 — wait falls back when deployment(id:) is unavailable
use_profile deployment_fallback
run_step "$WAT" DEPLOYMENT_ID=dep-new SERVICE_ID=svc-old ENVIRONMENT_ID=env-prod \
  ORIGIN_URL="http://127.0.0.1:$OGUP" EXPECTED_FRONTEND_ASSET=index-DXZYoYrc.js
if [ "$RC" = 0 ] && has 'deployment=SUCCESS'; then
  ok "T9 wait falls back to serviceInstance when deployment(id:) is missing"
else ko "T9 fallback" "$(show)"; fi

# T10 — wait aborts on CRASHED
use_profile existing
mark_crashed
run_step "$WAT" DEPLOYMENT_ID=dep-new SERVICE_ID=svc-old ENVIRONMENT_ID=env-prod \
  ORIGIN_URL="http://127.0.0.1:$OGUP" EXPECTED_FRONTEND_ASSET=index-DXZYoYrc.js
if [ "$RC" != 0 ] && has 'reported CRASHED'; then
  ok "T10 wait aborts on CRASHED instead of faking readiness"
else ko "T10 crashed" "$(show)"; fi

# T11 — the whole gate on a healthy runtime
start_origin "$OGUP" RW_ORIGIN_SITE_NAME=Open-Box RW_ORIGIN_ASSET=index-DXZYoYrc.js
gate_run "$OGUP"
if [ "$RC" = 0 ] && has 'Production gate passed for main-1e7093f'; then
  ok "T11 gate passes a healthy Railway runtime"
else ko "T11 gate" "$(show)"; fi

# T12 — a runtime that booted a local database is rejected
start_origin "$OGUP" RW_ORIGIN_SITE_NAME=OpenList RW_ORIGIN_ASSET=index-DXZYoYrc.js
gate_run "$OGUP"
if [ "$RC" != 0 ] && has 'not reading the production database'; then
  ok "T12 gate rejects a runtime that is not on the production database"
else ko "T12 site_name" "$(show)"; fi

# T13 — a pre-PAT binary is rejected
start_origin "$OGUP" RW_ORIGIN_SITE_NAME=Open-Box RW_ORIGIN_ASSET=index-DXZYoYrc.js RW_ORIGIN_PAT=legacy
gate_run "$OGUP"
if [ "$RC" != 0 ] && has 'predates scoped personal access tokens'; then
  ok "T13 gate rejects a binary that predates scoped personal access tokens"
else ko "T13 pat" "$(show)"; fi

# T13b — a SPA fallback on the token route is rejected
start_origin "$OGUP" RW_ORIGIN_SITE_NAME=Open-Box RW_ORIGIN_ASSET=index-DXZYoYrc.js RW_ORIGIN_TOKEN=spa
gate_run "$OGUP"
if [ "$RC" != 0 ] && has 'token/list is not routed'; then
  ok "T13b gate rejects an SPA fallback on the token route"
else ko "T13b spa" "$(show)"; fi

# T14 — Railway healthy, edge still down: names the cutover
start_origin "$OGUP" RW_ORIGIN_SITE_NAME=Open-Box RW_ORIGIN_ASSET=index-DXZYoYrc.js
start_origin "$OG" RW_ORIGIN_DOWN=1
EDGE_WRITE=skipped gate_run "$OGUP" SITE_URL="http://127.0.0.1:$OG"
if [ "$RC" != 0 ] && has 'edge cutover step was skipped' \
   && has 'CLOUDFLARE_API_KEY' && has 'verify-only run'; then
  ok "T14 the edge gate names the skipped cutover and the three reasons it could have been skipped"
else ko "T14 cutover message" "$(show)"; fi

# T14b — the Railway half passes on its own even while the edge is dead, which
#         is what lets the cutover step run at all during a recovery.
start_origin "$OG" RW_ORIGIN_DOWN=1
run_step "$GAT" ORIGIN_URL="http://127.0.0.1:$OGUP" EXPECTED_TAG=main-1e7093f \
  EXPECTED_FRONTEND_ASSET=index-DXZYoYrc.js EXPECTED_SITE_NAME=Open-Box \
  BEFORE_VERSION="" BEFORE_ASSETS="" \
  VERIFY_ONLY=false SITE_URL="http://127.0.0.1:$OG"
if [ "$RC" = 0 ] && has 'Railway origin checks passed'; then
  ok "T14b the Railway gate half is independent of the edge, so a recovery run can reach the cutover"
else ko "T14b railway-only gate" "$(show)"; fi

# T15 — the before-state capture tolerates a dead origin (recovery run)
start_origin "$OG" RW_ORIGIN_DOWN=1
run_step "$BEF" ORIGIN_URL="http://127.0.0.1:$OG" DOCKERHUB_NAMESPACE=definitely-not-a-real-ns-xyz
if [ "$RC" = 0 ] && grep -q '^before_assets=$' out.txt && has 'digest before: none'; then
  ok "T15 pre-state capture never aborts when the origin is dead"
else ko "T15 before step" "$(show)"; fi

# T16 — the channel guard refuses a mismatched channel digest
(
  curl() {
    case "$*" in
      *"/tags/main-abc1234"*) printf '{"digest":"sha256:aaa","last_updated":"2026-11-04T00:00:00Z"}' ;;
      *"/tags/railway"*)      printf '{"digest":"sha256:ddd"}' ;;
      *) return 22 ;;
    esac
  }
  export -f curl
  docker() { return 0; }
  export -f docker
  env HOME="$WORK" MODE="promote and verify" RAILWAY_API="http://127.0.0.1:$RP/graphql/v2" \
      RAILWAY_HEADER=/tmp/rw.header RAILWAY_GQL_TIMEOUT=8 \
      DOCKERHUB_NAMESPACE=hillstreet IMAGE_NAME=open-box CHANNEL_TAG=railway \
      EXPECTED_TAG=main-abc1234 EXPECTED_DIGEST=sha256:aaa \
      DOCKERHUB_USERNAME=user DOCKERHUB_TOKEN=secret-token \
      bash "$WORK/$PUB" > "$WORK"/stdout.txt 2> "$WORK"/stderr.txt
  RC=$?
  if [ "$RC" != 0 ] && grep -qs 'resolves to sha256:ddd' "$WORK"/stdout.txt "$WORK"/stderr.txt \
     && ! grep -qs 'secret-token' "$WORK"/stdout.txt "$WORK"/stderr.txt; then
    ok "T16 channel publish refuses to redeploy when the channel digest != the promoted build"
  else ko "T16 channel guard" "rc=$RC $(tail -2 "$WORK"/stderr.txt | tr '\n' '|')"; fi
)

# T17 — a matched channel digest lets the roll proceed
(
  curl() {
    case "$*" in
      *"/tags/main-abc1234"*) printf '{"digest":"sha256:aaa","last_updated":"2026-11-04T00:00:00Z"}' ;;
      *"/tags/railway"*)      printf '{"digest":"sha256:aaa"}' ;;
      *) return 22 ;;
    esac
  }
  export -f curl
  docker() { return 0; }
  export -f docker
  env HOME="$WORK" MODE="promote and verify" RAILWAY_API="http://127.0.0.1:$RP/graphql/v2" \
      RAILWAY_HEADER=/tmp/rw.header RAILWAY_GQL_TIMEOUT=8 \
      DOCKERHUB_NAMESPACE=hillstreet IMAGE_NAME=open-box CHANNEL_TAG=railway \
      EXPECTED_TAG=main-abc1234 EXPECTED_DIGEST=sha256:aaa \
      DOCKERHUB_USERNAME=user DOCKERHUB_TOKEN=secret-token \
      bash "$WORK/$PUB" > "$WORK"/stdout.txt 2> "$WORK"/stderr.txt
  RC=$?
  if [ "$RC" = 0 ] && grep -qs 'railway now resolves to sha256:aaa' "$WORK"/stdout.txt; then
    ok "T17 channel publish proceeds only on digest equality"
  else ko "T17 channel pass path" "rc=$RC $(tail -2 "$WORK"/stdout.txt | tr '\n' '|')"; fi
)

# T18 — the bindings check names every missing prerequisite and never prints a value
run_step "$BIN" RAILWAY_TOKEN="" PROJECT_ID="" DB_DSN="" DOCKERHUB_USERNAME="" DOCKERHUB_TOKEN=""
if [ "$RC" != 0 ] && has 'RAILWAY_TOKEN is not set' && has 'RAILWAY_PROJECT_ID is not set' \
   && has 'SUPABASE_DB_URL is not set' && hasnt 'harness-token' && hasnt 'secret-token'; then
  ok "T18 bindings check reports every missing prerequisite without printing values"
else ko "T18 bindings" "$(show)"; fi

# T19 — the retired Zeabur id is refused even if someone sets it
run_step "$BIN" RAILWAY_TOKEN=t PROJECT_ID=ymhiwerqyegvondndkjn DB_DSN=d \
  DOCKERHUB_USERNAME=u DOCKERHUB_TOKEN=t
if [ "$RC" != 0 ] && has 'retired Zeabur project id'; then
  ok "T19 the retired Zeabur identifier is still refused"
else ko "T19 retired id" "$(show)"; fi

# T19b — a repository variable shaped like JSON/shell metacharacters is refused
#           before any request body is built (the ids are concatenated into GraphQL
#           variables and Docker Hub URLs, so their shape is the boundary).
run_step "$BIN" RAILWAY_TOKEN=t PROJECT_ID='a","x":"y' DB_DSN=d \
  DOCKERHUB_USERNAME=u DOCKERHUB_TOKEN=t
if [ "$RC" != 0 ] && has 'RAILWAY_PROJECT_ID must contain only'; then
  ok "T19b a malformed project id is refused before any request is built"
else ko "T19b project id shape" "$(show)"; fi

run_step "$BIN" RAILWAY_TOKEN=t PROJECT_ID=prj-ok DB_DSN=d CHANNEL_TAG='bad/tag' \
  DOCKERHUB_USERNAME=u DOCKERHUB_NAMESPACE=u DOCKERHUB_TOKEN=t
if [ "$RC" != 0 ] && has 'RAILWAY_CHANNEL_TAG must contain only'; then
  ok "T19c a channel tag with a slash is refused (it would change the registry URL)"
else ko "T19c channel tag shape" "$(show)"; fi

# T20 — rotation attestation gates a write run
run_step "$RTO" ROTATE_CONFIRMED="no — stop"
if [ "$RC" != 0 ] && has 'rotating the previously exposed management tokens'; then
  ok "T20 a write run without the rotation attestation stops"
else ko "T20 rotation gate" "$(show)"; fi

# T21 — verify-only runs need no attestation
run_step "$RTO" ROTATE_CONFIRMED="no — stop" MODE="verify only (no write)"
if [ "$RC" = 0 ] && has 'no Railway write will be attempted'; then
  ok "T21 verify-only runs need no attestation"
else ko "T21 verify-only attestation" "$(show)"; fi

# T22 — provision fills in variables, volume, healthcheck and domain on a fresh service
reset_state; drop_services
use_profile provision_empty
run_step "$PRV" SERVICE_ID="" ENVIRONMENT_ID=env-prod
keys=$(python3 -c 'import json,os;print(",".join(sorted(json.load(open(os.environ["RW_MOCK_STATE"]))["variables"])))')
mount=$(python3 -c 'import json,os;print(json.load(open(os.environ["RW_MOCK_STATE"]))["services"][0].get("volume_mount"))')
hc=$(python3 -c 'import json,os;print(json.load(open(os.environ["RW_MOCK_STATE"]))["services"][0].get("healthcheckPath"))')
dsn=$(python3 -c 'import json,os;print(json.load(open(os.environ["RW_MOCK_STATE"]))["variables"].get("DB_DSN"))')
if [ "$RC" = 0 ] && grep -q '^service_id=svc-new$' out.txt && grep -q '^origin_url=https://' out.txt \
   && [ "$keys" = "DB_DSN,DB_TABLE_PREFIX,DB_TYPE,PUBLIC_DOMAIN,RAILWAY_RUN_UID,SITE_URL,TZ,UMASK" ] \
   && [ "$mount" = "/opt/openlist/data" ] && [ "$hc" = "/ping" ] \
   && [ "$dsn" = "postgres://u:p@h/db" ] && hasnt 'postgres://u:p@h/db'; then
  ok "T22 provision creates the service with the full env set, the data volume, /ping healthcheck and a domain; DSN never logged"
else ko "T22 provision detail" "rc=$RC keys=$keys mount=$mount hc=$hc $(show)"; fi

# T23 — a rejected volumeCreate becomes a visible warning, never a silent pass
reset_state; drop_services
use_profile volume_rejected
run_step "$PRV" SERVICE_ID="" ENVIRONMENT_ID=env-prod
if [ "$RC" = 0 ] && has 'volumeCreate was rejected' && ! has 'volume created at'; then
  ok "T23 a rejected volumeCreate is a loud warning, not a claim that the volume exists"
else ko "T23 volume warn" "$(show)"; fi

# T23b — a rejected healthcheck write is surfaced too
reset_state; drop_services
use_profile config_rejected
run_step "$PRV" SERVICE_ID="" ENVIRONMENT_ID=env-prod
if [ "$RC" = 0 ] && has 'healthcheck configuration was rejected' && ! has 'healthcheck configured'; then
  ok "T23b a rejected serviceInstanceUpdate is surfaced with the dashboard fallback, not swallowed"
else ko "T23b config reject" "$(show)"; fi

# T24 — the report always renders and never leaks the bearer
reset_state; use_profile existing
start_origin "$OGUP" RW_ORIGIN_SITE_NAME=Open-Box
: > summary.md
env HOME="$WORK" GITHUB_STEP_SUMMARY="$WORK"/summary.md GITHUB_OUTPUT="$WORK"/out.txt \
  RAILWAY_API="http://127.0.0.1:$RP/graphql/v2" RAILWAY_HEADER=/tmp/rw.header \
  DOCKERHUB_NAMESPACE=hillstreet IMAGE_NAME=open-box CHANNEL_TAG=railway PROJECT_ID=prj-openbox \
  MOUNT_PATH=/opt/openlist/data ORIGIN_URL="http://127.0.0.1:$OGUP" SERVICE_ID=svc-old \
  ENVIRONMENT_ID=env-prod DEPLOYMENT_ID=dep-new CHANNEL_DIGEST_BEFORE=sha256:zzz \
  WORKER_NAME=open-box-gateway EDGE_WRITE=skipped EDGE_ACCOUNT=none EDGE_OLD_ORIGIN=none \
  EDGE_NEW_ORIGIN=none EDGE_ROUTE=not-checked \
  bash "$REP" >stdout.txt 2>stderr.txt
RC=$?
if [ "$RC" = 0 ] && grep -q 'Railway promotion report' summary.md && grep -q 'rollback' summary.md \
   && grep -q 'edge: .skipped.' summary.md && ! grep -q 'harness-token' summary.md; then
  ok "T24 report records the channel digest and the rollback command without leaking the token"
else ko "T24 report" "rc=$RC summary=$(head -4 summary.md | tr '\n' '|') $(show)"; fi

# T25 — the cleanup step removes every credential file
printf 'x\n' > /tmp/rw.header; printf 'y\n' > /tmp/rw_gql.sh
touch /tmp/rw.token /tmp/rw.newdom /tmp/rw.dep
run_step "$CLN"
if [ "$RC" = 0 ] && [ ! -e /tmp/rw.header ] && [ ! -e /tmp/rw_gql.sh ] && [ ! -e /tmp/rw.newdom ] \
   && [ ! -e /tmp/rw.token ]; then
  ok "T25 the always-run cleanup deletes the bearer and response files"
else ko "T25 cleanup" "rc=$RC header=$([ -e /tmp/rw.header ] && echo present || echo gone)"; fi

# --------------------------------------------------------------------- edge
# The Cloudflare cutover step, executed as shipped against mock_cloudflare.py.
cf_bindings() { # worker
  python3 -c '
import json,sys
st=json.load(open("cf_state.json"))
w=[x for x in st["workers"] if x["name"]==sys.argv[1]][0]
print(json.dumps(w["bindings"], sort_keys=True))' "$1"
}
cf_binding() { # worker name field
  python3 -c '
import json,sys
st=json.load(open("cf_state.json"))
w=[x for x in st["workers"] if x["name"]==sys.argv[1]][0]
hit=[b for b in w["bindings"] if b["name"]==sys.argv[2]]
print("" if not hit else str(hit[0].get(sys.argv[3], "")))' "$1" "$2" "$3"
}
EDGE_URL="https://open-box-production.up.railway.app"
edge_run() { # [extra env]
  run_step "$EDG" ORIGIN_URL="$EDGE_URL" SITE_URL="https://open-box.space" "$@"
}

# T26 — the cutover rewrites ORIGIN_URL and nothing else
reset_cf; use_cf_profile existing
edge_run
mode=$(python3 -c 'import os,sys;print(oct(os.stat("/tmp/cf.header").st_mode & 0o777))')
b_names=$(cf_bindings open-box-gateway | python3 -c 'import json,sys;print(",".join(sorted(b["name"] for b in json.loads(sys.stdin.read()))))')
secret_type=$(cf_binding open-box-gateway AI_CONFIG_KEY type)
new_origin=$(cf_binding open-box-gateway ORIGIN_URL text)
app_name=$(cf_binding open-box-gateway APP_NAME text)
kv_ns=$(cf_binding open-box-gateway AI_CONFIG namespace_id)
if [ "$RC" = 0 ] && [ "$new_origin" = "$EDGE_URL" ] && [ "$secret_type" = "secret_text" ] \
   && [ "$b_names" = "AI,AI_CONFIG,AI_CONFIG_KEY,APP_NAME,AUTH_REQUIRED,ORIGIN_URL,SUPABASE_URL" ] \
   && [ "$app_name" = "Open-Box" ] && [ "$kv_ns" = "c400d6e5e1bf44fc96a6ae32f09b5bd1" ] \
   && grep -qs '^PATCH ' cf_reqs.log && grep -q '^edge_write=wrote$' out.txt \
   && grep -q '^route_verified=yes$' out.txt && [ "$mode" = "0o600" ]; then
  ok "T26 the cutover replaces ORIGIN_URL alone, keeps the ai/kv/plain bindings and the unreadable secret, and re-verifies the route"
else ko "T26 cutover write" "rc=$RC origin=$new_origin secret=$secret_type names=$b_names app=$app_name kv=$kv_ns mode=$mode $(show)"; fi

# T27 — no credentials means no write, not a failure
reset_cf; use_cf_profile existing
edge_run CLOUDFLARE_API_KEY="" CLOUDFLARE_EMAIL=""
if [ "$RC" = 0 ] && grep -q '^edge_write=skipped$' out.txt && ! grep -qs '^PATCH ' cf_reqs.log; then
  ok "T27 missing Cloudflare credentials skip the cutover loudly instead of failing a Railway promotion"
else ko "T27 no credentials" "$(show)"; fi

# T28 — an unresolved origin means no write
reset_cf; use_cf_profile existing
edge_run ORIGIN_URL=""
if [ "$RC" = 0 ] && grep -q '^edge_write=skipped$' out.txt && ! grep -qs '^PATCH ' cf_reqs.log; then
  ok "T28 the cutover refuses to guess an origin and writes nothing"
else ko "T28 no origin" "$(show)"; fi

# T29 — idempotent: already repointed, so no PATCH is issued
reset_cf; use_cf_profile already_railway
edge_run
if [ "$RC" = 0 ] && grep -q '^edge_write=unchanged$' out.txt && ! grep -qs '^PATCH ' cf_reqs.log \
   && has 'already points at this Railway origin'; then
  ok "T29 a Worker that already points at the Railway origin is left untouched"
else ko "T29 idempotent" "$(show)"; fi

# T30 — verify-only reads the state and writes nothing
reset_cf; use_cf_profile existing
edge_run VERIFY_ONLY=true
if [ "$RC" = 0 ] && grep -q '^edge_write=skipped$' out.txt && ! grep -qs '^PATCH ' cf_reqs.log \
   && has 'verify-only run'; then
  ok "T30 verify-only mode reports the drift it found without repointing the edge"
else ko "T30 verify only" "$(show)"; fi

# T31 — a Worker without an ORIGIN_URL binding is refused, not guessed
reset_cf; use_cf_profile no_origin_binding
edge_run
if [ "$RC" != 0 ] && has 'has no ORIGIN_URL binding' && ! grep -qs '^PATCH ' cf_reqs.log; then
  ok "T31 the cutover refuses to invent a binding name when the live Worker lacks ORIGIN_URL"
else ko "T31 missing binding" "$(show)"; fi

# T32 — an ORIGIN_URL stored as a secret is refused with the reason
reset_cf; use_cf_profile origin_is_secret
edge_run
if [ "$RC" != 0 ] && has "is a 'secret_text' binding" && ! grep -qs '^PATCH ' cf_reqs.log; then
  ok "T32 the cutover refuses to overwrite a secret-shaped ORIGIN_URL it cannot restate"
else ko "T32 secret-shaped origin" "$(show)"; fi

# T33 — the account is resolved by probing when nothing is configured
reset_cf; use_cf_profile existing
edge_run CLOUDFLARE_ACCOUNT_ID=""
if [ "$RC" = 0 ] && grep -q '^account=acc-hillstreet$' out.txt \
   && has 'resolved account: acc-hillstreet' && grep -qs 'GET /client/v4/accounts ' cf_reqs.log; then
  ok "T33 with no account binding the cutover finds the one account that owns the Worker"
else ko "T33 account discovery" "rc=$RC $(show) out=$(tr '\n' ' ' < out.txt)"; fi

# T34 — a rejected PATCH is reported as a failure, never as a completed cutover
reset_cf; use_cf_profile patch_rejected
edge_run
if [ "$RC" != 0 ] && has 'the settings PATCH was rejected' && [ "$(cf_binding open-box-gateway ORIGIN_URL text)" != "$EDGE_URL" ]; then
  ok "T34 a rejected settings PATCH fails the run and leaves the Worker on its old origin"
else ko "T34 patch rejected" "$(show)"; fi

# T35 — a detached zone route is a hard failure after a successful write
reset_cf; use_cf_profile route_detached
edge_run
if [ "$RC" != 0 ] && has 'is no longer routed' && [ "$(cf_binding open-box-gateway ORIGIN_URL text)" = "$EDGE_URL" ]; then
  ok "T35 the cutover verifies the zone route survived and stops the run when it did not"
else ko "T35 route detached" "$(show)"; fi

# T36 — an unreadable zone degrades to a named gap, not a false all-clear
reset_cf; use_cf_profile zone_unreadable
edge_run
if [ "$RC" = 0 ] && grep -q '^edge_write=wrote$' out.txt && grep -q '^route_verified=unverified$' out.txt \
   && has 'route attachment was not verified'; then
  ok "T36 an unreadable zone records the unverified route as a warning instead of claiming success"
else ko "T36 zone unreadable" "$(show)"; fi

# T37 — the Basic header is sent on every call and the key never reaches a log
reset_cf; use_cf_profile existing
edge_run
sent=$(grep -c 'Basic ' cf_reqs.log || true)
if [ "$RC" = 0 ] && [ "$sent" -ge 3 ] && hasnt 'cfkey' && hasnt 'cf@example.com' \
   && ! grep -qs 'cfkey' cf_reqs.log && ! grep -qs 'Bearer' cf_reqs.log; then
  ok "T37 every Cloudflare call carries the Basic header from the 0600 file and no key value is logged"
else ko "T37 credential hygiene" "rc=$RC sent=$sent $(show)"; fi

# T38 — the edge gate names the write it just performed when the edge still fails
reset_cf; use_cf_profile existing
start_origin "$OGUP" RW_ORIGIN_SITE_NAME=Open-Box RW_ORIGIN_ASSET=index-DXZYoYrc.js
start_origin "$OG" RW_ORIGIN_DOWN=1
run_step "$EDGATE" ORIGIN_URL="http://127.0.0.1:$OGUP" SITE_URL="http://127.0.0.1:$OG" \
  EXPECTED_TAG=main-1e7093f EXPECTED_FRONTEND_ASSET=index-DXZYoYrc.js \
  EDGE_WRITE=wrote WORKER_NAME=open-box-gateway
if [ "$RC" != 0 ] && has 'was repointed at http://127.0.0.1:' && has 'not the old Zeabur route'; then
  ok "T38 after a real cutover the edge gate says the Worker was repointed rather than blaming the old route"
else ko "T38 edge gate wording" "$(show)"; fi

# T39 — the report renders the edge line and does not leak the Cloudflare key
reset_cf; use_cf_profile existing
: > summary.md
env HOME="$WORK" GITHUB_STEP_SUMMARY="$WORK/summary.md" GITHUB_OUTPUT="$WORK/out.txt" \
  RAILWAY_API="http://127.0.0.1:$RP/graphql/v2" RAILWAY_HEADER=/tmp/rw.header \
  DOCKERHUB_NAMESPACE=hillstreet IMAGE_NAME=open-box CHANNEL_TAG=railway PROJECT_ID=prj-openbox \
  MOUNT_PATH=/opt/openlist/data ORIGIN_URL="http://127.0.0.1:$OGUP" SERVICE_ID=svc-old \
  ENVIRONMENT_ID=env-prod DEPLOYMENT_ID=dep-new CHANNEL_DIGEST_BEFORE=sha256:zzz \
  WORKER_NAME=open-box-gateway EDGE_WRITE=wrote EDGE_ACCOUNT=acc-hillstreet \
  EDGE_OLD_ORIGIN=https://open-box-space.zeabur.app EDGE_NEW_ORIGIN="$EDGE_URL" EDGE_ROUTE=yes \
  bash "$REP" >stdout.txt 2>stderr.txt
RC=$?
if [ "$RC" = 0 ] && grep -q 'edge: .wrote. on .open-box-gateway.' summary.md \
   && grep -q 'retired Zeabur host' summary.md && ! grep -q 'cfkey' summary.md; then
  ok "T39 the report records the edge write and explains why the edge is not part of the rollback"
else ko "T39 report edge line" "rc=$RC summary=$(head -12 summary.md | tr '\n' '|')"; fi

# T40 — the cleanup step also deletes the Cloudflare header
printf 'z\n' > /tmp/cf.header; printf 'w\n' > /tmp/cf_api.sh
run_step "$CLN"
if [ "$RC" = 0 ] && [ ! -e /tmp/cf.header ] && [ ! -e /tmp/cf_api.sh ]; then
  ok "T40 the always-run cleanup deletes the Cloudflare credential file too"
else ko "T40 cleanup cf" "rc=$RC cf.header=$([ -e /tmp/cf.header ] && echo present || echo gone)"; fi

pkill -f mock_railway.py 2>/dev/null
pkill -f mock_origin.py 2>/dev/null
pkill -f mock_cloudflare.py 2>/dev/null
echo "=== harness finished: fail=$fail"
exit "$fail"
