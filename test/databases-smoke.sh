#!/usr/bin/env bash
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

fail=0
pass(){ printf '[PASS] %s\n' "$1"; }
failf(){ printf '[FAIL] %s\n' "$1"; fail=1; }

for f in src/services/databaseHosts.js src/services/scheduler.js src/services/backups.js src/web/routes/api.js src/web/routes/index.js public/js/pages/databases.js src/db/migrations/033_database_hosts.js; do
  node --check "$f" >/dev/null 2>&1 && pass "syntax: $f" || failf "syntax: $f"
done

node -e "const fs=require('fs');const s=fs.readFileSync('src/db/migrations/033_database_hosts.js','utf8');for(const x of ['database_hosts','server_databases','schedule_runs']) if(!s.includes(x)) process.exit(1)" \
  && pass 'release migration contains database and scheduler tables' || failf 'release migration tables'

grep -q "sha256" src/services/backups.js && pass 'backup SHA-256 recording' || failf 'backup SHA-256 recording'
grep -q "schedule_runs" src/services/scheduler.js && pass 'schedule run history' || failf 'schedule run history'
grep -q "Docker-backed" docs/databases-backups-automation.md && pass 'release documentation' || failf 'release documentation'
grep -q "href=\"/databases\"" views/partials/sidebar.hbs && pass 'database navigation' || failf 'database navigation'

printf '\nDatabase smoke result: %s\n' "$([ "$fail" -eq 0 ] && echo PASS || echo FAIL)"
exit "$fail"
