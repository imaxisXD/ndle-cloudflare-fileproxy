/**
 * Logging and metrics utilities
 */

import type { RequestMetrics } from './types';

/**
 * Log request metrics as JSON
 */
export function logMetrics(requestId: string, metrics: RequestMetrics): void {
	const metricsLog = {
		cache: metrics.cacheHit ? 'HIT' : 'MISS',
		bytes: metrics.bytesTransferred,
		auth_ms: metrics.authTimeMs.toFixed(2),
		r2_ms: metrics.r2FetchTimeMs.toFixed(2),
		total_ms: metrics.totalTimeMs.toFixed(2),
	};
	console.log(`[FileProxy] [${requestId}] 📊 METRICS: ${JSON.stringify(metricsLog)}`);
}

/**
 * Create initial metrics object
 */
export function createMetrics(): RequestMetrics {
	return {
		cacheHit: false,
		bytesTransferred: 0,
		authTimeMs: 0,
		r2FetchTimeMs: 0,
		totalTimeMs: 0,
	};
}

/**
 * Log prefixed message for this worker
 */
export const log = {
	info: (requestId: string, message: string) => console.log(`[FileProxy] [${requestId}] ${message}`),
	warn: (requestId: string, message: string) => console.warn(`[FileProxy] [${requestId}] ⚠️ ${message}`),
	error: (requestId: string, message: string, error?: unknown) => console.error(`[FileProxy] [${requestId}] ❌ ${message}`, error ?? ''),
	security: (requestId: string, message: string) => console.warn(`[FileProxy] [${requestId}] 🚫 SECURITY: ${message}`),
};
