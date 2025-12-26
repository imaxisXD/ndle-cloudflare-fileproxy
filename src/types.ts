/**
 * Type definitions for the Worker
 */

/**
 * Environment type definition for bindings and secrets
 */
export interface Env {
	// R2 bucket binding for analytics parquet files
	ANALYTICS_BUCKET: R2Bucket;
	// Clerk secrets (set via `wrangler secret put`)
	CLERK_SECRET_KEY: string;
	CLERK_PUBLISHABLE_KEY: string;
	CLERK_JWT_KEY?: string; // Recommended for networkless verification (faster)
	// Comma-separated list of authorized origins
	AUTHORIZED_ORIGINS: string;
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
