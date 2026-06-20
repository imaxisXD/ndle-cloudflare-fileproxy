/**
 * Security validation utilities
 */

/**
 * Extract user_id from file key path
 * Expected format: analytics/archive/user_id={userId}/...
 */
export function extractUserIdFromKey(key: string): string | null {
	const match = key.match(/user_id=([^/]+)/);
	if (!match) return null;
	try {
		return decodeURIComponent(match[1]);
	} catch {
		return match[1];
	}
}

/**
 * Validate file key for path traversal and other security issues
 * Returns error message if invalid, null if valid
 */
export function validateFileKey(fileKey: string): string | null {
	// Must not be empty
	if (!fileKey || fileKey.trim() === '') {
		return 'Empty file key';
	}

	// Must not contain path traversal sequences
	if (fileKey.includes('..')) {
		return "Path traversal detected: '..' not allowed";
	}

	// Must not start with / (absolute path)
	if (fileKey.startsWith('/')) {
		return 'Path traversal detected: absolute paths not allowed';
	}

	// Must not contain null bytes
	if (fileKey.includes('\0')) {
		return 'Invalid characters in file key';
	}

	// Must start with expected prefix (support both legacy and new formats)
	if (!fileKey.startsWith('analytics/') && !fileKey.startsWith('archive/')) {
		return 'Invalid file path prefix';
	}

	// Must contain user_id
	if (!fileKey.includes('user_id=')) {
		return 'Missing user_id in file path';
	}

	return null; // Valid
}

/**
 * Validate user has access to the requested file
 * Returns error message if unauthorized, null if authorized
 */
export function validateFileAccess(fileKey: string, userId: string): string | null {
	const fileUserId = extractUserIdFromKey(fileKey);

	if (!fileUserId) {
		return 'Could not extract user_id from file key';
	}

	if (fileUserId !== userId && fileUserId !== `user:${userId}`) {
		return `User ${userId} attempted to access file owned by ${fileUserId}`;
	}

	return null; // Authorized
}
