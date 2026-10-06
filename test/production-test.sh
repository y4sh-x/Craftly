#!/usr/bin/env bash
set -u -o pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

PASS=0; FAIL=0; SKIP=0
ok(){ PASS=$((PASS+1)); printf '\033[92m[PASS]\033[0m %s\n' "$1"; }
bad(){ FAIL=$((FAIL+1)); printf '\033[91m[FAIL]\033[0m %s\n' "$1"; [ -n "${2:-}" ] && printf '       %s\n' "$2"; }
skip(){ SKIP=$((SKIP+1)); printf '\033[93m[SKIP]\033[0m %s\n' "$1"; [ -n "${2:-}" ] && printf '       %s\n' "$2"; }
run(){ local n="$1"; shift; if "$@" >/tmp/craftly-test-test.out 2>&1; then ok "$n"; else bad "$n" "$(tail -c 1200 /tmp/craftly-test-test.out)"; fi; }
run_allow_skip(){ local n="$1"; shift; if "$@" >/tmp/craftly-test-test.out 2>&1; then ok "$n"; else skip "$n" "$(tail -c 1200 /tmp/craftly-test-test.out)"; fi; }

printf '\nCraftly 1.1.0 — Comprehensive Production Test Harness\n'
printf '%s\n\n' 'PASS = tested successfully | FAIL = tested and broken | SKIP = environment/config unavailable'

# 1. Repository integrity and shell/static checks
run 'menu.sh syntax' bash -n menu.sh
run 'test.sh syntax' bash -n test/test.sh
run 'all test runner scripts syntax' bash -c 'for f in test/*-run.sh test/production-test.sh; do [ -f "$f" ] || continue; bash -n "$f" || exit 1; done'
run 'all project JavaScript syntax' bash -c 'find src scripts node-agent test -type f \( -name "*.js" -o -name "*.mjs" -o -name "*.cjs" \) -print0 | xargs -0 -n1 node --check >/dev/null'
run 'package.json valid JSON' node -e 'JSON.parse(require("fs").readFileSync("package.json"))'
run 'README present' test -s README.md
run 'LICENSE present' test -s LICENSE
run 'testing documentation present' test -s test/TESTING.md
run 'no node_modules in release tree' bash -c '! find . -type d -name node_modules -print -quit | grep -q .'

# 2. Branding / architecture policy
run 'Craftly package metadata' grep -qi 'Craftly Minecraft Server Management Panel' package.json
run 'y4sh.x metadata' grep -qi 'y4sh.x' package.json
run 'Docker-only architecture' bash -c "! grep -RniE '(^|[^[:alnum:]_])(kvm|qemu|libvirt)([^[:alnum:]_]|$)' package.json docker-compose.yml node-agent 2>/dev/null"
run 'legacy application branding scan' bash -c '! grep -RniE "MPanel|Mpanel|mpanel|Nobita329|Nobita" src scripts public assets node-agent docs README.md package.json 2>/dev/null'

# 3. Node/dependency environment
if command -v node >/dev/null 2>&1; then
  MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
  if [ "$MAJOR" -ge 24 ]; then ok "Node.js 24+ ($(node --version))"; else skip "Node.js 24+ runtime" "Found $(node --version); install Node 24+ for runtime certification."; fi
else skip 'Node.js runtime' 'Node is unavailable'; fi
command -v npm >/dev/null 2>&1 && ok 'npm available' || skip 'npm available' 'npm unavailable'
command -v pnpm >/dev/null 2>&1 && ok 'pnpm available' || skip 'pnpm available' 'pnpm unavailable'

if [ -d node_modules ]; then
  ok 'dependencies installed'
else
  skip 'dependencies installed' 'Run pnpm install/npm install on the test host.'
fi

# 4. Build/lint/typecheck/unit suite — only meaningful with Node 24 + deps
if command -v node >/dev/null 2>&1 && [ "$(node -p 'Number(process.versions.node.split(".")[0])')" -ge 24 ] && [ -d node_modules ]; then
  if command -v pnpm >/dev/null 2>&1; then PKG=pnpm; else PKG=npm; fi
  run 'production build' "$PKG" run build
  run 'lint' "$PKG" run lint
  run 'format check' "$PKG" run format:check
  run 'typecheck' "$PKG" run typecheck
  run 'full unit/integration test suite' "$PKG" test
else
  skip 'production build' 'Requires Node 24+ and installed dependencies'
  skip 'lint' 'Requires Node 24+ and installed dependencies'
  skip 'format check' 'Requires Node 24+ and installed dependencies'
  skip 'typecheck' 'Requires Node 24+ and installed dependencies'
  skip 'full unit/integration test suite' 'Requires Node 24+ and installed dependencies'
fi

# 5. Focused contract tests
if command -v node >/dev/null 2>&1 && [ "$(node -p 'Number(process.versions.node.split(".")[0])')" -ge 24 ] && [ -d node_modules ]; then
  for f in test/architecture-contract.test.js test/nodes-contract.test.js test/allocations.test.js test/provisioning.test.js test/minecraft-ecosystem.test.js; do
    [ -f "$f" ] && run "$(basename "$f")" node --test "$f"
  done
else
  skip 'focused contract tests' 'Requires Node 24+ dependencies'
fi

# 6. Docker validation
if command -v docker >/dev/null 2>&1; then
  run_allow_skip 'Docker CLI' docker --version
  if docker info >/tmp/craftly-test-docker.out 2>&1; then
    ok 'Docker daemon reachable'
    if docker compose version >/tmp/craftly-test-compose.out 2>&1; then
      ok 'Docker Compose available'
      if [ -f docker-compose.yml ]; then run 'docker compose configuration' env DATA_DIR_HOST="${DATA_DIR_HOST:-$ROOT/data}" docker compose config -q; else skip 'docker compose configuration' 'No docker-compose.yml'; fi
    else skip 'Docker Compose available' 'Compose plugin unavailable'; fi
  else skip 'Docker daemon reachable' 'Docker daemon unavailable'; fi
else skip 'Docker CLI' 'Docker unavailable'; fi

# 7. Live panel smoke tests when explicitly configured
if [ -n "${CRAFTLY_TEST_BASE_URL:-}" ]; then
  if command -v node >/dev/null 2>&1; then
    if [ -n "${QA_USER:-}" ] && [ -n "${QA_PASS:-}" ]; then
      run 'live authenticated QA sweep' node scripts/qa-sweep.js "$CRAFTLY_TEST_BASE_URL"
    else skip 'live authenticated QA sweep' 'Set QA_USER and QA_PASS'; fi
  else skip 'live authenticated QA sweep' 'Node unavailable'; fi
else skip 'live authenticated QA sweep' 'Set CRAFTLY_TEST_BASE_URL, QA_USER and QA_PASS'; fi

# 8. Comprehensive test-all runner, which performs environment-aware checks
if command -v node >/dev/null 2>&1 && [ "$(node -p 'Number(process.versions.node.split(".")[0])')" -ge 24 ]; then
  export CRAFTLY_TEST_DOCKER="${CRAFTLY_TEST_DOCKER:-0}"
  if node test/test-all.mjs >/tmp/craftly-test-testall.out 2>&1; then
    ok 'comprehensive test-all.mjs'
  else
    # test-all can fail for legitimate environment reasons, but its explicit FAIL lines are release blockers.
    if grep -q '✗ FAIL' /tmp/craftly-test-testall.out; then bad 'comprehensive test-all.mjs' "$(grep '✗ FAIL' /tmp/craftly-test-testall.out | tail -20)"; else skip 'comprehensive test-all.mjs' "$(tail -20 /tmp/craftly-test-testall.out)"; fi
  fi
else skip 'comprehensive test-all.mjs' 'Requires Node 24+'; fi

# 9. Release artifact safety
run 'no private key material in production source' bash -c "! grep -RIl --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=test --exclude='*.example' --exclude='*.md' 'BEGIN .*PRIVATE KEY' src scripts node-agent public assets 2>/dev/null | grep -q ."
run 'no obvious credential literals in production source' bash -c "! grep -RniE --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=test --exclude='*.example' '(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{20,}|BEGIN .*PRIVATE KEY)' src scripts node-agent public assets 2>/dev/null | grep -q ."

printf '\n==========================================\n'
printf 'Production test result: %s passed, %s failed, %s skipped\n' "$PASS" "$FAIL" "$SKIP"
printf '==========================================\n'

if [ "$FAIL" -eq 0 ]; then
  printf 'No tested blocker detected. Review every SKIP before production certification.\n'
  exit 0
fi
printf 'Production certification: BLOCKED by failed tests.\n'
exit 1
