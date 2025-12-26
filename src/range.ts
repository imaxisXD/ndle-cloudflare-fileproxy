/**
 * Range header parsing utilities
 */

import { MAX_RANGE_SIZE_BYTES, MAX_SUFFIX_SIZE_BYTES } from './config';
import type { ParsedRange } from './types';

/**
 * Parse Range header into R2 range format with validation
 */
export function parseRangeHeader(rangeHeader: string | null): ParsedRange {
	if (!rangeHeader) {
		return { range: undefined };
	}

	const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
	if (!match) {
		return { range: undefined };
	}

	const start = match[1] ? parseInt(match[1], 10) : undefined;
	const end = match[2] ? parseInt(match[2], 10) : undefined;

	// Validate: offset must be non-negative
	if (start !== undefined && start < 0) {
		return { range: undefined, error: 'Invalid range: negative offset' };
	}

	if (start !== undefined && end !== undefined) {
		const length = end - start + 1;

		// Validate: end must be >= start
		if (length <= 0) {
			return { range: undefined, error: 'Invalid range: end before start' };
		}

		// Validate: range size limit
		if (length > MAX_RANGE_SIZE_BYTES) {
			return {
				range: undefined,
				error: `Range too large: ${length} bytes exceeds ${MAX_RANGE_SIZE_BYTES} byte limit`,
			};
		}

		return { range: { offset: start, length } };
	}

	if (start !== undefined) {
		// Open-ended range (start to end of file) - allowed
		return { range: { offset: start } };
	}

	if (end !== undefined) {
		// Suffix range (last N bytes)
		if (end > MAX_SUFFIX_SIZE_BYTES) {
			return {
				range: undefined,
				error: `Suffix range too large: ${end} bytes exceeds ${MAX_SUFFIX_SIZE_BYTES} byte limit`,
			};
		}
		return { range: { suffix: end } };
	}

	return { range: undefined };
}

/**
 * Build Content-Range header value
 */
export function buildContentRangeHeader(r2Range: R2Range | undefined, totalSize: number): string | null {
	if (
		!r2Range ||
		!('offset' in r2Range) ||
		typeof r2Range.offset !== 'number' ||
		!('length' in r2Range) ||
		typeof r2Range.length !== 'number'
	) {
		return null;
	}

	return `bytes ${r2Range.offset}-${r2Range.offset + r2Range.length - 1}/${totalSize}`;
}
