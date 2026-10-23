import { db } from '@/lib/db';
import { json, readJson, recordAudit, requireAgentOperator } from '@/lib/apiHelpers';
import { publicRequirement, requirementInclude } from '@/lib/requirements';
import { validateRequirementInput } from '@/lib/validation';
import { ACTIVE_STATUSES } from '@/lib/agentSteps';

async function loadEditable(id) {
  const requirement = await db.requirement.findFirst({ where: { id, source: 'manual' } });
  if (!requirement) return { response: json({ error: 'Requirement not found' }, 404) };
  const active = await db.agentRun.findFirst({ where: { requirementId: id, status: { in: ACTIVE_STATUSES } } });
  if (active) return { response: json({ error: 'A run is in progress for this requirement. Wait for it or cancel it first.' }, 409) };
  return { requirement };
}

export async function PATCH(request, ctx) {
  const { user, response } = await requireAgentOperator();
  if (response) return response;
  const { id } = await ctx.params;
  const loaded = await loadEditable(id);
  if (loaded.response) return loaded.response;

  const { values, errors } = validateRequirementInput(await readJson(request));
  if (Object.keys(errors).length > 0) return json({ error: 'Please fix the highlighted fields', fieldErrors: errors }, 400);

  const updated = await db.requirement.update({ where: { id }, data: values, include: requirementInclude });
  await recordAudit({ userId: user.id, projectId: updated.projectId, action: 'requirement.updated', target: updated.key, details: updated.title });
  return json({ requirement: publicRequirement(updated) });
}

// Removes the requirement. Its runs and test cases stay, unlinked, so history is kept.
export async function DELETE(_request, ctx) {
  const { user, response } = await requireAgentOperator();
  if (response) return response;
  const { id } = await ctx.params;
  const loaded = await loadEditable(id);
  if (loaded.response) return loaded.response;

  await db.requirement.delete({ where: { id } });
  await recordAudit({ userId: user.id, projectId: loaded.requirement.projectId, action: 'requirement.deleted', target: loaded.requirement.key, details: loaded.requirement.title });
  return json({ ok: true });
}
