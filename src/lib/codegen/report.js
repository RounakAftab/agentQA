// Rule-based report of a finished Codegen run: what ran, where the time went, what changed compared
// with earlier runs of the same script, and what to improve. Pure, so it is unit tested
// (report.test.mjs); no model is used.

const SLOW_STEP_MS = 3_000;
const UNCHECKED_RUN = 8; // actions in a row without a check
const BASELINE_RUNS = 5; // earlier passing runs a step is compared with
const SLOWER_FACTOR = 1.5;
const SLOWER_MIN_MS = 300;
const TREND_RUNS = 10;

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
export const formatDuration = (ms) => (ms == null ? '–' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);

const isCheck = (step) => step.category === 'expect';
const isNavigation = (step) => /\.goto\(/.test(step.code ?? '') || /^Navigate/i.test(step.title);
const label = (step) => step.code ?? step.title;

// Every step of every test, in order, with a key that matches the same step in other runs: its code
// (or title) and how many times that code came before it.
function flatten(tests) {
  const seen = new Map();
  return tests.flatMap((test) =>
    test.steps.map((step) => {
      const base = `${test.title}|${label(step)}`;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      return { ...step, test: test.title, key: `${base}#${n}` };
    })
  );
}

// The longest stretch of actions without a check: { length, from, to } (1-based step numbers).
function longestUnchecked(steps) {
  let best = { length: 0, from: 0, to: 0 };
  let start = null;
  steps.forEach((step, i) => {
    if (isCheck(step)) start = null;
    else {
      start ??= i;
      if (i - start + 1 > best.length) best = { length: i - start + 1, from: start + 1, to: i + 1 };
    }
  });
  return best;
}

// Time per page object (Page Object Model runs); null when everything ran in one file.
function timeByPage(steps) {
  const groups = new Map();
  for (const step of steps) {
    if (step.folder !== 'pages' || !step.file) continue;
    const name = step.file.replace(/\.[jt]s$/, '');
    const g = groups.get(name) ?? groups.set(name, { page: name, durationMs: 0, steps: 0 }).get(name);
    g.durationMs += step.duration ?? 0;
    g.steps += 1;
  }
  return groups.size > 1 ? [...groups.values()].sort((a, b) => b.durationMs - a.durationMs) : null;
}

/**
 * @param run      the finished run: { id, status, style, createdAt, results: { status, duration, tests } }
 * @param history  earlier finished runs of the same script, newest first: { id, status, style, createdAt, duration, tests }
 * @param script   { title, startUrl, updatedAt }
 */
export function buildRunReport({ run, history = [], script }) {
  const tests = run.results?.tests ?? [];
  const steps = flatten(tests);
  const actions = steps.filter((s) => !isCheck(s));
  const checks = steps.filter(isCheck);
  const durationMs = run.results?.duration ?? tests.reduce((sum, t) => sum + (t.duration ?? 0), 0);
  const stepTotal = steps.reduce((sum, s) => sum + (s.duration ?? 0), 0) || 1;
  const insights = [];
  const add = (level, title, detail = null) => insights.push({ level, title, detail });

  // Earlier passing runs of the same style, to compare timings with.
  const baseline = history.filter((h) => h.status === 'PASSED' && h.style === run.style).slice(0, BASELINE_RUNS);
  const baselineSteps = new Map();
  for (const h of baseline) {
    for (const s of flatten(h.tests ?? [])) (baselineSteps.get(s.key) ?? baselineSteps.set(s.key, []).get(s.key)).push(s.duration ?? 0);
  }

  const slowest = [...steps]
    .sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0))
    .slice(0, 5)
    .map((s) => ({ label: label(s), durationMs: s.duration ?? 0, sharePct: Math.round(((s.duration ?? 0) / stepTotal) * 100), isCheck: isCheck(s) }));

  const slower = steps
    .map((s) => {
      const usual = baselineSteps.get(s.key);
      if (!usual?.length) return null;
      const typical = median(usual);
      return (s.duration ?? 0) > Math.max(typical * SLOWER_FACTOR, typical + SLOWER_MIN_MS) ? { label: label(s), durationMs: s.duration, usualMs: Math.round(typical) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.durationMs - b.usualMs - (a.durationMs - a.usualMs));

  // Runs of the current recording: anything before the script last changed tested different code.
  const sinceChange = [run, ...history].filter((r) => !script?.updatedAt || new Date(r.createdAt) >= new Date(script.updatedAt));
  const failedSinceChange = sinceChange.filter((r) => r.status === 'FAILED').length;
  const trend = [run, ...history]
    .slice(0, TREND_RUNS)
    .reverse()
    .map((r) => ({ id: r.id, status: r.status, durationMs: r.results?.duration ?? r.duration ?? null, createdAt: r.createdAt, current: r.id === run.id }));
  const usualTotal = baseline.length ? median(baseline.map((h) => h.duration ?? 0)) : null;

  // ---- Insights, most important first ----
  if (run.status === 'PASSED') {
    add('good', `Passed: ${checks.length} ${checks.length === 1 ? 'check' : 'checks'} after ${actions.length} ${actions.length === 1 ? 'action' : 'actions'} in ${formatDuration(durationMs)}`);
    const lastPass = history.findIndex((h) => h.status === 'PASSED');
    const failedBefore = lastPass === -1 ? history.filter((h) => h.status === 'FAILED').length : lastPass;
    if (failedBefore > 0 && history.slice(0, failedBefore).every((h) => h.status === 'FAILED')) {
      add('good', `Passing again after ${failedBefore} failed ${failedBefore === 1 ? 'run' : 'runs'}`);
    }
  } else {
    const failing = tests.find((t) => !['passed', 'skipped'].includes(t.status));
    const failedStep = steps.find((s) => s.error);
    add('bad', `Failed${failedStep ? ` at: ${label(failedStep)}` : ''}`, failing?.error?.split('\n')[0] ?? null);
  }
  if (checks.length === 0) {
    add('warn', 'No checks', 'The test clicks and types but never verifies what the page shows, so a broken page would still pass. Add a check with the eye or check buttons in the recorder toolbar.');
  } else {
    const unchecked = longestUnchecked(steps);
    if (unchecked.length >= UNCHECKED_RUN) {
      add('info', `${unchecked.length} actions in a row without a check (steps ${unchecked.from}–${unchecked.to})`, 'A check in between would show where a problem starts.');
    }
    if (steps.length && !isCheck(steps[steps.length - 1])) {
      add('info', 'Ends without a check', `Nothing verifies the result of the last action (${label(steps[steps.length - 1])}).`);
    }
  }
  if (sinceChange.length >= 3 && failedSinceChange > 0 && failedSinceChange < sinceChange.length) {
    add(
      'warn',
      `Unstable: failed ${failedSinceChange} of the last ${sinceChange.length} runs of this recording`,
      'The same code both passed and failed. If the app did not change in between, a step probably acts before the page is ready: add a check that waits for it.'
    );
  }
  if (usualTotal && durationMs > usualTotal * 1.3 && durationMs - usualTotal > 1_000) {
    add('warn', `${Math.round((durationMs / usualTotal - 1) * 100)}% slower than usual`, `This run took ${formatDuration(durationMs)}; earlier passing runs took ${formatDuration(usualTotal)}.`);
  } else if (usualTotal && durationMs < usualTotal * 0.77 && usualTotal - durationMs > 1_000) {
    add('good', `${Math.round((1 - durationMs / usualTotal) * 100)}% faster than usual`, `This run took ${formatDuration(durationMs)}; earlier passing runs took ${formatDuration(usualTotal)}.`);
  }
  for (const s of slower.slice(0, 3)) add('warn', `Slower than usual: ${s.label}`, `${formatDuration(s.durationMs)} this time, usually ${formatDuration(s.usualMs)}.`);
  for (const s of steps.filter((x) => (x.duration ?? 0) >= SLOW_STEP_MS).slice(0, 3)) {
    if (slower.some((x) => x.label === label(s))) continue;
    const why = isCheck(s) ? 'The page took that long to show what is checked.' : isNavigation(s) ? 'The page is slow to load.' : 'The app is slow to respond to this action.';
    add('info', `Slow step: ${label(s)} (${formatDuration(s.duration)})`, why);
  }
  if (steps.some((s) => /waitForTimeout\(/.test(s.code ?? ''))) {
    add('info', 'Fixed waits', 'waitForTimeout() always waits the full time and still breaks when the app is slower. Wait for what the page shows with a check instead.');
  }

  return {
    script: { title: script?.title ?? '', startUrl: script?.startUrl ?? '' },
    run: { id: run.id, status: run.status, style: run.style, createdAt: run.createdAt },
    summary: {
      durationMs,
      tests: tests.length,
      passedTests: tests.filter((t) => t.status === 'passed').length,
      actions: actions.length,
      checks: checks.length,
      navigations: steps.filter(isNavigation).length,
      usualDurationMs: usualTotal,
    },
    insights,
    slowest,
    slower,
    pages: timeByPage(steps),
    trend,
    steps: steps.map((s, i) => ({ n: i + 1, label: label(s), title: s.title, isCheck: isCheck(s), durationMs: s.duration ?? 0, error: s.error, where: s.file ? `${s.folder}/${s.file}:${s.line}` : null })),
    screenshot: tests.find((t) => t.screenshot)?.screenshot ?? null,
  };
}
