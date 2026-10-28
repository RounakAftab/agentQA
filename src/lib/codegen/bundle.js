// The downloadable project: generated code plus everything needed to run it with
// `npm install && npx playwright test`. Server-only (guardrails read process.env).
import { checkSpec } from '../../../agent/guardrails.mjs';
import { emitPlain, emitPom } from './emit.js';
import { slug } from './naming.js';

// Same version agent/workspace.mjs uses for blank test projects.
const PLAYWRIGHT_TEST_VERSION = '1.64.1';

export const emitCode = (script, style) => (style === 'plain' ? emitPlain(script) : emitPom(script));

// The QA Agent's spec rules (no XPath, no hardcoded credentials, no test.only...), applied to
// every generated file. A recording has no Jira plan, so the step and assertion counts are skipped.
export function checkCode(files) {
  const errors = new Set();
  const warnings = new Set();
  for (const content of Object.values(files)) {
    const result = checkSpec(content, { steps: [], acceptanceCriteria: [] });
    result.errors.filter((e) => !e.startsWith('Import test and expect')).forEach((e) => errors.add(e));
    result.warnings.forEach((w) => warnings.add(w));
  }
  return { errors: [...errors], warnings: [...warnings] };
}

function origin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

// { 'folder/path': content } for every file in the ZIP.
export function buildProject(script, style) {
  const name = slug(script.title);
  const secrets = script.recording.secrets ?? [];
  const baseUrl = origin(script.recording.startUrl || script.startUrl);

  const files = {
    ...emitCode(script, style),
    'playwright.config.ts': `import { defineConfig, devices } from '@playwright/test';
import 'dotenv/config';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.BASE_URL || ${JSON.stringify(baseUrl)},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
`,
    'package.json': `${JSON.stringify(
      {
        name,
        private: true,
        scripts: { test: 'playwright test', 'test:headed': 'playwright test --headed', report: 'playwright show-report' },
        devDependencies: { '@playwright/test': PLAYWRIGHT_TEST_VERSION, '@types/node': '^22.0.0', dotenv: '^16.4.5' },
      },
      null,
      2
    )}\n`,
    '.env.example': [`BASE_URL=${baseUrl}`, ...secrets.map((s) => `${s}=`), ''].join('\n'),
    '.gitignore': ['node_modules/', 'test-results/', 'playwright-report/', '.env', ''].join('\n'),
    'README.md': readme(script, style, secrets),
  };
  return Object.fromEntries(Object.entries(files).map(([path, content]) => [`${name}/${path}`, content]));
}

function readme(script, style, secrets) {
  const layout =
    style === 'plain'
      ? '- `tests/` holds the recorded test.'
      : '- `pages/` holds one page object per page: its locators and the actions done on it.\n- `tests/` holds the test, written with those page objects.';
  return `# ${script.title}

Recorded with Playwright codegen and converted by AgentQA.

## Run it

\`\`\`
npm install
npx playwright install chromium
cp .env.example .env    # then fill it in
npx playwright test
\`\`\`

\`npm run test:headed\` shows the browser, \`npm run report\` opens the last HTML report.

## Settings (.env)

- \`BASE_URL\`: the site to test. Pages are opened relative to it, so the same tests run on any environment.
${secrets.map((s) => `- \`${s}\`: typed during the recording and removed from the code. Set it here.`).join('\n')}

## Layout

${layout}

The recording only proves the steps can be done. Add \`expect()\` checks for what each step should show.
`;
}
