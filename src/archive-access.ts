import type { Env } from './types';

/** The ingest manifest owns archive grants, including claimed guest aliases. */
export async function hasArchiveAccess(
	fileKey: string,
	userId: string,
	env: Env,
): Promise<boolean> {
	if (!env.FILE_ACCESS_ENDPOINT || !env.FILE_ACCESS_SECRET) {
		throw new Error('Archive access settings are missing');
	}
	const url = new URL(env.FILE_ACCESS_ENDPOINT);
	url.searchParams.set('user_id', userId);
	url.searchParams.set('key', fileKey);
	const response = await fetch(url, {
		headers: { Authorization: `Bearer ${env.FILE_ACCESS_SECRET}` },
		signal: AbortSignal.timeout(5000),
	});
	if (!response.ok) {
		await response.body?.cancel();
		throw new Error(
			`Archive access check failed with status ${response.status}`,
		);
	}
	const result: unknown = await response.json();
	if (
		typeof result !== 'object' ||
		result === null ||
		!('allowed' in result) ||
		typeof result.allowed !== 'boolean'
	) {
		throw new Error('Archive access check returned an invalid result');
	}
	return result.allowed;
}
