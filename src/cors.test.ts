import { describe, expect, it } from "vitest";
import {
	addCorsHeaders,
	createPreflightResponse,
	getCorsHeaders,
	isOriginAllowed,
} from "./cors";

const allowedOrigins = "https://ndle.app,https://www.ndle.app";

describe("CORS origin checks", () => {
	it("allows configured origins", () => {
		expect(isOriginAllowed("https://ndle.app", allowedOrigins)).toBe(true);
		expect(isOriginAllowed("https://www.ndle.app", allowedOrigins)).toBe(true);
	});

	it("blocks origins that are not configured", () => {
		expect(isOriginAllowed("https://bad.example", allowedOrigins)).toBe(false);
	});

	it("sets the allowed origin and Vary header", () => {
		const headers = getCorsHeaders("https://ndle.app", allowedOrigins);

		expect(headers["Access-Control-Allow-Origin"]).toBe("https://ndle.app");
		expect(headers.Vary).toBe("Origin");
	});

	it("does not set Access-Control-Allow-Origin for blocked origins", () => {
		const headers = getCorsHeaders("https://bad.example", allowedOrigins);

		expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
	});

	it("removes stale origin CORS headers before adding current headers", () => {
		const headers = new Headers({
			"Access-Control-Allow-Origin": "https://old.example",
			Vary: "Accept-Encoding, Origin",
		});

		addCorsHeaders(headers, "https://bad.example", allowedOrigins);

		expect(headers.get("Access-Control-Allow-Origin")).toBeNull();
		expect(headers.get("Vary")).toBe("Accept-Encoding");
	});

	it("preserves existing Vary values when adding Origin", () => {
		const headers = new Headers({
			Vary: "Accept-Encoding",
		});

		addCorsHeaders(headers, "https://ndle.app", allowedOrigins);

		expect(headers.get("Vary")).toBe("Accept-Encoding, Origin");
	});

	it("returns 403 for blocked preflight requests", () => {
		const response = createPreflightResponse(
			"https://bad.example",
			allowedOrigins,
		);

		expect(response.status).toBe(403);
	});

	it("echoes requested headers for allowed preflight requests", () => {
		const request = new Request("https://proxy.test/file/test", {
			method: "OPTIONS",
			headers: {
				"Access-Control-Request-Headers": "Authorization, Range",
			},
		});
		const response = createPreflightResponse(
			"https://ndle.app",
			allowedOrigins,
			request,
		);

		expect(response.status).toBe(204);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
			"https://ndle.app",
		);
		expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
			"Authorization, Range",
		);
	});
});
