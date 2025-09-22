const { logGenerator } = require('../utils/LogGenerator');

/**
 * Auto Shutdown Service
 * Handles automatic shutdown of web server before scheduled processes
 * to prevent port conflicts and ensure smooth operation
 */

class AutoShutdownService {
    constructor() {
        this.shutdownTimer = null;
        this.warningTimer = null;
        this.isShutdownScheduled = false;
        this.logFileName = 'AutoShutdown';
        
        // Shutdown 30 seconds before scheduled time
        this.SHUTDOWN_ADVANCE_SECONDS = 30;
        // Warning 2 minutes before shutdown
        this.WARNING_ADVANCE_SECONDS = 120;
    }

    /**
     * Starts the auto-shutdown monitoring
     */
    start() {
        logGenerator(this.logFileName, 'info', '[START] Servicio de auto-shutdown iniciado');
        this.scheduleNextShutdown();
        
        // Check every minute for schedule changes
        setInterval(() => {
            if (!this.isShutdownScheduled) {
                this.scheduleNextShutdown();
            }
        }, 60000);
    }

    /**
     * Calculates the next scheduled execution time (xx:00, xx:15, xx:30, xx:45)
     * @returns {Date} Next scheduled execution time
     */
    getNextScheduledTime() {
        const now = new Date();
        const currentMinutes = now.getMinutes();
        const currentSeconds = now.getSeconds();
        
        // Find the next 15-minute mark
        const scheduleMinutes = [0, 15, 30, 45];
        let nextMinute = scheduleMinutes.find(min => min > currentMinutes);
        
        const nextExecution = new Date(now);
        
        if (nextMinute !== undefined) {
            // Next execution is in the same hour
            nextExecution.setMinutes(nextMinute);
            nextExecution.setSeconds(0);
            nextExecution.setMilliseconds(0);
        } else {
            // Next execution is in the next hour at :00
            nextExecution.setHours(nextExecution.getHours() + 1);
            nextExecution.setMinutes(0);
            nextExecution.setSeconds(0);
            nextExecution.setMilliseconds(0);
        }
        
        return nextExecution;
    }

    /**
     * Schedules the next automatic shutdown
     */
    scheduleNextShutdown() {
        if (this.isShutdownScheduled) return;
        
        const nextScheduledTime = this.getNextScheduledTime();
        const now = new Date();
        
        // Calculate shutdown time (30 seconds before scheduled)
        const shutdownTime = new Date(nextScheduledTime.getTime() - (this.SHUTDOWN_ADVANCE_SECONDS * 1000));
        const warningTime = new Date(nextScheduledTime.getTime() - (this.WARNING_ADVANCE_SECONDS * 1000));
        
        const timeToWarning = warningTime.getTime() - now.getTime();
        const timeToShutdown = shutdownTime.getTime() - now.getTime();
        
        // Skip if times are in the past or too close
        if (timeToShutdown <= 5000) {
            logGenerator(this.logFileName, 'warn', `Tiempo de shutdown muy cercano (${Math.round(timeToShutdown/1000)}s), esperando al siguiente ciclo`);
            return;
        }
        
        logGenerator(this.logFileName, 'info', 
            `Programado shutdown automático para ${shutdownTime.toLocaleString('es-MX')} ` +
            `(${Math.round(timeToShutdown/1000/60)} minutos antes del proceso a las ${nextScheduledTime.toLocaleString('es-MX')})`
        );
        
        this.isShutdownScheduled = true;
        
        // Schedule warning if it's not too close
        if (timeToWarning > 5000) {
            this.warningTimer = setTimeout(() => {
                this.sendWarningNotification(nextScheduledTime, shutdownTime);
            }, timeToWarning);
        }
        
        // Schedule shutdown
        this.shutdownTimer = setTimeout(() => {
            this.executeShutdown(nextScheduledTime);
        }, timeToShutdown);
    }

    /**
     * Sends warning notification to clients
     */
    sendWarningNotification(nextScheduledTime, shutdownTime) {
        const message = {
            type: 'shutdown_warning',
            scheduledTime: nextScheduledTime.toISOString(),
            shutdownTime: shutdownTime.toISOString(),
            reason: 'Evitar conflicto de puerto con proceso automático programado'
        };
        
        logGenerator(this.logFileName, 'warn', 
            `[WARNING] Shutdown automático en 2 minutos - Proceso programado para ${nextScheduledTime.toLocaleString('es-MX')}`
        );
        
        // Store warning for dashboard to pick up
        global.shutdownWarning = message;
    }

    /**
     * Executes the automatic shutdown
     */
    executeShutdown(scheduledTime) {
        logGenerator(this.logFileName, 'info', 
            `[SHUTDOWN] Ejecutando shutdown automático - Proceso programado para ${scheduledTime.toLocaleString('es-MX')}`
        );
        
        const message = {
            type: 'auto_shutdown',
            scheduledTime: scheduledTime.toISOString(),
            reason: 'Evitar conflicto de puerto con proceso automático programado'
        };
        
        // Store shutdown message for dashboard
        global.shutdownMessage = message;
        
        // Graceful shutdown
        setTimeout(() => {
            logGenerator(this.logFileName, 'info', '[SHUTDOWN] Servidor web cerrado automáticamente para evitar conflictos');
            process.exit(0);
        }, 2000);
    }

    /**
     * Clears shutdown timers (only for manual shutdown)
     */
    clearScheduledShutdown() {
        if (this.shutdownTimer) {
            clearTimeout(this.shutdownTimer);
            this.shutdownTimer = null;
        }
        
        if (this.warningTimer) {
            clearTimeout(this.warningTimer);
            this.warningTimer = null;
        }
        
        this.isShutdownScheduled = false;
        
        // Clear global messages
        global.shutdownWarning = null;
        global.shutdownMessage = null;
        
        logGenerator(this.logFileName, 'info', '[MANUAL] Shutdown automático interrumpido por cierre manual');
    }

    /**
     * Gets current shutdown status
     */
    getShutdownStatus() {
        if (!this.isShutdownScheduled) {
            return { scheduled: false };
        }
        
        const nextScheduledTime = this.getNextScheduledTime();
        const shutdownTime = new Date(nextScheduledTime.getTime() - (this.SHUTDOWN_ADVANCE_SECONDS * 1000));
        const now = new Date();
        
        return {
            scheduled: true,
            nextScheduledTime: nextScheduledTime.toISOString(),
            shutdownTime: shutdownTime.toISOString(),
            secondsUntilShutdown: Math.max(0, Math.round((shutdownTime.getTime() - now.getTime()) / 1000)),
            secondsUntilScheduled: Math.max(0, Math.round((nextScheduledTime.getTime() - now.getTime()) / 1000))
        };
    }
}

// Export singleton instance
const autoShutdownService = new AutoShutdownService();

module.exports = {
    AutoShutdownService,
    autoShutdownService
};