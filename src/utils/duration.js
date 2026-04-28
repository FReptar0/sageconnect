// REC-02 / D-04: formats lock-held duration for history summaries and admin email subjects.

/**
 * Format a millisecond duration as a human-readable string.
 *
 * Branches:
 *   - <60000 ms          → "<seconds>s"            (e.g., "42s")
 *   - >=60000 ms exact   → "<minutes>m"            (e.g., "14m")
 *   - >=60000 ms remain  → "<minutes>m <seconds>s" (e.g., "14m 32s")
 *
 * Defensive: returns "0s" for non-finite or negative input — callers
 * insert this string into email bodies; throwing here would derail the
 * lock-recovery flow.
 *
 * @param {number} durationMs - Non-negative finite millisecond count.
 * @returns {string} Human-readable duration label.
 */
function formatDurationMin(durationMs) {
    if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) {
        return '0s';
    }
    const totalSeconds = Math.floor(durationMs / 1000);
    if (totalSeconds < 60) {
        return totalSeconds + 's';
    }
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (seconds === 0) {
        return minutes + 'm';
    }
    return minutes + 'm ' + seconds + 's';
}

module.exports = { formatDurationMin };
