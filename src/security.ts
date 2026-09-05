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

	// Both formats still require an exact grant from the ingest service on every read.
	const isArchive =
		/^(?:analytics\/)?archive\/user_id=[^/]+\/.+\.parquet$/.test(fileKey);
	const isExport =
		/^exports\/account=[^/]+\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.parquet$/i.test(
			fileKey,
		);
	if (!isArchive && !isExport) {
		return 'Invalid file path prefix';
	}

	return null; // Valid
}
