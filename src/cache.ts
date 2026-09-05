import { CACHE_MAX_AGE_SECONDS, MAX_RANGE_SIZE_BYTES } from './config';

const storedStatusHeader = 'X-Archive-Response-Status';

/** Range bytes are part of the URL key, never a Range header on cache.match. */
export function buildCacheKey(
	requestUrl: string,
	userId: string,
	range: string | undefined,
): Request {
	const url = new URL(requestUrl);
	url.search = '';
	url.searchParams.set('_archive_cache', '2');
	url.searchParams.set('_uid', userId);
	url.searchParams.set('_range', range ?? 'full');
	return new Request(url.toString());
}

/** Store a bounded byte representation as 200: Cache API rejects 206 writes. */
export function cacheResponse(
	ctx: ExecutionContext,
	cacheKey: Request,
	response: Response,
): void {
	const length = Number(response.headers.get('Content-Length'));
	if (
		!Number.isSafeInteger(length) ||
		length <= 0 ||
		length > MAX_RANGE_SIZE_BYTES
	)
		return;
	if (response.status !== 200 && response.status !== 206) return;
	const copy = response.clone();
	const headers = new Headers(copy.headers);
	headers.set(storedStatusHeader, String(copy.status));
	headers.set(
		'Cache-Control',
		`public, max-age=${CACHE_MAX_AGE_SECONDS}, immutable`,
	);
	// Authorization and current-request CORS are applied before every cache read.
	headers.delete('Vary');
	for (const name of [...headers.keys()]) {
		if (name.toLowerCase().startsWith('access-control-')) headers.delete(name);
	}
	const stored = new Response(copy.body, { status: 200, headers });
	ctx.waitUntil(
		caches.default.put(cacheKey, stored).catch((error: unknown) => {
			console.error(
				JSON.stringify({
					message: 'Archive cache write failed',
					error: String(error),
				}),
			);
		}),
	);
}

export function restoreCachedStatus(headers: Headers): number {
	const status = headers.get(storedStatusHeader) === '206' ? 206 : 200;
	headers.delete(storedStatusHeader);
	return status;
}
