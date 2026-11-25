/**
 * Structured JSON logging utilities
 */

type LogLevel = 'info' | 'warn' | 'error';

export interface LogFields {
	request_id?: string;
	[key: string]: unknown;
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function emit(level: LogLevel, message: string, fields?: LogFields): void {
	const entry: Record<string, unknown> = { level, message };
	if (fields) {
		for (const [key, value] of Object.entries(fields)) {
			if (value !== undefined) {
				entry[key] = key === 'error' ? formatError(value) : value;
			}
		}
	}
	const payload = JSON.stringify(entry);
	if (level === 'error') {
		console.error(payload);
	} else if (level === 'warn') {
		console.warn(payload);
	} else {
		console.info(payload);
	}
}

export const log = {
	info: (message: string, fields?: LogFields): void => emit('info', message, fields),
	warn: (message: string, fields?: LogFields): void => emit('warn', message, fields),
	error: (message: string, fields?: LogFields): void => emit('error', message, fields),
};
