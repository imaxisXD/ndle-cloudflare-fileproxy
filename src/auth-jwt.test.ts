import { env } from 'cloudflare:workers';
import { afterEach, expect, it, vi } from 'vitest';
import { authenticateRequest } from './auth';
import type { Env } from './types';

function base64(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes));
}
function base64Url(bytes: Uint8Array): string {
	return base64(bytes)
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

afterEach(() => vi.restoreAllMocks());

it('verifies a real signed Convex-template JWT before querying the account, and rejects a forged signature', async () => {
	const keys = await crypto.subtle.generateKey(
		{
			name: 'RSASSA-PKCS1-v1_5',
			modulusLength: 2048,
			publicExponent: new Uint8Array([1, 0, 1]),
			hash: 'SHA-256',
		},
		true,
		['sign', 'verify'],
	);
	if (!('publicKey' in keys)) throw new Error('Expected an RSA key pair');
	const publicKey = await crypto.subtle.exportKey('spki', keys.publicKey);
	if (!(publicKey instanceof ArrayBuffer))
		throw new Error('Expected a binary public key');
	const now = Math.floor(Date.now() / 1000);
	const encode = (value: unknown) =>
		base64Url(new TextEncoder().encode(JSON.stringify(value)));
	const unsigned = `${encode({ alg: 'RS256', typ: 'JWT', kid: 'local-test-key' })}.${encode(
		{
			sub: 'user_test',
			aud: 'convex',
			iss: 'https://clerk.example.test',
			azp: 'https://ndle.app',
			iat: now - 1,
			nbf: now - 1,
			exp: now + 60,
		},
	)}`;
	const signature = base64Url(
		new Uint8Array(
			await crypto.subtle.sign(
				'RSASSA-PKCS1-v1_5',
				keys.privateKey,
				new TextEncoder().encode(unsigned),
			),
		),
	);
	const token = `${unsigned}.${signature}`;
	const config: Env = {
		...env,
		AUTHORIZED_ORIGINS: 'https://ndle.app',
		CONVEX_URL: 'https://convex.test',
		CLERK_SECRET_KEY: 'sk_test_local_only',
		CLERK_PUBLISHABLE_KEY: `pk_test_${btoa('clerk.example.test$')}`,
		CLERK_JWT_KEY: `-----BEGIN PUBLIC KEY-----\n${base64(new Uint8Array(publicKey))}\n-----END PUBLIC KEY-----`,
		FILE_ACCESS_ENDPOINT: 'https://access.test/internal/archive-access',
		FILE_ACCESS_SECRET: 'local-only',
	};
	const accountQuery = vi
		.spyOn(globalThis, 'fetch')
		.mockImplementation(async (url) => {
			expect(String(url)).toBe('https://convex.test/api/query');
			return Response.json({
				status: 'success',
				value: { isSignedIn: true, userId: 'actual-account' },
			});
		});
	const request = (value: string) =>
		new Request('https://proxy.test/file/test', {
			headers: { Authorization: `Bearer ${value}`, Origin: 'https://ndle.app' },
		});
	expect(
		await authenticateRequest(request(token), config, 'real-jwt'),
	).toMatchObject({
		success: true,
		clerkUserId: 'user_test',
		internalUserId: 'actual-account',
	});
	expect(accountQuery).toHaveBeenCalledTimes(1);
	accountQuery.mockClear();
	const forged = `${unsigned}.${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
	expect(
		await authenticateRequest(request(forged), config, 'forged-jwt'),
	).toMatchObject({ success: false, status: 401 });
	expect(accountQuery).not.toHaveBeenCalled();
});
