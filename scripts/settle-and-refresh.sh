#!/bin/bash
# Wait for the 19:15 UTC market batch to expire, settle it on-chain, sweep
# agent claims, then refresh the public feed + redeploy the web app.
set -u
cd "$(dirname "$0")/.."
END=1794683720
NOW=$(date -u +%s)
WAIT=$((END + 120 - NOW))
if [ "$WAIT" -gt 0 ]; then echo "waiting ${WAIT}s for expiry…"; sleep "$WAIT"; fi
echo "=== resolver ==="
node engine/resolver.cjs 2>&1 | grep -v "ws error\|bigint"
echo "=== agents (claim sweep) ==="
node engine/agents.cjs 2>&1 | grep -v "ws error\|bigint" | tail -8
echo "=== status ==="
node scripts/status.cjs 2>&1 | grep -v "ws error\|bigint"
node scripts/export-feed.cjs
cd web && npm run build >/dev/null 2>&1 && cd ..
python3 ~/workspace/jackpot/tools/git_push.py "$PWD/web/dist" Axonprotocol404/pulse-markets gh-pages "Settled batch + refreshed agent feed" 2>&1 | tail -1
python3 ~/workspace/jackpot/tools/git_push.py "$PWD" Axonprotocol404/pulse-markets main "Refresh agent feed snapshot" --skip node_modules,.git,state,dist 2>&1 | tail -1
echo "=== done ==="
