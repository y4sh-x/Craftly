'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');

function settings() {
  return {
    configured: Boolean(process.env.CF_API_TOKEN),
    zoneId: process.env.CF_ZONE_ID || null,
    zoneName: process.env.CF_ZONE_NAME || null,
    tunnelName: process.env.CF_TUNNEL_NAME || 'craftly',
  };
}

async function cf(pathname, options = {}) {
  if (!process.env.CF_API_TOKEN) throw Object.assign(new Error('Cloudflare API token is not configured.'), { status: 503 });
  const response = await fetch(`https://api.cloudflare.com/client/v4${pathname}`, {
    ...options,
    headers: { Authorization: `Bearer ${process.env.CF_API_TOKEN}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) {
    const message = body?.errors?.map((e) => e.message).join('; ') || `Cloudflare API returned ${response.status}`;
    throw Object.assign(new Error(message), { status: response.status });
  }
  return body.result;
}

async function zones() {
  return cf('/zones?per_page=100');
}

/**
 * @param {{zoneId?: string, type?: string, name?: string}} options
 */
async function records({ zoneId = process.env.CF_ZONE_ID, type, name } = {}) {
  if (!zoneId) throw Object.assign(new Error('CF_ZONE_ID is required.'), { status: 400 });
  const qs = new URLSearchParams();
  if (type) qs.set('type', type);
  if (name) qs.set('name', name);
  qs.set('per_page', '100');
  return cf(`/zones/${encodeURIComponent(zoneId)}/dns_records?${qs}`);
}

async function createRecord(input) {
  const zoneId = input.zoneId || process.env.CF_ZONE_ID;
  if (!zoneId) throw Object.assign(new Error('CF_ZONE_ID is required.'), { status: 400 });
  if (!input.type || !input.name || input.content === undefined) throw Object.assign(new Error('type, name and content are required.'), { status: 400 });
  return cf(`/zones/${encodeURIComponent(zoneId)}/dns_records`, { method: 'POST', body: JSON.stringify({ type: input.type, name: input.name, content: String(input.content), ttl: Number(input.ttl) || 1, proxied: Boolean(input.proxied) }) });
}

async function deleteRecord(zoneId, id) {
  if (!zoneId || !id) throw Object.assign(new Error('zoneId and record id are required.'), { status: 400 });
  return cf(`/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

function cloudflared() {
  const p = spawnSync('cloudflared', ['--version'], { encoding: 'utf8' });
  return { installed: p.status === 0, version: p.status === 0 ? (p.stdout || p.stderr || '').trim() : null };
}

function writeTunnelConfig({ hostname, service = `http://127.0.0.1:${config.port}`, tunnelId = '<TUNNEL_ID>' } = {}) {
  if (!hostname) throw Object.assign(new Error('hostname is required.'), { status: 400 });
  const dir = path.join(config.dataDir, 'cloudflare');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'config.yml');
  const yaml = `tunnel: ${tunnelId}\ncredentials-file: ${dir}/credentials.json\ningress:\n  - hostname: ${hostname}\n    service: ${service}\n  - service: http_status:404\n`;
  fs.writeFileSync(file, yaml, { mode: 0o600 });
  return { file, hostname, service, tunnelId };
}

module.exports = { settings, zones, records, createRecord, deleteRecord, cloudflared, writeTunnelConfig };
