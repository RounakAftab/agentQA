// Server-side session helpers for route handlers.
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession, verifySession } from '@/lib/sessionToken';

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error('SESSION_SECRET is not set. Add it to .env (see .env.example).');
  return value;
}

// The signed-in user, or null. The database is checked on every call, so disabling or
// deleting a user ends their access immediately instead of when the cookie expires.
export async function getSessionUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token, secret());
  if (!session) return null;
  return db.user.findFirst({
    where: { id: session.uid, deletedAt: null, disabled: false, passwordHash: { not: null } },
  });
}

export async function startSession(userId) {
  (await cookies()).set(SESSION_COOKIE, await signSession(userId, secret()), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}
