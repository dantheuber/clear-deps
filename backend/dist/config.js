export const config = {
    apiKey: process.env.API_KEY || 'change-me-dev',
    // Reduced from 60 to 30 to poll dependencies more frequently by default
    defaultPollIntervalSec: parseInt(process.env.DEFAULT_POLL_INTERVAL_SEC || '30', 10),
    maxParallelPolls: parseInt(process.env.MAX_PARALLEL_POLLS || '10', 10),
    pollTimeoutMs: parseInt(process.env.POLL_TIMEOUT_MS || '2000', 10),
    pollMaxSizeBytes: parseInt(process.env.POLL_MAX_SIZE_BYTES || '262144', 10),
};
export const STATUS_ORDER = ['OK', 'WARN', 'UNKNOWN', 'ERROR']; // used for comparison (indexOf)
export function worstStatus(statuses) {
    let worst = 'OK';
    for (const s of statuses) {
        if (STATUS_ORDER.indexOf(s) > STATUS_ORDER.indexOf(worst))
            worst = s;
    }
    return worst;
}
export function normalizeStatus(input) {
    if (!input)
        return 'UNKNOWN';
    const v = input.toLowerCase();
    if (['success', 'healthy', 'ok'].includes(v))
        return 'OK';
    if (['warn', 'warning', 'degraded'].includes(v))
        return 'WARN';
    if (['error', 'fail', 'failed', 'down'].includes(v))
        return 'ERROR';
    if (['unknown', 'missing'].includes(v))
        return 'UNKNOWN';
    return 'UNKNOWN';
}
export function statusFromHealthyFlag(healthy) {
    if (healthy === true)
        return 'OK';
    if (healthy === false)
        return 'ERROR';
    return undefined;
}
//# sourceMappingURL=config.js.map