/**
 * Configuration constants for the Worker
 */

// Maximum range size in bytes (50MB)
export const MAX_RANGE_SIZE_BYTES = 50 * 1024 * 1024;

// Maximum suffix size in bytes (10MB)
export const MAX_SUFFIX_SIZE_BYTES = 10 * 1024 * 1024;

// Cache max age in seconds (5 seconds - analytics data needs to be fresh)
export const CACHE_MAX_AGE_SECONDS = 5;
