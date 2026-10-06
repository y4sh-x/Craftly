'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

for (const file of [
  'src/services/provisioning.js',
  'src/services/nodeTransport.js',
  'src/services/nodes.js',
  'src/services/servers.js',
  'src/web/routes/provisioning.js',
  'src/web/routes/nodes.js',
  'node-agent/agent.js',
  'src/db/migrations/031_provisioning.js',
]) {
  test(`Release syntax: ${file}`, () => {
    execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'pipe' });
  });
}

test('Release migration exists and defines provisioning state/jobs', () => {
  const text = fs.readFileSync(path.join(root, 'src/db/migrations/031_provisioning.js'), 'utf8');
  assert.match(text, /provisioning_status/);
  assert.match(text, /provisioning_jobs/);
  assert.match(text, /agent_token_cipher/);
});

test('Release is Docker-only', () => {
  const agent = fs.readFileSync(path.join(root, 'node-agent/agent.js'), 'utf8');
  assert.match(agent, /dockerode/);
  assert.doesNotMatch(agent, /libvirt|qemu|kvm/i);
});

test('Remote node provisioning is routed through authenticated node transport', () => {
  const provisioning = fs.readFileSync(path.join(root, 'src/services/provisioning.js'), 'utf8');
  const transport = fs.readFileSync(path.join(root, 'src/services/nodeTransport.js'), 'utf8');
  assert.match(provisioning, /remote\(node/);
  assert.match(transport, /authorization/);
  assert.match(transport, /agent_token_cipher/);
});
