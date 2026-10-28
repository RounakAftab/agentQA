// Server-side shape and validation of a Codegen script (a recording converted by src/lib/codegen).
import { db } from '@/lib/db';
import { parseCodegen } from '@/lib/codegen/parse';
import { checkCode, emitCode } from '@/lib/codegen/bundle';
import { encryptSecret } from '@/lib/secrets';

const iso = (d) => (d ? d.toISOString() : null);
const MAX_SOURCE = 200_000;
const MAX_EDITS = 500;

export const codegenInclude = { createdBy: { select: { id: true, name: true } } };

export const toScript = (row) => ({ title: row.title, recording: row.recording, edits: row.edits ?? {} });

// The list view. `full` adds what the editor needs, including the rule checks on both outputs.
export function publicScript(row, { full = false } = {}) {
  const summary = {
    id: row.id,
    title: row.title,
    startUrl: row.startUrl,
    stepCount: row.recording?.steps?.length ?? 0,
    createdBy: row.createdBy ? { id: row.createdBy.id, name: row.createdBy.name } : null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
  if (!full) return summary;
  const script = toScript(row);
  const plain = checkCode(emitCode(script, 'plain'));
  const pom = checkCode(emitCode(script, 'pom'));
  return {
    ...summary,
    sourceCode: row.sourceCode,
    recording: row.recording,
    edits: script.edits,
    // The password never leaves the server; the editor only learns whether one is saved.
    testLogin: { username: row.e2eUsername ?? '', hasPassword: Boolean(row.e2ePasswordEnc) },
    checks: { errors: [...new Set([...plain.errors, ...pom.errors])], warnings: [...new Set([...plain.warnings, ...pom.warnings])] },
  };
}

// { username, password } for runs. An empty password keeps the saved one; `clear` removes both.
export function validateTestLogin(input) {
  if (!input || typeof input !== 'object') return { values: {}, errors: {} };
  if (input.clear) return { values: { e2eUsername: null, e2ePasswordEnc: null }, errors: {} };
  const username = String(input.username ?? '').trim();
  const password = String(input.password ?? '');
  if (username.length > 200 || password.length > 200) return { values: {}, errors: { testLogin: 'Username and password must be 200 characters or fewer' } };
  return { values: { e2eUsername: username || null, ...(password ? { e2ePasswordEnc: encryptSecret(password) } : {}) }, errors: {} };
}

export const ACTIVE_RUN = ['QUEUED', 'RUNNING'];

export function publicRun(row, { full = false } = {}) {
  const tests = row.results?.tests ?? [];
  const summary = {
    id: row.id,
    kind: row.kind,
    style: row.style,
    headed: row.headed,
    status: row.status,
    error: row.error,
    hostname: row.hostname,
    passed: tests.filter((t) => t.status === 'passed').length,
    failed: tests.filter((t) => !['passed', 'skipped', 'running'].includes(t.status)).length,
    duration: row.results?.duration ?? null,
    hasFix: Boolean(row.healedSource),
    appliedAt: iso(row.appliedAt),
    costUsd: row.costUsd,
    createdAt: iso(row.createdAt),
    finishedAt: iso(row.finishedAt),
  };
  if (!full) return summary;
  return { ...summary, console: row.console, results: row.results, healedSource: row.healedSource, healSummary: row.healSummary };
}

// After a healed recording replaces the old one, carries the editor's changes over. Step ids are
// positions, so a page started at a step follows that step's code to its new id; renames are by
// class name and carry over as they are. Removed steps were left out of the healed code already.
export function carryEdits(edits, oldRecording, newRecording) {
  const oldSource = new Map((oldRecording?.steps ?? []).map((s) => [s.id, s.source]));
  const used = new Set();
  const pageNames = {};
  for (const [id, name] of Object.entries(edits?.pageNames ?? {})) {
    const match = newRecording.steps.find((s) => !used.has(s.id) && s.source === oldSource.get(id));
    if (match) {
      used.add(match.id);
      pageNames[match.id] = name;
    }
  }
  return { removed: [], pageNames, renames: edits?.renames ?? {} };
}

function validUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

// Create, or change title / site URL / recorder code. Returns { values, errors }. A new recording
// replaces `recording` and clears the edits made to the old one.
export function validateCodegenInput(input, { partial = false } = {}) {
  const errors = {};
  const values = {};

  if ('sourceCode' in input || !partial) {
    const source = String(input.sourceCode ?? '');
    if (source.length > MAX_SOURCE) errors.sourceCode = 'The code is too long (200,000 characters at most)';
    else {
      const parsed = parseCodegen(source);
      if (parsed.errors.length) errors.sourceCode = parsed.errors[0];
      else {
        const { title, startUrl, steps, preamble, secrets } = parsed;
        values.sourceCode = parsed.source;
        values.recording = { title, startUrl, steps, preamble, secrets };
        values.edits = {};
      }
    }
  }

  if ('startUrl' in input || !partial) {
    const raw = String(input.startUrl ?? '').trim() || values.recording?.startUrl || '';
    const url = validUrl(raw);
    if (!url) errors.startUrl = 'Enter the site address, starting with https://';
    else if (url.length > 2000) errors.startUrl = 'The address is too long';
    else values.startUrl = url;
  }

  if ('title' in input || !partial) {
    const fallback = values.recording?.title || (values.startUrl ? `${new URL(values.startUrl).hostname} flow` : '');
    const title = (String(input.title ?? '').trim() || fallback).replace(/\s+/g, ' ');
    if (title.length < 1) errors.title = 'Give the script a name';
    else if (title.length > 120) errors.title = 'Name must be 120 characters or fewer';
    else values.title = title;
  }
  return { values, errors };
}

// Start a live recording: { startUrl, title? }. Returns { values, errors }.
export function validateRecordingInput(input) {
  const errors = {};
  const values = {};
  const url = validUrl(String(input.startUrl ?? '').trim());
  if (!url || url.length > 2000) errors.startUrl = 'Enter the site address, starting with https://';
  else values.startUrl = url;
  const title = String(input.title ?? '').trim().replace(/\s+/g, ' ');
  if (title.length > 120) errors.title = 'Name must be 120 characters or fewer';
  else values.title = title || (url ? `${new URL(url).hostname} flow` : '');
  return { values, errors };
}

export const ACTIVE_RECORDING = ['QUEUED', 'RECORDING', 'DONE', 'SAVING'];
const WORKER_ONLINE_MS = 30_000;

// The computer a queued recording will open on: the most recently seen worker.
export async function workerInfo() {
  const latest = await db.agentWorker.findFirst({ orderBy: { lastSeenAt: 'desc' } });
  const online = Boolean(latest && Date.now() - latest.lastSeenAt.getTime() < WORKER_ONLINE_MS);
  return { online, hostname: online ? latest.hostname : null };
}

export function publicRecording(row) {
  return {
    id: row.id,
    title: row.title,
    startUrl: row.startUrl,
    status: row.status,
    stepCount: row.stepCount,
    liveCode: row.liveCode ?? '',
    error: row.error,
    scriptId: row.scriptId,
    hostname: row.hostname,
    createdAt: iso(row.createdAt),
  };
}

// Editor changes: { removed: [stepId], pageNames: { stepId: name }, renames: { ClassName: name } }.
// Only names and ids are accepted; the code itself always comes from the parsed recording.
export function validateEdits(input, recording) {
  const ids = new Set((recording?.steps ?? []).map((s) => s.id));
  const name = (v) => String(v ?? '').trim().slice(0, 60);
  const entries = (obj) => (obj && typeof obj === 'object' && !Array.isArray(obj) ? Object.entries(obj).slice(0, MAX_EDITS) : []);

  return {
    removed: Array.isArray(input?.removed) ? [...new Set(input.removed.map(String).filter((id) => ids.has(id)))] : [],
    pageNames: Object.fromEntries(entries(input?.pageNames).filter(([id, v]) => ids.has(id) && name(v)).map(([id, v]) => [id, name(v)])),
    renames: Object.fromEntries(entries(input?.renames).filter(([from, v]) => /^\w{1,80}$/.test(from) && name(v)).map(([from, v]) => [from, name(v)])),
  };
}
