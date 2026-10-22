import { json } from '@/lib/apiHelpers';
import { endSession } from '@/lib/session';

export async function POST() {
  await endSession();
  return json({ ok: true });
}
