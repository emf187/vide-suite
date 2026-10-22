import { describe, expect, it } from "vitest";
import {
  createSessionToken,
  verifySessionToken,
} from "@/server/auth/session";
import { hashPassword, verifyPassword } from "@/server/auth/password";

describe("password hashing (scrypt)", () => {
  it("round-trips a correct password", async () => {
    const stored = await hashPassword("s3cret-pass-ω");
    expect(await verifyPassword("s3cret-pass-ω", stored)).toBe(true);
  });

  it("rejects a wrong password, malformed envelopes and tampering", async () => {
    const stored = await hashPassword("correct-password");
    expect(await verifyPassword("wrong-password", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
    expect(await verifyPassword("correct-password", "not-a-valid-envelope")).toBe(false);
    expect(await verifyPassword("correct-password", stored.replace("$", "%"))).toBe(false);
    expect(await verifyPassword("correct-password", "bcrypt$abc$def")).toBe(false);
  });
});

describe("session tokens", () => {
  it("signs and verifies a valid token", async () => {
    const token = await createSessionToken("user-123");
    const payload = await verifySessionToken(token);
    expect(payload).toEqual({ sub: "user-123" });
  });

  it("rejects tampered and expired tokens", async () => {
    const token = await createSessionToken("user-123");
    const tampered = `${token.slice(0, -3)}aaa`;
    expect(await verifySessionToken(tampered)).toBeNull();
    expect(await verifySessionToken("not-a-jwt")).toBeNull();

    const expired = await createSessionToken("user-123", -60);
    expect(await verifySessionToken(expired)).toBeNull();
  });

  it("tokens are not interchangeable across users", async () => {
    const a = await createSessionToken("user-a");
    const b = await createSessionToken("user-b");
    expect(await verifySessionToken(a)).toEqual({ sub: "user-a" });
    expect(await verifySessionToken(b)).toEqual({ sub: "user-b" });
  });
});
