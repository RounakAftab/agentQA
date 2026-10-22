// Scenario builder for the simulated AI workflow. It turns a real project and a typed
// requirement into the pipeline steps and log lines the page plays back.

const slugify = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'requirement';

const pascal = (text) =>
  slugify(text)
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');

const TEST_CASE_TEMPLATES = [
  { suffix: 'primary happy path', priority: 'critical', confidence: 0.96 },
  { suffix: 'required input validation', priority: 'high', confidence: 0.93 },
  { suffix: 'error handling', priority: 'high', confidence: 0.91 },
  { suffix: 'permissions and access', priority: 'high', confidence: 0.89 },
  { suffix: 'edge cases and boundaries', priority: 'medium', confidence: 0.87 },
  { suffix: 'regression of related behavior', priority: 'medium', confidence: 0.85 },
];

// Picks a test stack from the project's language. Anything unknown falls back to a neutral outline.
function stackFor(language, title, slug) {
  const lang = language.toLowerCase();
  if (/(type|java)script|node|^js$|^ts$/.test(lang)) {
    return {
      framework: 'Playwright (E2E)',
      runtime: 'Node.js 20, Playwright',
      specFiles: [`${slug}.spec.ts`, `${slug}-validation.spec.ts`],
      helper: 'test-data-factory.ts',
      script: `import { test, expect } from '@playwright/test';

test.describe('${title}', () => {
  test('primary happy path', async ({ page }) => {
    await page.goto('/');
    // Arrange: sign in and open the feature under test
    // Act: perform the main user flow described in the requirement
    // Assert: the expected result is visible
    await expect(page).toHaveURL(/.*/);
  });

  test('required input validation', async ({ page }) => {
    await page.goto('/');
    // Submit without the required data and expect validation messages
  });
});`,
    };
  }
  if (lang === 'java' || lang === 'kotlin') {
    const cls = pascal(title);
    return {
      framework: 'JUnit 5 + RestAssured',
      runtime: 'JDK 21, Maven',
      specFiles: [`${cls}IT.java`, `${cls}ValidationIT.java`],
      helper: 'TestDataFactory.java',
      script: `class ${cls}IT {

  @Test
  void primaryHappyPath() {
    // Arrange: prepare test data through TestDataFactory
    // Act: call the endpoint described in the requirement
    // Assert: status code and response body
  }

  @Test
  void requiredInputValidation() {
    // Send an incomplete request and expect a 4xx response
  }
}`,
    };
  }
  if (lang === 'python') {
    const fn = slug.replace(/-/g, '_');
    return {
      framework: 'pytest',
      runtime: 'Python 3.12, pytest',
      specFiles: [`test_${fn}.py`, `test_${fn}_validation.py`],
      helper: 'conftest.py',
      script: `def test_primary_happy_path(client):
    # Arrange: prepare input data
    # Act: call the feature described in the requirement
    # Assert: the expected result is returned
    assert client is not None


def test_required_input_validation(client):
    # Send incomplete input and expect a validation error
    ...`,
    };
  }
  return {
    framework: 'Generic test framework',
    runtime: 'Project CI runner',
    specFiles: [`${slug}.test`, `${slug}-validation.test`],
    helper: 'test-helpers',
    script: `// ${title}
// 1. primary happy path: arrange the data, run the main flow, assert the outcome
// 2. required input validation: submit incomplete input and assert the error`,
  };
}

// Builds the simulated run's source from a real project and a requirement the user typed.
// Nothing here is fetched from GitHub or an AI service; it only shapes the simulation.
export function buildSource(project, requirementTitle, prNumber) {
  const title = requirementTitle.trim();
  const slug = slugify(title);
  const stack = stackFor(project.language || '', title, slug);
  const repo = (project.automationRepoUrl || project.repoUrl).split('/').filter(Boolean).pop();

  return {
    id: `${project.id}:${slug}`,
    projectId: project.id,
    ref: 'Requirement',
    refTitle: title,
    feature: title,
    context: [project.language, project.framework].filter(Boolean).join('/') || project.name,
    ...stack,
    flows: 'requirement → test design → automation → review → pull request → CI',
    criteria: 3,
    branch: `ai/${slug}-tests`,
    prNumber,
    prTitle: `feat(tests): Add ${title} test suite`,
    repo,
    loc: 280,
    labels: 'ai-generated, test-automation',
    testCases: TEST_CASE_TEMPLATES.map((t) => ({
      title: `${title} — ${t.suffix}`,
      priority: t.priority,
      confidence: t.confidence,
    })),
  };
}

export const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low'];

export function averageConfidence(testCases) {
  const total = testCases.reduce((sum, t) => sum + t.confidence, 0);
  return total / testCases.length;
}

function priorityBreakdown(testCases) {
  return PRIORITY_ORDER.map((p) => ({ p, n: testCases.filter((t) => t.priority === p).length }))
    .filter(({ n }) => n > 0)
    .map(({ p, n }) => `${n} ${p}`)
    .join(', ');
}

export function buildScriptRevision(script, comment, version) {
  return `// v${version} — revised after reviewer feedback: "${comment}"\n${script}`;
}

// Builds the six pipeline steps for a source. Step 4 is a gate: its `logs` end where
// the run pauses for a human decision; later logs are produced by the decision handlers.
export function buildSteps(src, project, reviewer) {
  const n = src.testCases.length;
  const avg = averageConfidence(src.testCases);
  const avgPct = Math.round(avg * 100);
  const confRange = `${Math.min(...src.testCases.map((t) => t.confidence)).toFixed(2)} - ${Math.max(...src.testCases.map((t) => t.confidence)).toFixed(2)}`;
  const half = Math.ceil(n / 2);
  const ciTimes = ['2.3s', '1.8s', '1.5s', '2.1s', '1.9s', '1.7s'];
  const [specA, specB] = src.specFiles;
  const filesCount = src.specFiles.length + 1;

  return [
    {
      name: 'Requirements Analysis',
      description: 'Read the requirement and identify test scenarios',
      logs: [
        { time: '0.0s', msg: '[Agent] Starting requirements analysis...' },
        { time: '0.5s', msg: `[Agent] Reading requirement: "${src.refTitle}"` },
        { time: '1.2s', msg: `[Agent] Requirement parsed — ${src.criteria} acceptance criteria derived` },
        { time: '2.0s', msg: '[AI] Analyzing acceptance criteria with LLM...' },
        { time: '3.5s', msg: `[AI] Identified user flows: ${src.flows}` },
        { time: '4.8s', msg: `[AI] Mapped ${n} test scenarios for ${project.name}` },
        { time: '5.5s', msg: `[AI] Priority assignment: ${priorityBreakdown(src.testCases)}` },
        { time: '6.0s', msg: '[Checkpoint] State saved to PostgreSQL (step: requirements_complete)' },
        { time: '6.2s', msg: `✓ Requirements analysis complete — ${n} scenarios identified` },
      ],
      result: `${n} test scenarios identified for "${src.refTitle}"`,
    },
    {
      name: 'Test Case Generation',
      description: 'AI generates comprehensive test cases from requirements',
      logs: [
        { time: '0.0s', msg: '[Agent] Starting test case generation...' },
        { time: '0.8s', msg: `[AI] Loading project context: ${project.name} (${src.context})` },
        ...src.testCases.slice(0, 4).map((t, i) => ({
          time: `${(1.5 + i * 1.2).toFixed(1)}s`,
          msg: `[AI] Generating test case ${i + 1}/${n}: "${t.title}"`,
        })),
        { time: '6.2s', msg: `[AI] Generating test cases 5-${n}...` },
        { time: '8.5s', msg: `[AI] All ${n} test cases generated with assertions and expected results` },
        { time: '9.0s', msg: `[AI] Confidence scores: avg ${avg.toFixed(2)} (range: ${confRange})` },
        { time: '9.5s', msg: '[Checkpoint] State saved to PostgreSQL (step: tests_generated)' },
        { time: '9.8s', msg: `✓ Test case generation complete — ${n} cases with ${avgPct}% avg confidence` },
      ],
      result: `${n} test cases generated with ${avgPct}% average confidence score`,
    },
    {
      name: 'Automation Script Generation',
      description: 'Generate executable test automation scripts',
      logs: [
        { time: '0.0s', msg: '[Agent] Starting automation script generation...' },
        { time: '0.5s', msg: `[AI] Detected test framework: ${src.framework}` },
        { time: '1.2s', msg: '[AI] Loading existing helpers and fixtures from the test repo...' },
        { time: '2.5s', msg: `[AI] Generating script: ${specA}` },
        { time: '4.0s', msg: '[AI] Adding interactions, fixtures and request setup' },
        { time: '5.5s', msg: '[AI] Adding assertions for expected results' },
        { time: '7.0s', msg: `[AI] Generating helper: ${src.helper}` },
        { time: '8.5s', msg: `[AI] Generating script: ${specB}` },
        { time: '10.0s', msg: '[AI] Adding error handling and retry logic' },
        { time: '11.5s', msg: '[AI] Running static analysis on generated code... 0 issues found' },
        { time: '12.0s', msg: '[Checkpoint] State saved to PostgreSQL (step: scripts_generated)' },
        { time: '12.3s', msg: `✓ Automation scripts generated — ${filesCount} files, ${src.loc} lines of code` },
      ],
      result: `${filesCount} files generated (${src.loc} LOC) — ${src.framework}`,
    },
    {
      name: 'Human Review & Approval',
      description: 'Pause for human-in-the-loop review and approval',
      gate: true,
      logs: [
        { time: '0.0s', msg: '[Agent] Submitting for human review...' },
        { time: '0.5s', msg: `[System] Creating approval request for ${reviewer.role} (${reviewer.name})` },
        { time: '1.0s', msg: `[System] Notification sent to ${reviewer.email}` },
        { time: '1.5s', msg: '[System] Approval queue updated — 1 new item' },
        { time: '2.0s', msg: '[Checkpoint] State saved to PostgreSQL (step: awaiting_review)' },
        { time: '2.2s', msg: '⏳ Awaiting human approval — pipeline paused' },
      ],
      result: '',
    },
    {
      name: 'Draft PR Creation',
      description: 'Create Draft Pull Request on automation repository',
      logs: [
        { time: '0.0s', msg: '[Agent] Creating Draft PR...' },
        { time: '0.5s', msg: `[GitHub] Creating branch: ${src.branch}` },
        { time: '1.0s', msg: `[GitHub] Committing ${filesCount} files to branch...` },
        { time: '2.0s', msg: `[GitHub] Creating Draft PR #${src.prNumber}: "${src.prTitle}"` },
        { time: '2.5s', msg: '[GitHub] PR description generated with test coverage summary' },
        { time: '3.0s', msg: `[GitHub] Assigned reviewers: ${reviewer.name}` },
        { time: '3.5s', msg: `[GitHub] Labels added: ${src.labels}` },
        { time: '4.0s', msg: '[Checkpoint] State saved to PostgreSQL (step: pr_created)' },
        { time: '4.2s', msg: `✓ Draft PR #${src.prNumber} created — triggering CI pipeline` },
      ],
      result: `Draft PR #${src.prNumber} created on ${src.repo} repository`,
    },
    {
      name: 'CI Validation',
      description: 'GitHub Actions runs tests and validates results',
      logs: [
        { time: '0.0s', msg: `[CI] GitHub Actions workflow triggered on PR #${src.prNumber}...` },
        { time: '1.0s', msg: `[CI] Setting up test environment (${src.runtime})...` },
        { time: '3.0s', msg: '[CI] Installing dependencies...' },
        { time: '5.0s', msg: '[CI] Running lint checks... ✓ passed' },
        { time: '6.0s', msg: `[CI] Starting ${src.framework} runner...` },
        { time: '8.0s', msg: `[CI] Running: ${specA} (${half} tests)...` },
        ...src.testCases.slice(0, half).map((t, i) => ({
          time: `${(10 + i).toFixed(1)}s`,
          msg: `[CI]   ✓ ${t.title} (${ciTimes[i]})`,
        })),
        { time: '16.0s', msg: `[CI] Running: ${specB} (${n - half} tests)...` },
        ...src.testCases.slice(half).map((t, i) => ({
          time: `${(17 + i).toFixed(1)}s`,
          msg: `[CI]   ✓ ${t.title} (${ciTimes[half + i]})`,
        })),
        { time: '20.0s', msg: `[CI] Test Results: ${n}/${n} passed, 0 failed, 0 skipped` },
        { time: '20.5s', msg: '[CI] Coverage report uploaded' },
        { time: '21.0s', msg: '[CI] ✓ All checks passed — PR ready for merge' },
        { time: '21.5s', msg: `✓ CI validation complete — PASS (${n}/${n} tests)` },
      ],
      result: `All ${n} tests passed`,
    },
  ];
}
