import { describe, expect, it } from "vitest";
import { extractUserIdFromKey, validateFileAccess } from "./security";

describe("file owner checks", () => {
	it("extracts plain user ids from file keys", () => {
		expect(
			extractUserIdFromKey("analytics/archive/user_id=user_123/file.parquet"),
		).toBe("user_123");
	});

	it("decodes encoded user ids from file keys", () => {
		expect(
			extractUserIdFromKey(
				"analytics/archive/user_id=user%3Auser_123/file.parquet",
			),
		).toBe("user:user_123");
	});

	it("allows files owned by the exact internal user id", () => {
		expect(
			validateFileAccess(
				"analytics/archive/user_id=user_123/file.parquet",
				"user_123",
			),
		).toBeNull();
	});

	it("allows files owned by the user-prefixed internal user id", () => {
		expect(
			validateFileAccess(
				"analytics/archive/user_id=user%3Auser_123/file.parquet",
				"user_123",
			),
		).toBeNull();
	});

	it("blocks files owned by another user", () => {
		expect(
			validateFileAccess(
				"analytics/archive/user_id=user%3Auser_999/file.parquet",
				"user_123",
			),
		).toContain("attempted to access file owned by user:user_999");
	});
});
