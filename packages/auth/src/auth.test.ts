import { describe, expect, it } from "vitest";
import { SecretBox, generateEnvironmentKeys, hashPassword, signPayload, verifyPassword, verifySignature } from "./index";

describe("auth primitives", () => {
  it("hashes and verifies passwords", async () => {
    const h = await hashPassword("correct horse 42");
    expect(await verifyPassword("correct horse 42", h)).toBe(true);
    expect(await verifyPassword("wrong horse 42", h)).toBe(false);
  });

  it("encrypts secrets at rest", () => {
    const box = new SecretBox("test-key");
    const enc = box.encrypt("whsec_abc");
    expect(enc).not.toContain("whsec_abc");
    expect(box.decrypt(enc)).toBe("whsec_abc");
    expect(() => new SecretBox("other-key").decrypt(enc)).toThrow();
  });

  it("signs and verifies payloads with replay protection", () => {
    const body = JSON.stringify({ a: 1 });
    const header = signPayload("s3cret", body, 1000);
    expect(verifySignature("s3cret", body, header, 300, 1100)).toBe(true);
    expect(verifySignature("s3cret", body + " ", header, 300, 1100)).toBe(false);
    expect(verifySignature("other", body, header, 300, 1100)).toBe(false);
    expect(verifySignature("s3cret", body, header, 300, 2000)).toBe(false);
  });

  it("generates environment-scoped keys", () => {
    const dev = generateEnvironmentKeys("development");
    const prod = generateEnvironmentKeys("production");
    expect(dev.publishableKey.startsWith("pk_test_")).toBe(true);
    expect(prod.secretKey.startsWith("sk_live_")).toBe(true);
    expect(prod.secretKeyHash).not.toContain(prod.secretKey);
  });
});
