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
import { handleFlagRequest } from './routes/flag';
import { handleFaviconRequest } from './routes/favicon';

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const start = performance.now();
		const requestId = crypto.randomUUID();
		const url = new URL(request.url);
		const origin = request.headers.get('Origin');
		const cors: CorsContext = {
			origin,
			authorizedOrigins: env.AUTHORIZED_ORIGINS,
		};
		const pathname = url.pathname.startsWith('/apiv2/')
			? url.pathname.slice(6)
			: url.pathname;
		if (request.method === 'OPTIONS')
			return createPreflightResponse(origin, env.AUTHORIZED_ORIGINS, request);
		if (pathname === '/health') return createHealthResponse(cors);
		const publicCors = { origin, authorizedOrigins: env.AUTHORIZED_ORIGINS };
		if (pathname === '/flag')
			return handleFlagRequest(request, ctx, publicCors);
		if (pathname === '/favicon')
			return handleFaviconRequest(request, ctx, publicCors);
		if (!pathname.startsWith('/file/'))
			return createErrorResponse('Not found', 404, requestId, cors);
		if (request.method !== 'GET' && request.method !== 'HEAD')
			return createErrorResponse('Method not allowed', 405, requestId, cors);

		let fileKey: string;
		try {
			fileKey = decodeURIComponent(pathname.slice(6));
		} catch {
			return createErrorResponse(
				'The file path is invalid',
				400,
				requestId,
				cors,
			);
		}
		if (validateFileKey(fileKey))
			return createErrorResponse(
				'Forbidden - Invalid file path',
				403,
				requestId,
				cors,
			);
		const auth = await authenticateRequest(request, env, requestId);
		if (!auth.success)
			return createErrorResponse(auth.error, auth.status, requestId, cors);

		try {
			// Check the indexed archive grant before every read, including cache hits.
			// This is also the authority for guest files claimed by this account.
			if (!(await hasArchiveAccess(fileKey, auth.internalUserId, env))) {
				return createErrorResponse(
					'Forbidden - Access denied',
					403,
					requestId,
					cors,
				);
			}
			if (request.method === 'HEAD') {
				const object = await env.ANALYTICS_BUCKET.head(fileKey);
				return object
					? buildHeadResponse(object, cors)
					: createErrorResponse('Not found', 404, requestId, cors);
			}
			const parsed = parseRangeHeader(request.headers.get('Range'));
			if (parsed.error)
				return createErrorResponse(parsed.error, 400, requestId, cors);
			const cacheKey = buildCacheKey(
				request.url,
				auth.internalUserId,
				parsed.range ? JSON.stringify(parsed.range) : undefined,
			);
			const cached = await caches.default.match(cacheKey);
			if (cached) {
				console.info(
					JSON.stringify({
						message: 'Archive read completed',
						request_id: requestId,
						cache_hit: true,
						latency_ms: performance.now() - start,
					}),
				);
				return buildCachedResponse(cached, cors);
			}
			let range = parsed.range;
			if (range) {
				const metadata = await env.ANALYTICS_BUCKET.head(fileKey);
				if (!metadata)
					return createErrorResponse('Not found', 404, requestId, cors);
				const resolved = resolveFileRange(range, metadata.size);
				if (!resolved) {
					const response = createErrorResponse(
						'The requested file part is outside this file',
						416,
						requestId,
						cors,
					);
					response.headers.set('Content-Range', `bytes */${metadata.size}`);
					return response;
				}
				if (resolved.length > MAX_RANGE_SIZE_BYTES)
					return createErrorResponse(
						'Request a file part of 50 MB or less',
						400,
						requestId,
						cors,
					);
				range = resolved;
			}
			const object = await env.ANALYTICS_BUCKET.get(
				fileKey,
				range ? { range } : undefined,
			);
			if (!object)
				return createErrorResponse('Not found', 404, requestId, cors);
			const { response } = buildR2Response(object, range, cors);
			cacheResponse(ctx, cacheKey, response);
			console.info(
				JSON.stringify({
					message: 'Archive read completed',
					request_id: requestId,
					cache_hit: false,
					latency_ms: performance.now() - start,
				}),
			);
			return response;
		} catch (error) {
			console.error(
				JSON.stringify({
					message: 'Archive read failed',
					request_id: requestId,
					error: String(error),
				}),
			);
			return createErrorResponse(
				'This file is temporarily unavailable. Please try again.',
				503,
				requestId,
				cors,
			);
		}
	},
} satisfies ExportedHandler<Env>;
