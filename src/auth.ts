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
	status: 401 | 500;
}

export type AuthResponse = AuthResult | AuthError;

/**
 * Authenticate request using Clerk JWT and extract internal user ID from header
 * Uses networkless verification when CLERK_JWT_KEY is provided
 *
 * Security model:
 * - Clerk JWT proves the user is authenticated
 * - Internal user ID from header identifies which user's files to access
 * - The frontend is trusted to pass the correct internal user ID for the authenticated user
 */
export async function authenticateRequest(request: Request, env: Env, requestId: string): Promise<AuthResponse> {
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

	// Check for internal user ID header
	const internalUserId = request.headers.get('X-Internal-User-Id');
	if (!internalUserId) {
		log.warn(requestId, 'Missing X-Internal-User-Id header');
		return {
			success: false,
			error: 'Unauthorized - Missing internal user ID',
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
	const authorizedParties = env.AUTHORIZED_ORIGINS ? env.AUTHORIZED_ORIGINS.split(',').map((o) => o.trim()) : [];

	// Log auth mode
	const isNetworkless = !!env.CLERK_JWT_KEY;
	log.info(requestId, `🔑 Auth mode: ${isNetworkless ? 'NETWORKLESS (fast)' : 'NETWORK (slower)'}`);

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

		const clerkUserId = authResult.toAuth().userId;
		if (!clerkUserId) {
			log.warn(requestId, 'Authentication failed: No user ID in token');
			return {
				success: false,
				error: 'Unauthorized - Invalid token',
				status: 401,
			};
		}

		const durationMs = performance.now() - authStart;
		log.info(requestId, `✅ Authenticated: Clerk=${clerkUserId} Internal=${internalUserId} (${durationMs.toFixed(2)}ms)`);

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
