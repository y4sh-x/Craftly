'use strict';

const express = require('express');
const { z } = require('zod');
const db = require('../../db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/provisioning/jobs', requireRole('admin'), (req, res) => {
  const serverId = req.query.serverId ? z.string().min(1).max(100).parse(req.query.serverId) : null;
  const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
  const rows = serverId
    ? db.all('SELECT * FROM provisioning_jobs WHERE server_id=? ORDER BY created_at DESC LIMIT ?', serverId, limit)
    : db.all('SELECT * FROM provisioning_jobs ORDER BY created_at DESC LIMIT ?', limit);
  res.json({ ok: true, jobs: rows });
});

module.exports = router;
