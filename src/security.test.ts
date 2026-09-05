import { describe, expect, it } from 'vitest';
import { validateFileKey } from './security';

describe('archive path boundary', () => {
	it('accepts current and legacy parquet archive paths without deciding ownership locally', () => {
		expect(
			validateFileKey(
				'archive/user_id=guest%3Aguest123/year=2026/file.parquet',
			),
		).toBeNull();
		expect(
			validateFileKey('analytics/archive/user_id=user123/file.parquet'),
		).toBeNull();
	});
	it('accepts temporary account exports without granting ownership from the path', () => {
		expect(
			validateFileKey(
				'exports/account=account%3A123/0992d025-5a1c-4f31-bbae-fb1aecf882fe.parquet',
			),
		).toBeNull();
	});
	for (const key of [
		'',
		'/archive/user_id=user123/file.parquet',
		'archive/user_id=user123/../file.parquet',
		'archive/user_id=user123/file\0.parquet',
		'analytics/raw/user_id=user123/event.json',
		'archive/user_id=user123/file.json',
		'archive/file.parquet',
		'exports/account=account123/guessed-name.parquet',
		'exports/account=account123/subfolder/0992d025-5a1c-4f31-bbae-fb1aecf882fe.parquet',
		'exports/account=account123/0992d025-5a1c-4f31-bbae-fb1aecf882fe.json',
	]) {
		it(`rejects an unsafe or non-archive key: ${JSON.stringify(key)}`, () => {
			expect(validateFileKey(key)).not.toBeNull();
		});
	}
});
