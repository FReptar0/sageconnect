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

// ROOT-03 / D-10: per-step Promise.race wrapper for forResponse step blocks.

/**
 * Race a promise against a step timeout. Rejects with a labeled Error if `ms` elapses
 * before the promise settles. Accepts phantom continuation (D-10): the wrapped promise keeps
 * running in background even after rejection — see Phase 19 19-CONTEXT.md D-10 for tolerance reasoning.
 *
 * Wording sentinel (PATTERNS.md S-5): the error message MUST contain
 * 'Step timeout after' for the catch detection in src/background.js to log [TIMEOUT] entries.
 * Changing this wording requires synchronizing with the regex /Step timeout/ in the catch handler.
 *
 * The setTimeout is NOT explicitly cancelled when the wrapped promise resolves first — Node garbage-
 * collects the timer when the Promise goes to GC. If under always-on operations timer accumulation
 * generates event-loop warnings, mitigation is `.unref()` or explicit clearTimeout in `.then()`.
 * Deferred per D-10 phantom continuation tolerance.
 *
 * @param {Promise<T>|(() => Promise<T>)} promiseOrFn - Either a Promise or a function returning one.
 * @param {number} ms - Timeout in milliseconds.
 * @param {string} label - Human-readable step label included in the error message
 *                         (e.g., 'step=buildProviders tenant=T1').
 * @returns {Promise<T>}
 */
function withStepTimeout(promiseOrFn, ms, label) {
    const promise = typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn;
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(
            () => reject(new Error(`Step timeout after ${formatDurationMin(ms)} — ${label}`)),
            ms
        );
    });
    return Promise.race([promise, timeoutPromise]);
}

module.exports = { formatDurationMin, withStepTimeout };
