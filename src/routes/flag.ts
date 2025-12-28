/**
 * Flag Proxy Route Handler
 *
 * Proxies country flag SVGs from hatscripts.github.io with aggressive caching.
 * Flags are static assets that never change, so we cache for 1 year as immutable.
 *
 * Usage: GET /flag?code=us
 */

import { getCorsHeaders } from '../cors';
import { STATIC_CACHE_HEADERS, ERROR_CACHE_HEADERS, NO_CACHE_HEADERS } from './cache-headers';

const FLAG_BASE_URL = 'https://hatscripts.github.io/circle-flags/flags';

/** Validate country code format (2 lowercase letters) */
function isValidCountryCode(code: string): boolean {
	return /^[a-z]{2}$/.test(code);
}

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

interface FlagContext {
	origin: string | null;
	authorizedOrigins: string;
}

/**
 * Handle flag proxy requests
 * Public route - no authentication required
 */
export async function handleFlagRequest(request: Request, ctx: ExecutionContext, corsContext: FlagContext): Promise<Response> {
	const { origin, authorizedOrigins } = corsContext;
	const url = new URL(request.url);
	const code = url.searchParams.get('code');

	// Validate country code parameter
	if (!code) {
		return createErrorResponse('Missing country code parameter', 400, origin, authorizedOrigins, NO_CACHE_HEADERS);
	}

	if (!isValidCountryCode(code)) {
		return createErrorResponse(
			'Invalid country code. Expected 2 lowercase letters (e.g., "us", "gb").',
			400,
			origin,
			authorizedOrigins,
			NO_CACHE_HEADERS
		);
	}

	// Build cache key for this flag
	const cacheKey = new Request(`${request.url}`);
	const cache = caches.default;

	// Check cache first
	const cached = await cache.match(cacheKey);
	if (cached) {
		return cached;
	}

	// Fetch from upstream
	const flagUrl = `${FLAG_BASE_URL}/${code}.svg`;

	try {
		const response = await fetch(flagUrl, {
			signal: AbortSignal.timeout(5000),
			headers: {
				'User-Agent': 'Mozilla/5.0 (compatible; NDLE-FlagProxy/1.0)',
			},
		});

		if (!response.ok) {
			return createErrorResponse('Flag not found', 404, origin, authorizedOrigins, ERROR_CACHE_HEADERS);
		}

		// Get SVG content
		const svgContent = await response.text();

		// Build response with aggressive cache headers
		const flagResponse = new Response(svgContent, {
			status: 200,
			headers: {
				'Content-Type': 'image/svg+xml',
				...getCorsHeaders(origin, authorizedOrigins),
				...STATIC_CACHE_HEADERS,
			},
		});

		// Cache the response (non-blocking)
		ctx.waitUntil(cache.put(cacheKey, flagResponse.clone()));

		return flagResponse;
	} catch (error) {
		console.error(`Error fetching flag for code "${code}":`, error);
		return createErrorResponse('Failed to fetch flag', 500, origin, authorizedOrigins, ERROR_CACHE_HEADERS);
	}
}
