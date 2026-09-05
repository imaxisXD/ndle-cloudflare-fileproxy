/**
 * Type definitions for the Worker
 */

/**
 * Environment type definition for bindings and secrets
 */
export interface Env
	extends Omit<
		Cloudflare.Env,
		'AUTHORIZED_ORIGINS' | 'FILE_ACCESS_ENDPOINT' | 'CONVEX_URL'
	> {
	// Clerk secrets (set via `wrangler secret put`)
	CLERK_SECRET_KEY: string;
	CLERK_PUBLISHABLE_KEY: string;
	CLERK_JWT_KEY?: string; // Recommended for networkless verification (faster)
	// Comma-separated list of authorized origins
	AUTHORIZED_ORIGINS: string;
	FILE_ACCESS_ENDPOINT: string;
	FILE_ACCESS_SECRET: string;
	CONVEX_URL: string;
}

/**
 * Request metrics tracking
 */
export interface RequestMetrics {
	cacheHit: boolean;
	bytesTransferred: number;
	authTimeMs: number;
	r2FetchTimeMs: number;
	totalTimeMs: number;
}

/**
 * Parsed range result
 */
export interface ParsedRange {
	range: R2Range | undefined;
	error?: string;
}
