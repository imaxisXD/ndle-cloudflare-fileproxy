import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleFaviconRequest } from './favicon';

const authorizedOrigins = 'https://ndle.app,https://www.ndle.app';

afterEach(() => vi.restoreAllMocks());

describe('favicon route caching and CORS safety', () => {
	it('strips Vary and Access-Control-* before caching and reapplies current-origin CORS on hits', async () => {
		const domain = `${crypto.randomUUID()}.example.com`;
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));

		const ctx1 = createExecutionContext();
		const first = await handleFaviconRequest(
			new Request(`https://proxy.test/favicon?url=https://${domain}`),
			ctx1,
			{ origin: 'https://ndle.app', authorizedOrigins },
			'req-1',
		);
		await waitOnExecutionContext(ctx1);

		expect(first.status).toBe(200);
		expect(first.headers.get('Access-Control-Allow-Origin')).toBe('https://ndle.app');
		expect(await first.json()).toEqual({
			faviconUrl: `https://favicon.vemetric.com/${domain}?size=32`,
			domain,
		});
		expect(fetchSpy).toHaveBeenCalledTimes(1);

		// Verify the stored cache entry has no Vary or Access-Control-* headers
		const stored = await caches.default.match(new Request(`https://cache.internal/favicon/${encodeURIComponent(domain)}`));
		expect(stored).toBeDefined();
		expect(stored?.headers.has('Vary')).toBe(false);
		expect([...(stored?.headers.keys() ?? [])].some((k) => k.toLowerCase().startsWith('access-control-'))).toBe(false);

		// Second request from a different allowed origin hits cache with its own CORS origin
		const ctx2 = createExecutionContext();
		const second = await handleFaviconRequest(
			new Request(`https://proxy.test/favicon?url=https://${domain}`),
			ctx2,
			{ origin: 'https://www.ndle.app', authorizedOrigins },
			'req-2',
		);
		await waitOnExecutionContext(ctx2);

		expect(second.status).toBe(200);
		expect(second.headers.get('Access-Control-Allow-Origin')).toBe('https://www.ndle.app');
		expect(fetchSpy).toHaveBeenCalledTimes(1);

		// Third request from an unauthorized origin gets no Access-Control-Allow-Origin
		const ctx3 = createExecutionContext();
		const third = await handleFaviconRequest(
			new Request(`https://proxy.test/favicon?url=https://${domain}`),
			ctx3,
			{ origin: 'https://evil.example', authorizedOrigins },
			'req-3',
		);
		await waitOnExecutionContext(ctx3);

		expect(third.status).toBe(200);
		expect(third.headers.get('Access-Control-Allow-Origin')).toBeNull();
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it('handles cache.put failures inside ctx.waitUntil without failing the response', async () => {
		const domain = `${crypto.randomUUID()}.example.com`;
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
		vi.spyOn(caches.default, 'put').mockRejectedValue(new Error('Cache quota exceeded'));

		const ctx = createExecutionContext();
		const response = await handleFaviconRequest(
			new Request(`https://proxy.test/favicon?url=https://${domain}`),
			ctx,
			{ origin: 'https://ndle.app', authorizedOrigins },
			'req-cache-fail',
		);
		await expect(waitOnExecutionContext(ctx)).resolves.toBeUndefined();

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			faviconUrl: `https://favicon.vemetric.com/${domain}?size=32`,
			domain,
		});
	});

	it('rejects SSRF targets without contacting upstream', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch');
		const ctx = createExecutionContext();

		for (const target of ['http://[::1]', 'http://[::ffff:127.0.0.1]', 'http://169.254.169.254', 'http://sub.localhost']) {
			const response = await handleFaviconRequest(
				new Request(`https://proxy.test/favicon?url=${encodeURIComponent(target)}`),
				ctx,
				{ origin: 'https://ndle.app', authorizedOrigins },
				'req-ssrf',
			);
			expect(response.status).toBe(400);
		}
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});
