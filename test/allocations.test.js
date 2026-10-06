'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

test('release allocation migration exists after node migration', () => {
  assert.ok(fs.existsSync(path.join(root, 'src/db/migrations/029_nodes.js')));
  assert.ok(fs.existsSync(path.join(root, 'src/db/migrations/030_allocations.js')));
});

test('release allocation service exposes lifecycle operations', () => {
  const text = fs.readFileSync(path.join(root, 'src/services/allocations.js'), 'utf8');
  for (const key of ['list','get','create','assign','release','releaseByServer','remove','ensureForServer']) {
    assert.match(text, new RegExp(`function ${key}\\(`));
  }
});

test('release allocation API and UI exist', () => {
  assert.ok(fs.existsSync(path.join(root, 'src/web/routes/allocations.js')));
  assert.ok(fs.existsSync(path.join(root, 'views/allocations.hbs')));
  assert.ok(fs.existsSync(path.join(root, 'public/js/pages/allocations.js')));
});

test('release is wired into server creation, web app and sidebar', () => {
  const server = fs.readFileSync(path.join(root, 'src/services/servers.js'), 'utf8');
  const api = fs.readFileSync(path.join(root, 'src/web/routes/api.js'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'src/web/app.js'), 'utf8');
  const side = fs.readFileSync(path.join(root, 'views/partials/sidebar.hbs'), 'utf8');
  assert.match(server, /allocations\.ensureForServer/);
  assert.match(api, /nodeId: z\.string/);
  assert.match(app, /routes\/allocations/);
  assert.match(side, /href="\/allocations"/);
});
