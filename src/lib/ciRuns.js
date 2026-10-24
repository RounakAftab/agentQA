// Server-side CI run queries and report ingestion, shared by the /api/ci routes.
import crypto from 'node:crypto';
import { db } from '@/lib/db';
import { summarizeReport } from '@/lib/playwrightReport';

const iso = (d) => (d ? d.toISOString() : null);
const MAX_FAILURES = 100;

export function publicCiRun(run) {
  return {
    id: run.id,
    projectId: run.projectId,
    branch: run.branch,
    commit: run.commit,
    commitMessage: run.commitMessage,
    status: run.status.toLowerCase(),
    triggeredBy: run.triggeredBy,
    startedAt: iso(run.startedAt),
    completedAt: iso(run.completedAt),
    duration: run.duration,
    totalTests: run.totalTests,
    passed: run.passed,
    failed: run.failed,
    skipped: run.skipped,
    runUrl: run.runUrl,
    failures: (run.failures ?? []).map((f) => ({
      id: f.id,
      testName: f.testName,
      className: f.className,
      error: f.error,
      duration: f.duration,
      likelyCause: f.aiAnalysis,
    })),
  };
}

export async function listCiRuns({ projectId, take = 100 } = {}) {
  const runs = await db.cIRun.findMany({
    where: projectId ? { projectId } : undefined,
    orderBy: { startedAt: 'desc' },
    take,
    include: { failures: { orderBy: { testName: 'asc' } } },
  });
  return runs.map(publicCiRun);
}

// The workflow authenticates with CI_INGEST_TOKEN. Compared as hashes so timing reveals nothing.
export function validIngestToken(request) {
  const expected = process.env.CI_INGEST_TOKEN;
  const given = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!expected || !given) return false;
  const hash = (v) => crypto.createHash('sha256').update(v).digest();
  return crypto.timingSafeEqual(hash(given), hash(expected));
}

// "https://github.com/Owner/Repo.git" -> "owner/repo"
const repoSlug = (url) => /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(url ?? '')?.slice(1, 3).join('/').toLowerCase() ?? null;

// A report names its project by id, or by the repository it ran in.
export async function findProjectForReport({ projectId, repository }) {
  if (projectId) return db.project.findUnique({ where: { id: String(projectId) } });
  const slug = String(repository ?? '').toLowerCase();
  if (!slug) return null;
  const projects = await db.project.findMany({ select: { id: true, name: true, automationRepoUrl: true, repoUrl: true } });
  const matches = projects.filter((p) => repoSlug(p.automationRepoUrl) === slug || repoSlug(p.repoUrl) === slug);
  // Ambiguous when two projects share a repository: the workflow must send projectId.
  return matches.length === 1 ? matches[0] : matches.length > 1 ? { ambiguous: matches.map((p) => p.name) } : null;
}

// Saves one workflow run's Playwright report. Re-sending the same run id and attempt replaces it.
export async function saveReport(project, body) {
  const summary = body.report ? summarizeReport(body.report) : null;
  const failures = summary
    ? summary.failures
    : [{ testName: 'No test report', className: '', error: 'The workflow finished without a Playwright JSON report. The test command probably crashed before any test ran; open the workflow run for its log.', duration: 0, aiAnalysis: null }];
  if (summary && summary.totalTests === 0 && failures.length === 0) {
    failures.push({ testName: 'No tests ran', className: '', error: 'The report contains no tests. Check the test path and the testDir in playwright.config.', duration: 0, aiAnalysis: null });
  }

  const status =
    String(body.status ?? '').toLowerCase() === 'cancelled'
      ? 'CANCELLED'
      : !summary || summary.failed > 0 || failures.some((f) => !f.testName.endsWith('(flaky)'))
        ? 'FAILED'
        : 'PASSED';

  const startedAt = summary?.startedAt ?? new Date();
  const data = {
    projectId: project.id,
    branch: String(body.branch ?? 'unknown').slice(0, 200),
    commit: String(body.commit ?? '').slice(0, 12) || 'unknown',
    commitMessage: String(body.commitMessage ?? '').split('\n')[0].slice(0, 300) || '(no commit message)',
    status,
    triggeredBy: String(body.event ?? 'push').slice(0, 50),
    startedAt,
    completedAt: new Date(startedAt.getTime() + (summary?.durationSec ?? 0) * 1000),
    duration: summary?.durationSec ?? null,
    totalTests: summary?.totalTests ?? 0,
    passed: summary?.passed ?? 0,
    failed: summary?.failed ?? 0,
    skipped: summary?.skipped ?? 0,
    runUrl: /^https:\/\//.test(body.runUrl ?? '') ? String(body.runUrl).slice(0, 500) : null,
    externalId: body.runId ? `${body.runId}-${body.runAttempt ?? 1}`.slice(0, 100) : null,
  };
  const failureRows = failures.slice(0, MAX_FAILURES);

  return db.$transaction(async (tx) => {
    const existing = data.externalId
      ? await tx.cIRun.findUnique({ where: { projectId_externalId: { projectId: project.id, externalId: data.externalId } } })
      : null;
    if (existing) await tx.cIFailure.deleteMany({ where: { ciRunId: existing.id } });
    const run = existing
      ? await tx.cIRun.update({ where: { id: existing.id }, data })
      : await tx.cIRun.create({ data });
    if (failureRows.length) await tx.cIFailure.createMany({ data: failureRows.map((f) => ({ ...f, ciRunId: run.id })) });
    return { run, replaced: Boolean(existing) };
  });
}
