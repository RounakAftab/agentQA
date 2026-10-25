// The project's test repository, checked out once per project and reset for every run.
import fs from 'node:fs/promises';
import path from 'node:path';
import { run, runOrThrow, redact } from './processes.mjs';

const ROOT = path.resolve(process.env.AGENT_WORKSPACE_DIR || '.agent-workspaces');

function githubRepo(repoUrl) {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(repoUrl);
  return m ? { owner: m[1], repo: m[2] } : null;
}

// Git arguments that authenticate one command. The token travels in a header for that command
// only, so it is never written to .git/config in the workspace.
export function gitAuthArgs(repoUrl) {
  const token = process.env.GITHUB_TOKEN;
  if (!token || !githubRepo(repoUrl)) return [];
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  return ['-c', `http.https://github.com/.extraheader=AUTHORIZATION: basic ${basic}`];
}

const exists = (p) => fs.access(p).then(() => true, () => false);

// Version used for blank test projects (projects without a test repository).
const PLAYWRIGHT_TEST_VERSION = '1.64.1';

const BLANK_CONFIG = `import { defineConfig } from '@playwright/test';

// Created by AgentQA for a project without a test repository.
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  use: { baseURL: process.env.BASE_URL, trace: 'retain-on-failure' },
});
`;

// A minimal Playwright project, kept between runs so dependencies install only once.
async function prepareBlankProject(project, log) {
  const dir = path.join(ROOT, `${project.id}-blank`);
  await fs.mkdir(path.join(dir, 'tests', 'generated'), { recursive: true });
  if (!(await exists(path.join(dir, 'package.json')))) {
    await log('No test repository connected: creating a blank Playwright project');
    await fs.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'agentqa-tests', private: true, devDependencies: { '@playwright/test': PLAYWRIGHT_TEST_VERSION } }, null, 2)
    );
    await fs.writeFile(path.join(dir, 'playwright.config.ts'), BLANK_CONFIG);
  }
  await installDependencies(dir, log);
  return dir;
}

// Installs npm dependencies once, then the browser build that project's Playwright expects.
async function installDependencies(dir, log) {
  if (!(await exists(path.join(dir, 'package.json')))) return;
  if (await exists(path.join(dir, 'node_modules'))) return;
  const hasLock = await exists(path.join(dir, 'package-lock.json'));
  await log(hasLock ? 'Installing dependencies (npm ci)' : 'Installing dependencies (npm install)');
  await runOrThrow('npm', [hasLock ? 'ci' : 'install', '--no-audit', '--no-fund'], { cwd: dir, timeoutMs: 15 * 60_000 });
  if (await exists(path.join(dir, 'node_modules', '@playwright', 'test'))) {
    await log('Checking the Chromium build for this Playwright version');
    await runOrThrow('npx', ['playwright', 'install', 'chromium'], { cwd: dir, timeoutMs: 15 * 60_000 });
  }
}

// Clones (or refreshes) the test repository on a clean branch from the default branch, or
// prepares a blank Playwright project when there is none. Returns { dir, hasRepo }.
export async function prepareWorkspace(project, branch, log) {
  if (!project.automationRepoUrl) return { dir: await prepareBlankProject(project, log), hasRepo: false };

  const dir = path.join(ROOT, project.id);
  const base = project.defaultBranch || 'main';
  const git = (...args) => runOrThrow('git', args, { cwd: dir, timeoutMs: 5 * 60_000 });
  const auth = gitAuthArgs(project.automationRepoUrl);

  if (await exists(path.join(dir, '.git'))) {
    await log(`Refreshing ${redact(project.automationRepoUrl)}`);
    // Also replaces a token-bearing URL saved by older workers.
    await git('remote', 'set-url', 'origin', project.automationRepoUrl);
    await git(...auth, 'fetch', '--depth', '50', 'origin', base);
    await git('checkout', '-B', branch, `origin/${base}`);
    await git('reset', '--hard', `origin/${base}`);
    await git('clean', '-fd');
  } else {
    await log(`Cloning ${redact(project.automationRepoUrl)}`);
    await fs.mkdir(ROOT, { recursive: true });
    await runOrThrow('git', [...auth, 'clone', '--depth', '50', '--branch', base, project.automationRepoUrl, dir], { timeoutMs: 10 * 60_000 });
    await git('checkout', '-B', branch);
    // Keep worker scratch files out of commits.
    await fs.appendFile(path.join(dir, '.git', 'info', 'exclude'), '\n.agentqa/\n');
  }

  await installDependencies(dir, log);
  if (!(await exists(path.join(dir, 'node_modules', '@playwright', 'test')))) {
    throw new Error('The test repository has no @playwright/test installed. Add Playwright to it (npm init playwright@latest), or remove the test repository from the project to use a blank one.');
  }
  return { dir, hasRepo: true };
}

// Commits the spec, pushes the branch and opens a draft pull request. Without GITHUB_TOKEN
// the commit stays in the local workspace and { pushed: false } is returned.
export async function publishSpec({ dir, project, branch, specPath, issueKey, summary, runUrl }) {
  const git = (...args) => runOrThrow('git', args, { cwd: dir, timeoutMs: 5 * 60_000 });
  await git('add', '--', specPath);
  const staged = await run('git', ['diff', '--cached', '--quiet'], { cwd: dir });
  if (staged.code !== 0) {
    await git(
      '-c', `user.name=${process.env.AGENT_GIT_NAME || 'AgentQA'}`,
      '-c', `user.email=${process.env.AGENT_GIT_EMAIL || 'agentqa@users.noreply.github.com'}`,
      'commit', '-m', `test(${issueKey}): add automation test\n\n${summary}`
    );
  }

  const gh = githubRepo(project.automationRepoUrl);
  if (!process.env.GITHUB_TOKEN || !gh) return { pushed: false, prUrl: null };

  // The branch is rebuilt from the default branch on every run, so a branch left by an earlier
  // run is replaced. Only the default branch is fetched, so look up the branch's current commit
  // for the lease; without it the push is rejected as "stale info".
  const auth = gitAuthArgs(project.automationRepoUrl);
  const remoteHead = await git(...auth, 'ls-remote', 'origin', `refs/heads/${branch}`);
  const leaseSha = remoteHead.stdout.trim().split(/\s+/)[0] || '';
  await git(...auth, 'push', `--force-with-lease=refs/heads/${branch}:${leaseSha}`, '-u', 'origin', branch);

  const headers = {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const api = `https://api.github.com/repos/${gh.owner}/${gh.repo}/pulls`;
  const existing = await fetch(`${api}?head=${gh.owner}:${encodeURIComponent(branch)}&state=open`, { headers });
  if (existing.ok) {
    const [pr] = await existing.json();
    if (pr) return { pushed: true, prUrl: pr.html_url };
  }
  const res = await fetch(api, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: `test(${issueKey}): ${summary}`.slice(0, 250),
      head: branch,
      base: project.defaultBranch || 'main',
      draft: true,
      body: `Automation test for ${issueKey}, written and verified by the AgentQA QA Agent.\n\nSpec: \`${specPath}\`\n${runUrl ? `Run: ${runUrl}\n` : ''}`,
    }),
  });
  if (!res.ok) throw new Error(`GitHub could not open the pull request (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return { pushed: true, prUrl: (await res.json()).html_url };
}
