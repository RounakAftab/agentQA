import { db } from '@/lib/db';
import { json, readJson, recordAudit, requireAgentOperator, requireUser } from '@/lib/apiHelpers';
import { ACTIVE_RECORDING, publicRecording, validateRecordingInput, workerInfo } from '@/lib/codegenScripts';

// Where a recording would open, and the caller's recording still in progress (after a reload).
export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;
  const open = await db.codegenRecording.findFirst({ where: { requestedById: user.id, status: { in: ACTIVE_RECORDING } }, orderBy: { createdAt: 'desc' } });
  return json({ worker: await workerInfo(), recording: open ? publicRecording(open) : null });
}

// Starts a live recording: POST { startUrl, title? }. A worker opens Playwright's recorder on its
// computer (agent/recorder.mjs); poll GET /api/codegen/recordings/:id for progress.
export async function POST(request) {
  const { user, response } = await requireAgentOperator();
  if (response) return response;

  const { values, errors } = validateRecordingInput(await readJson(request));
  if (Object.keys(errors).length > 0) return json({ error: 'Please fix the highlighted fields', fieldErrors: errors }, 400);

  const open = await db.codegenRecording.findFirst({ where: { requestedById: user.id, status: { in: ACTIVE_RECORDING } } });
  if (open) return json({ error: 'You already have a recording open. Finish or cancel it first.', recording: publicRecording(open) }, 409);

  const created = await db.codegenRecording.create({ data: { ...values, requestedById: user.id } });
  await recordAudit({ userId: user.id, action: 'codegen.recording.started', target: created.title, details: created.startUrl });
  return json({ recording: publicRecording(created) }, 201);
}
