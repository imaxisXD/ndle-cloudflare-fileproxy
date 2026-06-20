import { describe, expect, it, vi } from "vitest";
import worker from "./index";
import type { Env } from "./types";

describe("file route method guard", () => {
	it("rejects non-GET and non-HEAD file requests before auth or R2 work", async () => {
		const request = new Request(
			"https://proxy.test/file/analytics/archive/user_id=user_123/file.parquet",
			{
				method: "POST",
				headers: {
					Origin: "https://ndle.app",
				},
			},
		);
		const env = {
			AUTHORIZED_ORIGINS: "https://ndle.app",
		} as Env;
		const ctx = {
			waitUntil: vi.fn(),
			passThroughOnException: vi.fn(),
		} as unknown as ExecutionContext;

		const response = await worker.fetch(request, env, ctx);

		expect(response.status).toBe(405);
		expect(await response.json()).toEqual({ error: "Method not allowed" });
		expect(ctx.waitUntil).not.toHaveBeenCalled();
	});
});
