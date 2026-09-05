/**
 * Clerk authentication utilities
 */

import { createClerkClient, type ClerkClient } from '@clerk/backend';
import type { Env } from './types';
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
		signal: AbortSignal.timeout(5_000),
		cache: 'no-store',
	});
	if (response.status !== 200)
		throw new Error('Account verification is unavailable');
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
 * Sessions → Customize session token → Add: { "convex_user_id": "{{user.public_metadata.convex_user_id}}" }
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
		log.warn(requestId, 'Missing or invalid Authorization header');
		return {
			success: false,
			error: 'Unauthorized - Missing Bearer token',
			status: 401,
		};
	}

	// Initialize Clerk client
	let clerk: ClerkClient;
	try {
		clerk = createClerkClient({
			secretKey: env.CLERK_SECRET_KEY,
			publishableKey: env.CLERK_PUBLISHABLE_KEY,
		});
	} catch (err) {
		log.error(requestId, 'Failed to initialize Clerk client', err);
		return {
			success: false,
			error: 'Internal server error',
			status: 500,
		};
	}

	// Parse authorized origins
	const authorizedParties = env.AUTHORIZED_ORIGINS
		? env.AUTHORIZED_ORIGINS.split(',').map((o) => o.trim())
		: [];

	// Log auth mode
	const isNetworkless = !!env.CLERK_JWT_KEY;
	log.info(
		requestId,
		`🔑 Auth mode: ${isNetworkless ? 'NETWORKLESS (fast)' : 'NETWORK (slower)'}`,
	);

	// Verify the token
	try {
		const authResult = await clerk.authenticateRequest(request, {
			authorizedParties,
			jwtKey: env.CLERK_JWT_KEY, // Enables networkless verification when provided
		});

		if (!authResult.isSignedIn) {
			log.warn(requestId, 'Authentication failed: Not signed in');
			return {
				success: false,
				error: 'Unauthorized - Invalid token',
				status: 401,
			};
		}

		const auth = authResult.toAuth();
		const clerkUserId = auth.userId;
		if (!clerkUserId) {
			log.warn(requestId, 'Authentication failed: No user ID in token');
			return {
				success: false,
				error: 'Unauthorized - Invalid token',
				status: 401,
			};
		}

		// Extract internal user ID from JWT session claims
		// This is set in Clerk Dashboard: Sessions → Customize session token
		// Template: { "convex_user_id": "{{user.public_metadata.convex_user_id}}" }
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
				log.warn(
					requestId,
					`Account lookup is not ready: ${error instanceof Error ? error.message : 'query failed'}`,
				);
				return {
					success: false,
					error: 'Account verification is not ready. Please try again shortly.',
					status: 503,
				};
			}
		}

		const durationMs = performance.now() - authStart;
		log.info(
			requestId,
			`✅ Authenticated: Clerk=${clerkUserId} Convex=${internalUserId} (${durationMs.toFixed(2)}ms)`,
		);

		return { success: true, clerkUserId, internalUserId, durationMs };
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		log.error(requestId, 'Token verification failed', message);
		return {
			success: false,
			error: 'Unauthorized - Token verification failed',
			status: 401,
		};
	}
}
