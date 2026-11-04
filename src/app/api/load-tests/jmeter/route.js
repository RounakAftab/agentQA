import { db } from '@/lib/db';
import { json, readJson, recordAudit, requireAgentOperator } from '@/lib/apiHelpers';
import { decryptSecret } from '@/lib/secrets';
import { MAX_JMX_BYTES, readJmeterPlan } from '@/lib/jmeterRecording';

// Reads a JMeter plan saved after recording with the HTTP(S) Test Script Recorder:
// POST { projectId, jmx, fileName? } -> { requests, notes }. Nothing is saved: the form lets the person
// pick requests as scenario steps, and saving the load test validates them as usual.
// Read here rather than in the browser so the test account's password, which only the server can
// decrypt, is swapped for {{password}} before the requests reach the form.
export async function POST(request) {
  const { user, response } = await requireAgentOperator();
  if (response) return response;

  const body = await readJson(request);
  const jmx = typeof body.jmx === 'string' ? body.jmx : '';
  if (jmx.length > MAX_JMX_BYTES) return json({ error: `The file is over ${MAX_JMX_BYTES / 1024 / 1024} MB.` }, 413);

  const project = await db.project.findUnique({
    where: { id: String(body.projectId ?? '') },
    select: { id: true, appBaseUrl: true, e2eUsername: true, e2ePasswordEnc: true },
  });
  if (!project) return json({ error: 'Choose a project first.' }, 400);

  const account = project.e2eUsername && project.e2ePasswordEnc ? { username: project.e2eUsername, password: decryptSecret(project.e2ePasswordEnc) ?? '' } : null;
  const { requests, notes, error } = readJmeterPlan(jmx, { appBaseUrl: project.appBaseUrl ?? '', account });
  if (error) return json({ error }, 400);

  const fileName = String(body.fileName ?? 'recording.jmx').slice(0, 200);
  await recordAudit({ userId: user.id, projectId: project.id, action: 'loadtest.jmeter.imported', target: fileName, details: `${requests.length} requests` });
  return json({ requests, notes });
}
