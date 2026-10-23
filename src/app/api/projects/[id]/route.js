import { db } from '@/lib/db';
import { json, readJson, recordAudit, requireProjectManager, requireUser } from '@/lib/apiHelpers';
import { getProject, projectData } from '@/lib/projects';
import { validateProjectInput } from '@/lib/validation';

export async function GET(_request, ctx) {
  const { response } = await requireUser();
  if (response) return response;
  const project = await getProject((await ctx.params).id);
  return project ? json({ project }) : json({ error: 'Project not found' }, 404);
}

export async function PATCH(request, ctx) {
  const { user, response } = await requireProjectManager();
  if (response) return response;

  const { id } = await ctx.params;
  const existing = await db.project.findUnique({ where: { id } });
  if (!existing) return json({ error: 'Project not found' }, 404);

  // Whether a token is already stored comes from the database, not the request.
  const { values, errors } = validateProjectInput({ ...(await readJson(request)), jiraTokenSet: Boolean(existing.jiraApiTokenEnc) });
  if (Object.keys(errors).length > 0) return json({ error: 'Please fix the highlighted fields', fieldErrors: errors }, 400);

  const clash = await db.project.findFirst({
    where: { name: { equals: values.name, mode: 'insensitive' }, id: { not: id } },
  });
  if (clash) return json({ error: 'Please fix the highlighted fields', fieldErrors: { name: 'A project with this name already exists' } }, 409);

  const { data: fields, memberIds } = projectData(values);
  const activeMembers = await db.user.findMany({ where: { id: { in: memberIds }, deletedAt: null }, select: { id: true } });

  await db.$transaction([
    db.project.update({ where: { id }, data: fields }),
    db.projectMember.deleteMany({ where: { projectId: id } }),
    db.projectMember.createMany({ data: activeMembers.map((m) => ({ projectId: id, userId: m.id })) }),
  ]);

  const secretChanges = [
    values.jiraApiToken ? 'Jira API token replaced' : values.clearJiraApiToken && existing.jiraApiTokenEnc ? 'Jira API token removed' : null,
    values.e2ePassword ? 'test password replaced' : values.clearE2ePassword && existing.e2ePasswordEnc ? 'test password removed' : null,
  ].filter(Boolean);
  await recordAudit({
    userId: user.id,
    projectId: id,
    action: 'project.updated',
    target: values.name,
    details: `Updated project settings${secretChanges.length ? ` (${secretChanges.join(', ')})` : ''}`,
  });
  return json({ project: await getProject(id) });
}

export async function DELETE(_request, ctx) {
  const { user, response } = await requireProjectManager();
  if (response) return response;

  const { id } = await ctx.params;
  const existing = await db.project.findUnique({ where: { id } });
  if (!existing) return json({ error: 'Project not found' }, 404);

  // Approvals only carry the project id (no relation), so remove them explicitly.
  await db.$transaction([
    db.approval.deleteMany({ where: { projectId: id } }),
    db.project.delete({ where: { id } }),
  ]);

  await recordAudit({ userId: user.id, action: 'project.deleted', target: existing.name, details: 'Deleted the project and everything in it' });
  return json({ ok: true });
}
