// Runs one spec in the test repository with Playwright's JSON reporter and summarises it.
import fs from 'node:fs/promises';
import path from 'node:path';
import { run } from './processes.mjs';

const stripAnsi = (s) => String(s ?? '').replace(/\u001b\[[0-9;]*m/g, '');

function collectFailures(suites, out = []) {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        for (const r of t.results ?? []) {
          if (r.status === 'passed' || r.status === 'skipped') continue;
          const messages = (r.errors ?? []).map((e) => stripAnsi(e.message ?? e.value ?? '')).filter(Boolean);
          out.push({ title: spec.title, status: r.status, error: messages.join('\n').slice(0, 4000) });
        }
      }
    }
    collectFailures(suite.suites, out);
  }
  return out;
}

// Resolves { passed, stats, failures, output }. `passed` requires at least one test and
// no unexpected or flaky results.
export async function runSpec({ workspace, specPath, env, signal }) {
  const reportFile = path.join(workspace, '.agentqa', `report-${Date.now()}.json`);
  await fs.mkdir(path.dirname(reportFile), { recursive: true });

  const result = await run('npx', ['playwright', 'test', specPath, '--reporter=json', '--retries=0'], {
    cwd: workspace,
    env: { ...env, PLAYWRIGHT_JSON_OUTPUT_FILE: reportFile, CI: '1', FORCE_COLOR: '0' },
    timeoutMs: Number(process.env.AGENT_TEST_TIMEOUT_MS) || 5 * 60_000,
    signal,
  });

  let report = null;
  try {
    report = JSON.parse(await fs.readFile(reportFile, 'utf8'));
  } catch {
    // No report: Playwright failed before running tests (bad config, syntax error, missing browsers).
  }
  await fs.rm(reportFile, { force: true });

  const output = stripAnsi(`${result.stdout}\n${result.stderr}`).trim().slice(-6000);
  if (!report) {
    return { passed: false, stats: null, failures: [{ title: 'Playwright', status: 'error', error: output || `exit ${result.code}` }], output };
  }

  const stats = {
    expected: report.stats?.expected ?? 0,
    unexpected: report.stats?.unexpected ?? 0,
    flaky: report.stats?.flaky ?? 0,
    skipped: report.stats?.skipped ?? 0,
    durationMs: Math.round(report.stats?.duration ?? 0),
  };
  const failures = collectFailures(report.suites);
  for (const e of report.errors ?? []) failures.push({ title: 'Load error', status: 'error', error: stripAnsi(e.message).slice(0, 4000) });

  const passed = result.code === 0 && stats.expected > 0 && stats.unexpected === 0 && stats.flaky === 0 && failures.length === 0;
  return { passed, stats, failures, output };
}
