#!/usr/bin/env bash
# Development-only bootstrap; no storage mounts, credential writes or deployment.
set -Eeuo pipefail
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
MODE="${1:-install}"
case "$MODE" in install|check) ;; *) echo 'Usage: bash scripts/codex-setup.sh [install|check]' >&2; exit 2;; esac
command -v go >/dev/null || { echo 'Install the Go toolchain declared in go.mod first' >&2; exit 1; }
command -v npm >/dev/null || { echo 'Node/npm required for the edge gateway' >&2; exit 1; }
if [[ "$MODE" == install ]]; then
  go mod download
  go mod verify
  npm ci --prefix deploy/cloudflare
  echo 'Dependencies installed. Frontend assets and provider access are separate readiness gates.'
else
  go test ./...
  npm test --prefix deploy/cloudflare
  # Do not call build.sh here: it downloads frontend releases and may change tags.
  echo 'Tests passed. Full release build requires reviewed frontend assets and existing release workflow.'
fi
