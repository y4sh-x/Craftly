'use strict';

const { nanoid } = require('nanoid');
const db = require('../db');
const nodes = require('./nodes');
const containers = require('../docker/containers');
const images = require('../docker/images');
const { dataPath } = require('../storage/pathGuard');
const { remote } = require('./nodeTransport');
const httpError = require('../utils/httpError');

function nodeForServer(server) {
  const node = nodes.getNode(server.node_id || 'local');
  if (!node) throw httpError(409, `Server node ${server.node_id || 'local'} no longer exists`);
  if (!node.enabled) throw httpError(409, `Node ${node.name} is disabled`);
  return node;
}

function createJob(server, operation) {
  const id = `prov_${nanoid(12)}`;
  db.run(`INSERT INTO provisioning_jobs (id,server_id,node_id,operation,status) VALUES (?,?,?,?, 'queued')`, id, server.id, server.node_id || 'local', operation);
  db.run(`UPDATE servers SET provisioning_status=?, provisioning_error=NULL, provisioning_started_at=datetime('now') WHERE id=?`, operation === 'remove' ? 'deprovisioning' : 'provisioning', server.id);
  return id;
}

function finishJob(id, ok, error = null) {
  db.run(`UPDATE provisioning_jobs SET status=?, error=?, started_at=COALESCE(started_at,datetime('now')), finished_at=datetime('now') WHERE id=?`, ok ? 'succeeded' : 'failed', error ? String(error).slice(0, 2000) : null, id);
}

function markReady(serverId) {
  db.run(`UPDATE servers SET provisioning_status='ready', provisioning_error=NULL, provisioned_at=datetime('now') WHERE id=?`, serverId);
}
function markFailed(serverId, error) {
  db.run(`UPDATE servers SET provisioning_status='failed', provisioning_error=? WHERE id=?`, String(error).slice(0, 2000), serverId);
}

async function execute(server, operation, spec = {}) {
  const node = nodeForServer(server);
  const job = createJob(server, operation);
  db.run(`UPDATE provisioning_jobs SET status='running', started_at=datetime('now') WHERE id=?`, job);
  try {
    let result;
    if (node.mode === 'local') {
      switch (operation) {
        case 'create':
        case 'recreate':
          await images.ensureImage(spec.image);
          result = { containerId: await containers.createContainer(spec) };
          break;
        case 'start': await containers.startContainer(server.id); result = { ok: true }; break;
        case 'stop': await containers.stopContainer(server.id, { graceSeconds: spec.graceSeconds || 90 }); result = { ok: true }; break;
        case 'kill': await containers.killContainer(server.id); result = { ok: true }; break;
        case 'remove': await containers.removeContainer(server.id); result = { ok: true }; break;
        default: throw new Error(`Unsupported provisioning operation: ${operation}`);
      }
    } else {
      result = await remote(node, `/v1/servers/${encodeURIComponent(server.id)}/${operation}`, spec, { timeoutMs: operation === 'create' || operation === 'recreate' ? 15 * 60_000 : 60_000 });
    }
    finishJob(job, true);
    if (operation === 'create' || operation === 'recreate') markReady(server.id);
    return result;
  } catch (err) {
    finishJob(job, false, err.message || err);
    if (operation !== 'remove') markFailed(server.id, err.message || err);
    throw err;
  }
}

function serverDataDir(server, node) {
  return node.mode === 'local' ? dataPath('servers', server.id) : `${node.data_root || '/var/lib/craftly'}/servers/${server.id}`;
}

async function inspect(server) {
  const node = nodeForServer(server);
  if (node.mode === 'local') return containers.inspectStatus(server.id);
  return remote(node, `/v1/servers/${encodeURIComponent(server.id)}/inspect`, {}, { timeoutMs: 20_000 });
}

async function stats(server) {
  const node = nodeForServer(server);
  if (node.mode === 'local') return require('../docker/stats').statsOnce(server.id);
  return remote(node, `/v1/servers/${encodeURIComponent(server.id)}/stats`, {}, { timeoutMs: 10_000 });
}

async function logs(server, options = {}) {
  const node = nodeForServer(server);
  if (node.mode === 'local') return require('../docker/logs').fetchLogs(server.id, options);
  return remote(node, `/v1/servers/${encodeURIComponent(server.id)}/logs`, options, { timeoutMs: 15_000 });
}

async function exec(server, command) {
  const node = nodeForServer(server);
  if (node.mode === 'local') {
    const { execCaptureChecked } = require('../docker/containers');
    return execCaptureChecked(server.id, command);
  }
  return remote(node, `/v1/servers/${encodeURIComponent(server.id)}/exec`, { command }, { timeoutMs: 20_000 });
}

function runtimeWebSocket(server, kind) {
  const node = nodeForServer(server);
  if (node.mode !== 'remote') return null;
  const transport = require('./nodeTransport');
  return { url: transport.wsUrlFor(node, `/v1/ws/${kind}/${encodeURIComponent(server.id)}`), token: transport.tokenFor(node) };
}

module.exports = { execute, inspect, stats, logs, exec, runtimeWebSocket, nodeForServer, serverDataDir };
