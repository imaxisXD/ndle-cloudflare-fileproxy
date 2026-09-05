import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticateRequest } from './auth';
import type { Env } from './types';

const identity = vi.hoisted(() => ({
	signedIn: true,
	userId: 'user_test',
	claims: {} as Record<string, unknown>,
}));
vi.mock('@clerk/backend', () => ({
	createClerkClient: () => ({
		authenticateRequest: async () => ({
			isSignedIn: identity.signedIn,
			toAuth: () => ({
				userId: identity.userId,
				sessionClaims: identity.claims,
			}),
		}),
	}),
}));

const config: Env = {
	...env,
	AUTHORIZED_ORIGINS: 'https://ndle.app',
	CONVEX_URL: 'https://convex.test',
	CLERK_SECRET_KEY: 'test-only',
	CLERK_PUBLISHABLE_KEY: 'test-only',
	FILE_ACCESS_ENDPOINT: 'https://access.test/internal/archive-access',
	FILE_ACCESS_SECRET: 'test-only',
};
const request = () =>
	new Request('https://proxy.test/file/test', {
		headers: {
			Authorization: 'Bearer verified-convex-token',
			Origin: 'https://ndle.app',
			'X-User-Id': 'forged-account',
		},
	});

beforeEach(() => {
	identity.signedIn = true;
	identity.userId = 'user_test';
	identity.claims = {};
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(
		Response.json({
			status: 'success',
			value: { isSignedIn: true, userId: 'actual-account' },
		}),
	);
});
afterEach(() => vi.restoreAllMocks());

describe('verified account lookup for fresh sessions', () => {
	it('uses the authenticated Convex viewer when metadata is missing', async () => {
		expect(await authenticateRequest(request(), config, 'test')).toMatchObject({
			success: true,
			clerkUserId: 'user_test',
			internalUserId: 'actual-account',
		});
		const [url, options] = vi.mocked(fetch).mock.calls[0];
		expect(String(url)).toBe('https://convex.test/api/query');
		expect(options?.headers).toEqual({
			Authorization: 'Bearer verified-convex-token',
			'Content-Type': 'application/json',
		});
		expect(JSON.parse(String(options?.body))).toEqual({
			path: 'users:getViewerState',
			args: {},
			format: 'json',
		});
		expect(options?.cache).toBe('no-store');
	});
	it('does not contact Convex before Clerk verifies the token', async () => {
		identity.signedIn = false;
		expect(await authenticateRequest(request(), config, 'test')).toMatchObject({
			success: false,
			status: 401,
		});
		expect(fetch).not.toHaveBeenCalled();
	});
	it('keeps the verified metadata path without an additional account request', async () => {
		identity.claims = { convex_user_id: 'metadata-account' };
		expect(await authenticateRequest(request(), config, 'test')).toMatchObject({
			success: true,
			internalUserId: 'metadata-account',
		});
		expect(fetch).not.toHaveBeenCalled();
	});
	it.each([
		{
			status: 'success',
			value: { isSignedIn: false, userId: 'forged-account' },
		},
		{ status: 'success', value: { isSignedIn: true } },
		{ status: 'error', errorMessage: 'unavailable' },
	])('denies an incomplete account response', async (body) => {
		vi.mocked(fetch).mockResolvedValue(Response.json(body));
		expect(await authenticateRequest(request(), config, 'test')).toMatchObject({
			success: false,
			status: 503,
		});
	});
	it('returns retryable failure when Convex is unavailable or not configured', async () => {
		vi.mocked(fetch).mockRejectedValue(new Error('Connection failed'));
		expect(await authenticateRequest(request(), config, 'test')).toMatchObject({
			success: false,
			status: 503,
		});
		vi.mocked(fetch).mockClear();
		expect(
			await authenticateRequest(
				request(),
				{ ...config, CONVEX_URL: '' },
				'test',
			),
		).toMatchObject({ success: false, status: 503 });
		expect(fetch).not.toHaveBeenCalled();
	});
});
