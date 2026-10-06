'use strict';

const crypto = require('node:crypto');
const { nanoid } = require('nanoid');
const db = require('../db');
const { checkDocker } = require('../docker/connect');
const secrets = require('./secrets');

const TOKEN_PREFIX = 'mfnode_';
const HEARTBEAT_STALE_MS = 90 * 1000;

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function safeJson(value) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return {};
  }
}

function normalize(row) {
  if (!row) return null;
  return {
    ...row,
    enabled: Boolean(row.enabled),
    docker_info: safeJson(row.docker_info_json),
    data_root: row.data_root || '/var/lib/craftly',
  };
}

function listNodes() {
  return db.all('SELECT * FROM nodes ORDER BY name COLLATE NOCASE').map(normalize);
}

function getNode(id) {
  return normalize(db.get('SELECT * FROM nodes WHERE id = ?', id));
}

function createNode(input) {
  const id = input.id || `node_${nanoid(10)}`;
  const token = `${TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
  db.run(
    `INSERT INTO nodes
      (id,name,description,fqdn,scheme,daemon_port,sftp_port,data_root,token_hash,token_prefix,agent_token_cipher,mode,enabled,status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,'offline')`,
    id,
    input.name,
    input.description || '',
    input.fqdn,
    input.scheme || 'https',
    Number(input.daemonPort || 8080),
    Number(input.sftpPort || 2022),
    input.dataRoot || '/var/lib/craftly',
    hashToken(token),
    token.slice(0, 12),
    secrets.encrypt(token),
    input.mode || 'remote'
  );
  return { node: getNode(id), token };
}

function rotateToken(id) {
  const node = getNode(id);
  if (!node) return null;
  const token = `${TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
  db.run(
    `UPDATE nodes SET token_hash=?, token_prefix=?, agent_token_cipher=?, status=CASE WHEN enabled=1 THEN 'offline' ELSE 'disabled' END,
      last_error='Node token rotated; reconnect the node agent.', updated_at=datetime('now') WHERE id=?`,
    hashToken(token),
    token.slice(0, 12),
    secrets.encrypt(token),
    id
  );
  return { node: getNode(id), token };
}

function setEnabled(id, enabled) {
  const node = getNode(id);
  if (!node) return null;
  db.run(
    `UPDATE nodes SET enabled=?, status=?, updated_at=datetime('now') WHERE id=?`,
    enabled ? 1 : 0,
    enabled ? 'offline' : 'disabled',
    id
  );
  return getNode(id);
}

function removeNode(id) {
  return db.run('DELETE FROM nodes WHERE id = ?', id);
}

function authenticateNode(id, token) {
  const node = db.get('SELECT * FROM nodes WHERE id = ?', id);
  if (!node || !node.enabled || !node.token_hash || !token) return null;
  const expected = Buffer.from(node.token_hash, 'hex');
  const supplied = Buffer.from(hashToken(token), 'hex');
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return null;
  return normalize(node);
}

function recordHeartbeat(id, payload = {}) {
  const node = getNode(id);
  if (!node || !node.enabled) return null;
  const docker = payload.docker || {};
  const dockerInfo = payload.dockerInfo || {};
  const healthy = docker.available !== false;
  db.run(
    `UPDATE nodes SET status=?, last_seen_at=datetime('now'), last_agent_at=datetime('now'), last_error=?, docker_version=?, docker_os=?,
      docker_cpus=?, docker_memory_bytes=?, docker_info_json=?, updated_at=datetime('now') WHERE id=?`,
    healthy ? 'online' : 'degraded',
    healthy ? null : String(docker.error || 'Docker daemon unavailable').slice(0, 500),
    docker.version ? String(docker.version).slice(0, 100) : null,
    docker.os ? String(docker.os).slice(0, 300) : null,
    Number.isFinite(Number(docker.ncpu)) ? Number(docker.ncpu) : null,
    Number.isFinite(Number(docker.memTotal)) ? Number(docker.memTotal) : null,
    JSON.stringify(dockerInfo || {}),
    id
  );
  return getNode(id);
}

async function refreshLocalNode() {
  const existing = db.get("SELECT * FROM nodes WHERE id='local'");
  if (!existing) {
    db.run(
      `INSERT INTO nodes (id,name,description,fqdn,scheme,daemon_port,sftp_port,mode,enabled,status)
       VALUES ('local','Local Node','This panel host; Docker is accessed through the local Docker Engine.','localhost','http',8080,2022,'local',1,'offline')`
    );
  } else if (!Number.isInteger(Number(existing.daemon_port)) || Number(existing.daemon_port) < 1 || Number(existing.daemon_port) > 65535) {
    // Older releases accidentally created the local node with daemon_port=0,
    // which violates the nodes table CHECK constraint during the first health refresh.
    // The local node does not expose a remote daemon, but the schema requires a valid
    // metadata port; keep the historical/default node-agent port instead.
    db.run(
      "UPDATE nodes SET daemon_port=8080, updated_at=datetime('now') WHERE id='local'"
    );
  }
  const docker = await checkDocker();
  const row = getNode('local');
  if (!row.enabled) return row;
  return recordHeartbeat('local', { docker, dockerInfo: { source: 'local-docker', refreshedAt: new Date().toISOString() } });
}

function markStale() {
  const cutoff = new Date(Date.now() - HEARTBEAT_STALE_MS).toISOString();
  db.run(
    `UPDATE nodes SET status='offline', updated_at=datetime('now')
     WHERE mode='remote' AND enabled=1 AND last_seen_at IS NOT NULL AND last_seen_at < ?`,
    cutoff.replace('T', ' ').replace('Z', '')
  );
}

module.exports = {
  listNodes,
  getNode,
  createNode,
  rotateToken,
  setEnabled,
  removeNode,
  authenticateNode,
  recordHeartbeat,
  refreshLocalNode,
  markStale,
};
