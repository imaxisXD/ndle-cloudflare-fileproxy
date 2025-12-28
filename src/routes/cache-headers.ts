/**
 * Cache header utilities for public proxy routes
 *
 * Provides preset cache configurations for different content types:
 * - Static: Long-term caching for immutable content (flags, fonts)
 * - Dynamic: Shorter caching with stale-while-revalidate (favicons)
 * - Error: Short-term caching for error responses
 */

/**
 * Cache preset for static, immutable assets (flags, etc.)
 * These assets never change, so cache aggressively
 */
export const STATIC_CACHE_HEADERS: Record<string, string> = {
	// Browser cache for 1 year
	'Cache-Control': 'public, max-age=31536000, immutable',
	// Cloudflare edge cache for 1 year
	'Cloudflare-CDN-Cache-Control': 'public, max-age=31536000, immutable',
	// Other CDNs cache for 1 year
	'CDN-Cache-Control': 'public, max-age=31536000, immutable',
};

/**
 * Cache preset for dynamic content that rarely changes (favicons)
 * Uses stale-while-revalidate for fast responses while checking freshness
 */
export const DYNAMIC_CACHE_HEADERS: Record<string, string> = {
	// Browser cache for 30 days, allow stale for 24 hours while revalidating
	'Cache-Control': 'public, max-age=2592000, stale-while-revalidate=86400',
	// Cloudflare edge cache for 60 days
	'Cloudflare-CDN-Cache-Control': 'public, max-age=5184000, stale-while-revalidate=2592000',
	// Other CDNs cache for 45 days
	'CDN-Cache-Control': 'public, max-age=3888000, stale-while-revalidate=1728000',
	Vary: 'Accept-Encoding',
};

/**
 * Cache preset for error responses
 * Cache briefly to prevent hammering origin on errors
 */
export const ERROR_CACHE_HEADERS: Record<string, string> = {
	// Browser cache for 1 hour
	'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
	// Cloudflare edge cache for 6 hours
	'Cloudflare-CDN-Cache-Control': 'public, max-age=21600, stale-while-revalidate=86400',
	// Other CDNs cache for 3 hours
	'CDN-Cache-Control': 'public, max-age=10800, stale-while-revalidate=86400',
	Vary: 'Accept-Encoding',
};

/**
 * Cache preset for no-cache responses
 */
export const NO_CACHE_HEADERS: Record<string, string> = {
	'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
	'Cloudflare-CDN-Cache-Control': 'no-store, no-cache, must-revalidate',
	Pragma: 'no-cache',
	Expires: '0',
};
