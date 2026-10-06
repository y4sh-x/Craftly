#!/usr/bin/env bash
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
fail=0
printf 'Craftly Release tests\n\n'
node --check src/services/softwareCatalog.js || fail=1
node --check src/db/migrations/032_minecraft_software.js || fail=1
node --check src/web/routes/api.js || fail=1
node --check test/minecraft-ecosystem.test.js || fail=1
bash -n menu.sh || fail=1
bash -n test/test.sh || fail=1
if grep -q "CREATE TABLE IF NOT EXISTS server_software_state" src/db/migrations/032_minecraft_software.js; then echo '[PASS] Release migration'; else echo '[FAIL] Release migration'; fail=1; fi
if grep -q "softwareCatalog" src/web/routes/api.js; then echo '[PASS] software catalog API wiring'; else echo '[FAIL] software catalog API wiring'; fail=1; fi
if grep -q "Modrinth\|CurseForge\|Hangar\|SpigotMC" docs/minecraft-ecosystem.md; then echo '[PASS] content source documentation'; else echo '[FAIL] content source documentation'; fail=1; fi
node --test test/minecraft-ecosystem.test.js || fail=1
printf '\nMinecraft ecosystem smoke result: %s\n' "$([ "$fail" -eq 0 ] && echo PASS || echo FAIL)"
exit "$fail"
