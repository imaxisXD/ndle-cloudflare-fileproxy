/**
 * Clerk authentication utilities
 */

import { createClerkClient, type ClerkClient } from '@clerk/backend';
import type { Env } from './types';
import { parseAuthorizedOrigins } from './cors';
import { log } from './logging';

export interface AuthResult {
	success: true;
	clerkUserId: string;
	internalUserId: string;
	durationMs: number;
}

export interface AuthError {
	success: false;
	error: string;
	status: 401 | 500 | 503;
}

export type AuthResponse = AuthResult | AuthError;

const MAX_CLERK_CLIENTS = 16;
const clerkClientCache = new Map<string, ClerkClient>();

function getClerkClient(env: Env): ClerkClient {
	const cacheKey = `${env.CLERK_SECRET_KEY}\0${env.CLERK_PUBLISHABLE_KEY}`;
	const cached = clerkClientCache.get(cacheKey);
	if (cached) return cached;
	const client = createClerkClient({
		secretKey: env.CLERK_SECRET_KEY,
		publishableKey: env.CLERK_PUBLISHABLE_KEY,
	});
	if (clerkClientCache.size >= MAX_CLERK_CLIENTS) {
		clerkClientCache.clear();
	}
	clerkClientCache.set(cacheKey, client);
	return client;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Called only after Clerk has verified this exact token and its authorized origin. */
async function readAccountFromConvex(
	env: Env,
	authorization: string,
): Promise<string> {
	if (!env.CONVEX_URL)
		throw new Error('Account verification is not configured');
	const response = await fetch(new URL('/api/query', env.CONVEX_URL), {
		method: 'POST',
		headers: {
			Authorization: authorization,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			path: 'users:getViewerState',
			args: {},
			format: 'json',
		}),
		redirect: 'manual',
		signal: AbortSignal.timeout(5_000),
		cache: 'no-store',
	});
	if (response.status !== 200) {
		await response.body?.cancel();
		throw new Error(
			response.status >= 300 && response.status < 400
				? 'Account verification redirect rejected'
				: 'Account verification is unavailable',
		);
	}
	const body: unknown = await response.json();
	if (
		!isObject(body) ||
		body.status !== 'success' ||
		!isObject(body.value) ||
		body.value.isSignedIn !== true ||
		typeof body.value.userId !== 'string' ||
		!body.value.userId.trim()
	) {
		throw new Error('Account setup is not ready');
	}
	return body.value.userId;
}

/**
 * Authenticate request using Clerk JWT and extract internal user ID from session claims.
 * Uses networkless verification when CLERK_JWT_KEY is provided.
 *
 * Security model:
 * - Clerk JWT proves the user is authenticated
 * - The internal account ID comes from verified claims or Convex's authenticated viewer query
 * - This prevents IDOR attacks since the ID cannot be spoofed via headers
 *
 * The JWT session claims must be configured in Clerk Dashboard:
 * Sessions -> Customize session token -> Add: { "convex_user_id": "{{user.public_metadata.convex_user_id}}" }
 */
export async function authenticateRequest(
	request: Request,
	env: Env,
	requestId: string,
): Promise<AuthResponse> {
	const authStart = performance.now();

	// Check for Authorization header
	const authHeader = request.headers.get('Authorization');
	if (!authHeader || !authHeader.startsWith('Bearer ')) {
		log.warn('Missing or invalid Authorization header', {
			request_id: requestId,
		});
		return {
			success: false,
			error: 'Unauthorized - Missing Bearer token',
			status: 401,
		};
	}

	// Initialize or reuse memoized Clerk client
	let clerk: ClerkClient;
	try {
		clerk = getClerkClient(env);
	} catch (err) {
		log.error('Failed to initialize Clerk client', {
			request_id: requestId,
			error: err,
		});
		return {
			success: false,
			error: 'Internal server error',
			status: 500,
		};
	}

	const authorizedParties = parseAuthorizedOrigins(env.AUTHORIZED_ORIGINS);

	// Verify the token
	try {
		const authResult = await clerk.authenticateRequest(request, {
			authorizedParties,
			audience: 'convex',
			jwtKey: env.CLERK_JWT_KEY, // Enables networkless verification when provided
		});

		if (!authResult.isSignedIn) {
			log.warn('Authentication failed: Not signed in', {
				request_id: requestId,
			});
			return {
				success: false,
				error: 'Unauthorized - Invalid token',
				status: 401,
			};
		}

		const auth = authResult.toAuth();
		const clerkUserId = auth.userId;
		if (!clerkUserId) {
			log.warn('Authentication failed: No user ID in token', {
				request_id: requestId,
			});
			return {
				success: false,
				error: 'Unauthorized - Invalid token',
				status: 401,
			};
		}

		// Extract internal user ID from JWT session claims
		const sessionClaims = auth.sessionClaims as
			| Record<string, unknown>
			| undefined;
		const claimedUserId = sessionClaims?.convex_user_id;
		let internalUserId: string;

		if (typeof claimedUserId === 'string' && claimedUserId.trim()) {
			internalUserId = claimedUserId;
		} else {
			try {
				// Fresh sessions can precede metadata delivery. The caller supplies a Convex-template
				// JWT, and Convex resolves its own authenticated identity; no account header is used.
				internalUserId = await readAccountFromConvex(env, authHeader);
			} catch (error) {
				log.warn('Account lookup is not ready', {
					request_id: requestId,
					error,
				});
				return {
					success: false,
					error: 'Account verification is not ready. Please try again shortly.',
					status: 503,
				};
			}
		}

		const durationMs = performance.now() - authStart;
		return { success: true, clerkUserId, internalUserId, durationMs };
	} catch (err: unknown) {
		log.error('Token verification failed', {
			request_id: requestId,
			error: err,
		});
		return {
			success: false,
			error: 'Unauthorized - Token verification failed',
			status: 401,
		};
	}
}
