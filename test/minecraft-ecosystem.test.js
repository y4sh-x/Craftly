'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('release migration exists after provisioning', () => {
  assert.ok(fs.existsSync(path.join(root, 'src/db/migrations/031_provisioning.js')));
  assert.ok(fs.existsSync(path.join(root, 'src/db/migrations/032_minecraft_software.js')));
});

test('software catalog exposes real registry-backed capabilities', () => {
  const text = fs.readFileSync(path.join(root, 'src/services/softwareCatalog.js'), 'utf8');
  for (const token of [
    "require('./mojang')",
    "require('./loaderVersions')",
    "require('./javaMatrix')",
    'async function versions',
    'async function builds',
    'function java',
    'function compatibility',
    'function contentSources',
  ]) {
    assert.ok(text.includes(token), `missing token: ${token}`);
  }
});

test('release API exposes software catalog and server resolution', () => {
  const api = fs.readFileSync(path.join(root, 'src/web/routes/api.js'), 'utf8');
  for (const route of [
    "'/software/catalog'",
    "'/software/versions'",
    "'/software/builds'",
    "'/software/java'",
    "'/software/compatibility'",
    "'/servers/:id/software'",
    "'/servers/:id/software/resolve'",
  ]) {
    assert.match(api, new RegExp(route.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));
  }
});

test('software state persists resolved runtime metadata', () => {
  const migration = fs.readFileSync(path.join(root, 'src/db/migrations/032_minecraft_software.js'), 'utf8');
  for (const column of ['server_id', 'minecraft_version', 'loader', 'loader_version', 'java_tag', 'compatibility_json', 'status']) {
    assert.match(migration, new RegExp(`\\b${column}\\b`));
  }
});

test('release remains Docker-only', () => {
  const service = fs.readFileSync(path.join(root, 'src/services/softwareCatalog.js'), 'utf8');
  assert.doesNotMatch(service, /libvirt|qemu|kvm/i);
});
