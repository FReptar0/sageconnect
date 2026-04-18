/**
 * OperationManager - Singleton concurrency controller
 *
 * Provides:
 * - Per-operation-type locks (prevents concurrent same-type execution)
 * - Global 'background-cycle' lock (blocks ALL manual triggers while cron runs)
 * - EventEmitter-based progress events (for SSE streaming)
 * - Bounded execution history ring buffer (max 100 entries)
 *
 * Usage: const operationManager = require('./services/OperationManager');
 */

const { EventEmitter } = require('events');

const MAX_HISTORY = 100;

class OperationManager extends EventEmitter {
    constructor() {
        super();
        /** @type {Map<string, { operationId: string, startedAt: string }>} */
        this.locks = new Map();
        /** @type {Array<Object>} */
        this.history = [];
        this.setMaxListeners(20);
    }

    /**
     * Acquire a per-operation-type lock.
     * Returns false if the same operationType is already locked,
     * or if 'background-cycle' lock is held (blocks all non-background-cycle ops).
     *
     * @param {string} operationType - e.g. 'payment-reconciliation', 'po-upload', 'background-cycle'
     * @param {string} operationId - unique ID for this operation run
     * @returns {boolean} true if lock acquired, false if blocked
     */
    acquireLock(operationType, operationId) {
        // Global lock: if background-cycle is held, block everything else
        if (this.locks.has('background-cycle') && operationType !== 'background-cycle') {
            return false;
        }

        // Per-type lock: if this type is already held, reject
        if (this.locks.has(operationType)) {
            return false;
        }

        this.locks.set(operationType, {
            operationId,
            startedAt: new Date().toISOString(),
        });

        return true;
    }

    /**
     * Release a per-operation-type lock.
     * @param {string} operationType
     */
    releaseLock(operationType) {
        this.locks.delete(operationType);
    }

    /**
     * Check if an operation type is locked (directly or via background-cycle).
     * @param {string} operationType
     * @returns {boolean}
     */
    isLocked(operationType) {
        if (this.locks.has(operationType)) return true;
        if (this.locks.has('background-cycle')) return true;
        return false;
    }

    /**
     * Emit a progress event for a specific operation ID.
     * SSE subscribers listen on 'progress:{operationId}'.
     *
     * @param {string} operationId
     * @param {Object} event - { type, operation, tenant, step, message, timestamp }
     */
    emitProgress(operationId, event) {
        this.emit(`progress:${operationId}`, event);
    }

    /**
     * Get all currently running (locked) operations.
     * @returns {Object} key=operationType, value={ operationId, startedAt }
     */
    getRunningOperations() {
        return Object.fromEntries(this.locks);
    }

    /**
     * Add a record to execution history. Ring buffer: oldest evicted beyond MAX_HISTORY.
     *
     * @param {Object} record - { taskId, operationId, startedAt, finishedAt, success, errors, summary }
     */
    addHistory(record) {
        this.history.push(record);
        if (this.history.length > MAX_HISTORY) {
            this.history.shift();
        }
    }

    /**
     * Get execution history, optionally filtered by hours.
     * @param {number} [hours] - if provided, return only entries from last N hours
     * @returns {Array<Object>}
     */
    getHistory(hours) {
        if (hours !== undefined) {
            const cutoff = Date.now() - hours * 60 * 60 * 1000;
            return this.history.filter((entry) => new Date(entry.startedAt).getTime() >= cutoff);
        }
        return [...this.history];
    }

    /**
     * Reset internal state (for testing only).
     * @private
     */
    _reset() {
        this.locks.clear();
        this.history = [];
        this.removeAllListeners();
    }
}

module.exports = new OperationManager();
