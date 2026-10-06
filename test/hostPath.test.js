'use strict';

const { dir } = require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

// toHostPath reads config at require time, so each case loads it in a clean
// child process with a controlled DATA_DIR / DATA_DIR_HOST pair.
function translate(extraEnv, script) {
  return spawnSync(process.execPath, ['-e', script], {
    cwd: ROOT,
    env: {
      ...process.env,
      SESSION_SECRET: 'valid-session-secret-abcdef123456',
      ...extraEnv,
    },
    encoding: 'utf8',
  });
}

const PRINT = (parts) =>
  `const {toHostPath}=require('./src/docker/hostPath');const {dataPath}=require('./src/storage/pathGuard');process.stdout.write(toHostPath(dataPath(${parts})))`;

test('without DATA_DIR_HOST, translation is the identity', () => {
  const res = translate({ DATA_DIR_HOST: '' }, PRINT("'servers','abc'"));
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, path.resolve(dir, 'servers', 'abc'));
});

test('re-roots panel-local paths under a POSIX DATA_DIR_HOST', () => {
  const res = translate({ DATA_DIR_HOST: '/opt/craftly/data/' }, PRINT("'servers','abc'"));
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, '/opt/craftly/data/servers/abc');
});

test('follows the host separator for a Windows DATA_DIR_HOST', () => {
  const res = translate({ DATA_DIR_HOST: 'C:\\craftly\\data' }, PRINT("'servers','abc'"));
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, 'C:\\craftly\\data\\servers\\abc');
});

test('the data root itself maps to DATA_DIR_HOST exactly', () => {
  const res = translate({ DATA_DIR_HOST: '/opt/craftly/data' }, PRINT(''));
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, '/opt/craftly/data');
});

test('paths outside DATA_DIR are refused', () => {
  const res = translate(
    { DATA_DIR_HOST: '/opt/craftly/data' },
    "const {toHostPath}=require('./src/docker/hostPath');toHostPath(require('node:path').resolve('elsewhere'))"
  );
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /outside DATA_DIR/);
});

test('a relative DATA_DIR_HOST fails fast at config load', () => {
  const res = translate({ DATA_DIR_HOST: './data' }, "require('./src/config')");
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /DATA_DIR_HOST/);
});
