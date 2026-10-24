import { db } from '@/lib/db';
import { json, readJson, recordAudit, requireUser } from '@/lib/apiHelpers';
import { getApproval } from '@/lib/approvals';
import { APPROVAL_STATUSES, APPROVER_ROLES, REASON_REQUIRED, canTransition } from '@/lib/approvalRules';
import { ROLE_LABEL } from '@/lib/roles';

export async function GET(_request, ctx) {
  const { response } = await requireUser();
  if (response) return response;
  const approval = await getApproval((await ctx.params).id);
  return approval ? json({ approval }) : json({ error: 'Approval not found' }, 404);
}

// Records a decision: { status, comment? }. Only the moves in approvalRules.js are allowed,
// and only from the status the reviewer was looking at, so two reviewers can't both decide.
export async function PATCH(request, ctx) {
  const { user, response } = await requireUser();
  if (response) return response;
  if (!APPROVER_ROLES.includes(ROLE_LABEL[user.role])) {
    return json({ error: 'Only administrators and QA leads can approve, reject or request changes' }, 403);
  }

  const { id } = await ctx.params;
  const body = await readJson(request);
  const next = String(body.status ?? '');
  const comment = String(body.comment ?? '').trim().slice(0, 4000);
  if (!APPROVAL_STATUSES.includes(next)) return json({ error: 'Unknown status' }, 400);
  if (REASON_REQUIRED.includes(next) && !comment) {
    return json({ error: 'Say what needs to change so the author can act on it' }, 400);
  }

  const current = await db.approval.findUnique({ where: { id }, select: { status: true, projectId: true, testCaseId: true, title: true } });
  if (!current) return json({ error: 'Approval not found' }, 404);
  const from = current.status.toLowerCase();
  if (!canTransition(from, next)) return json({ error: `A ${from.replace('_', ' ')} item cannot move to ${next.replace('_', ' ')}` }, 409);

  const reopening = next === 'pending';
  const status = next.toUpperCase();
  const { count } = await db.$transaction(async (tx) => {
    const result = await tx.approval.updateMany({
      where: { id, status: current.status },
      data: { status, approvedById: reopening ? null : user.id, decidedAt: reopening ? null : new Date() },
    });
    if (result.count === 0) return result;
    if (comment) await tx.comment.create({ data: { approvalId: id, userId: user.id, text: comment } });
    if (current.testCaseId) await tx.testCase.update({ where: { id: current.testCaseId }, data: { status } });
    return result;
  });
  if (count === 0) return json({ error: 'Someone else changed this item. Reload to see its current status.', approval: await getApproval(id) }, 409);

  await recordAudit({
    userId: user.id,
    projectId: current.projectId,
    action: `approval.${reopening ? 'reopened' : next}`,
    target: current.title,
    details: comment || `${from} → ${next}`,
  });
  return json({ approval: await getApproval(id) });
}
