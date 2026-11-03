import { db } from '@/lib/db';
import { json, requireAgentOperator } from '@/lib/apiHelpers';
import { workerStatus } from '@/lib/agentRuns';
import { validateLoadTestInput } from '@/lib/loadTests';

// A worker that dies mid-draft leaves the row RUNNING; Claude normally answers well within this.
const STUCK_MS = 5 * 60 * 1000;

// One draft: GET /api/load-tests/draft/:id -> { status, draft?, notes?, fieldErrors?, error?, worker }
// When done, the draft is checked like a save, so problems show on the form straight away.
export async function GET(_request, ctx) {
  const { response } = await requireAgentOperator();
  if (response) return response;
  const { id } = await ctx.params;

  let row = await db.loadTestDraft.findUnique({
    where: { id },
    include: { project: { select: { id: true, appBaseUrl: true, e2eUsername: true, e2ePasswordEnc: true } } },
  });
  if (!row) return json({ error: 'Draft not found' }, 404);

  if (row.status === 'RUNNING' && row.startedAt && Date.now() - row.startedAt.getTime() > STUCK_MS) {
    row = await db.loadTestDraft.update({
      where: { id },
      data: { status: 'ERROR', error: 'The worker stopped before Claude answered. Try again.', finishedAt: new Date() },
      include: { project: { select: { id: true, appBaseUrl: true, e2eUsername: true, e2ePasswordEnc: true } } },
    });
  }

  const base = { status: row.status, worker: await workerStatus() };
  if (row.status === 'ERROR') return json({ ...base, error: row.error ?? 'Could not draft the load test' });
  if (row.status !== 'DONE') return json(base);

  const { form, notes } = row.result;
  const { errors } = validateLoadTestInput({ ...form, steps: form.kind === 'scenario' ? form.steps : undefined }, { project: row.project });
  return json({ ...base, draft: form, notes, fieldErrors: errors });
}
