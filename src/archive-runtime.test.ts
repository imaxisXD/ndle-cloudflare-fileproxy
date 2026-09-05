import {
	createExecutionContext,
	waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from './index';
import type { Env } from './types';

const account = vi.hoisted(() => ({ id: 'account123', signedIn: true }));
vi.mock('./auth', () => ({
	authenticateRequest: async () =>
		account.signedIn
			? {
					success: true,
					internalUserId: account.id,
					clerkUserId: 'clerk123',
					durationMs: 0,
				}
			: { success: false, status: 401, error: 'Unauthorized' },
}));

const config: Env = {
	...env,
	AUTHORIZED_ORIGINS: 'https://ndle.app',
	CLERK_SECRET_KEY: 'test',
	CLERK_PUBLISHABLE_KEY: 'test',
	FILE_ACCESS_ENDPOINT: 'https://access.test/internal/archive-access',
	FILE_ACCESS_SECRET: 'test-only-secret',
};
let key: string;

beforeEach(async () => {
	account.id = 'account123';
	account.signedIn = true;
	key = `archive/user_id=user%3Aaccount123/year=2026/${crypto.randomUUID()}.parquet`;
	await env.ANALYTICS_BUCKET.put(key, 'abcdefgh');
	vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
		Response.json({ allowed: true }),
	);
});
afterEach(() => vi.restoreAllMocks());

async function read(
	range?: string,
	options: {
		method?: string;
		fileKey?: string;
		origin?: string;
		settings?: Env;
	} = {},
) {
	const ctx = createExecutionContext();
	const response = await worker.fetch(
		new Request(
			`https://proxy.test/file/${encodeURIComponent(options.fileKey ?? key)}`,
			{
				method: options.method ?? 'GET',
				headers: {
					Authorization: 'Bearer test',
					Origin: options.origin ?? 'https://ndle.app',
					...(range ? { Range: range } : {}),
				},
			},
		),
		options.settings ?? config,
		ctx,
	);
	const body = new TextDecoder().decode(await response.arrayBuffer());
	await waitOnExecutionContext(ctx);
	return { response, body };
}

describe('archive access and actual Workers cache', () => {
	it('caches distinct byte ranges as internal 200 objects and returns the correct private 206 bytes', async () => {
		const first = await read('bytes=0-3');
		const second = await read('bytes=4-7');
		expect(first.body).toBe('abcd');
		expect(second.body).toBe('efgh');
		await env.ANALYTICS_BUCKET.delete(key);
		for (const [range, expected, contentRange] of [
			['bytes=0-3', 'abcd', 'bytes 0-3/8'],
			['bytes=4-7', 'efgh', 'bytes 4-7/8'],
		]) {
			const cached = await read(range);
			expect(cached.body).toBe(expected);
			expect(cached.response.status).toBe(206);
			expect(cached.response.headers.get('Content-Range')).toBe(contentRange);
			expect(cached.response.headers.get('Content-Length')).toBe('4');
			expect(cached.response.headers.get('Cache-Control')).toBe(
				'private, no-store',
			);
			expect(cached.response.headers.has('X-Archive-Response-Status')).toBe(
				false,
			);
		}
	});

	it('checks the archive grant again before serving cached bytes', async () => {
		await read('bytes=0-3');
		vi.mocked(fetch).mockImplementation(async () =>
			Response.json({ allowed: false }),
		);
		const denied = await read('bytes=0-3');
		expect(denied.response.status).toBe(403);
		expect(denied.body).not.toBe('abcd');
		expect(denied.response.headers.get('Cache-Control')).toBe(
			'private, no-store',
		);
	});

	it('allows an indexed guest archive after ownership is verified by the alias service', async () => {
		const guestKey = `archive/user_id=guest%3Aguest123/year=2026/${crypto.randomUUID()}.parquet`;
		await env.ANALYTICS_BUCKET.put(guestKey, 'guest history');
		const result = await read(undefined, { fileKey: guestKey });
		expect(result.response.status).toBe(200);
		expect(result.body).toBe('guest history');
		const accessUrl = new URL(String(vi.mocked(fetch).mock.calls[0][0]));
		expect(accessUrl.searchParams.get('key')).toBe(guestKey);
		expect(accessUrl.searchParams.get('user_id')).toBe('account123');
		expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toEqual({
			Authorization: 'Bearer test-only-secret',
		});
	});

	it('serves a granted account export and denies cached bytes when its temporary grant expires', async () => {
		const exportKey = `exports/account=account123/${crypto.randomUUID()}.parquet`;
		await env.ANALYTICS_BUCKET.put(exportKey, 'export bytes');
		const first = await read('bytes=0-5', { fileKey: exportKey });
		expect(first.response.status).toBe(206);
		expect(first.body).toBe('export');
		const grantUrl = new URL(String(vi.mocked(fetch).mock.calls[0][0]));
		expect(grantUrl.searchParams.get('key')).toBe(exportKey);
		expect(grantUrl.searchParams.get('user_id')).toBe('account123');
		await env.ANALYTICS_BUCKET.delete(exportKey);
		expect((await read('bytes=0-5', { fileKey: exportKey })).body).toBe(
			'export',
		);
		vi.mocked(fetch).mockImplementation(async () =>
			Response.json({ allowed: false }),
		);
		const expired = await read('bytes=0-5', { fileKey: exportKey });
		expect(expired.response.status).toBe(403);
		expect(expired.body).not.toBe('export');
		expect(expired.response.headers.get('Cache-Control')).toBe(
			'private, no-store',
		);
	});

	it('does not bypass unavailable authorization for a locally matching owner', async () => {
		await read();
		vi.mocked(fetch).mockImplementation(
			async () => new Response(null, { status: 503 }),
		);
		expect((await read()).response.status).toBe(503);
		expect(
			(
				await read(undefined, {
					settings: { ...config, FILE_ACCESS_SECRET: '' },
				})
			).response.status,
		).toBe(503);
	});

	it('does not check grants or read data before authentication', async () => {
		account.signedIn = false;
		expect((await read()).response.status).toBe(401);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('handles suffix, open-ended and unsatisfiable ranges with correct lengths', async () => {
		const suffix = await read('bytes=-3');
		expect(suffix.body).toBe('fgh');
		expect(suffix.response.headers.get('Content-Range')).toBe('bytes 5-7/8');
		expect((await read('bytes=5-')).body).toBe('fgh');
		const outside = await read('bytes=8-');
		expect(outside.response.status).toBe(416);
		expect(outside.response.headers.get('Content-Range')).toBe('bytes */8');
		for (const invalid of [
			'bytes=0-1,4-5',
			'wrong=0-1',
			'bytes=-0',
			'bytes=9007199254740992-',
		]) {
			expect((await read(invalid)).response.status).toBe(400);
		}
	});

	it('returns private HEAD metadata without a file body', async () => {
		const result = await read(undefined, { method: 'HEAD' });
		expect(result.body).toBe('');
		expect(result.response.headers.get('Content-Length')).toBe('8');
		expect(result.response.headers.get('Cache-Control')).toBe(
			'private, no-store',
		);
	});

	it('does not reuse the previous request origin on cache hits', async () => {
		await read('bytes=0-3');
		const result = await read('bytes=0-3', { origin: 'https://other.test' });
		expect(result.response.headers.has('Access-Control-Allow-Origin')).toBe(
			false,
		);
	});

	it('refuses raw recovery data paths before checking file grants', async () => {
		const result = await read(undefined, {
			fileKey: 'analytics/raw/user_id=account123/event.json',
		});
		expect(result.response.status).toBe(403);
		expect(fetch).not.toHaveBeenCalled();
	});
});
