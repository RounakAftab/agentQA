// Starts the QA Agent on GitHub Actions when a run is queued, so no worker has to be kept
// running. Enabled when AGENT_DISPATCH_TOKEN and AGENT_DISPATCH_REPO are set.
// Server-only.
import { db } from '@/lib/db';

const WORKFLOW_FILE = 'qa-agent.yml';

export const cloudRunnerEnabled = () => Boolean(process.env.AGENT_DISPATCH_TOKEN && process.env.AGENT_DISPATCH_REPO);

const HINTS = {
  401: 'AGENT_DISPATCH_TOKEN is invalid or expired.',
  403: 'AGENT_DISPATCH_TOKEN needs "Actions: Read and write" on the repository.',
  404: `Check AGENT_DISPATCH_REPO, and that .github/workflows/${WORKFLOW_FILE} is pushed to the branch.`,
  422: `The ${WORKFLOW_FILE} workflow on that branch does not accept the run_id input yet. Push the latest version.`,
};

export async function startCloudRunner(runId) {
  const repo = process.env.AGENT_DISPATCH_REPO.trim();
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.AGENT_DISPATCH_TOKEN.trim()}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: process.env.AGENT_DISPATCH_REF?.trim() || 'main', inputs: { run_id: runId } }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`GitHub returned ${res.status}. ${HINTS[res.status] ?? ''}`.trim());
}

// Starts a runner for a queued run and notes the outcome in the run's activity log.
// Never throws: the run stays queued and can be started again from its page.
export async function startRunnerFor(runId) {
  if (!cloudRunnerEnabled()) return { started: false };
  try {
    await startCloudRunner(runId);
    await db.agentRunEvent.create({ data: { runId, step: 'runner', level: 'info', message: 'Started a QA Agent runner on GitHub Actions' } });
    return { started: true };
  } catch (err) {
    const message = `Could not start the GitHub Actions runner: ${err.name === 'TimeoutError' ? 'GitHub did not respond in time.' : err.message}`;
    await db.agentRunEvent.create({ data: { runId, step: 'runner', level: 'error', message } });
    return { started: false, error: message };
  }
}
