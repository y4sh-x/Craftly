'use strict';

const express = require('express');
const { z } = require('zod');
const asyncHandler = require('../middleware/asyncHandler');
const { requireRole } = require('../middleware/auth');
const allocations = require('../../services/allocations');

const router = express.Router();
const createSchema = z.object({
  nodeId: z.string().min(1).max(100),
  ip: z.string().trim().min(1).max(255).default('0.0.0.0'),
  port: z.coerce.number().int().min(1).max(65535),
  protocol: z.enum(['tcp', 'udp', 'both']).default('tcp'),
  alias: z.string().max(100).optional(),
  notes: z.string().max(1000).optional(),
});

router.get('/allocations', requireRole('admin'), (req, res) => {
  res.json({ ok: true, allocations: allocations.list({ nodeId: req.query.nodeId, freeOnly: req.query.free === 'true' }) });
});

router.post('/allocations', requireRole('admin'), asyncHandler(async (req, res) => {
  const allocation = allocations.create(createSchema.parse(req.body));
  res.status(201).json({ ok: true, allocation });
}));

router.post('/allocations/:id/assign', requireRole('admin'), (req, res) => {
  const serverId = z.object({ serverId: z.string().min(1) }).parse(req.body).serverId;
  res.json({ ok: true, allocation: allocations.assign(req.params.id, serverId) });
});

router.post('/allocations/:id/release', requireRole('admin'), (req, res) => {
  res.json({ ok: true, allocation: allocations.release(req.params.id) });
});

router.delete('/allocations/:id', requireRole('admin'), (req, res) => {
  allocations.remove(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
