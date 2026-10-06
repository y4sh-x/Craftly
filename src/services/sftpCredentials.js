
'use strict';
const crypto = require('node:crypto');
const nodes = require('./nodes');
const transport = require('./nodeTransport');
const provisioning = require('./provisioning');
const servers = require('./servers');
const permissions = require('./permissions');
const httpError = require('../utils/httpError');

function credentials(user, serverId, ttlMs = 15 * 60_000) {
  const server = servers.getServer(serverId); if (!server) throw httpError(404,'Server not found');
  if (!permissions.can(user, serverId, 'files')) throw httpError(403,"You don't have the files permission on this server.");
  const node = provisioning.nodeForServer(server);
  if (node.mode === 'local') return { mode:'local', host:'localhost', port:require('../config').sftp.port, username:`${user.username}@${serverId}`, expiresAt:Date.now()+ttlMs };
  const token = transport.tokenFor(node);
  const payload = { username:`mf_${user.id}`, userId:user.id, serverId, rw:true, exp:Date.now()+ttlMs };
  const body=Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig=crypto.createHmac('sha256',token).update(body).digest('base64url');
  return { mode:'remote', host:node.fqdn, port:Number(node.sftp_port||2022), username:payload.username, password:`${body}.${sig}`, expiresAt:payload.exp, serverId };
}
module.exports = { credentials };
