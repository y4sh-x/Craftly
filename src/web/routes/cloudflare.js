'use strict';
const express = require('express');
const { z } = require('zod');
const asyncHandler = require('../middleware/asyncHandler');
const { requireRole } = require('../middleware/auth');
const cf = require('../../services/cloudflare');
const { recordEvent } = require('../../events');

const router = express.Router();
router.use(requireRole('admin'));
router.get('/cloudflare/status', (req, res) => res.json({ ok: true, config: cf.settings(), cloudflared: cf.cloudflared() }));
router.get('/cloudflare/zones', asyncHandler(async (req, res) => res.json({ ok: true, zones: await cf.zones() })));
router.get('/cloudflare/records', asyncHandler(async (req, res) => res.json({ ok: true, records: await cf.records({ zoneId: req.query.zoneId, type: req.query.type, name: req.query.name }) })));
router.post('/cloudflare/records', asyncHandler(async (req, res) => {
  const input = z.object({ zoneId: z.string().min(1).optional(), type: z.enum(['A','AAAA','CNAME','TXT','SRV']), name: z.string().min(1).max(253), content: z.union([z.string(), z.number()]), ttl: z.number().int().min(1).optional(), proxied: z.boolean().optional() }).parse(req.body);
  const record = await cf.createRecord(input);
  recordEvent({ actor: req.user.username, type: 'cloudflare-dns-create', summary: `Created Cloudflare ${input.type} record ${input.name}.`, details: { recordId: record.id, name: input.name } });
  res.status(201).json({ ok: true, record });
}));
router.delete('/cloudflare/records/:id', asyncHandler(async (req, res) => {
  const zoneId = z.string().min(1).parse(req.query.zoneId || process.env.CF_ZONE_ID);
  const result = await cf.deleteRecord(zoneId, req.params.id);
  recordEvent({ actor: req.user.username, type: 'cloudflare-dns-delete', summary: `Deleted Cloudflare DNS record ${req.params.id}.` });
  res.json({ ok: true, result });
}));
router.post('/cloudflare/tunnel/config', (req, res) => {
  const input = z.object({ hostname: z.string().min(1).max(253), service: z.string().url().optional(), tunnelId: z.string().min(1).max(200).optional() }).parse(req.body);
  const result = cf.writeTunnelConfig(input);
  recordEvent({ actor: req.user.username, type: 'cloudflare-tunnel-config', summary: `Generated Cloudflare Tunnel configuration for ${input.hostname}.` });
  res.status(201).json({ ok: true, config: result });
});
module.exports = router;
