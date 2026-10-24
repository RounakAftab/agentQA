import { db } from '@/lib/db';
import { json, readJson, recordAudit } from '@/lib/apiHelpers';
import { hashToken } from '@/lib/invites';
import { hashPassword } from '@/lib/password';
import { validatePassword } from '@/lib/validation';

async function findValidToken(token) {
  if (!token || typeof token !== 'string') return null;
  const record = await db.passwordToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!record || record.usedAt || record.expiresAt < new Date() || record.user.deletedAt) return null;
  return record;
}

// Lets the set-password page check the link before showing the form.
export async function GET(request) {
  const record = await findValidToken(new URL(request.url).searchParams.get('token'));
  if (!record) return json({ valid: false });
  return json({ valid: true, name: record.user.name, email: record.user.email, purpose: record.purpose });
}

export async function POST(request) {
  const body = await readJson(request);
  const record = await findValidToken(body.token);
  if (!record) {
    return json({ error: 'This link is invalid or has expired. Use "Forgot password?" on the sign-in page to get a new one.' }, 400);
  }

  const password = validatePassword(body.password);
  if (password.error) return json({ error: password.error, field: 'password' }, 400);

  const passwordHash = await hashPassword(password.value);
  await db.$transaction([
    db.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    db.passwordToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    db.passwordToken.deleteMany({ where: { userId: record.userId, usedAt: null } }),
  ]);

  const isReset = record.purpose === 'reset';
  await recordAudit({
    userId: record.userId,
    action: isReset ? 'user.password_reset' : 'user.password_set',
    target: record.user.name,
    details: isReset ? 'Reset their password with an emailed link' : 'Accepted the invitation and set a password',
  });

  // Deliberately no auto sign-in: the user signs in with the password they just chose.
  return json({ ok: true });
}
