import { db } from '@/lib/db';
import { json, readJson, requireUser } from '@/lib/apiHelpers';
import { getApproval } from '@/lib/approvals';

// Any signed-in user may leave review feedback; deciding is limited to approvers.
export async function POST(request, ctx) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id } = await ctx.params;
  const text = String((await readJson(request)).text ?? '').trim().slice(0, 4000);
  if (!text) return json({ error: 'Write a comment first' }, 400);
  if (!(await db.approval.findUnique({ where: { id }, select: { id: true } }))) return json({ error: 'Approval not found' }, 404);

  await db.comment.create({ data: { approvalId: id, userId: user.id, text } });
  return json({ approval: await getApproval(id) }, 201);
}
