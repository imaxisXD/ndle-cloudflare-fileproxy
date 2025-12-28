/**
 * URL Validation Utilities
 *
 * Provides security-focused URL validation for the favicon proxy route.
 * Blocks private IPs, localhost, and malformed URLs to prevent SSRF attacks.
 */

/** Blocked patterns for SSRF protection */
const BLOCKED_PATTERNS: RegExp[] = [
	/^0\.0\.0\.0$/,
	/^localhost$/i,
	/^127\./,
	/^192\.168\./,
	/^10\./,
	/^172\.(1[6-9]|2[0-9]|3[01])\./,
	/^169\.254\./, // Link-local
	/^::1$/, // IPv6 localhost
	/^fc00:/, // IPv6 private
	/^fe80:/, // IPv6 link-local
];

/**
 * Validates a URL string for safe favicon fetching
 * @returns null if valid, error message if invalid
 */
export function validateUrl(urlString: string): { error: string } | { url: URL; domain: string } {
	// Check if URL is provided
	if (!urlString) {
		return { error: 'URL parameter is required' };
	}

	// Parse URL
	let parsedUrl: URL;
	try {
		parsedUrl = new URL(urlString);
	} catch {
		return { error: 'Invalid URL format' };
	}

	// Validate protocol
	if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
		return { error: 'URL must use HTTP or HTTPS protocol' };
	}

	const domain = parsedUrl.hostname;

	// Check for empty domain
	if (!domain) {
		return { error: 'Could not extract domain from URL' };
	}

	// Block localhost variations
	if (domain === 'localhost' || domain.includes('localhost')) {
		return { error: 'Localhost domains are not allowed' };
	}

	// Block private/internal IP ranges
	for (const pattern of BLOCKED_PATTERNS) {
		if (pattern.test(domain)) {
			return { error: 'Private/internal domains are not allowed' };
		}
	}

	// Basic FQDN validation (must have at least one dot)
	if (!domain.includes('.')) {
		return { error: 'Invalid domain format' };
	}

	return { url: parsedUrl, domain };
}
