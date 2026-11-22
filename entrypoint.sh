#!/bin/bash
set -euo pipefail

if [ -z "${RUNNER_TOKEN:-}" ]; then
  echo "::error::RUNNER_TOKEN environment variable is required"
  exit 1
fi

# Register the runner (ephemeral so it re-registers cleanly on redeploy)
./config.sh --unattended \
  --url "https://github.com/hillstreet-ph/open-box" \
  --token "${RUNNER_TOKEN}" \
  --name "Master Runner" \
  --work "_work" \
  --ephemeral \
  --labels self-hosted,linux,x64

# Clean up on exit
trap './config.sh remove --unattended --token "${RUNNER_TOKEN}"' EXIT

# Start the runner
./run.sh
