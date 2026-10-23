// One QA Agent run, end to end. The ordering here is what enforces the Jira rules:
// In Progress before any work, and Done only after the worker's own test run passes.
import fs from 'node:fs/promises';
import path from 'node:path';
import { jiraForProject, jiraStatusesFor } from '../src/lib/jira.js';
import { decryptSecret } from '../src/lib/secrets.js';
import { specPathFor } from '../src/lib/agentSteps.js';
import { checkSpec } from './guardrails.mjs';
import { runSpec } from './playwright.mjs';
import { prepareWorkspace, publishSpec } from './workspace.mjs';
import { runAgentSession } from './session.mjs';

export class CancelledError extends Error {}

export async function runTicket({ db, run, abortController }) {
  const project = await db.project.findUnique({ where: { id: run.projectId } });
  const jira = jiraForProject(project);
  const { inProgress: STATUS_IN_PROGRESS, done: STATUS_DONE } = jiraStatusesFor(project);
  // The project's test account. The agent may type it into the browser; specs must read it from env.
  const credentials = { username: project.e2eUsername ?? '', password: decryptSecret(project.e2ePasswordEnc) ?? '' };
  const specPath = specPathFor(run.issueKey);
  const specFile = path.basename(specPath);
  const branch = `qa/${run.issueKey.toLowerCase()}`;
  const runUrl = process.env.APP_URL ? `${process.env.APP_URL.replace(/\/+$/, '')}/dashboard/qa-agent/runs/${run.id}` : null;

  let currentStep = null;
  const log = (step, level, message) => db.agentRunEvent.create({ data: { runId: run.id, step, level, message: String(message).slice(0, 8000) } });
  const update = (data) => db.agentRun.update({ where: { id: run.id }, data });
  const checkCancelled = () => {
    if (abortController.signal.aborted) throw new CancelledError('Cancelled');
  };
  const step = async (id, message) => {
    checkCancelled();
    currentStep = id;
    await update({ step: id });
    if (message) await log(id, 'info', message);
  };
  const audit = (action, details) =>
    db.auditEvent
      .create({ data: { userId: run.startedById, projectId: run.projectId, action, target: run.issueKey, details } })
      .catch(() => {});

  // 1. Read the ticket.
  await step('jira.read', `Reading ${run.issueKey} from Jira`);
  const issue = await jira.getIssue(run.issueKey);
  await update({ issueSummary: issue.summary, issueSnapshot: issue, specPath, branch });
  await log('jira.read', 'success', `${issue.key}: ${issue.summary} (status: ${issue.status})`);
  if (issue.statusCategory === 'done') throw new Error(`${issue.key} is already ${issue.status}. Reopen it in Jira to automate it again.`);

  // 2. In Progress before any implementation work.
  await step('jira.in_progress');
  const moved = await jira.transitionTo(issue.key, STATUS_IN_PROGRESS);
  await log('jira.in_progress', 'success', moved.changed ? `Moved from ${moved.from} to ${STATUS_IN_PROGRESS}` : `Already ${STATUS_IN_PROGRESS}`);
  if (moved.changed) await audit('jira.transitioned', `${moved.from} → ${STATUS_IN_PROGRESS}`);

  try {
    // 3. Test repository.
    await step('workspace');
    const workspace = await prepareWorkspace(project, branch, (m) => log('workspace', 'info', m));
    await log('workspace', 'success', `Branch ${branch} ready`);

    const testEnv = {
      ...process.env,
      BASE_URL: project.appBaseUrl,
      PLAYWRIGHT_BASE_URL: project.appBaseUrl,
      E2E_USERNAME: credentials.username,
      E2E_PASSWORD: credentials.password,
    };

    // 4. The agent plans, inspects the page, writes and iterates on the spec.
    await step('agent', `Starting agent (${process.env.AGENT_MODEL || 'claude-opus-5-5'})`);
    const outcome = await runAgentSession({
      workspace,
      project,
      issue,
      specPath,
      testEnv,
      credentials,
      abortController,
      ctx: {
        log,
        savePlan: async (plan) => {
          await update({ testPlan: plan });
          await log('agent', 'success', `Test plan: ${plan.steps.length} steps, ${plan.acceptanceCriteria.length} acceptance criteria`);
        },
        saveSpec: async (content) => {
          await update({ specContent: content });
          await log('agent', 'success', `Wrote ${specPath}`);
        },
        countTestRun: (n) => update({ testAttempts: n }),
      },
    });
    checkCancelled();
    if (outcome.costUsd != null) await update({ costUsd: outcome.costUsd });
    if (outcome.summary) await log('agent', outcome.ok ? 'info' : 'warn', outcome.summary.slice(0, 4000));
    if (!outcome.plan) throw new Error('The agent finished without submitting a test plan.');

    // 5. Independent verification: the file on disk must pass the rules and the test must pass.
    await step('verify', 'Re-running the spec to confirm it passes');
    const content = await fs.readFile(path.join(workspace, specPath), 'utf8').catch(() => null);
    if (!content) throw new Error(`The agent did not create ${specPath}.`);
    const { errors } = checkSpec(content, outcome.plan, [credentials.username, credentials.password]);
    if (errors.length > 0) throw new Error(`Spec breaks the rules: ${errors.join(' ')}`);
    const verification = await runSpec({ workspace, specPath, env: testEnv, signal: abortController.signal });
    checkCancelled();
    if (!verification.passed) {
      const first = verification.failures[0];
      throw new Error(`Verification run failed${first ? `: ${first.title} — ${first.error.split('\n')[0]}` : ''}`);
    }
    await update({ verifiedPass: true, specContent: content });
    await log('verify', 'success', `Passed: ${verification.stats.expected} test(s) in ${(verification.stats.durationMs / 1000).toFixed(1)}s`);

    // 6. Commit, push and open a draft PR.
    await step('publish');
    const published = await publishSpec({ dir: workspace, project, branch, specPath, issueKey: issue.key, summary: issue.summary, runUrl });
    await update({ prUrl: published.prUrl });
    await log(
      'publish',
      published.pushed ? 'success' : 'warn',
      published.pushed ? `Pushed ${branch}${published.prUrl ? ` · ${published.prUrl}` : ''}` : `Committed on ${branch} in the local workspace only (set GITHUB_TOKEN to push and open a PR)`
    );

    // 7. Jira: append the note, then Done. Re-read the flag from the database so Done can
    //    only follow a verified pass.
    await step('jira.done');
    const fresh = await db.agentRun.findUnique({ where: { id: run.id }, select: { verifiedPass: true } });
    if (!fresh.verifiedPass) throw new Error('Refusing to move to Done without a verified passing test.');
    await jira.appendToDescription(issue.key, `✅ Automation test created: ${specFile}`);
    await log('jira.done', 'success', `Appended "✅ Automation test created: ${specFile}"`);
    const done = await jira.transitionTo(issue.key, STATUS_DONE);
    await log('jira.done', 'success', done.changed ? `Moved to ${STATUS_DONE}` : `Already ${STATUS_DONE}`);
    await audit('jira.transitioned', `${STATUS_IN_PROGRESS} → ${STATUS_DONE}`);

    await recordTestCase(db, project, issue);
    await audit('agent.run.passed', `${specPath}${published.prUrl ? ` · ${published.prUrl}` : ''}`);
    return { status: 'PASSED' };
  } catch (err) {
    // The ticket stays In Progress. Tell the people watching it why.
    if (!(err instanceof CancelledError) && !abortController.signal.aborted) {
      await jira.addComment(issue.key, `AgentQA could not finish the automation test: ${err.message}${runUrl ? `\nDetails: ${runUrl}` : ''}`).catch(() => {});
    }
    err.step = currentStep;
    throw err;
  }
}

// Keeps the dashboard's requirement and test-case counts in step with real automation.
async function recordTestCase(db, project, issue) {
  const source = `Jira ${issue.key}`;
  const requirement =
    (await db.requirement.findFirst({ where: { projectId: project.id, source } })) ??
    (await db.requirement.create({
      data: { projectId: project.id, title: issue.summary, source, sourceUrl: issue.url, status: 'automated', priority: (issue.priority || 'medium').toLowerCase() },
    }));
  await db.requirement.update({ where: { id: requirement.id }, data: { generatedTests: { increment: 1 }, status: 'automated' } });
  await db.testCase.create({
    data: {
      projectId: project.id,
      requirementId: requirement.id,
      title: `${issue.key}: ${issue.summary}`.slice(0, 300),
      type: 'e2e',
      priority: (issue.priority || 'medium').toLowerCase(),
      aiGenerated: true,
      automationStatus: 'scripted',
      lastResult: 'pass',
    },
  });
}
