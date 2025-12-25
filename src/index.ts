/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

/**
 * Add CORS headers for DuckDB WASM compatibility
 */
function addCors(headers: Headers) {
	headers.set('Access-Control-Allow-Origin', '*');
	headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
	headers.set('Access-Control-Allow-Headers', 'Range');
	headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified');
}

export default {
	async fetch(request: Request, env: any, ctx: ExecutionContext) {
		// Handle CORS preflight requests
		if (request.method === 'OPTIONS') {
			return new Response(null, {
				status: 204,
				headers: {
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
					'Access-Control-Allow-Headers': 'Range',
					'Access-Control-Max-Age': '86400',
				},
			});
		}

		const url = new URL(request.url);

		/**
		 * Expected:
		 *   /analytics/file?url=<ENCODED_PRESIGNED_R2_URL>
		 */
		const encoded = url.searchParams.get('url');
		if (!encoded) {
			const errorResponse = new Response('Missing url parameter', { status: 400 });
			const headers = new Headers(errorResponse.headers);
			addCors(headers);
			return new Response(errorResponse.body, { status: 400, headers });
		}

		let targetUrl: string;
		try {
			targetUrl = decodeURIComponent(encoded);
		} catch {
			targetUrl = encoded;
		}

		const method = request.method;
		const incomingRange = request.headers.get('range');

		/**
		 * DuckDB issues HEAD first.
		 * Presigned R2 URLs do NOT support HEAD.
		 * We emulate HEAD with GET bytes=0-0.
		 */
		const isHead = method === 'HEAD';

		const range = incomingRange ?? (isHead ? 'bytes=0-0' : undefined);

		/**
		 * Cache key MUST include Range header
		 */
		const cacheKey = new Request(request.url, {
			method: 'GET',
			headers: range ? { range } : {},
		});

		const cache = caches.default;

		// -------- CACHE LOOKUP --------
		let cached = await cache.match(cacheKey);
		if (cached) {
			console.log('[CF CACHE HIT]', {
				range: range ?? 'FULL',
				status: cached.status,
			});
			// Add CORS headers to cached response
			const cachedHeaders = new Headers(cached.headers);
			addCors(cachedHeaders);
			return new Response(cached.body, {
				status: cached.status,
				headers: cachedHeaders,
			});
		}

		console.log('[CF CACHE MISS]', {
			range: range ?? 'FULL',
		});

		// -------- FETCH FROM R2 --------
		const upstreamHeaders = new Headers();
		if (range) {
			upstreamHeaders.set('range', range);
		}

		const upstream = await fetch(targetUrl, {
			method: 'GET',
			headers: upstreamHeaders,
			redirect: 'manual',
		});

		/**
		 * Forward only required headers
		 */
		const responseHeaders = new Headers();
		const passthroughHeaders = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'];

		for (const h of passthroughHeaders) {
			const v = upstream.headers.get(h);
			if (v) responseHeaders.set(h, v);
		}

		/**
		 * Parquet files are immutable → cache forever
		 */
		responseHeaders.set('Cache-Control', 'public, max-age=31536000, immutable');

		/**
		 * Add CORS headers for DuckDB WASM compatibility
		 */
		addCors(responseHeaders);

		/**
		 * HEAD response must not include body
		 */
		if (isHead) {
			const headResponse = new Response(null, {
				status: upstream.ok ? 200 : upstream.status,
				headers: responseHeaders,
			});

			if (upstream.status === 200 || upstream.status === 206) {
				ctx.waitUntil(cache.put(cacheKey, headResponse.clone()));
			}

			return headResponse;
		}

		const response = new Response(upstream.body, {
			status: upstream.status,
			headers: responseHeaders,
		});

		/**
		 * Cache successful reads only
		 */
		if (upstream.status === 200 || upstream.status === 206) {
			ctx.waitUntil(cache.put(cacheKey, response.clone()));
		}

		return response;
	},
};
