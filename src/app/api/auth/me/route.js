import { json, publicUser, requireUser } from '@/lib/apiHelpers';

export async function GET() {
  const { user, response } = await requireUser();
  return response ?? json({ user: publicUser(user) });
}
