/**
 * Response builders and utilities
 */

import { getCorsHeaders, addCorsHeaders } from './cors';
import { CACHE_MAX_AGE_SECONDS } from './config';
import { buildContentRangeHeader } from './range';

/**
 * Create error response with CORS headers
 */
export function createErrorResponse(message: string, status: number, requestId: string): Response {
	console.log(`[FileProxy] [${requestId}] ❌ Error response: ${status} - ${message}`);
	const headers = new Headers(getCorsHeaders());
	headers.set('Content-Type', 'application/json');
	return new Response(JSON.stringify({ error: message }), { status, headers });
}

/**
 * Create health check response
 */
export function createHealthResponse(): Response {
	return new Response(JSON.stringify({ status: 'ok' }), {
		status: 200,
		headers: { 'Content-Type': 'application/json', ...getCorsHeaders() },
	});
}

/**
 * Build response from R2 object body (GET request)
 */
export function buildR2Response(object: R2ObjectBody, range: R2Range | undefined): { response: Response; status: number } {
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

	// Cache immutable parquet files
	responseHeaders.set('Cache-Control', `public, max-age=${CACHE_MAX_AGE_SECONDS}, immutable`);

	// Add CORS headers
	addCorsHeaders(responseHeaders);

	// Determine status code
	let status = 200;
	if (range && 'range' in object) {
		status = 206;
		const r2Range = (object as R2ObjectBody & { range?: R2Range }).range;
		const contentRange = buildContentRangeHeader(r2Range, object.size);
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
export function buildHeadResponse(object: R2Object): { response: Response; status: number } {
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

	// Cache immutable parquet files
	responseHeaders.set('Cache-Control', `public, max-age=${CACHE_MAX_AGE_SECONDS}, immutable`);

	// Add CORS headers
	addCorsHeaders(responseHeaders);

	return {
		response: new Response(null, { status: 200, headers: responseHeaders }),
		status: 200,
	};
}

/**
 * Build cached response with CORS headers
 */
export function buildCachedResponse(cached: Response, isHead: boolean): Response {
	const cachedHeaders = new Headers(cached.headers);
	addCorsHeaders(cachedHeaders);

	if (isHead) {
		return new Response(null, {
			status: cached.status === 206 ? 200 : cached.status,
			headers: cachedHeaders,
		});
	}

	return new Response(cached.body, {
		status: cached.status,
		headers: cachedHeaders,
	});
}
