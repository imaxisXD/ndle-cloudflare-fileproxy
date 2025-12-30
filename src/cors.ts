/**
 * CORS utilities - permissive configuration
 *
 * Allows all origins and echoes back requested headers per Cloudflare best practices.
 * https://developers.cloudflare.com/workers/examples/cors-header-proxy/
 */

const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
	'Access-Control-Max-Age': '86400',
};

/**
 * Check if origin is allowed - currently allowing all
 */
export function isOriginAllowed(origin: string | null, authorizedOrigins: string | undefined): boolean {
	return true;
}

/**
 * Get CORS headers - allows all origins
 */
export function getCorsHeaders(origin: string | null, authorizedOrigins: string | undefined): HeadersInit {
	return {
		...corsHeaders,
		'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range, X-Requested-With',
		'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified',
	};
}

/**
 * Add CORS headers to an existing Headers object
 */
export function addCorsHeaders(headers: Headers, origin: string | null, authorizedOrigins: string | undefined): void {
	const cors = getCorsHeaders(origin, authorizedOrigins);
	Object.entries(cors).forEach(([key, value]) => {
		headers.set(key, value);
	});
}

/**
 * Create a CORS preflight response
 * Echoes back the requested headers per Cloudflare best practices
 */
export function createPreflightResponse(origin: string | null, authorizedOrigins: string | undefined, request?: Request): Response {
	// Echo back the requested headers if provided
	const requestedHeaders = request?.headers.get('Access-Control-Request-Headers');

	return new Response(null, {
		status: 204,
		headers: {
			...corsHeaders,
			'Access-Control-Allow-Headers': requestedHeaders || 'Content-Type, Authorization, Range, X-Requested-With',
			'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified',
		},
	});
}
