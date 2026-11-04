// Server-side QA Agent run queries, shared by the /api/qa-agent routes.
import { db } from '@/lib/db';
import { WORKER_STALE_MS } from '@/lib/agentSteps';
import { issueUrl } from '@/lib/jira';
import { cloudRunnerEnabled } from '@/lib/agentRunner';

const iso = (d) => (d ? d.toISOString() : null);

export function publicRun(run, { withDetail = false } = {}) {
  const base = {
    id: run.id,
    projectId: run.projectId,
    projectName: run.project?.name ?? null,
    issueKey: run.issueKey,
    issueSummary: run.issueSummary,
    source: run.source,
    requirementId: run.requirementId,
    skippedSteps: run.skippedSteps ?? [],
    issueUrl:
      run.source === 'jira'
        ? run.project?.jiraBaseUrl ? issueUrl(run.project.jiraBaseUrl, run.issueKey) : null
        : run.issueSnapshot?.url ?? null, // a manual requirement linked to a ticket
    status: run.status,
    step: run.step,
    verifiedPass: run.verifiedPass,
    testAttempts: run.testAttempts,
    specPath: run.specPath,
    branch: run.branch,
    prUrl: run.prUrl,
    costUsd: run.costUsd,
    error: run.error,
    cancelRequested: run.cancelRequested,
    startedBy: run.startedBy ? { id: run.startedBy.id, name: run.startedBy.name } : null,
    queuedAt: iso(run.queuedAt),
    startedAt: iso(run.startedAt),
    finishedAt: iso(run.finishedAt),
  };
  if (!withDetail) return base;
  return {
    ...base,
    issueSnapshot: run.issueSnapshot,
    testPlan: run.testPlan,
    specContent: run.specContent,
    // The page objects (and other local files) the spec imports: [{ path, content }].
    pageObjects: Object.entries(run.pageObjects ?? {}).map(([path, content]) => ({ path, content })),
    // "Run test" runs, newest first; only the newest carries its console.
    testRuns: (run.testRuns ?? []).map((t, i) => publicTestRun(t, { withConsole: i === 0 })),
    events: (run.events ?? []).map((e) => ({ id: e.id, step: e.step, level: e.level, message: e.message, at: iso(e.at) })),
  };
}

export const ACTIVE_TEST_RUN = ['QUEUED', 'RUNNING'];

// One "Run test" run. Screenshots are left out: they are large and the page doesn't show them.
export function publicTestRun(t, { withConsole = false } = {}) {
  return {
    id: t.id,
    headed: t.headed,
    status: t.status,
    error: t.error,
    hostname: t.hostname,
    cancelRequested: t.cancelRequested,
    requestedBy: t.requestedBy ? { id: t.requestedBy.id, name: t.requestedBy.name } : null,
    createdAt: iso(t.createdAt),
    startedAt: iso(t.startedAt),
    finishedAt: iso(t.finishedAt),
    results: t.results
      ? {
          status: t.results.status,
          duration: t.results.duration,
          tests: (t.results.tests ?? []).map(({ screenshot: _screenshot, ...test }) => test),
        }
      : null,
    ...(withConsole ? { console: t.console } : {}),
  };
}

const include = {
  project: { select: { name: true, jiraBaseUrl: true } },
  startedBy: { select: { id: true, name: true } },
};

export async function listRuns({ projectId, take = 50 } = {}) {
  const runs = await db.agentRun.findMany({
    where: projectId ? { projectId } : undefined,
    orderBy: { queuedAt: 'desc' },
    take,
    include,
  });
  return runs.map((r) => publicRun(r));
}

export async function getRun(id) {
  const run = await db.agentRun.findUnique({
    where: { id },
    include: {
      ...include,
      events: { orderBy: { at: 'asc' } },
      testRuns: { orderBy: { createdAt: 'desc' }, take: 10, include: { requestedBy: { select: { id: true, name: true } } } },
    },
  });
  return run ? publicRun(run, { withDetail: true }) : null;
}

export async function workerStatus() {
  const latest = await db.agentWorker.findFirst({ orderBy: { lastSeenAt: 'desc' } });
  return {
    online: Boolean(latest && Date.now() - latest.lastSeenAt.getTime() < WORKER_STALE_MS),
    lastSeenAt: iso(latest?.lastSeenAt),
    // The computer the most recent worker runs on, e.g. where load tests send their traffic from.
    hostname: latest?.hostname ?? null,
    // Runs start a GitHub Actions runner themselves, so no worker has to be online.
    onDemand: cloudRunnerEnabled(),
  };
}
