import { afterEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./secrets";

describe("secret encryption", () => {
  afterEach(() => {
    delete process.env.APP_ENCRYPTION_KEY;
  });

  it("round-trips evaluator credentials with the configured application key", () => {
    process.env.APP_ENCRYPTION_KEY = "test-encryption-key";
    const encrypted = encryptSecret("frontier-api-key");

    expect(encrypted).not.toContain("frontier-api-key");
    expect(decryptSecret(encrypted)).toBe("frontier-api-key");
  });
});
