'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PLAYER_NAME_RE, isValidPlayerName, isBedrockName } = require('../src/utils/playerName');

test('isValidPlayerName accepts plain Java usernames', () => {
  assert.equal(isValidPlayerName('Notch'), true);
  assert.equal(isValidPlayerName('Steve_123'), true);
  assert.equal(isValidPlayerName('a'), true); // lenient min-length, matches historical behavior
  assert.equal(isValidPlayerName('waytoolongusername_123'), false);
  assert.equal(isValidPlayerName('bad name!'), false);
  assert.equal(isValidPlayerName(''), false);
});

test('isValidPlayerName accepts a single Bedrock (Geyser/Floodgate) prefix', () => {
  assert.equal(isValidPlayerName('.Steve'), true);
  assert.equal(isValidPlayerName('*Alex'), true);
  assert.equal(isValidPlayerName('..Steve'), false); // only one prefix char allowed
  assert.equal(isValidPlayerName('.'), false); // prefix with no name after it
});

test('isBedrockName detects the leading prefix only', () => {
  assert.equal(isBedrockName('.Steve'), true);
  assert.equal(isBedrockName('*Alex'), true);
  assert.equal(isBedrockName('Steve'), false);
  assert.equal(isBedrockName(''), false);
  assert.equal(isBedrockName(null), false);
});

test('PLAYER_NAME_RE is anchored (no partial matches)', () => {
  assert.equal(PLAYER_NAME_RE.test('Steve extra'), false);
  assert.equal(PLAYER_NAME_RE.test('/say hi'), false);
});
