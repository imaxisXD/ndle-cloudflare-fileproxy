/**
 * CORS utilities for DuckDB WASM compatibility
 */

const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
	'Access-Control-Allow-Headers': 'Range, Authorization, X-Internal-User-Id',
	'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified',
} as const;

/**
 * Get CORS headers as HeadersInit
 */
export function getCorsHeaders(): HeadersInit {
	return { ...CORS_HEADERS };
}

/**
 * Add CORS headers to an existing Headers object
 */
export function addCorsHeaders(headers: Headers): void {
	Object.entries(CORS_HEADERS).forEach(([key, value]) => {
		headers.set(key, value);
	});
}

/**
 * Create a CORS preflight response
 */
export function createPreflightResponse(): Response {
	return new Response(null, {
		status: 204,
		headers: {
			...CORS_HEADERS,
			'Access-Control-Max-Age': '86400',
		},
	});
}
