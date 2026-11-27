import { hashPassword, verifyPassword } from "../src/auth/password";

describe("password hashing (scrypt)", () => {
  it("verifies the right password and refuses a wrong one", async () => {
    const stored = await hashPassword("paolo-test-2026");
    expect(stored).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    await expect(verifyPassword("paolo-test-2026", stored)).resolves.toBe(true);
    await expect(verifyPassword("paolo-test-2027", stored)).resolves.toBe(false);
  });

  it("salts every hash, so the same password never hashes the same way twice", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("treats a malformed or placeholder hash as a failed check, never an error", async () => {
    await expect(verifyPassword("x", "unset")).resolves.toBe(false);
    await expect(verifyPassword("x", "scrypt$16384$8$1$c2FsdA==$c2hvcnQ=")).resolves.toBe(false);
    await expect(verifyPassword("x", "bcrypt$1$2$3$4$5")).resolves.toBe(false);
    const key = Buffer.alloc(32, 1).toString("base64");
    await expect(verifyPassword("x", `scrypt$abc$8$1$c2FsdA==$${key}`)).resolves.toBe(false);
    await expect(verifyPassword("x", `scrypt$1000$8$1$c2FsdA==$${key}`)).resolves.toBe(false);
  });
});
