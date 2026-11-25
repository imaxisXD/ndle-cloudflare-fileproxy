/**
 * Clerk authentication utilities
 */

import { verifyToken } from '@clerk/backend';
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

function isObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Called only after Clerk has verified this exact token and its authorized origin. */
async function readAccountFromConvex(env: Env, authorization: string): Promise<string> {
	if (!env.CONVEX_URL) throw new Error('Account verification is not configured');
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
			response.status >= 300 && response.status < 400 ? 'Account verification redirect rejected' : 'Account verification is unavailable',
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
 * Authenticate request using Clerk Convex-template JWT and extract internal user ID from claims.
 * Uses networkless verification via `verifyToken` when `CLERK_JWT_KEY` is provided.
 *
 * `verifyToken` is used instead of `authenticateRequest` because Clerk's AISEC-21 hardening
 * restricts `authenticateRequest` to session tokens only, whereas callers send a Clerk
 * `convex` JWT template token (`cat: cl_B7d4PD222AAA`, `aud: 'convex'`).
 *
 * Security model:
 * - Clerk JWT proves the user is authenticated and bound to `aud: 'convex'` + `authorizedParties`
 * - The internal account ID comes from verified claims or Convex's authenticated viewer query
 * - This prevents IDOR attacks since the ID cannot be spoofed via headers
 */
export async function authenticateRequest(request: Request, env: Env, requestId: string): Promise<AuthResponse> {
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

	const bearerToken = authHeader.slice('Bearer '.length).trim();
	if (!bearerToken) {
		log.warn('Missing or invalid Authorization header', {
			request_id: requestId,
		});
		return {
			success: false,
			error: 'Unauthorized - Missing Bearer token',
			status: 401,
		};
	}

	const authorizedParties = parseAuthorizedOrigins(env.AUTHORIZED_ORIGINS);

	// Verify the Convex-template JWT directly
	try {
		const sessionClaims = await verifyToken(bearerToken, {
			authorizedParties,
			audience: 'convex',
			jwtKey: env.CLERK_JWT_KEY,
			secretKey: env.CLERK_SECRET_KEY,
		});

		const clerkUserId = typeof sessionClaims.sub === 'string' ? sessionClaims.sub : '';
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

		// Extract internal user ID from JWT claims
		const claimedUserId = (sessionClaims as Record<string, unknown>).convex_user_id;
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
		log.warn('Authentication failed: Token verification failed', {
			request_id: requestId,
			error: err,
		});
		return {
			success: false,
			error: 'Unauthorized - Invalid token',
			status: 401,
		};
	}
}
