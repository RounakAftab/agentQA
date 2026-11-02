import { db } from '@/lib/db';
import { json, readJson, recordAudit, requireAgentOperator, requireUser } from '@/lib/apiHelpers';
import { loadLimits } from '@/lib/loadLimits';
import { loadTestInclude, publicLoadTest, validateLoadTestInput } from '@/lib/loadTests';

const notFound = () => json({ error: 'Load test not found' }, 404);

export async function GET(_request, ctx) {
  const { response } = await requireUser();
  if (response) return response;
  const { id } = await ctx.params;
  const row = await db.loadTest.findUnique({ where: { id }, include: loadTestInclude });
  return row ? json({ test: publicLoadTest(row), limits: loadLimits() }) : notFound();
}

// PATCH with any of the POST fields except projectId. Blank `headers` keeps the saved ones;
// `clearHeaders: true` removes them.
export async function PATCH(request, ctx) {
  const { user, response } = await requireAgentOperator();
  if (response) return response;
  const { id } = await ctx.params;
  const existing = await db.loadTest.findUnique({ where: { id }, include: { project: { select: { id: true, appBaseUrl: true } } } });
  if (!existing) return notFound();

  const { values, errors } = validateLoadTestInput(await readJson(request), { project: existing.project, existing });
  if (Object.keys(errors).length > 0) return json({ error: 'Please fix the highlighted fields', fieldErrors: errors }, 400);

  const updated = await db.loadTest.update({ where: { id }, data: values, include: loadTestInclude });
  await recordAudit({ userId: user.id, projectId: updated.projectId, action: 'loadtest.updated', target: updated.name, details: `${updated.method} ${updated.url}` });
  return json({ test: publicLoadTest(updated) });
}

export async function DELETE(_request, ctx) {
  const { user, response } = await requireAgentOperator();
  if (response) return response;
  const { id } = await ctx.params;
  const existing = await db.loadTest.findUnique({ where: { id } });
  if (!existing) return notFound();

  await db.loadTest.delete({ where: { id } });
  await recordAudit({ userId: user.id, projectId: existing.projectId, action: 'loadtest.deleted', target: existing.name, details: `${existing.method} ${existing.url}` });
  return json({ ok: true });
}
