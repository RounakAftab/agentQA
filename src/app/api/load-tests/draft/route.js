import { db } from '@/lib/db';
import { json, readJson, recordAudit, requireAgentOperator } from '@/lib/apiHelpers';
import { loadLimits } from '@/lib/loadLimits';
import { DraftError, MAX_PROMPT, draftLoadTest } from '@/lib/loadTestDraft';

// Claude usually answers in 10-30 seconds.
export const maxDuration = 60;

// Drafts a load test from a description, without saving it: POST { projectId, prompt }
// Returns { draft, notes, fieldErrors } for the form to fill in and the person to review.
export async function POST(request) {
  const { user, response } = await requireAgentOperator();
  if (response) return response;

  const body = await readJson(request);
  const prompt = String(body.prompt ?? '').trim();
  if (prompt.length < 10) return json({ error: 'Describe the load test in a sentence or two.' }, 400);
  if (prompt.length > MAX_PROMPT) return json({ error: `Keep the description under ${MAX_PROMPT.toLocaleString()} characters.` }, 400);

  const project = await db.project.findUnique({
    where: { id: String(body.projectId ?? '') },
    select: { id: true, name: true, description: true, appBaseUrl: true, e2eUsername: true, e2ePasswordEnc: true },
  });
  if (!project) return json({ error: 'Choose a project first.' }, 400);
  if (!project.appBaseUrl) return json({ error: "Set the project's app link (Projects → Edit project → Test environment) first." }, 400);

  // Paths this project's load tests already use, as hints for the real API.
  const existing = await db.loadTest.findMany({ where: { projectId: project.id }, select: { url: true, steps: true }, take: 20, orderBy: { updatedAt: 'desc' } });
  const knownPaths = [
    ...new Set(
      existing.flatMap((t) => [
        ...(Array.isArray(t.steps) ? t.steps.map((s) => `${s.method} ${s.path}`) : []),
        (() => {
          try {
            return new URL(t.url).pathname;
          } catch {
            return null;
          }
        })(),
      ])
    ),
  ]
    .filter(Boolean)
    .slice(0, 30);

  try {
    const { form, notes, fieldErrors } = await draftLoadTest({ prompt, project, limits: loadLimits(), knownPaths });
    await recordAudit({ userId: user.id, projectId: project.id, action: 'loadtest.drafted', target: form.name, details: prompt.slice(0, 200) });
    return json({ draft: form, notes, fieldErrors });
  } catch (err) {
    if (err instanceof DraftError) return json({ error: err.message }, err.status);
    console.error('[load-draft] failed', err);
    return json({ error: 'Could not draft the load test.' }, 500);
  }
}
