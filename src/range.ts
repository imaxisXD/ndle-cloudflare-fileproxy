import { MAX_RANGE_SIZE_BYTES, MAX_SUFFIX_SIZE_BYTES } from './config';
import type { ParsedRange } from './types';

export function parseRangeHeader(header: string | null): ParsedRange {
	if (!header) return { range: undefined };
	const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (!match || (!match[1] && !match[2]))
		return {
			range: undefined,
			error: 'Use one byte range, such as bytes=0-1023',
		};
	const start = match[1] ? Number(match[1]) : undefined;
	const end = match[2] ? Number(match[2]) : undefined;
	if (
		[start, end].some(
			(value) =>
				value !== undefined && (!Number.isSafeInteger(value) || value < 0),
		)
	) {
		return {
			range: undefined,
			error: 'The byte range contains an invalid number',
		};
	}
	if (start !== undefined && end !== undefined) {
		const length = end - start + 1;
		if (length <= 0)
			return {
				range: undefined,
				error: 'The byte range ends before it starts',
			};
		if (length > MAX_RANGE_SIZE_BYTES)
			return {
				range: undefined,
				error: 'Request a file part of 50 MB or less',
			};
		return { range: { offset: start, length } };
	}
	if (start !== undefined) return { range: { offset: start } };
	if (!end || end > MAX_SUFFIX_SIZE_BYTES)
		return {
			range: undefined,
			error: 'Request a file suffix between 1 byte and 10 MB',
		};
	return { range: { suffix: end } };
}

/** Resolve suffix/open-ended ranges against metadata before fetching bytes. */
export function resolveFileRange(
	range: R2Range,
	size: number,
): { offset: number; length: number } | null {
	if (size <= 0) return null;
	if ('suffix' in range) {
		const length = Math.min(range.suffix, size);
		return { offset: size - length, length };
	}
	const offset = range.offset ?? 0;
	if (offset >= size) return null;
	const length = Math.min(range.length ?? size - offset, size - offset);
	return { offset, length };
}

export function buildContentRangeHeader(
	range: R2Range | undefined,
	totalSize: number,
): string | null {
	if (
		!range ||
		!('offset' in range) ||
		typeof range.offset !== 'number' ||
		!('length' in range) ||
		typeof range.length !== 'number'
	)
		return null;
	return `bytes ${range.offset}-${range.offset + range.length - 1}/${totalSize}`;
}
