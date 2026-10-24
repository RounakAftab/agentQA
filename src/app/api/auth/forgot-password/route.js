import { db } from '@/lib/db';
import { json, readJson, recordAudit } from '@/lib/apiHelpers';
import { issuePasswordReset } from '@/lib/invites';
import { checkLimit, recordFailure } from '@/lib/rateLimit';

// The same answer whether or not the account exists, so this can't be used to find emails.
const SENT = { ok: true, message: 'If that email belongs to an account, a reset link is on its way. Check your inbox.' };

export async function POST(request) {
  const body = await readJson(request);
  const email = String(body.email ?? '').trim().toLowerCase();
  if (!email || !email.includes('@')) return json({ error: 'Enter your email address' }, 400);

  // Every request counts, so one address or one visitor can't trigger a flood of emails.
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local';
  const keys = [`reset|${email}`, `reset-ip|${ip}`];
  for (const key of keys) {
    const limit = await checkLimit(key);
    if (!limit.allowed) {
      return json(
        { error: `Too many reset requests. Try again in ${Math.ceil(limit.retryAfterSec / 60)} minute(s).` },
        429,
        { 'Retry-After': String(limit.retryAfterSec) }
      );
    }
  }
  for (const key of keys) await recordFailure(key);

  const user = await db.user.findUnique({ where: { email } });
  if (!user || user.deletedAt || user.disabled) return json(SENT);

  try {
    await issuePasswordReset(user, { origin: new URL(request.url).origin });
  } catch (err) {
    // Still the usual answer: a different one would reveal that the account exists.
    console.error('[forgot-password] could not send the reset email', err);
    return json(SENT);
  }

  await recordAudit({ userId: user.id, action: 'user.password_reset_requested', target: user.name, details: 'Asked for a password reset link' });
  return json(SENT);
}
