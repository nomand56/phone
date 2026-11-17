import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const algorithm = "scrypt-32768-8-3";
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const keyLength = 64;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return [algorithm, salt.toString("hex"), key.toString("hex")].join("$");
}

export async function verifyPassword(password: string, storedHash?: string): Promise<boolean> {
  const [version, saltHex, keyHex, extra] = storedHash?.split("$") ?? [];
  const valid = version === algorithm && /^[a-f0-9]{32}$/.test(saltHex ?? "")
    && /^[a-f0-9]{128}$/.test(keyHex ?? "") && extra === undefined;
  // Spend the same derivation work when the account is absent.
  const salt = valid ? Buffer.from(saltHex, "hex") : Buffer.alloc(16);
  const expected = valid ? Buffer.from(keyHex, "hex") : Buffer.alloc(keyLength);
  const actual = await derive(password, salt);
  return timingSafeEqual(actual, expected) && valid;
}
