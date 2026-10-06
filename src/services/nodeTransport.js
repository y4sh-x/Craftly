'use strict';

const httpError = require('../utils/httpError');
const secrets = require('./secrets');

function urlFor(node, path) {
  return `${node.scheme}://${node.fqdn}:${node.daemon_port}${path}`;
}

function tokenFor(node) {
  if (!node.agent_token_cipher) throw httpError(409, `Node ${node.name} has no stored agent credential; rotate its node token.`);
  try { return secrets.decrypt(node.agent_token_cipher); } catch { throw httpError(409, `Node ${node.name} has an unreadable agent credential; rotate its node token.`); }
}

async function remote(node, path, body = {}, { timeoutMs = 30_000 } = {}) {
  if (!node || node.mode !== 'remote') throw httpError(409, 'A remote node is required');
  if (!node.enabled) throw httpError(409, `Node ${node.name} is disabled`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetch(urlFor(node, path), {
      method: 'POST',
      headers: { authorization: `Bearer ${tokenFor(node)}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let data; try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 500) }; }
    if (!response.ok) throw httpError(response.status, data.error || `Node agent returned HTTP ${response.status}`);
    return data;
  } catch (err) {
    if (err.name === 'AbortError') throw httpError(504, `Node ${node.name} did not respond within ${timeoutMs}ms`);
    if (err.status) throw err;
    throw httpError(502, `Could not reach node ${node.name}: ${err.message}`);
  } finally { clearTimeout(timer); }
}


async function runtime(node, path, body = {}, { timeoutMs = 30_000 } = {}) {
  return remote(node, path, body, { timeoutMs });
}


async function remoteRaw(node, method, path, { body, contentType = 'application/octet-stream', timeoutMs = 120_000, headers = {} } = {}) {
  if (!node || node.mode !== 'remote') throw httpError(409, 'A remote node is required');
  if (!node.enabled) throw httpError(409, `Node ${node.name} is disabled`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetch(urlFor(node, path), {
      method,
      headers: { authorization: `Bearer ${tokenFor(node)}`, ...(contentType ? { 'content-type': contentType } : {}), ...headers },
      body,
      signal: controller.signal,
      ...(body && typeof body.pipe === 'function' ? { duplex: 'half' } : {}),
    });
    if (!response.ok) {
      const text = await response.text();
      let message = text;
      try { message = JSON.parse(text).error || text; } catch {}
      throw httpError(response.status, String(message).slice(0, 2000));
    }
    return response;
  } catch (err) {
    if (err.name === 'AbortError') throw httpError(504, `Node ${node.name} did not respond within ${timeoutMs}ms`);
    if (err.status) throw err;
    throw httpError(502, `Could not reach node ${node.name}: ${err.message}`);
  } finally { clearTimeout(timer); }
}

async function uploadStream(node, path, stream, size, { timeoutMs = 15 * 60_000 } = {}) {
  return remoteRaw(node, 'PUT', path, {
    body: stream,
    contentType: 'application/octet-stream',
    timeoutMs,
    headers: size >= 0 ? { 'content-length': String(size) } : {},
  });
}

async function downloadStream(node, path, { timeoutMs = 15 * 60_000 } = {}) {
  return remoteRaw(node, 'GET', path, { contentType: null, timeoutMs });
}

function wsUrlFor(node, path) {
  const scheme = node.scheme === 'https' ? 'wss' : 'ws';
  return `${scheme}://${node.fqdn}:${node.daemon_port}${path}`;
}

module.exports = { remote, remoteRaw, uploadStream, downloadStream, runtime, urlFor, wsUrlFor, tokenFor };
