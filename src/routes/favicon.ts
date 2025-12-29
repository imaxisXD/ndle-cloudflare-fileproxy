/**
 * Favicon Proxy Route Handler
 *
 * Returns favicon URL for a given domain using favicon.vemetric.com.
 * Includes SSRF protection and smart caching (30 days with stale-while-revalidate).
 *
 * Usage: GET /favicon?url=https://example.com
 * Returns: { faviconUrl: "...", domain: "..." }
 */

import { getCorsHeaders } from '../cors';
import { DYNAMIC_CACHE_HEADERS, ERROR_CACHE_HEADERS, NO_CACHE_HEADERS } from './cache-headers';
import { validateUrl } from './url-validation';

const FAVICON_SERVICE_URL = 'https://favicon.vemetric.com';

/** Create error response with cache headers */
function createErrorResponse(
	message: string,
	status: number,
	origin: string | null,
	authorizedOrigins: string,
	cacheHeaders: Record<string, string>
): Response {
	return Response.json(
		{ error: message },
		{
			status,
			headers: {
				...getCorsHeaders(origin, authorizedOrigins),
				...cacheHeaders,
			},
		}
	);
}

/** Create success response with cache headers */
function createSuccessResponse(data: { faviconUrl: string; domain: string }, origin: string | null, authorizedOrigins: string): Response {
	return Response.json(data, {
		status: 200,
		headers: {
			...getCorsHeaders(origin, authorizedOrigins),
			...DYNAMIC_CACHE_HEADERS,
		},
	});
}

interface FaviconContext {
	origin: string | null;
	authorizedOrigins: string;
}

/**
 * Handle favicon lookup requests
 * Public route - no authentication required
 */
export async function handleFaviconRequest(request: Request, ctx: ExecutionContext, corsContext: FaviconContext): Promise<Response> {
	const { origin, authorizedOrigins } = corsContext;
	const url = new URL(request.url);
	const urlParam = url.searchParams.get('url');

	// Validate URL parameter
	if (!urlParam) {
		return createErrorResponse('URL parameter is required', 400, origin, authorizedOrigins, NO_CACHE_HEADERS);
	}

	const validationResult = validateUrl(urlParam);

	if ('error' in validationResult) {
		return createErrorResponse(validationResult.error, 400, origin, authorizedOrigins, NO_CACHE_HEADERS);
	}

	const { domain } = validationResult;

	// Build cache key based on domain only (not full URL)
	const cacheKeyUrl = `https://cache.internal/favicon/${domain}`;
	const cacheKey = new Request(cacheKeyUrl);
	const cache = caches.default;

	// Check cache first
	const cached = await cache.match(cacheKey);
	if (cached) {
		// Clone cached response and apply current origin's CORS headers
		const headers = new Headers(cached.headers);
		const corsHeaders = getCorsHeaders(origin, authorizedOrigins);
		Object.entries(corsHeaders).forEach(([key, value]) => headers.set(key, value as string));
		return new Response(cached.body, {
			status: cached.status,
			statusText: cached.statusText,
			headers,
		});
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

		if (!response.ok) {
			return createErrorResponse('Favicon not found or not accessible', 404, origin, authorizedOrigins, ERROR_CACHE_HEADERS);
		}
	} catch (error) {
		console.error(`Error checking favicon for domain "${domain}":`, error);
		return createErrorResponse('Favicon not found or not accessible', 404, origin, authorizedOrigins, ERROR_CACHE_HEADERS);
	}

	// Build success response
	const successResponse = createSuccessResponse({ faviconUrl, domain }, origin, authorizedOrigins);

	// Cache the response (non-blocking)
	ctx.waitUntil(cache.put(cacheKey, successResponse.clone()));

	return successResponse;
}
