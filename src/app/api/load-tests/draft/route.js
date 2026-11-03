import { db } from '@/lib/db';
import { json, readJson, recordAudit, requireAgentOperator } from '@/lib/apiHelpers';
import { workerStatus } from '@/lib/agentRuns';
import { MAX_PROMPT } from '@/lib/loadDraftSpec';

// Queues "Draft with AI" for the worker, which asks Claude with your Claude login or API key
// (agent/loadDraftRunner.mjs): POST { projectId, prompt } -> { id, worker }.
// The form then polls GET /api/load-tests/draft/:id. Nothing is saved as a load test.
export async function POST(request) {
  const { user, response } = await requireAgentOperator();
  if (response) return response;

  const body = await readJson(request);
  const prompt = String(body.prompt ?? '').trim();
  if (prompt.length < 10) return json({ error: 'Describe the load test in a sentence or two.' }, 400);
  if (prompt.length > MAX_PROMPT) return json({ error: `Keep the description under ${MAX_PROMPT.toLocaleString()} characters.` }, 400);

  const project = await db.project.findUnique({ where: { id: String(body.projectId ?? '') }, select: { id: true, appBaseUrl: true } });
  if (!project) return json({ error: 'Choose a project first.' }, 400);
  if (!project.appBaseUrl) return json({ error: "Set the project's app link (Projects → Edit project → Test environment) first." }, 400);

  const draft = await db.loadTestDraft.create({ data: { projectId: project.id, prompt, requestedById: user.id } });
  await recordAudit({ userId: user.id, projectId: project.id, action: 'loadtest.drafted', target: 'Draft with AI', details: prompt.slice(0, 200) });
  return json({ id: draft.id, worker: await workerStatus() }, 201);
}
