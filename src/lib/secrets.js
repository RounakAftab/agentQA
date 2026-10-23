// Encryption for secrets stored in the database (Jira API tokens, test-account passwords).
// AES-256-GCM with a key derived from ENCRYPTION_KEY, or from SESSION_SECRET when that is not set.
// Server-only. Changing the key makes stored secrets unreadable; they must then be re-entered.
import crypto from 'node:crypto';

function key() {
  const source = process.env.ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!source) throw new Error('Set ENCRYPTION_KEY (or SESSION_SECRET) to store secrets.');
  return crypto.createHash('sha256').update(`agentqa-secrets:${source}`).digest();
}

export function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join(':');
}

// Returns null for an empty value. Throws if the value was encrypted with a different key.
export function decryptSecret(stored) {
  if (!stored) return null;
  const [version, iv, tag, data] = stored.split(':');
  if (version !== 'v1' || !data) throw new Error('Stored secret has an unknown format');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('A stored secret could not be decrypted (was ENCRYPTION_KEY or SESSION_SECRET changed?). Re-enter it in the project settings.');
  }
}
