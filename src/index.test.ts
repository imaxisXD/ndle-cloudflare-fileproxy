import { describe, expect, it, vi } from 'vitest';
import worker from './index';
import type { Env } from './types';

function createTestEnv(): Env {
	return {
		AUTHORIZED_ORIGINS: 'https://ndle.app',
	} as Env;
}

function createTestCtx(): ExecutionContext {
	return {
		waitUntil: vi.fn(),
		passThroughOnException: vi.fn(),
	} as unknown as ExecutionContext;
}

describe('route method guards and routing', () => {
	it.each([
		['POST', '/file/analytics/archive/user_id=user_123/file.parquet'],
		['PUT', '/file/analytics/archive/user_id=user_123/file.parquet'],
		['DELETE', '/file/analytics/archive/user_id=user_123/file.parquet'],
		['POST', '/health'],
		['PUT', '/health'],
		['DELETE', '/health'],
		['POST', '/favicon?url=https://example.com'],
		['PUT', '/favicon?url=https://example.com'],
		['DELETE', '/favicon?url=https://example.com'],
	])('rejects %s %s with 405 before route work', async (method, path) => {
		const request = new Request(`https://proxy.test${path}`, {
			method,
			headers: {
				Origin: 'https://ndle.app',
			},
		});
		const ctx = createTestCtx();

		const response = await worker.fetch(request, createTestEnv(), ctx);

		expect(response.status).toBe(405);
		expect(await response.json()).toEqual({ error: 'Method not allowed' });
		expect(ctx.waitUntil).not.toHaveBeenCalled();
	});

	it('returns 200 for GET /health', async () => {
		const response = await worker.fetch(
			new Request('https://proxy.test/health', {
				headers: { Origin: 'https://ndle.app' },
			}),
			createTestEnv(),
			createTestCtx(),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: 'ok' });
	});

	it('returns 404 for removed /flag route', async () => {
		const response = await worker.fetch(
			new Request('https://proxy.test/flag?code=us', {
				headers: { Origin: 'https://ndle.app' },
			}),
			createTestEnv(),
			createTestCtx(),
		);

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: 'Not found' });
	});
});
