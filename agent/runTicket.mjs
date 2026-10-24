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
import { runAgentSession, runHealerSession } from './session.mjs';

// Healer sessions allowed after a failed verification (0 turns healing off).
// Each one gets the same turn, budget and test-run limits as the author session.
const HEAL_ATTEMPTS = Math.max(0, Number(process.env.AGENT_HEAL_ATTEMPTS ?? 1) || 0);

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
    await step('agent', `Starting agent (${process.env.AGENT_MODEL || 'claude-haiku-5-5'})`);
    let costUsd = 0;
    const addCost = async (outcome) => {
      if (outcome.costUsd == null) return;
      costUsd += outcome.costUsd;
      await update({ costUsd });
    };
    // Tools report under the step of the session that called them ('agent' or 'heal').
    const sessionCtx = (tag) => ({
      log,
      savePlan: async (plan) => {
        await update({ testPlan: plan });
        await log(tag, 'success', `Test plan: ${plan.steps.length} steps, ${plan.acceptanceCriteria.length} acceptance criteria`);
      },
      saveSpec: async (content) => {
        await update({ specContent: content });
        await log(tag, 'success', `Wrote ${specPath}`);
      },
      countTestRun: (n) => update({ testAttempts: n }),
    });
    const session = { workspace, project, issue, specPath, testEnv, credentials, abortController };
    const outcome = await runAgentSession({ ...session, ctx: sessionCtx('agent') });
    checkCancelled();
    await addCost(outcome);
    if (outcome.summary) await log('agent', outcome.ok ? 'info' : 'warn', outcome.summary.slice(0, 4000));
    if (!outcome.plan) throw new Error('The agent finished without submitting a test plan.');
    const plan = outcome.plan;

    // 5. Independent verification: the file on disk must pass the rules and the test must pass.
    //    A spec that fails goes to the healer, then is verified again from scratch.
    const verify = async (finished) => {
      const content = await fs.readFile(path.join(workspace, specPath), 'utf8').catch(() => null);
      if (!content) {
        return {
          problem: `The agent did not create ${specPath}.${finished.lastRejection ? ` Its last draft was rejected: ${finished.lastRejection}` : finished.ok ? '' : ` ${finished.summary}`}`,
          draft: finished.lastDraft,
        };
      }
      const { errors } = checkSpec(content, plan, credentials);
      if (errors.length > 0) return { problem: `Spec breaks the rules: ${errors.join(' ')}`, draft: content };
      const verification = await runSpec({ workspace, specPath, env: testEnv, signal: abortController.signal });
      checkCancelled();
      if (!verification.passed) {
        const first = verification.failures[0];
        return {
          problem: `Verification run failed${first ? `: ${first.title} — ${first.error.split('\n')[0]}` : ''}`,
          draft: content,
          failures: verification.failures,
        };
      }
      return { content, stats: verification.stats };
    };

    await step('verify', 'Re-running the spec to confirm it passes');
    let result = await verify(outcome);
    let testRuns = outcome.testRuns;
    if (result.problem) {
      await log('verify', 'warn', result.problem);
      for (let attempt = 1; result.problem && attempt <= HEAL_ATTEMPTS; attempt++) {
        await step('heal', `Healer attempt ${attempt} of ${HEAL_ATTEMPTS}: ${result.problem.slice(0, 300)}`);
        const healed = await runHealerSession({
          ...session,
          ctx: sessionCtx('heal'),
          plan,
          draft: result.draft,
          problem: result.problem,
          failures: result.failures,
          testRunsSoFar: testRuns,
        });
        checkCancelled();
        await addCost(healed);
        testRuns = healed.testRuns;
        if (healed.summary) await log('heal', healed.ok ? 'info' : 'warn', healed.summary.slice(0, 4000));
        await log('heal', 'info', 'Re-running the healed spec to confirm it passes');
        result = await verify(healed);
        if (result.problem) await log('heal', 'warn', result.problem);
      }
      if (result.problem) throw new Error(HEAL_ATTEMPTS > 0 ? `${result.problem} (still failing after healing)` : result.problem);
    } else {
      await skip('heal', 'Skipped: the spec passed on the first verification');
    }
    const { content } = result;
    await update({ verifiedPass: true, specContent: content });
    await log(skipped.includes('heal') ? 'verify' : 'heal', 'success', `Passed: ${result.stats.expected} test(s) in ${(result.stats.durationMs / 1000).toFixed(1)}s`);

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
    const testCase = await recordTestCase(db, project, requirementId, issue);
    await log('jira.done', 'success', `Saved test case for ${issue.key}`);
    await requestApproval(db, { run, testCase, issue, specPath, content, prUrl });
    await log('jira.done', 'success', 'Sent the spec to Approvals for review');
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
  return db.testCase.create({
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

// A verified spec still needs a human sign-off before it is trusted. Opens a review in
// Approvals and retires any open review of an earlier run of the same ticket.
async function requestApproval(db, { run, testCase, issue, specPath, content, prUrl }) {
  await db.approval.updateMany({
    where: {
      projectId: run.projectId,
      status: { in: ['PENDING', 'CHANGES_REQUESTED'] },
      agentRun: { issueKey: run.issueKey },
      NOT: { agentRunId: run.id },
    },
    data: { status: 'SUPERSEDED', decidedAt: new Date() },
  });
  await db.approval.create({
    data: {
      projectId: run.projectId,
      agentRunId: run.id,
      testCaseId: testCase.id,
      type: 'automation_script',
      title: `${issue.key}: ${issue.summary}`.slice(0, 300),
      description: `Playwright spec ${specPath} written by the QA Agent and verified passing.${prUrl ? ` Pull request: ${prUrl}` : ''}`,
      requestedBy: 'QA Agent',
      codePreview: content,
    },
  });
}
