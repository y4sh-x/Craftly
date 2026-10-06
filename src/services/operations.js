'use strict';

// Release: production operations/health surface. This service intentionally
// reports only measurements that are actually available; it never invents
// healthy/online states when Docker, storage, or the database cannot be checked.
const fs = require('node:fs');
const os = require('node:os');
const config = require('../config');
const db = require('../db');
const { checkDocker } = require('../docker/connect');
const indexer = require('../storage/indexer');
const nodes = require('./nodes');

async function disk() {
  try {
    const value = await indexer.diskFree();
    const freePct = value.total > 0 ? Math.round((value.free / value.total) * 1000) / 10 : null;
    return { ok: true, ...value, freePct };
  } catch (error) {
    return { ok: false, error: String(error.message || error).slice(0, 300) };
  }
}

function database() {
  try {
    const row = db.get('PRAGMA quick_check');
    const result = row && Object.values(row)[0];
    return { ok: result === 'ok', check: result || 'unknown' };
  } catch (error) {
    return { ok: false, error: String(error.message || error).slice(0, 300) };
  }
}

function provisioning() {
  const counts = db.all(
    `SELECT status, COUNT(*) AS count FROM provisioning_jobs GROUP BY status ORDER BY status`
  );
  const recent = db.all(
    `SELECT id, server_id, node_id, operation, status, error, created_at, started_at, finished_at
       FROM provisioning_jobs ORDER BY rowid DESC LIMIT 20`
  );
  return {
    counts: Object.fromEntries(counts.map((r) => [r.status, Number(r.count)])),
    recent,
  };
}

function processInfo() {
  const mem = process.memoryUsage();
  return {
    pid: process.pid,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    uptimeSeconds: Math.floor(process.uptime()),
    rssBytes: mem.rss,
    heapUsedBytes: mem.heapUsed,
    heapTotalBytes: mem.heapTotal,
    loadAverage: os.loadavg(),
    cpus: os.cpus().length,
  };
}

async function overview() {
  const [docker, storage] = await Promise.all([checkDocker(), disk()]);
  const nodeRows = nodes.listNodes();
  const dbState = database();
  const prov = provisioning();
  const enabled = nodeRows.filter((n) => n.enabled);
  const online = enabled.filter((n) => n.status === 'online').length;
  const degraded = enabled.filter((n) => n.status === 'degraded').length;
  const offline = enabled.filter((n) => n.status === 'offline').length;

  const checks = {
    database: dbState.ok,
    docker: docker.available === true,
    storage: storage.ok,
    enabledNodes: enabled.length === 0 || offline === 0,
    provisioningQueue: !Object.entries(prov.counts).some(([status, count]) =>
      ['queued', 'running'].includes(status) && Number(count) > 50
    ),
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    docker: {
      available: Boolean(docker.available),
      version: docker.version || null,
      os: docker.os || null,
      cpus: docker.ncpu ?? null,
      memoryBytes: docker.memTotal ?? null,
      error: docker.error || null,
    },
    storage,
    database: dbState,
    nodes: {
      total: nodeRows.length,
      enabled: enabled.length,
      online,
      degraded,
      offline,
    },
    provisioning: prov,
    process: processInfo(),
    dataDir: config.dataDir,
    checkedAt: new Date().toISOString(),
  };
}

function runMaintenance() {
  nodes.markStale();
  return { ok: true, action: 'mark-stale-nodes', completedAt: new Date().toISOString() };
}

module.exports = { overview, runMaintenance };
