#!/usr/bin/env bash
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
fail=0
printf 'Craftly Release tests\n\n'
node --check src/services/nodeTransport.js || fail=1
node --check src/services/remoteFiles.js || fail=1
node --check src/services/sftpCredentials.js || fail=1
node --check src/web/routes/files.js || fail=1
node --check src/web/routes/api.js || fail=1
node --check node-agent/agent.js || fail=1
bash -n menu.sh || fail=1
bash -n test/test.sh || fail=1
if grep -q "Release" docs/files-and-sftp.md; then echo '[PASS] Release documentation'; else echo '[FAIL] Release documentation'; fail=1; fi
if grep -q "sftp-credentials" src/web/routes/api.js; then echo '[PASS] SFTP credential route'; else echo '[FAIL] SFTP credential route'; fail=1; fi
if grep -q "files-download" node-agent/agent.js; then echo '[PASS] streaming download route'; else echo '[FAIL] streaming download route'; fail=1; fi
if grep -q "app.put('/v1/servers/:id/files" node-agent/agent.js; then echo '[PASS] streaming upload route'; else echo '[FAIL] streaming upload route'; fail=1; fi
printf '\nFiles and SFTP smoke result: %s\n' "$([ "$fail" -eq 0 ] && echo PASS || echo FAIL)"
exit "$fail"
