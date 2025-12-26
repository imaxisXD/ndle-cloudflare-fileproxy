/**
 * Cloudflare Worker: Analytics File Proxy with Clerk Authentication
 *
 * This worker provides authenticated access to parquet files stored in R2.
 * It uses Clerk JWT tokens for authentication and the Cache API for performance.
 *
 * Security features:
 * - Clerk JWT verification (networkless when CLERK_JWT_KEY is provided)
 * - User-scoped cache keys to prevent cross-tenant cache collisions
 * - Path traversal protection
 * - Range request size limits
 */

import type { Env } from './types';
import { createPreflightResponse } from './cors';
import { createErrorResponse, createHealthResponse, buildR2Response, buildCachedResponse, buildHeadResponse } from './response';
import { validateFileKey, validateFileAccess } from './security';
import { authenticateRequest } from './auth';
import { parseRangeHeader } from './range';
import { buildCacheKey, cacheResponse } from './cache';
import { log, logMetrics, createMetrics } from './logging';

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const requestStart = performance.now();
		const url = new URL(request.url);
		const requestId = crypto.randomUUID().slice(0, 8);
		const method = request.method;
		const metrics = createMetrics();

		log.info(requestId, `📥 Request: ${method} ${url.pathname}`);

		// ========== CORS Preflight ==========
		if (method === 'OPTIONS') {
			log.info(requestId, '✅ CORS preflight response');
			return createPreflightResponse();
		}

		// ========== Health Check ==========
		if (url.pathname === '/health') {
			log.info(requestId, '✅ Health check OK');
			return createHealthResponse();
		}

		// ========== File Access: /file/{key} ==========
		if (!url.pathname.startsWith('/file/')) {
			return createErrorResponse('Not found', 404, requestId);
		}

		// Extract and validate file key
		const fileKey = decodeURIComponent(url.pathname.slice(6));
		const keyError = validateFileKey(fileKey);
		if (keyError) {
			log.security(requestId, `Invalid file key - ${keyError}`);
			return createErrorResponse('Forbidden - Invalid file path', 403, requestId);
		}

		log.info(requestId, `📁 File key: ${fileKey}`);

		// ========== Authentication ==========
		log.info(requestId, `🔐 Auth header present: ${!!request.headers.get('Authorization')}`);

		const authResult = await authenticateRequest(request, env, requestId);
		if (!authResult.success) {
			return createErrorResponse(authResult.error, authResult.status, requestId);
		}

		const { internalUserId } = authResult;
		metrics.authTimeMs = authResult.durationMs;

		// ========== Authorization ==========
		// Use internal user ID from header (validated by Clerk auth) to check file ownership
		const accessError = validateFileAccess(fileKey, internalUserId);
		if (accessError) {
			log.security(requestId, `Access denied - ${accessError}`);
			return createErrorResponse('Forbidden - Access denied', 403, requestId);
		}

		log.info(requestId, '✅ Authorization passed');

		// ========== Range Validation (GET only) ==========
		const rangeHeader = request.headers.get('Range');
		const isHead = method === 'HEAD';

		// Only parse range for GET requests
		const { range, error: rangeError } = isHead ? { range: undefined, error: undefined } : parseRangeHeader(rangeHeader);

		if (rangeError) {
			log.warn(requestId, `Invalid range request: ${rangeError}`);
			return createErrorResponse(`Bad Request - ${rangeError}`, 400, requestId);
		}

		// ========== Cache Lookup ==========
		const cacheKey = buildCacheKey(request.url, internalUserId, rangeHeader ?? undefined);
		const cached = await caches.default.match(cacheKey);

		if (cached) {
			metrics.cacheHit = true;
			metrics.bytesTransferred = parseInt(cached.headers.get('Content-Length') || '0', 10);
			metrics.totalTimeMs = performance.now() - requestStart;

			log.info(requestId, `📦 CACHE HIT | User: ${internalUserId} | Range: ${rangeHeader ?? 'FULL'}`);
			logMetrics(requestId, metrics);

			return buildCachedResponse(cached, isHead);
		}

		log.info(requestId, `📭 CACHE MISS | User: ${internalUserId} | Range: ${rangeHeader ?? 'FULL'}`);

		// ========== Fetch from R2 ==========
		const fetchStart = performance.now();
		log.info(requestId, `🗄️ Fetching from R2: ${fileKey}`);

		// Use R2.head() for HEAD requests (no body, just metadata)
		if (isHead) {
			const object = await env.ANALYTICS_BUCKET.head(fileKey);

			if (object === null) {
				log.warn(requestId, `R2 object not found: ${fileKey}`);
				return createErrorResponse('Not found', 404, requestId);
			}

			metrics.r2FetchTimeMs = performance.now() - fetchStart;
			metrics.bytesTransferred = 0;

			log.info(requestId, `✅ R2 HEAD complete | Size: ${object.size} bytes | Time: ${metrics.r2FetchTimeMs.toFixed(2)}ms`);

			const { response } = buildHeadResponse(object);
			cacheResponse(ctx, cacheKey, response);

			metrics.totalTimeMs = performance.now() - requestStart;
			log.info(requestId, `📤 HEAD response sent | Size: ${object.size}`);
			logMetrics(requestId, metrics);

			return response;
		}

		// GET request - fetch with optional range
		const r2Options: R2GetOptions = range ? { range } : {};
		const object = await env.ANALYTICS_BUCKET.get(fileKey, r2Options);

		if (object === null) {
			log.warn(requestId, `R2 object not found: ${fileKey}`);
			return createErrorResponse('Not found', 404, requestId);
		}

		metrics.r2FetchTimeMs = performance.now() - fetchStart;
		metrics.bytesTransferred = object.size;

		log.info(requestId, `✅ R2 fetch complete | Size: ${object.size} bytes | Time: ${metrics.r2FetchTimeMs.toFixed(2)}ms`);

		// ========== Build and Cache Response ==========
		const { response, status } = buildR2Response(object, range);

		if (status === 200 || status === 206) {
			cacheResponse(ctx, cacheKey, response);
			log.info(requestId, '💾 Response cached');
		}

		metrics.totalTimeMs = performance.now() - requestStart;
		log.info(requestId, `📤 Response sent | Status: ${status} | Size: ${object.size}`);
		logMetrics(requestId, metrics);

		return response;
	},
};
