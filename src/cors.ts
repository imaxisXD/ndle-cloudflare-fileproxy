/**
 * CORS utilities.
 */

const corsHeaders = {
	'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
	'Access-Control-Max-Age': '86400',
};

function updateVaryHeader(headers: Headers, includeOrigin: boolean): void {
	const existing = headers
		.get('Vary')
		?.split(',')
		.map((value) => value.trim())
		.filter(Boolean)
		.filter((value) => value.toLowerCase() !== 'origin') ?? [];

	if (includeOrigin) {
		existing.push('Origin');
	}

	if (existing.length) {
		headers.set('Vary', existing.join(', '));
	} else {
		headers.delete('Vary');
	}
}

function parseAuthorizedOrigins(authorizedOrigins: string | undefined): string[] {
	return (authorizedOrigins || '')
		.split(',')
		.map(origin => origin.trim())
		.filter(Boolean);
}

/**
 * Check if origin is allowed.
 */
export function isOriginAllowed(origin: string | null, authorizedOrigins: string | undefined): boolean {
	if (!origin) return true;
	const allowed = parseAuthorizedOrigins(authorizedOrigins);
	return allowed.includes(origin);
}

/**
 * Get CORS headers.
 */
export function getCorsHeaders(origin: string | null, authorizedOrigins: string | undefined): Record<string, string> {
	const headers: Record<string, string> = {
		...corsHeaders,
		'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range, X-Requested-With',
		'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified',
	};
	if (origin && isOriginAllowed(origin, authorizedOrigins)) {
		headers['Access-Control-Allow-Origin'] = origin;
		headers['Vary'] = 'Origin';
	}
	return headers;
}

/**
 * Add CORS headers to an existing Headers object
 */
export function addCorsHeaders(headers: Headers, origin: string | null, authorizedOrigins: string | undefined): void {
	headers.delete('Access-Control-Allow-Origin');
	const allowOrigin = !!(origin && isOriginAllowed(origin, authorizedOrigins));
	updateVaryHeader(headers, allowOrigin);
	const cors = getCorsHeaders(origin, authorizedOrigins);
	Object.entries(cors).forEach(([key, value]) => {
		if (key === 'Vary') return;
		headers.set(key, value);
	});
}

/**
 * Create a CORS preflight response
 * Echoes back the requested headers per Cloudflare best practices
 */
export function createPreflightResponse(origin: string | null, authorizedOrigins: string | undefined, request?: Request): Response {
	if (!isOriginAllowed(origin, authorizedOrigins)) {
		return new Response(null, { status: 403 });
	}
	// Echo back the requested headers if provided
	const requestedHeaders = request?.headers.get('Access-Control-Request-Headers');

	return new Response(null, {
		status: 204,
		headers: {
			...getCorsHeaders(origin, authorizedOrigins),
			'Access-Control-Allow-Headers': requestedHeaders || 'Content-Type, Authorization, Range, X-Requested-With',
		},
	});
}
