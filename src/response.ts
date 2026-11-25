/**
 * Response builders and utilities
 */

import { getCorsHeaders, addCorsHeaders } from './cors';
import { restoreCachedStatus } from './cache';
import { buildContentRangeHeader, resolveFileRange } from './range';
import { log } from './logging';

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
export function createErrorResponse(
	message: string,
	status: number,
	requestId: string,
	cors?: CorsContext,
): Response {
	if (status >= 500) {
		log.error('Error response', { request_id: requestId, status, error: message });
	} else {
		log.warn('Error response', { request_id: requestId, status, error: message });
	}
	const headers = new Headers(
		getCorsHeaders(cors?.origin ?? null, cors?.authorizedOrigins),
	);
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
		headers: {
			'Content-Type': 'application/json',
			...getCorsHeaders(cors?.origin ?? null, cors?.authorizedOrigins),
		},
	});
}

/**
 * Build shared response headers for R2 GET and HEAD responses
 */
function buildR2BaseHeaders(object: R2Object, cors: CorsContext): Headers {
	const headers = new Headers();

	// Copy HTTP metadata from R2 object
	object.writeHttpMetadata(headers);
	headers.set('etag', object.httpEtag);

	// Set content type for parquet files
	if (!headers.has('Content-Type')) {
		headers.set('Content-Type', 'application/octet-stream');
	}

	// Set content length from object size
	headers.set('Content-Length', String(object.size));

	// Support range requests
	headers.set('Accept-Ranges', 'bytes');

	// Private bytes are cached only inside the authorized Worker path.
	headers.set('Cache-Control', 'private, no-store');

	// Add CORS headers
	addCorsHeaders(headers, cors.origin, cors.authorizedOrigins);

	return headers;
}

/**
 * Build response from R2 object body (GET request)
 */
export function buildR2Response(
	object: R2ObjectBody,
	range: R2Range | undefined,
	cors: CorsContext,
): Response {
	const headers = buildR2BaseHeaders(object, cors);

	let status = 200;
	if (range) {
		const resolvedRange = resolveFileRange(object.range ?? range, object.size);
		if (resolvedRange) {
			status = 206;
			headers.set('Content-Length', String(resolvedRange.length));
			const contentRange = buildContentRangeHeader(resolvedRange, object.size);
			if (contentRange) {
				headers.set('Content-Range', contentRange);
			}
		}
	}

	return new Response(object.body, { status, headers });
}

/**
 * Build response from R2 object metadata (HEAD request)
 */
export function buildHeadResponse(object: R2Object, cors: CorsContext): Response {
	return new Response(null, {
		status: 200,
		headers: buildR2BaseHeaders(object, cors),
	});
}

/**
 * Clone a cached response and apply current-request CORS headers
 */
export function cloneCachedResponse(
	cached: Response,
	cors: CorsContext,
	options?: {
		cacheControl?: string;
		transformHeaders?: (headers: Headers) => number | void;
	},
): Response {
	const headers = new Headers(cached.headers);
	const status = options?.transformHeaders?.(headers) ?? cached.status;
	if (options?.cacheControl !== undefined) {
		headers.set('Cache-Control', options.cacheControl);
	}
	addCorsHeaders(headers, cors.origin, cors.authorizedOrigins);

	return new Response(cached.body, {
		status,
		statusText: status === cached.status ? cached.statusText : undefined,
		headers,
	});
}

/**
 * Build cached archive response with CORS headers
 */
export function buildCachedResponse(
	cached: Response,
	cors: CorsContext,
): Response {
	return cloneCachedResponse(cached, cors, {
		cacheControl: 'private, no-store',
		transformHeaders: restoreCachedStatus,
	});
}
