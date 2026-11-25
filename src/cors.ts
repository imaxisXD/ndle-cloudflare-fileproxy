/**
 * CORS utilities.
 */

const DEFAULT_ALLOW_HEADERS = 'Content-Type, Authorization, Range, X-Requested-With';

const BASE_CORS_HEADERS: Readonly<Record<string, string>> = {
	'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
	'Access-Control-Max-Age': '86400',
	'Access-Control-Allow-Headers': DEFAULT_ALLOW_HEADERS,
	'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified',
};

const MAX_ORIGIN_CACHE_ENTRIES = 32;
const EMPTY_ORIGINS: string[] = [];
const parsedOriginsCache = new Map<string, string[]>();

/**
 * Parse and memoize the comma-separated list of authorized origins.
 */
export function parseAuthorizedOrigins(authorizedOrigins: string | undefined): string[] {
	if (!authorizedOrigins) return EMPTY_ORIGINS;
	let parsed = parsedOriginsCache.get(authorizedOrigins);
	if (!parsed) {
		if (parsedOriginsCache.size >= MAX_ORIGIN_CACHE_ENTRIES) {
			parsedOriginsCache.clear();
		}
		parsed = authorizedOrigins
			.split(',')
			.map((origin) => origin.trim())
			.filter(Boolean);
		parsedOriginsCache.set(authorizedOrigins, parsed);
	}
	return parsed;
}

function updateVaryHeader(headers: Headers, includeOrigin: boolean): void {
	const existing =
		headers
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

function buildCorsHeaders(origin: string | null, allowOrigin: boolean): Record<string, string> {
	const headers: Record<string, string> = { ...BASE_CORS_HEADERS };
	if (origin && allowOrigin) {
		headers['Access-Control-Allow-Origin'] = origin;
		headers['Vary'] = 'Origin';
	}
	return headers;
}

/**
 * Check if origin is allowed.
 */
export function isOriginAllowed(origin: string | null, authorizedOrigins: string | undefined): boolean {
	if (!origin) return true;
	return parseAuthorizedOrigins(authorizedOrigins).includes(origin);
}

/**
 * Get CORS headers.
 */
export function getCorsHeaders(origin: string | null, authorizedOrigins: string | undefined): Record<string, string> {
	const allowOrigin = Boolean(origin && isOriginAllowed(origin, authorizedOrigins));
	return buildCorsHeaders(origin, allowOrigin);
}

/**
 * Add CORS headers to an existing Headers object.
 */
export function addCorsHeaders(headers: Headers, origin: string | null, authorizedOrigins: string | undefined): void {
	headers.delete('Access-Control-Allow-Origin');
	const allowOrigin = Boolean(origin && isOriginAllowed(origin, authorizedOrigins));
	updateVaryHeader(headers, allowOrigin);
	for (const [key, value] of Object.entries(BASE_CORS_HEADERS)) {
		headers.set(key, value);
	}
	if (allowOrigin && origin) {
		headers.set('Access-Control-Allow-Origin', origin);
	}
}

/**
 * Strip Vary and Access-Control-* headers before storing a response in Cache API.
 */
export function stripCorsHeaders(headers: Headers): void {
	headers.delete('Vary');
	for (const name of [...headers.keys()]) {
		if (name.toLowerCase().startsWith('access-control-')) {
			headers.delete(name);
		}
	}
}

/**
 * Create a CORS preflight response.
 * Echoes back the requested headers per Cloudflare best practices and adds
 * Access-Control-Request-Headers to Vary when reflecting them.
 */
export function createPreflightResponse(
	origin: string | null,
	authorizedOrigins: string | undefined,
	request?: Request,
): Response {
	if (!isOriginAllowed(origin, authorizedOrigins)) {
		return new Response(null, { status: 403 });
	}
	const headers = buildCorsHeaders(origin, Boolean(origin));
	const requestedHeaders = request?.headers.get('Access-Control-Request-Headers')?.trim();
	if (requestedHeaders) {
		headers['Access-Control-Allow-Headers'] = requestedHeaders;
		headers['Vary'] = headers['Vary']
			? `${headers['Vary']}, Access-Control-Request-Headers`
			: 'Access-Control-Request-Headers';
	}

	return new Response(null, {
		status: 204,
		headers,
	});
}
