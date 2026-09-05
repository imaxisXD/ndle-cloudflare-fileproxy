/**
 * Response builders and utilities
 */

import { getCorsHeaders, addCorsHeaders } from './cors';
import { restoreCachedStatus } from './cache';
import { buildContentRangeHeader } from './range';

/**
 * CORS context passed to response builders
 */
export interface CorsContext {
	origin: string | null;
	authorizedOrigins: string | undefined;
}

/**
 * Create error response with CORS headers
 */
export function createErrorResponse(message: string, status: number, requestId: string, cors?: CorsContext): Response {
	console.log(`[FileProxy] [${requestId}] ❌ Error response: ${status} - ${message}`);
	const headers = new Headers(getCorsHeaders(cors?.origin ?? null, cors?.authorizedOrigins));
	headers.set('Content-Type', 'application/json');
	headers.set('Cache-Control', 'private, no-store');
	return new Response(JSON.stringify({ error: message }), { status, headers });
}

/**
 * Create health check response
 */
export function createHealthResponse(cors?: CorsContext): Response {
	return new Response(JSON.stringify({ status: 'ok' }), {
		status: 200,
		headers: { 'Content-Type': 'application/json', ...getCorsHeaders(cors?.origin ?? null, cors?.authorizedOrigins) },
	});
}

/**
 * Build response from R2 object body (GET request)
 */
export function buildR2Response(
	object: R2ObjectBody,
	range: R2Range | undefined,
	cors: CorsContext
): { response: Response; status: number } {
	const responseHeaders = new Headers();

	// Copy HTTP metadata from R2 object
	object.writeHttpMetadata(responseHeaders);
	responseHeaders.set('etag', object.httpEtag);

	// Set content type for parquet files
	if (!responseHeaders.has('Content-Type')) {
		responseHeaders.set('Content-Type', 'application/octet-stream');
	}

	// Support range requests
	responseHeaders.set('Accept-Ranges', 'bytes');

	// Private bytes are cached only inside the authorized Worker path.
	responseHeaders.set('Cache-Control', 'private, no-store');

	// Add CORS headers
	addCorsHeaders(responseHeaders, cors.origin, cors.authorizedOrigins);

	// Determine status code
	let status = 200;
	responseHeaders.set('Content-Length', String(object.size));
	if (range && 'range' in object) {
		status = 206;
		const r2Range = (object as R2ObjectBody & { range?: R2Range }).range;
		const contentRange = buildContentRangeHeader(r2Range, object.size);
		if (r2Range && 'length' in r2Range && typeof r2Range.length === 'number') {
			responseHeaders.set('Content-Length', String(r2Range.length));
		}
		if (contentRange) {
			responseHeaders.set('Content-Range', contentRange);
		}
	}

	return {
		response: new Response(object.body, { status, headers: responseHeaders }),
		status,
	};
}

/**
 * Build response from R2 object metadata (HEAD request)
 */
export function buildHeadResponse(object: R2Object, cors: CorsContext): Response {
	const responseHeaders = new Headers();

	// Copy HTTP metadata from R2 object
	object.writeHttpMetadata(responseHeaders);
	responseHeaders.set('etag', object.httpEtag);

	// Set content type for parquet files
	if (!responseHeaders.has('Content-Type')) {
		responseHeaders.set('Content-Type', 'application/octet-stream');
	}

	// Set content length from object size
	responseHeaders.set('Content-Length', String(object.size));

	// Support range requests
	responseHeaders.set('Accept-Ranges', 'bytes');

	// Private bytes are cached only inside the authorized Worker path.
	responseHeaders.set('Cache-Control', 'private, no-store');

	// Add CORS headers
	addCorsHeaders(responseHeaders, cors.origin, cors.authorizedOrigins);

	return new Response(null, { status: 200, headers: responseHeaders });
}

/**
 * Build cached response with CORS headers
 */
export function buildCachedResponse(cached: Response, cors: CorsContext): Response {
	const cachedHeaders = new Headers(cached.headers);
	const status = restoreCachedStatus(cachedHeaders);
	cachedHeaders.set('Cache-Control', 'private, no-store');
	addCorsHeaders(cachedHeaders, cors.origin, cors.authorizedOrigins);

	return new Response(cached.body, {
		status,
		headers: cachedHeaders,
	});
}
