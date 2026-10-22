// Failed-login lockout, stored in the database so it holds across serverless instances
// and restarts. After MAX_FAILURES wrong attempts a key is blocked until the window ends.
import { db } from '@/lib/db';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

export async function checkLimit(key) {
  const entry = await db.rateLimit.findUnique({ where: { key } });
  if (!entry || entry.resetAt <= new Date() || entry.count < MAX_FAILURES) return { allowed: true };
  return { allowed: false, retryAfterSec: Math.ceil((entry.resetAt.getTime() - Date.now()) / 1000) };
}

export async function recordFailure(key) {
  const now = new Date();
  const entry = await db.rateLimit.findUnique({ where: { key } });
  const resetAt = new Date(now.getTime() + WINDOW_MS);

  if (!entry || entry.resetAt <= now) {
    await db.rateLimit.upsert({
      where: { key },
      create: { key, count: 1, resetAt },
      update: { count: 1, resetAt },
    });
  } else {
    await db.rateLimit.update({ where: { key }, data: { count: { increment: 1 } } });
  }

  // Housekeeping: drop expired counters so the table stays small.
  await db.rateLimit.deleteMany({ where: { resetAt: { lt: now } } });
}

export async function clearFailures(key) {
  await db.rateLimit.deleteMany({ where: { key } });
}
