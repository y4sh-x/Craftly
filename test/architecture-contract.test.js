'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('Release architecture is explicitly Docker-only', () => {
  const source = read('src/infrastructure/architecture.js');
  assert.match(source, /runtime:\s*['"]docker['"]/);
  assert.match(source, /virtualMachineRuntime:\s*null/);
});

test('Release keeps the documented runtime ports and allocation defaults', () => {
  const source = read('src/infrastructure/architecture.js');
  assert.match(source, /defaultHttpPort:\s*6060/);
  assert.match(source, /defaultPort:\s*2022/);
  assert.match(source, /defaultGameStart:\s*25565/);
  assert.match(source, /defaultBedrockStart:\s*19132/);
});

test('Release architecture documentation exists and forbids fake feature entries', () => {
  const docs = read('docs/ARCHITECTURE.md');
  assert.match(docs, /Docker only/i);
  assert.match(docs, /Feature rule/i);
  assert.match(docs, /not considered implemented until/i);
});

test('The cumulative development plan ends with one complete Release project', () => {
  const plan = read('docs/DEVELOPMENT.md');
  assert.match(plan, /one cumulative project tree/i);
  assert.match(plan, /complete snapshots/i);
  assert.doesNotMatch(plan, /phase/i);
});
