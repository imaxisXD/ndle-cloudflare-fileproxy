/**
 * CORS utilities for DuckDB WASM compatibility
 *
 * Security: Only allows origins listed in AUTHORIZED_ORIGINS env var.
 * Falls back to rejecting if no origins configured (secure by default).
 */

/**
 * Check if origin is allowed based on AUTHORIZED_ORIGINS env var
 */
export function isOriginAllowed(origin: string | null, authorizedOrigins: string | undefined): boolean {
	if (!origin) return false;
	if (!authorizedOrigins) return false;

	const allowed = authorizedOrigins.split(',').map((o) => o.trim());
	return allowed.includes(origin);
}

/**
 * Get CORS headers with validated origin
 */
export function getCorsHeaders(origin: string | null, authorizedOrigins: string | undefined): HeadersInit {
	const allowedOrigin = isOriginAllowed(origin, authorizedOrigins) ? origin! : '';

	return {
		'Access-Control-Allow-Origin': allowedOrigin,
		'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
		'Access-Control-Allow-Headers': 'Range, Authorization',
		'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified',
	};
}

/**
 * Add CORS headers to an existing Headers object
 */
export function addCorsHeaders(headers: Headers, origin: string | null, authorizedOrigins: string | undefined): void {
	const corsHeaders = getCorsHeaders(origin, authorizedOrigins);
	Object.entries(corsHeaders).forEach(([key, value]) => {
		headers.set(key, value);
	});
}

/**
 * Create a CORS preflight response
 */
export function createPreflightResponse(origin: string | null, authorizedOrigins: string | undefined): Response {
	const corsHeaders = getCorsHeaders(origin, authorizedOrigins);

	return new Response(null, {
		status: 204,
		headers: {
			...corsHeaders,
			'Access-Control-Max-Age': '86400',
		},
	});
}
