// "Draft with AI" for load tests: picks up queued LoadTestDraft rows and asks Claude for a draft
// through the Agent SDK, so it uses ANTHROPIC_API_KEY when set and otherwise your Claude login
// (the same as the QA Agent). Claude gets no tools: it only returns the structured draft.
import { query } from '@anthropic-ai/claude-agent-sdk';
import { loadLimits } from '../src/lib/loadLimits.js';
import { DRAFT_SYSTEM_PROMPT, DraftSchema, draftJsonSchema, draftPrompt, toForm } from '../src/lib/loadDraftSpec.js';

const POLL_MS = 2_000;
// Secrets Claude and its process never need.
const HIDDEN_ENV = ['DATABASE_URL', 'DIRECT_URL', 'SESSION_SECRET', 'ENCRYPTION_KEY', 'GITHUB_TOKEN', 'SMTP_PASS', 'E2E_USERNAME', 'E2E_PASSWORD'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function claim(db, workerId) {
  const rows = await db.$queryRaw`
    UPDATE "LoadTestDraft"
    SET status = 'RUNNING', "workerId" = ${workerId}, "startedAt" = NOW() AT TIME ZONE 'UTC'
    WHERE id = (
      SELECT id FROM "LoadTestDraft" WHERE status = 'QUEUED'
      ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING id`;
  return rows[0]?.id ?? null;
}

// Paths this project's load tests already use, as hints for the real API.
async function knownPaths(db, projectId) {
  const tests = await db.loadTest.findMany({ where: { projectId }, select: { url: true, steps: true }, take: 20, orderBy: { updatedAt: 'desc' } });
  const paths = tests.flatMap((t) => {
    const steps = Array.isArray(t.steps) ? t.steps.map((s) => `${s.method} ${s.path}`) : [];
    try {
      return [...steps, new URL(t.url).pathname];
    } catch {
      return steps;
    }
  });
  return [...new Set(paths)].slice(0, 30);
}

export async function askClaude({ project, prompt, paths }) {
  const env = { ...process.env };
  for (const name of HIDDEN_ENV) delete env[name];
  // An empty key from .env would override the CLI login.
  if (!env.ANTHROPIC_API_KEY) delete env.ANTHROPIC_API_KEY;

  const session = query({
    prompt: draftPrompt({ project, limits: loadLimits(), knownPaths: paths, prompt }),
    options: {
      // A strong model by default: drafting is one short call per test, and better guesses at
      // endpoints, steps and limits save editing. LOAD_AI_MODEL overrides it.
      model: process.env.LOAD_AI_MODEL || 'claude-opus-5-5',
      effort: process.env.LOAD_AI_EFFORT || 'high',
      systemPrompt: DRAFT_SYSTEM_PROMPT,
      tools: [],
      canUseTool: async () => ({ behavior: 'deny', message: 'No tools are available.' }),
      settingSources: [],
      outputFormat: { type: 'json_schema', schema: draftJsonSchema() },
      maxTurns: 4,
      maxBudgetUsd: Number(process.env.LOAD_AI_MAX_BUDGET_USD) || 1,
      env,
    },
  });

  let result = null;
  for await (const message of session) if (message.type === 'result') result = message;
  if (result?.subtype !== 'success') {
    const why = (result?.errors ?? []).join('; ') || result?.subtype || 'Claude stopped without an answer';
    throw new Error(`Claude could not draft the test: ${why}`);
  }
  const parsed = DraftSchema.safeParse(result.structured_output);
  if (!parsed.success) throw new Error('Claude’s answer didn’t fit the load test format. Try again.');
  return { draft: parsed.data, costUsd: result.total_cost_usd ?? null };
}

async function execute(db, id, log) {
  const row = await db.loadTestDraft.findUnique({
    where: { id },
    include: { project: { select: { id: true, name: true, description: true, appBaseUrl: true, e2eUsername: true, e2ePasswordEnc: true } } },
  });
  if (!row) return;
  log(`Drafting a load test for ${row.project.name}`);
  try {
    const project = { ...row.project, hasTestAccount: Boolean(row.project.e2eUsername && row.project.e2ePasswordEnc) };
    const { draft, costUsd } = await askClaude({ project, prompt: row.prompt, paths: await knownPaths(db, row.projectId) });
    await db.loadTestDraft.update({
      where: { id },
      data: { status: 'DONE', result: { form: toForm(draft), notes: draft.notes }, costUsd, finishedAt: new Date() },
    });
    log(`Draft ready: ${draft.name}`);
  } catch (err) {
    log(`Draft failed: ${err.message}`);
    await db.loadTestDraft.update({ where: { id }, data: { status: 'ERROR', error: String(err.message).slice(0, 2000), finishedAt: new Date() } });
  }
}

export async function loadDraftLoop({ db, workerId, isStopping }) {
  const log = (message) => console.log(`[load-draft] ${message}`);
  log('Ready to draft load tests with Claude');
  while (!isStopping()) {
    try {
      const id = await claim(db, workerId);
      if (id) await execute(db, id, log);
      else await sleep(POLL_MS);
    } catch (err) {
      console.error('[load-draft]', err.message);
      await sleep(POLL_MS * 5);
    }
  }
}
