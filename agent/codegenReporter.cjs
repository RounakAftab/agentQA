// Playwright reporter for Codegen runs (agent/codegenRunner.mjs). Writes every test and its
// actions and checks to the JSON file in AGENTQA_RESULTS while the run goes, for the Tests panel.
// CommonJS, because Playwright loads reporters with require().
const fs = require('node:fs');
const path = require('node:path');

const SHOWN = new Set(['pw:api', 'expect', 'test.step']);
const MAX_SCREENSHOT = 1_500_000;

// Playwright titles a fill with the typed text ("Fill \"secret\""), so the test password is masked
// everywhere the results go.
const PASSWORD = process.env.E2E_PASSWORD;
const mask = (s) => (PASSWORD && PASSWORD.length >= 3 ? s.split(PASSWORD).join('••••••') : s);
const strip = (s) => mask(String(s ?? '').replace(/\u001b\[[0-9;]*m/g, ''));

// The line of code a step comes from ("await this.loginButton.click();"), which says more than
// Playwright's own title ("Click").
const sources = new Map();
function codeAt(location) {
  if (!location) return null;
  if (!sources.has(location.file)) {
    try {
      sources.set(location.file, fs.readFileSync(location.file, 'utf8').split(/\r?\n/));
    } catch {
      sources.set(location.file, []);
    }
  }
  const line = sources.get(location.file)[location.line - 1];
  return line ? mask(line.trim()).slice(0, 300) : null;
}

class CodegenReporter {
  constructor() {
    this.tests = new Map(); // test id -> entry
    this.file = process.env.AGENTQA_RESULTS;
  }

  write(status, duration) {
    if (!this.file) return;
    const out = { status, duration, tests: [...this.tests.values()] };
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(out));
    fs.renameSync(`${this.file}.tmp`, this.file); // the runner never reads half a file
  }

  onTestBegin(test) {
    this.tests.set(test.id, {
      title: test.title,
      file: path.basename(test.location.file),
      status: 'running',
      duration: 0,
      error: null,
      steps: [],
      screenshot: null,
    });
    this.write('running', 0);
  }

  // Actions and checks written in the test or a page object; Playwright's own internal steps
  // (fixtures, hooks, nested calls) are left out.
  onStepEnd(test, _result, step) {
    const entry = this.tests.get(test.id);
    if (!entry || !SHOWN.has(step.category)) return;
    let parent = step.parent;
    while (parent && parent.category === 'test.step') parent = parent.parent;
    if (parent) return;
    entry.steps.push({
      title: strip(step.title),
      code: codeAt(step.location),
      category: step.category,
      duration: step.duration,
      error: step.error ? strip(step.error.message).slice(0, 2000) : null,
      file: step.location ? path.basename(step.location.file) : null,
      folder: step.location ? path.basename(path.dirname(step.location.file)) : null,
      line: step.location?.line ?? null,
    });
    this.write('running', 0);
  }

  onTestEnd(test, result) {
    const entry = this.tests.get(test.id);
    if (!entry) return;
    entry.status = result.status;
    entry.duration = result.duration;
    entry.error = result.error ? strip(result.error.message).slice(0, 4000) : null;
    const shot = result.attachments.find((a) => a.name === 'screenshot' && a.path);
    if (shot) {
      try {
        const bytes = fs.readFileSync(shot.path);
        if (bytes.length <= MAX_SCREENSHOT) entry.screenshot = `data:image/png;base64,${bytes.toString('base64')}`;
      } catch {
        // No screenshot: the panel shows the error alone.
      }
    }
    this.write('running', 0);
  }

  onEnd(result) {
    this.write(result.status, Math.round(result.duration));
  }

  printsToStdio() {
    return false;
  }
}

module.exports = CodegenReporter;
