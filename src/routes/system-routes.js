const express = require('express');
const router = express.Router();

/**
 * GET /health
 * Returns service health status for monitoring and load balancer checks.
 */
router.get('/health', (req, res) => {
    res.json({
        success: true,
        data: {
            status: 'ok',
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
        },
        errors: [],
        summary: 'Service healthy',
        meta: {},
    });
});

module.exports = router;
