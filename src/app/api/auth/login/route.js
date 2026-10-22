import { db } from '@/lib/db';
import { json, readJson, publicUser, recordAudit } from '@/lib/apiHelpers';
import { hashPassword, verifyPassword } from '@/lib/password';
import { startSession } from '@/lib/session';
import { checkLimit, clearFailures, recordFailure } from '@/lib/rateLimit';

// Verified against when the account doesn't exist, so response time doesn't reveal it.
let dummyHash;

export async function POST(request) {
  const body = await readJson(request);
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');

  if (!email || !password) return json({ error: 'Enter your email and password' }, 400);

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local';
  const limiterKey = `${ip}|${email}`;
  const limit = await checkLimit(limiterKey);
  if (!limit.allowed) {
    return json(
      { error: `Too many failed attempts. Try again in ${Math.ceil(limit.retryAfterSec / 60)} minute(s).` },
      429,
      { 'Retry-After': String(limit.retryAfterSec) }
    );
  }

  const user = await db.user.findUnique({ where: { email } });
  const usable = Boolean(user && !user.deletedAt && !user.disabled && user.passwordHash);
  dummyHash ??= await hashPassword('not-a-real-password');
  const matches = await verifyPassword(password, usable ? user.passwordHash : dummyHash);

  // One message for every failure (unknown email, wrong password, disabled, not yet activated).
  if (!usable || !matches) {
    await recordFailure(limiterKey);
    return json({ error: 'Invalid email or password' }, 401);
  }

  await clearFailures(limiterKey);
  const updated = await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await startSession(user.id);
  await recordAudit({ userId: user.id, action: 'user.login', target: user.name, details: 'Signed in with email and password' });
  return json({ user: publicUser(updated) });
}
