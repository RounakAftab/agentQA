// node --test src/lib/codegen/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRunReport } from './report.js';

const step = (code, duration, extra = {}) => ({
  title: code.includes('expect(') ? 'Expect "toBeVisible"' : 'Click',
  code,
  category: code.includes('expect(') ? 'expect' : 'pw:api',
  duration,
  error: null,
  file: 'login.spec.ts',
  folder: 'tests',
  line: 1,
  ...extra,
});
const GOTO = "await page.goto('/login');";
const FILL = "await page.getByRole('textbox', { name: 'Username' }).fill('Admin');";
const CLICK = "await page.getByRole('button', { name: 'Login' }).click();";
const CHECK = "await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();";

const results = (steps, status = 'passed') => ({
  status,
  duration: steps.reduce((s, x) => s + x.duration, 0),
  tests: [{ title: 'test', file: 'login.spec.ts', status, duration: 0, error: status === 'passed' ? null : 'Timed out', steps, screenshot: null }],
});
const run = (steps, extra = {}) => ({ id: 'now', status: 'PASSED', style: 'plain', createdAt: '2026-11-03T10:00:00Z', results: results(steps), ...extra });
const past = (id, steps, status = 'PASSED', createdAt = '2026-11-02T10:00:00Z') => {
  const r = results(steps, status === 'PASSED' ? 'passed' : 'failed');
  return { id, status, style: 'plain', createdAt, duration: r.duration, tests: r.tests };
};
const script = { title: 'Login', startUrl: 'https://app.example/login', updatedAt: '2026-11-01T00:00:00Z' };
const titles = (report) => report.insights.map((i) => i.title);

test('summarises a passing run: actions, checks, navigations and the slowest steps', () => {
  const report = buildRunReport({ run: run([step(GOTO, 900), step(FILL, 100), step(CLICK, 400), step(CHECK, 600)]), script });
  assert.deepEqual(
    { actions: report.summary.actions, checks: report.summary.checks, navigations: report.summary.navigations, durationMs: report.summary.durationMs },
    { actions: 3, checks: 1, navigations: 1, durationMs: 2000 }
  );
  assert.equal(report.insights[0].level, 'good');
  assert.match(report.insights[0].title, /^Passed: 1 check after 3 actions in 2\.0 s/);
  assert.equal(report.slowest[0].label, GOTO);
  assert.equal(report.slowest[0].sharePct, 45);
});

test('warns when a test checks nothing, and when it ends without a check', () => {
  const none = buildRunReport({ run: run([step(GOTO, 100), step(CLICK, 100)]), script });
  assert.ok(titles(none).includes('No checks'));
  const endsOpen = buildRunReport({ run: run([step(GOTO, 100), step(CHECK, 100), step(CLICK, 100)]), script });
  assert.ok(titles(endsOpen).includes('Ends without a check'));
  assert.ok(!titles(endsOpen).includes('No checks'));
});

test('points out a long stretch of actions without a check', () => {
  const steps = [step(GOTO, 10), ...Array.from({ length: 8 }, (_, i) => step(`await page.getByText('${i}').click();`, 10)), step(CHECK, 10)];
  const report = buildRunReport({ run: run(steps), script });
  assert.ok(titles(report).includes('9 actions in a row without a check (steps 1–9)'));
});

test('compares each step and the total with earlier passing runs of the same style', () => {
  const usual = [step(GOTO, 500), step(CLICK, 200), step(CHECK, 300)];
  const history = [past('a', usual), past('b', usual), past('c', usual)];
  const report = buildRunReport({ run: run([step(GOTO, 500), step(CLICK, 2600), step(CHECK, 300)]), history, script });
  assert.deepEqual(report.slower, [{ label: CLICK, durationMs: 2600, usualMs: 200 }]);
  assert.ok(titles(report).includes(`Slower than usual: ${CLICK}`));
  assert.ok(titles(report).includes('240% slower than usual'));
  assert.equal(report.summary.usualDurationMs, 1000);
  // A run in the other style (Page Object Model) is not a baseline.
  const otherStyle = buildRunReport({ run: run([step(CLICK, 2600)], { style: 'pom' }), history, script });
  assert.deepEqual(otherStyle.slower, []);
});

test('flags an unstable recording, but not failures from before the recording changed', () => {
  const ok = [step(GOTO, 100), step(CHECK, 100)];
  const flaky = buildRunReport({ run: run(ok), history: [past('a', ok, 'FAILED'), past('b', ok)], script });
  assert.ok(titles(flaky).some((t) => t.startsWith('Unstable: failed 1 of the last 3 runs')));
  const before = buildRunReport({ run: run(ok), history: [past('a', ok), past('b', ok, 'FAILED', '2026-10-01T00:00:00Z')], script });
  assert.ok(!titles(before).some((t) => t.startsWith('Unstable')));
});

test('celebrates a pass after failures and keeps the trend oldest first', () => {
  const ok = [step(GOTO, 100), step(CHECK, 100)];
  const report = buildRunReport({ run: run(ok), history: [past('b', ok, 'FAILED', '2026-11-02T12:00:00Z'), past('a', ok, 'FAILED')], script });
  assert.ok(titles(report).includes('Passing again after 2 failed runs'));
  assert.deepEqual(report.trend.map((t) => t.id), ['a', 'b', 'now']);
  assert.equal(report.trend.at(-1).current, true);
});

test('explains slow steps and fixed waits, and names the failing step of a failed run', () => {
  const slow = buildRunReport({ run: run([step(GOTO, 5200), step('await page.waitForTimeout(3000);', 3000), step(CHECK, 100)]), script });
  assert.ok(titles(slow).includes(`Slow step: ${GOTO} (5.2 s)`));
  assert.ok(titles(slow).includes('Fixed waits'));
  const failedSteps = [step(GOTO, 100), step(CHECK, 5000, { error: 'Timed out 5000ms waiting for expect(locator).toBeVisible()' })];
  const failed = buildRunReport({ run: { ...run(failedSteps), status: 'FAILED', results: results(failedSteps, 'failed') }, script });
  assert.equal(failed.insights[0].level, 'bad');
  assert.equal(failed.insights[0].title, `Failed at: ${CHECK}`);
});

test('breaks time down by page object for Page Object Model runs', () => {
  const pom = (code, duration, file) => step(code, duration, { folder: 'pages', file });
  const report = buildRunReport({ run: run([pom(GOTO, 300, 'LoginPage.ts'), pom(CLICK, 200, 'LoginPage.ts'), pom(CHECK, 900, 'DashboardPage.ts')], { style: 'pom' }), script });
  assert.deepEqual(report.pages, [
    { page: 'DashboardPage', durationMs: 900, steps: 1 },
    { page: 'LoginPage', durationMs: 500, steps: 2 },
  ]);
});
