// Password hashing with scrypt from Node's standard library (no extra dependency).
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const N = 16384;
const R = 8;
const P = 1;
const KEY_LEN = 64;

function derive(password, salt) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LEN, { N, r: R, p: P }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored ?? '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const expected = Buffer.from(parts[5], 'base64');
  const actual = await derive(password, Buffer.from(parts[4], 'base64'));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
