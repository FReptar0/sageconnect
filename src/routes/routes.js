const express = require('express');
const router = express.Router();
const { requireApiKey } = require('../middleware/api-key');

// Dashboard routes -- no API key required (internal monitoring)
router.use(require('./dashboard-routes'));

// System routes -- no API key required
router.use('/api/system', require('./system-routes'));

// API routes -- API key required (per user decision: all /api/payments and /api/pos)
// Payment and PO route files will be added in Plans 02 and 03
// router.use('/api/payments', requireApiKey, require('./payment-routes'));
// router.use('/api/pos', requireApiKey, require('./po-routes'));

module.exports = router;
