import type { Env } from './types';
import { createPreflightResponse } from './cors';
import {
	createErrorResponse,
	createHealthResponse,
	buildR2Response,
	buildCachedResponse,
	buildHeadResponse,
	type CorsContext,
} from './response';
import { validateFileKey } from './security';
import { authenticateRequest } from './auth';
import { hasArchiveAccess } from './archive-access';
import { parseRangeHeader, resolveFileRange } from './range';
import { buildCacheKey, cacheResponse } from './cache';
import { MAX_RANGE_SIZE_BYTES } from './config';
import { log } from './logging';
import { handleFaviconRequest } from './routes/favicon';

function isOpenEndedRange(range: R2Range): boolean {
	return 'offset' in range && typeof range.offset === 'number' && (!('length' in range) || typeof range.length !== 'number');
}

function createRangeNotSatisfiableResponse(size: number, requestId: string, cors: CorsContext): Response {
	const response = createErrorResponse('The requested file part is outside this file', 416, requestId, cors);
	response.headers.set('Content-Range', `bytes */${size}`);
	return response;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const start = performance.now();
		const requestId = crypto.randomUUID();
		const url = new URL(request.url);
		const origin = request.headers.get('Origin');
		const cors: CorsContext = {
			origin,
			authorizedOrigins: env.AUTHORIZED_ORIGINS,
		};
		const pathname = url.pathname.startsWith('/apiv2/') ? url.pathname.slice(6) : url.pathname;
		if (request.method === 'OPTIONS') return createPreflightResponse(origin, env.AUTHORIZED_ORIGINS, request);
		if (request.method !== 'GET' && request.method !== 'HEAD') return createErrorResponse('Method not allowed', 405, requestId, cors);
		if (pathname === '/health') return createHealthResponse(cors);
		if (pathname === '/favicon') return handleFaviconRequest(request, ctx, cors, requestId);
		if (!pathname.startsWith('/file/')) return createErrorResponse('Not found', 404, requestId, cors);

		let fileKey: string;
		try {
			fileKey = decodeURIComponent(pathname.slice(6));
		} catch {
			return createErrorResponse('The file path is invalid', 400, requestId, cors);
		}
		if (validateFileKey(fileKey)) return createErrorResponse('Forbidden - Invalid file path', 403, requestId, cors);
		const auth = await authenticateRequest(request, env, requestId);
		if (!auth.success) return createErrorResponse(auth.error, auth.status, requestId, cors);

		try {
			// Check the indexed archive grant before every read, including cache hits.
			// This is also the authority for guest files claimed by this account.
			if (!(await hasArchiveAccess(fileKey, auth.internalUserId, env))) {
				return createErrorResponse('Forbidden - Access denied', 403, requestId, cors);
			}
			if (request.method === 'HEAD') {
				const object = await env.ANALYTICS_BUCKET.head(fileKey);
				return object ? buildHeadResponse(object, cors) : createErrorResponse('Not found', 404, requestId, cors);
			}
			const parsed = parseRangeHeader(request.headers.get('Range'));
			if (parsed.error) return createErrorResponse(parsed.error, 400, requestId, cors);
			const cacheKey = buildCacheKey(fileKey, auth.internalUserId, parsed.range ? JSON.stringify(parsed.range) : undefined);
			const cached = await caches.default.match(cacheKey);
			if (cached) {
				log.info('Archive read completed', {
					request_id: requestId,
					cache_hit: true,
					latency_ms: performance.now() - start,
				});
				return buildCachedResponse(cached, cors);
			}
			let range = parsed.range;
			// Only open-ended ranges need a pre-flight head() to enforce MAX_RANGE_SIZE_BYTES.
			// Explicit ranges (<= 50 MB) and suffix ranges (<= 10 MB) are already bounded by parseRangeHeader.
			if (range && isOpenEndedRange(range)) {
				const metadata = await env.ANALYTICS_BUCKET.head(fileKey);
				if (!metadata) return createErrorResponse('Not found', 404, requestId, cors);
				const resolved = resolveFileRange(range, metadata.size);
				if (!resolved) {
					return createRangeNotSatisfiableResponse(metadata.size, requestId, cors);
				}
				if (resolved.length > MAX_RANGE_SIZE_BYTES)
					return createErrorResponse('Request a file part of 50 MB or less', 400, requestId, cors);
				range = resolved;
			}
			let object: R2ObjectBody | null;
			try {
				object = await env.ANALYTICS_BUCKET.get(fileKey, range ? { range } : undefined);
			} catch (getError) {
				if (!range) throw getError;
				const metadata = await env.ANALYTICS_BUCKET.head(fileKey);
				if (!metadata) return createErrorResponse('Not found', 404, requestId, cors);
				if (!resolveFileRange(range, metadata.size)) {
					return createRangeNotSatisfiableResponse(metadata.size, requestId, cors);
				}
				throw getError;
			}
			if (!object) return createErrorResponse('Not found', 404, requestId, cors);
			let responseRange = range;
			if (range) {
				const resolved = resolveFileRange(object.range ?? range, object.size);
				if (!resolved) {
					await object.body?.cancel();
					return createRangeNotSatisfiableResponse(object.size, requestId, cors);
				}
				responseRange = resolved;
			}
			const response = buildR2Response(object, responseRange, cors);
			cacheResponse(ctx, cacheKey, response, requestId);
			log.info('Archive read completed', {
				request_id: requestId,
				cache_hit: false,
				latency_ms: performance.now() - start,
			});
			return response;
		} catch (error) {
			log.error('Archive read failed', {
				request_id: requestId,
				error,
			});
			return createErrorResponse('This file is temporarily unavailable. Please try again.', 503, requestId, cors);
		}
	},
} satisfies ExportedHandler<Env>;
