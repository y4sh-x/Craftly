#!/usr/bin/env bash
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
PASS=0; FAIL=0
check(){ local name="$1"; shift; if "$@" >/dev/null 2>&1; then printf '[PASS] %s\n' "$name"; PASS=$((PASS+1)); else printf '[FAIL] %s\n' "$name"; FAIL=$((FAIL+1)); fi; }
command -v node >/dev/null 2>&1 || { echo 'Node.js is required'; exit 2; }
check 'nodeTransport syntax' node --check src/services/nodeTransport.js
check 'provisioning syntax' node --check src/services/provisioning.js
check 'live cache syntax' node --check src/services/liveCache.js
check 'API runtime routes syntax' node --check src/web/routes/api.js
check 'Panel WebSocket runtime proxy syntax' node --check src/ws/index.js
check 'Node agent runtime syntax' node --check node-agent/agent.js
check 'Release runtime methods present' grep -q 'runtimeWebSocket' src/services/provisioning.js
check 'Remote stats endpoint present' grep -q '/v1/servers/:id/stats' node-agent/agent.js
check 'Remote logs endpoint present' grep -q '/v1/servers/:id/logs' node-agent/agent.js
check 'Remote exec endpoint present' grep -q '/v1/servers/:id/exec' node-agent/agent.js
check 'Remote runtime WebSockets present' grep -q 'handleRuntimeWs' node-agent/agent.js
printf '\nPASS: %s\nFAIL: %s\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
