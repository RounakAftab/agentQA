// Turns a Playwright JSON report (--reporter=json) into the numbers and failures stored for a
// CI run. Pure functions, no imports, so tests and scripts can use it too.

const stripAnsi = (s) => String(s ?? '').replace(/\u001b\[[0-9;]*m/g, '');

// Rule-based first read of an error, so a reviewer knows where to look. Not a diagnosis.
const CAUSES = [
  [/strict mode violation/i, 'The locator matches more than one element. Make it more specific: an exact accessible name, a role, or scope it to a container.'],
  [/net::ERR_|ECONNREFUSED|ENOTFOUND|ERR_NAME_NOT_RESOLVED/i, 'The application could not be reached. Check BASE_URL and that the environment is up before suspecting the test.'],
  [/toHaveURL|waitForURL/i, 'The page did not reach the expected URL. A redirect, login or navigation step may have changed.'],
  [/toHaveText|toContainText|toHaveValue|toHaveTitle/i, 'The page shows different content than the test expects. Either the app changed (confirm it is intended) or the expectation is out of date.'],
  [/toBeVisible|toBeHidden|toBeEnabled|toBeChecked/i, 'An element was not in the expected state. It may be renamed, moved, hidden behind another step, or slower to appear.'],
  [/Timeout \d+ms exceeded|timed out|waiting for (locator|getBy)/i, 'Timed out waiting for an element. The selector may no longer match the page, or the page is slower than before.'],
  [/E2E_USERNAME|E2E_PASSWORD|Invalid credentials/i, 'Login failed. Check the E2E_USERNAME and E2E_PASSWORD secrets in the test repository.'],
  [/SyntaxError|Cannot find module|is not defined|TypeError/i, 'The spec itself does not run: a code or import error, not an application problem.'],
];

export function likelyCause(error) {
  const hit = CAUSES.find(([re]) => re.test(error));
  return hit ? hit[1] : null;
}

function walk(suites, path, out) {
  for (const suite of suites ?? []) {
    const here = suite.title && !/\.(spec|test)\.[cm]?[jt]sx?$/.test(suite.title) ? [...path, suite.title] : path;
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) out.push({ spec, test: t, path: here });
    }
    walk(suite.suites, here, out);
  }
  return out;
}

// Resolves { totalTests, passed, failed, skipped, flaky, durationSec, startedAt, failures[] }.
// Flaky tests (failed, then passed on retry) count as passed and are listed as failures too.
export function summarizeReport(report) {
  const entries = walk(report?.suites, [], []);
  const counts = { expected: 0, unexpected: 0, skipped: 0, flaky: 0 };
  const failures = [];

  for (const { spec, test, path } of entries) {
    counts[test.status] = (counts[test.status] ?? 0) + 1;
    if (test.status !== 'unexpected' && test.status !== 'flaky') continue;
    const failed = (test.results ?? []).filter((r) => r.status !== 'passed' && r.status !== 'skipped');
    const last = failed[failed.length - 1] ?? test.results?.[0] ?? {};
    const error = stripAnsi((last.errors ?? []).map((e) => e.message ?? e.value ?? '').filter(Boolean).join('\n') || last.error?.message || `Test ${test.status}`).slice(0, 8000);
    failures.push({
      testName: `${spec.title}${test.projectName ? ` [${test.projectName}]` : ''}${test.status === 'flaky' ? ' (flaky)' : ''}`.slice(0, 500),
      className: [spec.file, ...path].filter(Boolean).join(' › ').slice(0, 500),
      error,
      duration: Math.round((last.duration ?? 0) / 100) / 10,
      aiAnalysis: likelyCause(error),
    });
  }

  // Errors outside any test (config, import or global setup failures).
  for (const e of report?.errors ?? []) {
    const error = stripAnsi(e.message ?? e.value ?? '').slice(0, 8000);
    failures.push({ testName: 'Test run error', className: e.location?.file ?? '', error, duration: 0, aiAnalysis: likelyCause(error) });
  }

  const started = report?.stats?.startTime ? new Date(report.stats.startTime) : null;
  return {
    totalTests: entries.length,
    passed: counts.expected + counts.flaky,
    failed: counts.unexpected,
    skipped: counts.skipped,
    flaky: counts.flaky,
    durationSec: Math.round((report?.stats?.duration ?? 0) / 1000),
    startedAt: started && !Number.isNaN(started.getTime()) ? started : null,
    failures,
  };
}
