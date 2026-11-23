#!/bin/bash
set -euo pipefail

# config.sh accepts registration inputs via ACTIONS_RUNNER_INPUT_*.
export ACTIONS_RUNNER_INPUT_TOKEN="${RUNNER_TOKEN:?RUNNER_TOKEN is required}"
unset RUNNER_TOKEN
./config.sh --unattended --ephemeral \
    --url https://github.com/hillstreet-ph/open-box \
    --name "Master Runner" --work _work
unset ACTIONS_RUNNER_INPUT_TOKEN
exec ./run.sh
