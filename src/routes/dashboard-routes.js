const express = require('express');
const router = express.Router();
const { sendMail } = require('../utils/EmailSender');
const {
    getAllLogs,
    readLogFile,
    getLastExecutionInfo,
    getAvailableLogDates,
    getLogStatistics,
    getStorageOverview,
    LOG_TYPES
} = require('../services/LogDashboardService');


router.post('/send-mail', (req, res) => {

    const { data } = req.body;

    if (!data) {
        res.status(500).json({ message: 'Error sending email', error: 'Empty fields' });
        return;
    }

    sendMail(data).then((result) => {
        res.status(200).json({ message: 'Email sent successfully', result });
    }).catch((error) => {
        res.status(500).json({ message: 'Error sending email', error });
        console.log(error);
    });

});

// Dashboard API Routes

// Get dashboard data (logs + execution info)
router.get('/api/dashboard', async (req, res) => {
    try {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        const date = req.query.date || null;

        const [logsData, executionInfo, logStats, availableDates, storageOverview] = await Promise.all([
            getAllLogs(date),
            getLastExecutionInfo(),
            getLogStatistics(),
            getAvailableLogDates(),
            getStorageOverview()
        ]);

        res.json({
            success: true,
            data: {
                logs: logsData,
                execution: executionInfo,
                statistics: logStats,
                availableDates,
                storageOverview,
                logTypes: LOG_TYPES
            }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get specific log file content
router.get('/api/logs/:logType', async (req, res) => {
    try {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        const { logType } = req.params;
        const date = req.query.date || null;
        const lines = parseInt(req.query.lines) || 100;

        if (!LOG_TYPES.includes(logType)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid log type'
            });
        }

        const logData = await readLogFile(logType, date);

        // Return only the last N lines if requested (0 means all lines)
        if (logData.exists && lines > 0) {
            logData.lines = logData.lines.slice(-lines);
        }

        res.json({
            success: true,
            data: logData
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get execution status and timing
router.get('/api/execution-status', async (req, res) => {
    try {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        const executionInfo = await getLastExecutionInfo();

        res.json({
            success: true,
            data: executionInfo
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get available log dates
router.get('/api/log-dates', async (req, res) => {
    try {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        const dates = await getAvailableLogDates();

        res.json({
            success: true,
            data: dates
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
