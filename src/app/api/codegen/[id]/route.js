import { db } from '@/lib/db';
import { json, readJson, recordAudit, requireAgentOperator, requireUser } from '@/lib/apiHelpers';
import { codegenInclude, publicScript, validateCodegenInput, validateEdits, validateTestLogin } from '@/lib/codegenScripts';

const notFound = () => json({ error: 'Script not found' }, 404);

export async function GET(_request, ctx) {
  const { response } = await requireUser();
  if (response) return response;
  const { id } = await ctx.params;
  const row = await db.codegenScript.findUnique({ where: { id }, include: codegenInclude });
  return row ? json({ script: publicScript(row, { full: true }) }) : notFound();
}

// PATCH { title?, startUrl?, sourceCode?, edits? }. New recorder code replaces the steps and clears
// the edits; otherwise `edits` (page names, removed steps) is saved as given.
export async function PATCH(request, ctx) {
  const { user, response } = await requireAgentOperator();
  if (response) return response;
  const { id } = await ctx.params;
  const existing = await db.codegenScript.findUnique({ where: { id } });
  if (!existing) return notFound();

  const body = await readJson(request);
  const { values, errors } = validateCodegenInput(body, { partial: true });
  const login = validateTestLogin(body.testLogin);
  Object.assign(errors, login.errors);
  if (Object.keys(errors).length > 0) return json({ error: 'Please fix the highlighted fields', fieldErrors: errors }, 400);
  if (!values.recording && 'edits' in body) values.edits = validateEdits(body.edits, existing.recording);

  const updated = await db.codegenScript.update({ where: { id }, data: { ...values, ...login.values }, include: codegenInclude });
  if (values.recording) {
    await recordAudit({ userId: user.id, action: 'codegen.rerecorded', target: updated.title, details: updated.startUrl });
  }
  if (body.testLogin) {
    await recordAudit({ userId: user.id, action: 'codegen.test_login.updated', target: updated.title, details: body.testLogin.clear ? 'Removed' : 'Saved' });
  }
  return json({ script: publicScript(updated, { full: true }) });
}

export async function DELETE(_request, ctx) {
  const { user, response } = await requireAgentOperator();
  if (response) return response;
  const { id } = await ctx.params;
  const existing = await db.codegenScript.findUnique({ where: { id } });
  if (!existing) return notFound();

  await db.codegenScript.delete({ where: { id } });
  await recordAudit({ userId: user.id, action: 'codegen.deleted', target: existing.title, details: existing.startUrl });
  return json({ ok: true });
}
