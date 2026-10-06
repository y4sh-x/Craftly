'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createInstanceLock, isLiveCraftlyProcess } = require('../src/services/instanceLock');

test('stale lock owned by an unrelated PID is recovered', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'craftly-lock-'));
  const lockPath = path.join(dataDir, '.craftly-instance.lock');
  fs.writeFileSync(lockPath, `${process.pid}\n`);
  const logger = { warn() {}, debug() {} };
  const lock = createInstanceLock({ dataDir, logger, checkoutDir: process.cwd() });
  assert.equal(lock.acquire(), true);
  assert.equal(fs.readFileSync(lockPath, 'utf8').trim(), String(process.pid));
  lock.release();
  assert.equal(fs.existsSync(lockPath), false);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('the current process is never treated as another live Craftly instance', () => {
  assert.equal(isLiveCraftlyProcess(process.pid, process.cwd()), false);
});
