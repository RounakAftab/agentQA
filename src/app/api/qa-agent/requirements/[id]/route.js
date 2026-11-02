import { db } from '@/lib/db';
import { json, readJson, recordAudit, requireAgentOperator } from '@/lib/apiHelpers';
import { isManualKey, nextManualKey, publicRequirement, requirementColumns, requirementInclude } from '@/lib/requirements';
import { validateRequirementInput } from '@/lib/validation';
import { ACTIVE_STATUSES } from '@/lib/agentSteps';

async function loadEditable(id) {
  const requirement = await db.requirement.findFirst({ where: { id, source: 'manual' }, include: { project: true } });
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
  const { requirement } = loaded;

  const { values, errors } = validateRequirementInput(await readJson(request));
  if (Object.keys(errors).length > 0) return json({ error: 'Please fix the highlighted fields', fieldErrors: errors }, 400);

  // Adding, changing or removing the Jira key renames the requirement; without one it keeps
  // (or gets back) a REQ-n number. Earlier runs keep the key they ran under.
  const key = values.jiraKey ?? (isManualKey(requirement.key) ? requirement.key : await nextManualKey(db, requirement.projectId));
  let updated;
  try {
    updated = await db.requirement.update({
      where: { id },
      data: { ...requirementColumns(values, requirement.project), key },
      include: requirementInclude,
    });
  } catch (err) {
    if (err.code !== 'P2002') throw err;
    return json({ error: 'Please fix the highlighted fields', fieldErrors: { jiraKey: `${key} is already a requirement in this project` } }, 409);
  }
  const renamed = key !== requirement.key ? ` (was ${requirement.key})` : '';
  await recordAudit({ userId: user.id, projectId: updated.projectId, action: 'requirement.updated', target: updated.key, details: `${updated.title}${renamed}` });
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
