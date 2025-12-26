/**
 * Cache utilities
 */

/**
 * Build a user-scoped cache key to prevent cross-tenant cache collisions
 */
export function buildCacheKey(requestUrl: string, userId: string, range: string | undefined): Request {
	const cacheKeyUrl = new URL(requestUrl);
	cacheKeyUrl.searchParams.set('_uid', userId);

	const headers: Record<string, string> = {};
	if (range) {
		headers['Range'] = range;
	}

	return new Request(cacheKeyUrl.toString(), {
		method: 'GET',
		headers,
	});
}

/**
 * Store response in cache (non-blocking)
 */
export function cacheResponse(ctx: ExecutionContext, cacheKey: Request, response: Response): void {
	ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
}
