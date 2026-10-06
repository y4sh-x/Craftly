
'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const files = require('./files');
const servers = require('./servers');
const provisioning = require('./provisioning');
const transport = require('./nodeTransport');
const httpError = require('../utils/httpError');

function serverAndNode(serverId) {
  const server = servers.getServer(serverId);
  if (!server) throw httpError(404, 'Server not found');
  const node = provisioning.nodeForServer(server);
  return { server, node };
}

function enc(value) { return encodeURIComponent(String(value || '')); }
function remotePath(serverId, rel = '') { return `/v1/servers/${enc(serverId)}/files?path=${enc(rel)}`; }
function remoteDownloadPath(serverId, rel='') { return `/v1/servers/${enc(serverId)}/files-download?path=${enc(rel)}`; }

async function list(serverId, rel='') {
  const { server, node } = serverAndNode(serverId);
  if (node.mode === 'local') return files.list(server.id, rel);
  return transport.remote(node, remotePath(server.id, rel), { op: 'list' });
}
async function readText(serverId, rel) {
  const { server, node } = serverAndNode(serverId);
  if (node.mode === 'local') return files.readText(server.id, rel);
  return transport.remote(node, remotePath(server.id, rel), { op: 'read' });
}
async function writeText(serverId, rel, content, opts={}) {
  const { server, node } = serverAndNode(serverId);
  if (node.mode === 'local') return files.writeText(server.id, rel, content, opts);
  return transport.remote(node, remotePath(server.id, rel), { op: 'write', content, actor: opts.actor || 'system' });
}
async function mutate(serverId, op, body={}) {
  const { server, node } = serverAndNode(serverId);
  if (node.mode === 'local') {
    switch(op) {
      case 'mkdir': return files.mkdir(server.id, body.path, body);
      case 'rename': return files.rename(server.id, body.path, body.newName, body);
      case 'move': return files.move(server.id, body.path, body.dest, body);
      case 'copy': return files.copy(server.id, body.path, body.dest, body);
      case 'remove': return files.remove(server.id, body.path, body);
      case 'stat': return files.statFile(server.id, body.path);
      case 'search': return files.searchFiles(server.id, body.q, body);
      default: throw httpError(400, `Unsupported file operation: ${op}`);
    }
  }
  return transport.remote(node, remotePath(server.id, body.path || ''), { op, ...body });
}
async function upload(serverId, rel, tmpPath, originalName, size) {
  const { server, node } = serverAndNode(serverId);
  if (node.mode === 'local') return files.acceptUpload(server.id, rel, tmpPath, originalName, { actor: 'upload' });
  const target = `${remotePath(server.id, rel)}&filename=${enc(originalName)}`;
  const stream = require('node:fs').createReadStream(tmpPath);
  try {
    const response = await transport.uploadStream(node, target, stream, size);
    return await response.json();
  } finally { await fs.rm(tmpPath, { force: true }).catch(()=>{}); }
}
async function download(serverId, rel) {
  const { server, node } = serverAndNode(serverId);
  if (node.mode === 'local') return { local: true, file: await files.statFile(server.id, rel) };
  const response = await transport.downloadStream(node, remoteDownloadPath(server.id, rel));
  return { local: false, response, name: path.posix.basename(String(rel || 'file')) };
}

module.exports = { list, readText, writeText, mutate, upload, download, serverAndNode };
