const express = require('express');
const router = express.Router();
const { requireApiKey } = require('../middleware/api-key');
const { requireLicense } = require('../middleware/require-license');

// Unlicensed routes -- always accessible regardless of license state
router.use(require('./dashboard-routes'));
router.use('/api/system', require('./system-routes'));

// Licensed routes -- blocked with 503 when license invalid
router.use('/api/schedule', requireLicense, require('./schedule-routes'));
router.use('/api/operations', requireLicense, require('./operations-routes'));

// Licensed + API key routes -- requireLicense runs BEFORE requireApiKey
router.use('/api/payments', requireLicense, requireApiKey, require('./payment-routes'));
router.use('/api/pos', requireLicense, requireApiKey, require('./po-routes'));

module.exports = router;
