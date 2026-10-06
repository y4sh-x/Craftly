'use strict';

const { nanoid } = require('nanoid');
const db = require('../db');
const httpError = require('../utils/httpError');
const nodes = require('./nodes');

function normalize(row) {
  if (!row) return null;
  return {
    ...row,
    port: Number(row.port),
    assigned: Boolean(row.server_id),
  };
}

/**
 * @param {{nodeId?: string, serverId?: string, freeOnly?: boolean}} [options]
 */
function list({ nodeId, serverId, freeOnly = false } = {}) {
  const where = [];
  const params = [];
  if (nodeId) { where.push('a.node_id = ?'); params.push(nodeId); }
  if (serverId) { where.push('a.server_id = ?'); params.push(serverId); }
  if (freeOnly) where.push('a.server_id IS NULL');
  const sql = `SELECT a.*, n.name AS node_name, n.status AS node_status, s.display_name AS server_name
    FROM allocations a JOIN nodes n ON n.id=a.node_id
    LEFT JOIN servers s ON s.id=a.server_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY n.name COLLATE NOCASE, a.port`;
  return db.all(sql, ...params).map(normalize);
}

function get(id) {
  return normalize(db.get(`SELECT a.*, n.name AS node_name, n.status AS node_status, s.display_name AS server_name
    FROM allocations a JOIN nodes n ON n.id=a.node_id LEFT JOIN servers s ON s.id=a.server_id WHERE a.id=?`, id));
}

function create(input) {
  const node = nodes.getNode(input.nodeId);
  if (!node) throw httpError(404, 'Node not found');
  if (!node.enabled) throw httpError(409, 'Node is disabled');
  const id = input.id || `alloc_${nanoid(10)}`;
  try {
    db.run(`INSERT INTO allocations (id,node_id,ip,port,protocol,alias,notes) VALUES (?,?,?,?,?,?,?)`,
      id, input.nodeId, input.ip || '0.0.0.0', Number(input.port), input.protocol || 'tcp', input.alias || '', input.notes || '');
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) throw httpError(409, 'That allocation already exists on this node.');
    throw err;
  }
  return get(id);
}

function assign(id, serverId) {
  const allocation = get(id);
  if (!allocation) throw httpError(404, 'Allocation not found');
  if (allocation.server_id && allocation.server_id !== serverId) throw httpError(409, 'Allocation is already assigned');
  const server = db.get('SELECT id,node_id,allocation_id FROM servers WHERE id=? AND deleted_at IS NULL', serverId);
  if (!server) throw httpError(404, 'Server not found');
  if (server.node_id && server.node_id !== allocation.node_id) throw httpError(409, 'Server belongs to a different node');
  const other = db.get('SELECT id FROM allocations WHERE server_id=? AND id<>?', serverId, id);
  if (other) throw httpError(409, 'Server already has an allocation');
  db.transaction(() => {
    db.run('UPDATE allocations SET server_id=?, updated_at=datetime(\'now\') WHERE id=?', serverId, id);
    db.run('UPDATE servers SET node_id=?, allocation_id=? WHERE id=?', allocation.node_id, id, serverId);
  });
  return get(id);
}

function release(id) {
  const allocation = get(id);
  if (!allocation) throw httpError(404, 'Allocation not found');
  db.transaction(() => {
    if (allocation.server_id) db.run('UPDATE servers SET allocation_id=NULL, node_id=NULL WHERE id=? AND allocation_id=?', allocation.server_id, id);
    db.run('UPDATE allocations SET server_id=NULL, updated_at=datetime(\'now\') WHERE id=?', id);
  });
  return get(id);
}

function remove(id) {
  const allocation = get(id);
  if (!allocation) throw httpError(404, 'Allocation not found');
  if (allocation.server_id) throw httpError(409, 'Release the allocation from its server before deleting it.');
  db.run('DELETE FROM allocations WHERE id=?', id);
  return true;
}


function releaseByServer(serverId) {
  const rows = db.all('SELECT id FROM allocations WHERE server_id=?', serverId);
  db.transaction(() => {
    db.run('UPDATE allocations SET server_id=NULL, updated_at=datetime(\'now\') WHERE server_id=?', serverId);
    db.run('UPDATE servers SET allocation_id=NULL, node_id=NULL WHERE id=?', serverId);
  });
  return rows.length;
}

function ensureForServer(serverId, input = {}) {
  const server = db.get('SELECT id,node_id,allocation_id,port_game FROM servers WHERE id=? AND deleted_at IS NULL', serverId);
  if (!server) throw httpError(404, 'Server not found');
  if (server.allocation_id) return get(server.allocation_id);
  const nodeId = input.nodeId || server.node_id || 'local';
  const existing = db.get('SELECT id FROM allocations WHERE node_id=? AND ip=? AND port=? AND protocol=?', nodeId, input.ip || '0.0.0.0', Number(input.port || server.port_game), input.protocol || 'tcp');
  const allocation = existing ? get(existing.id) : create({ nodeId, ip: input.ip, port: input.port || server.port_game, protocol: input.protocol, alias: input.alias });
  return assign(allocation.id, serverId);
}

module.exports = { list, get, create, assign, release, releaseByServer, remove, ensureForServer };
