// The Claude Agent SDK session for one ticket. The agent gets only the tools defined here
// plus the Playwright MCP browser; built-in file and shell tools are disabled.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { checkPageObject, checkSpec, DEFAULT_PAGES_DIR, pageObjectPathProblem } from './guardrails.mjs';
import { runSpec } from './playwright.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PLAYWRIGHT_MCP = path.resolve(here, '..', 'node_modules', '@playwright', 'mcp', 'cli.js');
// Defaults are the low-cost mode; raise them in .env for harder tickets.
const MAX_TEST_RUNS = Number(process.env.AGENT_MAX_TEST_RUNS) || 3;

// Secrets the model and its subprocesses never need.
const HIDDEN_ENV = ['DATABASE_URL', 'DIRECT_URL', 'SESSION_SECRET', 'ENCRYPTION_KEY', 'GITHUB_TOKEN', 'SMTP_PASS', 'E2E_USERNAME', 'E2E_PASSWORD'];

const text = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });

// Resolves a repository-relative path and refuses anything outside the workspace.
function inside(workspace, rel) {
  const full = path.resolve(workspace, rel || '.');
  if (full !== workspace && !full.startsWith(workspace + path.sep)) throw new Error('Path is outside the test repository');
  if (full.split(path.sep).includes('node_modules') || full.split(path.sep).includes('.git')) throw new Error('That folder is not readable');
  return full;
}

export function ticketPrompt({ issue, project, specPath }) {
  return `Pick up ${issue.key} and automate it.

Project: ${project.name}
Application under test: ${project.appBaseUrl}  (also available to tests as process.env.BASE_URL)
Spec file: ${specPath}
Page objects: ${DEFAULT_PAGES_DIR}/ (or the repository's own page-object folder, if it has one)

# ${issue.key}: ${issue.summary}
Type: ${issue.type || 'n/a'} · Priority: ${issue.priority || 'n/a'}

${issue.description || '(The ticket has no description.)'}`;
}

// What the healer is told: the plan to keep, the spec (or rejected draft) and why it fails.
export function healerPrompt({ issue, project, specPath, plan, draft, problem, failures, pom = false, pageObjects = {} }) {
  const failureText = (failures ?? []).map((f) => `- ${f.title} (${f.status}):\n${f.error}`).join('\n\n');
  const pomText = pom
    ? `
## Page Object Model
The test uses page objects. Keep it that way: locators and page actions stay in page objects
(${DEFAULT_PAGES_DIR}/ or the repository's page-object folder), the spec only calls them and asserts.
A failing locator is fixed in its page object with \`write_page_object\`, not in the spec.
${Object.entries(pageObjects)
  .map(([file, content]) => `\n### ${file}\n\`\`\`ts\n${content}\n\`\`\``)
  .join('\n') || '\nNo page objects were saved yet.'}
`
    : '';
  return `Heal the failing test for ${issue.key}.

Project: ${project.name}
Application under test: ${project.appBaseUrl}  (also available to tests as process.env.BASE_URL)
Spec file: ${specPath}

# ${issue.key}: ${issue.summary}

${issue.description || '(The ticket has no description.)'}

## Test plan (fixed: keep every step and assert every criterion)
Flow: ${plan.flow}
Steps:
${plan.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}
Acceptance criteria:
${plan.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

## Why it fails
${problem}
${failureText ? `\n${failureText}\n` : ''}
## Current ${draft ? 'spec' : 'state'}
${draft ? `\`\`\`ts\n${draft}\n\`\`\`` : `No spec was saved. Write ${specPath} from the plan.`}
${pomText}`;
}

// Writes and fixes a spec for one ticket. The author session plans and writes it; the healer
// session (`plan` given) repairs a spec that failed verification without changing the plan.
// `ctx` carries the run state and callbacks the tools report through.
export function runAgentSession(options) {
  return runSession({ ...options, mode: 'author' });
}

export function runHealerSession(options) {
  return runSession({ ...options, mode: 'heal' });
}

// `pom`: the spec must use page objects, which the agent writes with write_page_object. `pageObjects`
// ({ path: source }) are the ones already written for this ticket, shown to the healer.
async function runSession({ mode, workspace, project, issue, specPath, testEnv, credentials, abortController, ctx, plan: fixedPlan, draft, problem, failures, testRunsSoFar = 0, pom = false, pageObjects = {} }) {
  const healing = mode === 'heal';
  const tag = healing ? 'heal' : 'agent';
  let plan = fixedPlan ?? null;
  let testRuns = 0;
  let lastResult = null;
  let lastDraft = null;
  let lastRejection = null;
  const written = {}; // page objects written in this session: { path: source }

  const qa = createSdkMcpServer({
    name: 'qa',
    version: '1.0.0',
    tools: [
      // The healer works to the author's plan; it may not rewrite what the test must prove.
      !healing && tool(
        'submit_test_plan',
        'Record the user flow, ordered test steps and acceptance criteria extracted from the Jira ticket. Call this before write_spec.',
        {
          flow: z.string().min(3).describe('One or two sentences describing the user flow'),
          steps: z.array(z.string().min(2)).min(1).describe('Test steps in order, as written or implied by the ticket'),
          acceptanceCriteria: z.array(z.string().min(2)).min(1).describe('Each criterion the test must assert'),
        },
        async (args) => {
          plan = args;
          await ctx.savePlan(plan);
          return text(`Plan saved: ${plan.steps.length} steps, ${plan.acceptanceCriteria.length} acceptance criteria.`);
        }
      ),
      tool(
        'list_repo_files',
        'List files and folders in the test repository (node_modules and .git are hidden).',
        { dir: z.string().default('.').describe('Folder relative to the repository root') },
        async ({ dir }) => {
          const entries = await fs.readdir(inside(workspace, dir), { withFileTypes: true });
          return text(
            entries
              .filter((e) => !['node_modules', '.git', '.agentqa'].includes(e.name))
              .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
              .join('\n') || '(empty)'
          );
        },
        { annotations: { readOnlyHint: true } }
      ),
      tool(
        'read_repo_file',
        'Read a text file from the test repository (up to 100 KB).',
        { path: z.string().describe('File path relative to the repository root') },
        async ({ path: rel }) => {
          const full = inside(workspace, rel);
          const stat = await fs.stat(full);
          if (stat.size > 100_000) return text('File is larger than 100 KB; not shown.');
          return text(await fs.readFile(full, 'utf8'));
        },
        { annotations: { readOnlyHint: true } }
      ),
      tool(
        'get_test_credentials',
        'The test account for logging in during browser inspection. Never write these values into the spec; the spec must read process.env.E2E_USERNAME and process.env.E2E_PASSWORD.',
        {},
        async () => {
          if (!credentials.username) return text('This project has no test account configured.');
          return text({ username: credentials.username, password: credentials.password });
        },
        { annotations: { readOnlyHint: true } }
      ),
      tool(
        'write_spec',
        `Write the full contents of ${specPath}. The file is checked against the spec rules; if it breaks one, it is not saved and the problems are returned.`,
        { content: z.string().min(20).describe('Complete TypeScript source of the spec file') },
        async ({ content }) => {
          if (!plan) return text('Call submit_test_plan first.');
          const { errors, warnings } = checkSpec(content, plan, credentials, { pom });
          if (errors.length > 0) {
            lastDraft = content;
            lastRejection = errors.join(' ');
            await ctx.log(tag, 'warn', `Spec rejected: ${lastRejection}`);
            return { ...text(`Not saved. Fix these problems:\n- ${errors.join('\n- ')}`), isError: true };
          }
          const full = path.join(workspace, specPath);
          await fs.mkdir(path.dirname(full), { recursive: true });
          await fs.writeFile(full, content, 'utf8');
          lastDraft = null;
          lastRejection = null;
          await ctx.saveSpec(content);
          return text(`Saved ${specPath}.${warnings.length ? `\nWarnings:\n- ${warnings.join('\n- ')}` : ''}`);
        }
      ),
      pom && tool(
        'write_page_object',
        `Create or replace a page object file: one class per page with its locators and actions (e.g. ${DEFAULT_PAGES_DIR}/LoginPage.ts). The file is checked against the rules; if it breaks one, it is not saved and the problems are returned.`,
        {
          path: z.string().min(3).describe(`File path relative to the repository root, inside a pages folder, e.g. ${DEFAULT_PAGES_DIR}/LoginPage.ts`),
          content: z.string().min(20).describe('Complete source of the page object file'),
        },
        async ({ path: rel, content }) => {
          const problemWithPath = pageObjectPathProblem(rel);
          if (problemWithPath) return { ...text(`Not saved. ${problemWithPath}`), isError: true };
          const { errors, warnings } = checkPageObject(content, credentials);
          if (errors.length > 0) {
            await ctx.log(tag, 'warn', `Page object ${rel} rejected: ${errors.join(' ')}`);
            return { ...text(`Not saved. Fix these problems:\n- ${errors.join('\n- ')}`), isError: true };
          }
          const file = rel.replace(/\\/g, '/');
          const full = inside(workspace, file);
          await fs.mkdir(path.dirname(full), { recursive: true });
          await fs.writeFile(full, content, 'utf8');
          written[file] = content;
          await ctx.savePageObject?.(file, content);
          return text(`Saved ${file}.${warnings.length ? `\nWarnings:\n- ${warnings.join('\n- ')}` : ''}`);
        }
      ),
      tool(
        'run_spec',
        `Run ${specPath} with Playwright and report the result. Limited to ${MAX_TEST_RUNS} runs per ticket.`,
        {},
        async () => {
          if (testRuns >= MAX_TEST_RUNS) return { ...text(`Run limit (${MAX_TEST_RUNS}) reached. Stop and summarise what is failing.`), isError: true };
          testRuns += 1;
          await ctx.countTestRun(testRunsSoFar + testRuns);
          lastResult = await runSpec({ workspace, specPath, env: testEnv, signal: abortController.signal });
          await ctx.log(tag, lastResult.passed ? 'success' : 'warn', lastResult.passed ? `Test run ${testRuns} passed` : `Test run ${testRuns} failed`);
          if (lastResult.setupError) {
            return { ...text(`The test could not start because of the worker's setup, not the spec: ${lastResult.setupError} Do not change the spec for this. Stop and report it.`), isError: true };
          }
          return text(
            lastResult.passed
              ? { passed: true, stats: lastResult.stats }
              : { passed: false, stats: lastResult.stats, failures: lastResult.failures, output: lastResult.failures.length ? undefined : lastResult.output }
          );
        }
      ),
    ].filter(Boolean),
  });

  const env = { ...process.env };
  for (const name of HIDDEN_ENV) delete env[name];
  // An empty key from .env would override the CLI login.
  if (!env.ANTHROPIC_API_KEY) delete env.ANTHROPIC_API_KEY;

  const systemPrompt = await fs.readFile(path.join(here, healing ? 'healerPrompt.md' : 'systemPrompt.md'), 'utf8');

  const session = query({
    prompt: healing
      ? healerPrompt({ issue, project, specPath, plan, draft, problem, failures, pom, pageObjects })
      : ticketPrompt({ issue, project, specPath }),
    options: {
      model: process.env.AGENT_MODEL || 'claude-haiku-5-5',
      systemPrompt,
      cwd: workspace,
      tools: [], // no built-in Read/Write/Bash: only the tools above and the browser
      mcpServers: {
        qa,
        playwright: {
          type: 'stdio',
          command: process.execPath,
          args: [PLAYWRIGHT_MCP, '--headless', '--isolated', '--output-dir', path.join(workspace, '.agentqa', 'browser')],
        },
      },
      // Anything not from these two servers is refused, whatever else is configured.
      canUseTool: async (name) =>
        name.startsWith('mcp__qa__') || name.startsWith('mcp__playwright__')
          ? { behavior: 'allow' }
          : { behavior: 'deny', message: 'Only the qa and playwright tools are available.' },
      settingSources: [],
      maxTurns: Number(process.env.AGENT_MAX_TURNS) || 40,
      maxBudgetUsd: Number(process.env.AGENT_MAX_BUDGET_USD) || 0.3,
      abortController,
      env,
    },
  });

  let result = null;
  for await (const message of session) {
    if (message.type === 'assistant') {
      for (const block of message.message.content ?? []) {
        if (block.type === 'text' && block.text.trim()) await ctx.log(tag, 'info', block.text.trim().slice(0, 2000));
        if (block.type === 'tool_use') await ctx.log(tag, 'info', `→ ${block.name.replace(/^mcp__\w+?__/, '')}`);
      }
    } else if (message.type === 'result') {
      result = message;
    }
  }

  return {
    plan,
    costUsd: result?.total_cost_usd ?? null,
    ok: result?.subtype === 'success',
    summary:
      result?.subtype === 'success'
        ? result.result
        : result?.subtype === 'error_max_budget_usd'
          ? `Stopped at the spending cap of $${Number(process.env.AGENT_MAX_BUDGET_USD) || 0.3} for this run (AGENT_MAX_BUDGET_USD).`
          : result?.subtype === 'error_max_turns'
            ? `Stopped after the maximum of ${Number(process.env.AGENT_MAX_TURNS) || 40} agent steps (AGENT_MAX_TURNS).`
            : (result?.errors ?? []).join('; ') || result?.subtype || 'Agent stopped',
    lastTestPassed: Boolean(lastResult?.passed),
    testRuns: testRunsSoFar + testRuns,
    // A draft the guard refused and never replaced, so the healer can start from it.
    lastDraft,
    lastRejection,
    pageObjects: written,
  };
}
