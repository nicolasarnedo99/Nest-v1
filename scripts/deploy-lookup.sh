#!/usr/bin/env bash
# Copies the lookup service to morty and installs its dependencies. Never touches the env file.
# shortcut: no lockfile for the box, add one if transitive drift ever bites
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

rsync -R server/lookup.ts server/lookup-service.ts server/merchants.json server/shop.ts server/shop-crossmint.ts server/shop/catalog.json server/money.ts server/mirror.ts server/bitrefill.ts server/faucet.ts server/ocr-proxy.ts contracts/deployments/sepolia.json morty:turtle-lookup/
rsync deploy/lookup/package.json morty:turtle-lookup/package.json
ssh morty 'cd ~/turtle-lookup && npm install --omit=dev --no-audit --no-fund && if systemctl cat turtle-lookup >/dev/null 2>&1; then sudo systemctl restart turtle-lookup; fi'
