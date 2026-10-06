'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireRole } = require('../middleware/auth');
const operations = require('../../services/operations');
const { recordEvent } = require('../../events');

const router = express.Router();
router.use(requireRole('admin'));

router.get('/operations/health', asyncHandler(async (req, res) => {
  res.json({ ok: true, health: await operations.overview() });
}));

router.post('/operations/maintenance', (req, res) => {
  const result = operations.runMaintenance();
  recordEvent({
    actor: req.user.username,
    type: 'operations-maintenance',
    summary: 'Operations maintenance run completed.',
    details: result,
  });
  res.json(result);
});

module.exports = router;
