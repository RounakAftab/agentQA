import { db } from '@/lib/db';
import { json, readJson, recordAudit, requireAgentOperator, requireUser } from '@/lib/apiHelpers';
import { ACTIVE_RUN, publicRun, workerInfo } from '@/lib/codegenScripts';

// The script's latest runs and heals: GET /api/codegen/:id/runs
export async function GET(_request, ctx) {
  const { response } = await requireUser();
  if (response) return response;
  const { id } = await ctx.params;
  const rows = await db.codegenRun.findMany({ where: { scriptId: id }, orderBy: { createdAt: 'desc' }, take: 10 });
  return json({ runs: rows.map((row) => publicRun(row)), worker: await workerInfo() });
}

// Starts a run on the worker: POST { kind: 'run' | 'heal', style: 'pom' | 'plain', headed, fromRunId }.
// A heal needs the failed run it should fix.
export async function POST(request, ctx) {
  const { user, response } = await requireAgentOperator();
  if (response) return response;
  const { id } = await ctx.params;
  const script = await db.codegenScript.findUnique({ where: { id } });
  if (!script) return json({ error: 'Script not found' }, 404);

  const body = await readJson(request);
  const kind = body.kind === 'heal' ? 'heal' : 'run';
  let fromRunId = null;
  if (kind === 'heal') {
    const from = await db.codegenRun.findFirst({ where: { id: String(body.fromRunId ?? ''), scriptId: id } });
    if (!from || !['FAILED', 'ERROR'].includes(from.status)) return json({ error: 'Heal starts from a failed run of this script.' }, 400);
    fromRunId = from.id;
  }

  const active = await db.codegenRun.findFirst({ where: { scriptId: id, status: { in: ACTIVE_RUN } } });
  if (active) return json({ error: 'A run of this script is already in progress.', run: publicRun(active) }, 409);

  const created = await db.codegenRun.create({
    data: {
      scriptId: id,
      kind,
      // A heal fixes the recording itself, so it always works on the plain spec.
      style: kind === 'heal' || body.style === 'plain' ? 'plain' : 'pom',
      headed: Boolean(body.headed),
      fromRunId,
      requestedById: user.id,
    },
  });
  await recordAudit({ userId: user.id, action: kind === 'heal' ? 'codegen.heal.started' : 'codegen.run.started', target: script.title, details: created.style });
  return json({ run: publicRun(created) }, 201);
}
