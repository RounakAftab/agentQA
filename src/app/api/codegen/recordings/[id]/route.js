import { db } from '@/lib/db';
import { json, recordAudit, requireAgentOperator, requireUser } from '@/lib/apiHelpers';
import { publicRecording, validateCodegenInput, workerInfo } from '@/lib/codegenScripts';

const STALE_MS = 30_000; // the worker writes a heartbeat every 1.5 s while recording

// A recording whose worker stopped writing is failed, so the page doesn't wait forever.
async function failIfStale(row) {
  if (row.status !== 'RECORDING' || !row.heartbeatAt || Date.now() - row.heartbeatAt.getTime() < STALE_MS) return row;
  return db.codegenRecording.update({
    where: { id: row.id },
    data: { status: 'FAILED', error: 'The worker stopped responding during the recording. Start it again and retry.' },
  });
}

// Turns finished recorder code into a script, once: the status change to SAVING is the claim.
async function saveIfDone(row) {
  if (row.status !== 'DONE' || row.scriptId) return row;
  const claimed = await db.codegenRecording.updateMany({ where: { id: row.id, status: 'DONE', scriptId: null }, data: { status: 'SAVING' } });
  if (claimed.count === 0) return db.codegenRecording.findUnique({ where: { id: row.id } });

  const { values, errors } = validateCodegenInput({ title: row.title, startUrl: row.startUrl, sourceCode: row.liveCode ?? '' });
  if (Object.keys(errors).length > 0) {
    return db.codegenRecording.update({ where: { id: row.id }, data: { status: 'FAILED', error: Object.values(errors)[0] } });
  }
  const script = await db.codegenScript.create({ data: { ...values, createdById: row.requestedById } });
  await recordAudit({ userId: row.requestedById, action: 'codegen.created', target: script.title, details: `Recorded on ${row.hostname ?? 'a worker'}: ${script.startUrl}` });
  // The script holds the code now; the live copy is no longer needed.
  return db.codegenRecording.update({ where: { id: row.id }, data: { status: 'SAVED', scriptId: script.id, liveCode: null } });
}

export async function GET(_request, ctx) {
  const { response } = await requireUser();
  if (response) return response;
  const { id } = await ctx.params;
  let row = await db.codegenRecording.findUnique({ where: { id } });
  if (!row) return json({ error: 'Recording not found' }, 404);

  row = await saveIfDone(await failIfStale(row));
  return json({ recording: publicRecording(row), worker: await workerInfo() });
}

// Cancels: a queued recording at once, an open one when the worker next checks (it closes the browser).
export async function DELETE(_request, ctx) {
  const { user, response } = await requireAgentOperator();
  if (response) return response;
  const { id } = await ctx.params;
  const row = await db.codegenRecording.findUnique({ where: { id } });
  if (!row) return json({ error: 'Recording not found' }, 404);

  if (row.status === 'QUEUED') {
    await db.codegenRecording.updateMany({ where: { id, status: 'QUEUED' }, data: { status: 'CANCELLED', cancelRequested: true } });
  } else if (row.status === 'RECORDING') {
    await db.codegenRecording.update({ where: { id }, data: { cancelRequested: true } });
  }
  await recordAudit({ userId: user.id, action: 'codegen.recording.cancelled', target: row.title, details: row.startUrl });
  return json({ ok: true });
}
