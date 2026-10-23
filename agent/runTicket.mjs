// One QA Agent run, end to end. Works for a Jira ticket or a requirement written in AgentQA.
// For Jira, the ordering here is what enforces the rules: In Progress before any work, and
// Done only after the worker's own test run passes.
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
  const isJira = run.source !== 'manual';
  const jira = isJira ? jiraForProject(project) : null;
  const statuses = jiraStatusesFor(project);
  // The project's test account. The agent may type it into the browser; specs must read it from env.
  const credentials = { username: project.e2eUsername ?? '', password: decryptSecret(project.e2ePasswordEnc) ?? '' };
  const specPath = specPathFor(run.issueKey);
  const specFile = path.basename(specPath);
  const branch = `qa/${run.issueKey.toLowerCase()}`;
  const runUrl = process.env.APP_URL ? `${process.env.APP_URL.replace(/\/+$/, '')}/dashboard/qa-agent/runs/${run.id}` : null;

  let currentStep = null;
  let requirementId = run.requirementId;
  const skipped = [];
  const log = (step, level, message) => db.agentRunEvent.create({ data: { runId: run.id, step, level, message: String(message).slice(0, 8000) } });
  const update = (data) => db.agentRun.update({ where: { id: run.id }, data });
  const setRequirementStatus = (status) =>
    requirementId ? db.requirement.update({ where: { id: requirementId }, data: { status } }).catch(() => {}) : null;
  const skip = async (id, message) => {
    skipped.push(id);
    await update({ skippedSteps: skipped });
    await log(id, 'info', message);
  };
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

  // 1. Read the requirement.
  let issue;
  if (isJira) {
    await step('jira.read', `Reading ${run.issueKey} from Jira`);
    issue = await jira.getIssue(run.issueKey);
    if (issue.statusCategory === 'done') throw new Error(`${issue.key} is already ${issue.status}. Reopen it in Jira to automate it again.`);
    const requirement = await db.requirement.upsert({
      where: { projectId_key: { projectId: project.id, key: issue.key } },
      create: {
        projectId: project.id,
        key: issue.key,
        title: issue.summary,
        source: 'jira',
        sourceUrl: issue.url,
        priority: (issue.priority || 'medium').toLowerCase(),
        status: 'in_progress',
      },
      update: { title: issue.summary, sourceUrl: issue.url, status: 'in_progress' },
    });
    requirementId = requirement.id;
    await log('jira.read', 'success', `${issue.key}: ${issue.summary} (status: ${issue.status})`);
  } else {
    await step('jira.read', `Reading ${run.issueKey}`);
    const requirement = await db.requirement.findUnique({ where: { id: run.requirementId ?? '' } });
    if (!requirement) throw new Error('The requirement for this run was deleted.');
    issue = {
      key: requirement.key,
      summary: requirement.title,
      description: requirement.description ?? '',
      type: 'Requirement',
      priority: requirement.priority,
      url: null,
    };
    await setRequirementStatus('in_progress');
    await log('jira.read', 'success', `${issue.key}: ${issue.summary}`);
  }
  await update({ issueSummary: issue.summary, issueSnapshot: issue, specPath, branch, requirementId });

  // 2. In Progress before any implementation work (Jira only).
  if (isJira) {
    await step('jira.in_progress');
    const moved = await jira.transitionTo(issue.key, statuses.inProgress);
    await log('jira.in_progress', 'success', moved.changed ? `Moved from ${moved.from} to ${statuses.inProgress}` : `Already ${statuses.inProgress}`);
    if (moved.changed) await audit('jira.transitioned', `${moved.from} → ${statuses.inProgress}`);
  } else {
    await skip('jira.in_progress', 'Skipped: this requirement is not in Jira');
  }

  try {
    // 3. Test project: the project's test repository, or a blank Playwright project.
    await step('workspace');
    const { dir: workspace, hasRepo } = await prepareWorkspace(project, branch, (m) => log('workspace', 'info', m));
    await log('workspace', 'success', hasRepo ? `Branch ${branch} ready` : 'Blank Playwright project ready (no test repository connected)');

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

    // 6. Commit, push and open a draft PR (only with a test repository).
    let prUrl = null;
    if (hasRepo) {
      await step('publish');
      const published = await publishSpec({ dir: workspace, project, branch, specPath, issueKey: issue.key, summary: issue.summary, runUrl });
      prUrl = published.prUrl;
      await update({ prUrl });
      await log(
        'publish',
        published.pushed ? 'success' : 'warn',
        published.pushed
          ? `Pushed ${branch}${prUrl ? ` · ${prUrl}` : ''}`
          : `Committed on ${branch} in the local workspace only (set GITHUB_TOKEN to push and open a PR)`
      );
    } else {
      await skip('publish', 'Skipped: no test repository connected. The spec is saved in AgentQA (download it from this page).');
    }

    // 7. Results. For Jira: append the note, then Done. Re-read the flag from the database
    //    so Done can only follow a verified pass.
    await step('jira.done');
    const fresh = await db.agentRun.findUnique({ where: { id: run.id }, select: { verifiedPass: true } });
    if (!fresh.verifiedPass) throw new Error('Refusing to finish without a verified passing test.');
    if (isJira) {
      await jira.appendToDescription(issue.key, `✅ Automation test created: ${specFile}`);
      await log('jira.done', 'success', `Appended "✅ Automation test created: ${specFile}"`);
      const done = await jira.transitionTo(issue.key, statuses.done);
      await log('jira.done', 'success', done.changed ? `Moved to ${statuses.done}` : `Already ${statuses.done}`);
      await audit('jira.transitioned', `${statuses.inProgress} → ${statuses.done}`);
    }
    await recordTestCase(db, project, requirementId, issue);
    await log('jira.done', 'success', `Saved test case for ${issue.key}`);
    await audit('agent.run.passed', `${specPath}${prUrl ? ` · ${prUrl}` : ''}`);
    return { status: 'PASSED' };
  } catch (err) {
    const cancelled = err instanceof CancelledError || abortController.signal.aborted;
    await setRequirementStatus(cancelled ? 'open' : 'failed');
    // A Jira ticket stays In Progress. Tell the people watching it why.
    if (isJira && !cancelled) {
      await jira.addComment(issue.key, `AgentQA could not finish the automation test: ${err.message}${runUrl ? `\nDetails: ${runUrl}` : ''}`).catch(() => {});
    }
    err.step = currentStep;
    throw err;
  }
}

// Keeps the dashboard's requirement and test-case counts in step with real automation.
async function recordTestCase(db, project, requirementId, issue) {
  await db.requirement.update({ where: { id: requirementId }, data: { generatedTests: { increment: 1 }, status: 'automated' } });
  await db.testCase.create({
    data: {
      projectId: project.id,
      requirementId,
      title: `${issue.key}: ${issue.summary}`.slice(0, 300),
      type: 'e2e',
      priority: (issue.priority || 'medium').toLowerCase(),
      aiGenerated: true,
      automationStatus: 'scripted',
      lastResult: 'pass',
    },
  });
}
