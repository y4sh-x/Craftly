#!/usr/bin/env bash
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASS=0; FAIL=0
ok(){ echo "[PASS] $1"; PASS=$((PASS+1)); }
bad(){ echo "[FAIL] $1"; FAIL=$((FAIL+1)); }

check(){ local label="$1"; shift; if "$@"; then ok "$label"; else bad "$label"; fi; }

check "Release migration exists" test -f "$ROOT/src/db/migrations/034_security.js"
check "Release security service exists" test -f "$ROOT/src/services/securityProfiles.js"
check "Release security routes exist" test -f "$ROOT/src/web/routes/security.js"
check "Security page exists" test -f "$ROOT/views/security.hbs"
check "Session metadata is captured" grep -q "req.session.userAgent" "$ROOT/src/web/routes/auth.js"
check "Custom permission profiles are persistent" grep -q "permission_profiles" "$ROOT/src/db/migrations/034_security.js"
check "Session revocation is implemented" grep -q "revokeSession" "$ROOT/src/services/securityProfiles.js"
check "API scope storage exists" grep -q "api_token_scopes" "$ROOT/src/db/migrations/034_security.js"
check "Security API is mounted" grep -q "routes/security" "$ROOT/src/web/app.js"
check "Security page route exists" grep -q "/settings/security" "$ROOT/src/web/routes/index.js"
check "No KVM/libvirt dependency introduced" bash -c "! grep -RniE 'libvirt|qemu-system|virsh|/dev/kvm' '$ROOT/src' '$ROOT/node-agent' --include='*.js' 2>/dev/null"

echo
echo "Craftly Release"
echo "PASS: $PASS"
echo "FAIL: $FAIL"
test "$FAIL" -eq 0
