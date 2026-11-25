/**
 * Favicon Proxy Route Handler
 *
 * Returns favicon URL for a given domain using favicon.vemetric.com.
 * Includes SSRF protection and smart caching (30 days with stale-while-revalidate).
 *
 * Usage: GET /favicon?url=https://example.com
 * Returns: { faviconUrl: "...", domain: "..." }
 */

import { addCorsHeaders, stripCorsHeaders } from '../cors';
import { log } from '../logging';
import { cloneCachedResponse, type CorsContext } from '../response';
import { DYNAMIC_CACHE_HEADERS, ERROR_CACHE_HEADERS, NO_CACHE_HEADERS } from './cache-headers';
import { validateUrl } from './url-validation';

const FAVICON_SERVICE_URL = 'https://favicon.vemetric.com';

/** Create error response with cache headers */
function createFaviconErrorResponse(message: string, status: number, cors: CorsContext, cacheHeaders: Record<string, string>): Response {
	const headers = new Headers(cacheHeaders);
	addCorsHeaders(headers, cors.origin, cors.authorizedOrigins);
	return Response.json(
		{ error: message },
		{
			status,
			headers,
		},
	);
}

/** Create success response with cache headers */
function createSuccessResponse(data: { faviconUrl: string; domain: string }, cors: CorsContext): Response {
	const headers = new Headers(DYNAMIC_CACHE_HEADERS);
	addCorsHeaders(headers, cors.origin, cors.authorizedOrigins);
	return Response.json(data, {
		status: 200,
		headers,
	});
}

/**
 * Handle favicon lookup requests
 * Public route - no authentication required
 */
export async function handleFaviconRequest(
	request: Request,
	ctx: ExecutionContext,
	cors: CorsContext,
	requestId?: string,
): Promise<Response> {
	const url = new URL(request.url);
	const urlParam = url.searchParams.get('url');

	// Validate URL parameter
	if (!urlParam) {
		return createFaviconErrorResponse('URL parameter is required', 400, cors, NO_CACHE_HEADERS);
	}

	const validationResult = validateUrl(urlParam);

	if ('error' in validationResult) {
		return createFaviconErrorResponse(validationResult.error, 400, cors, NO_CACHE_HEADERS);
	}

	const { domain } = validationResult;

	// Build cache key based on domain only (not full URL)
	const cacheKey = new Request(`https://cache.internal/favicon/${encodeURIComponent(domain)}`);
	const cache = caches.default;

	// Check cache first
	const cached = await cache.match(cacheKey);
	if (cached) {
		return cloneCachedResponse(cached, cors);
	}

	// Construct favicon URL
	const faviconUrl = `${FAVICON_SERVICE_URL}/${domain}?size=32`;

	// Verify favicon accessibility with HEAD request
	try {
		const response = await fetch(faviconUrl, {
			method: 'HEAD',
			signal: AbortSignal.timeout(5000),
			headers: {
				'User-Agent': 'Mozilla/5.0 (compatible; NDLE-FaviconProxy/1.0)',
			},
		});

		await response.body?.cancel();
		if (!response.ok) {
			return createFaviconErrorResponse('Favicon not found or not accessible', 404, cors, ERROR_CACHE_HEADERS);
		}
	} catch (error) {
		log.error('Favicon check failed', {
			request_id: requestId,
			domain,
			error,
		});
		return createFaviconErrorResponse('Favicon not found or not accessible', 404, cors, ERROR_CACHE_HEADERS);
	}

	// Build success response
	const successResponse = createSuccessResponse({ faviconUrl, domain }, cors);

	// Strip Vary and Access-Control-* before caching so cache entries are origin-independent
	const copy = successResponse.clone();
	const cacheHeaders = new Headers(copy.headers);
	stripCorsHeaders(cacheHeaders);
	const stored = new Response(copy.body, {
		status: copy.status,
		statusText: copy.statusText,
		headers: cacheHeaders,
	});

	ctx.waitUntil(
		cache.put(cacheKey, stored).catch((error: unknown) => {
			log.error('Favicon cache write failed', {
				request_id: requestId,
				domain,
				error,
			});
		}),
	);

	return successResponse;
}
