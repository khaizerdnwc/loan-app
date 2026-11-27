import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const MAXMEM = 64 * 1024 * 1024;

/**
 * Hash a password with scrypt (Node's built-in, memory-hard KDF) and a random 16-byte salt.
 * Stored as `scrypt$N$r$p$<salt b64>$<hash b64>` so the cost can rise later without
 * breaking existing hashes.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH, { N, r: R, p: P, maxmem: MAXMEM });
  return ["scrypt", N, R, P, salt.toString("base64"), hash.toString("base64")].join("$");
}

/** Constant-time check of a password against a stored hash; false for any malformed hash. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const expected = Buffer.from(hashB64, "base64");
  if (expected.length !== KEY_LENGTH) return false;
  try {
    const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: MAXMEM,
    });
    return timingSafeEqual(actual, expected);
  } catch {
    // Cost values scrypt refuses (NaN, an N that is not a power of two): a failed check.
    return false;
  }
}
