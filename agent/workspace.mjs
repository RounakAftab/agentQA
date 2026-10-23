// The project's test repository, checked out once per project and reset for every run.
import fs from 'node:fs/promises';
import path from 'node:path';
import { run, runOrThrow, redact } from './processes.mjs';

const ROOT = path.resolve(process.env.AGENT_WORKSPACE_DIR || '.agent-workspaces');

function githubRepo(repoUrl) {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(repoUrl);
  return m ? { owner: m[1], repo: m[2] } : null;
}

function authedUrl(repoUrl) {
  const token = process.env.GITHUB_TOKEN;
  if (!token || !githubRepo(repoUrl)) return repoUrl;
  return repoUrl.replace('https://', `https://x-access-token:${token}@`);
}

const exists = (p) => fs.access(p).then(() => true, () => false);

// Clones (or refreshes) the repository and creates a clean branch from the default branch.
export async function prepareWorkspace(project, branch, log) {
  const dir = path.join(ROOT, project.id);
  const base = project.defaultBranch || 'main';
  const git = (...args) => runOrThrow('git', args, { cwd: dir, timeoutMs: 5 * 60_000 });

  if (await exists(path.join(dir, '.git'))) {
    await log(`Refreshing ${redact(project.automationRepoUrl)}`);
    await git('remote', 'set-url', 'origin', authedUrl(project.automationRepoUrl));
    await git('fetch', '--depth', '50', 'origin', base);
    await git('checkout', '-B', branch, `origin/${base}`);
    await git('reset', '--hard', `origin/${base}`);
    await git('clean', '-fd');
  } else {
    await log(`Cloning ${redact(project.automationRepoUrl)}`);
    await fs.mkdir(ROOT, { recursive: true });
    await runOrThrow('git', ['clone', '--depth', '50', '--branch', base, authedUrl(project.automationRepoUrl), dir], { timeoutMs: 10 * 60_000 });
    await git('checkout', '-B', branch);
    // Keep worker scratch files out of commits.
    await fs.appendFile(path.join(dir, '.git', 'info', 'exclude'), '\n.agentqa/\n');
  }

  if (await exists(path.join(dir, 'package.json'))) {
    if (!(await exists(path.join(dir, 'node_modules')))) {
      const hasLock = await exists(path.join(dir, 'package-lock.json'));
      await log(hasLock ? 'Installing dependencies (npm ci)' : 'Installing dependencies (npm install)');
      await runOrThrow('npm', [hasLock ? 'ci' : 'install', '--no-audit', '--no-fund'], { cwd: dir, timeoutMs: 15 * 60_000 });
    }
  }
  if (!(await exists(path.join(dir, 'node_modules', '@playwright', 'test')))) {
    throw new Error('The test repository has no @playwright/test installed. Add Playwright to it (npm init playwright@latest) and try again.');
  }
  return dir;
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

  await git('push', '--force-with-lease', '-u', 'origin', branch);

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
