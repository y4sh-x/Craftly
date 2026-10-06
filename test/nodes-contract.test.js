'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('Release defines a persistent Docker-only node registry', () => {
  const migration = read('src/db/migrations/029_nodes.js');
  assert.match(migration, /CREATE TABLE nodes/);
  assert.match(migration, /mode TEXT NOT NULL DEFAULT 'remote'/);
  assert.match(migration, /CHECK \(mode IN \('local','remote'\)\)/);
  assert.match(migration, /token_hash TEXT/);
  assert.match(migration, /last_seen_at TEXT/);
});

test('Release node credentials are hashed and never returned from public node data', () => {
  const source = read('src/services/nodes.js');
  const route = read('src/web/routes/nodes.js');
  assert.match(source, /createHash\('sha256'\)/);
  assert.match(source, /timingSafeEqual/);
  assert.match(route, /const \{ token_hash, \.\.\.safe \} = node/);
  assert.match(route, /Store this token now/);
});

test('Release exposes authenticated remote heartbeat separately from browser auth', () => {
  const app = read('src/web/app.js');
  const routes = read('src/web/routes/nodes.js');
  assert.match(app, /nodeRoutes\.agentRouter/);
  assert.match(routes, /\/node-agent\/:id\/heartbeat/);
  assert.match(routes, /Bearer\\s\+\(\.\+\)/);
  assert.match(routes, /Invalid node credentials/);
});

test('Release registers local Docker health and stale remote-node handling', () => {
  const service = read('src/services/nodes.js');
  const server = read('src/server.js');
  assert.match(service, /refreshLocalNode/);
  assert.match(service, /markStale/);
  assert.match(service, /HEARTBEAT_STALE_MS/);
  assert.match(server, /nodeRegistry\.refreshLocalNode/);
});

test('Release provides real admin node management and a node-management UI', () => {
  const routes = read('src/web/routes/nodes.js');
  const page = read('views/nodes.hbs');
  const sidebar = read('views/partials/sidebar.hbs');
  assert.match(routes, /router\.post\('\/nodes'/);
  assert.match(routes, /router\.post\('\/nodes\/:id\/token'/);
  assert.match(routes, /router\.delete\('\/nodes\/:id'/);
  assert.match(page, /Register remote Docker node/);
  assert.match(sidebar, /href="\/nodes"/);
});


test('Release repairs invalid local-node daemon ports before health refresh', () => {
  const service = read('src/services/nodes.js');
  const migration = read('src/db/migrations/035_fix_local_node_daemon_port.js');
  assert.ok(service.includes("'localhost','http',8080,2022,'local',1,'offline'"));
  assert.match(service, /Number\(existing\.daemon_port\).*< 1/);
  assert.match(service, /UPDATE nodes SET daemon_port=8080/);
  assert.match(migration, /daemon_port=8080/);
  assert.match(migration, /daemon_port IS NULL OR daemon_port < 1 OR daemon_port > 65535/);
});
