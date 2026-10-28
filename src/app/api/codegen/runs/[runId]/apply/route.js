import { db } from '@/lib/db';
import { json, recordAudit, requireAgentOperator } from '@/lib/apiHelpers';
import { carryEdits, codegenInclude, publicScript, validateCodegenInput } from '@/lib/codegenScripts';

// Replaces the script's recording with the healer's fix: POST /api/codegen/runs/:runId/apply
export async function POST(_request, ctx) {
  const { user, response } = await requireAgentOperator();
  if (response) return response;
  const { runId } = await ctx.params;
  const run = await db.codegenRun.findUnique({ where: { id: runId }, include: { script: true } });
  if (!run?.healedSource) return json({ error: 'This run has no fix to apply.' }, 404);
  if (run.appliedAt) return json({ error: 'This fix was already applied.' }, 409);
  const { script } = run;

  const { values, errors } = validateCodegenInput({ sourceCode: run.healedSource, startUrl: script.startUrl, title: script.title });
  if (Object.keys(errors).length > 0) return json({ error: Object.values(errors)[0] }, 400);
  // The healed code navigates with relative paths; the script keeps its site address.
  if (!/^https?:\/\//.test(values.recording.startUrl)) values.recording.startUrl = script.startUrl;
  values.edits = carryEdits(script.edits, script.recording, values.recording);

  const [updated] = await db.$transaction([
    db.codegenScript.update({ where: { id: script.id }, data: values, include: codegenInclude }),
    db.codegenRun.update({ where: { id: runId }, data: { appliedAt: new Date() } }),
  ]);
  await recordAudit({ userId: user.id, action: 'codegen.heal.applied', target: script.title, details: `Fix from run ${runId}` });
  return json({ script: publicScript(updated, { full: true }) });
}
