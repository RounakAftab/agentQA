import { db } from '@/lib/db';
import { json } from '@/lib/apiHelpers';

// For uptime monitors and deploy checks. Public on purpose; it reveals nothing but up/down.
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return json({ status: 'ok' });
  } catch {
    return json({ status: 'database unavailable' }, 503);
  }
}
