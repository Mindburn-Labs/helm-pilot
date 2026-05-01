#!/usr/bin/env bash
set -euo pipefail

if rg -n \
  --glob '!package-lock.json' \
  --glob '!scripts/check-active-deploy-targets.sh' \
  '(flyctl|Fly\.io|superfly|FLY_API_TOKEN|infra/fly|\.fly\.dev)' \
  .; then
  echo "Active Fly deployment references are not allowed. Use DigitalOcean/doctl only." >&2
  exit 1
fi
