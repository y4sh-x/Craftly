#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
node --test test/provisioning.test.js
bash -n menu.sh
bash -n test/test.sh
