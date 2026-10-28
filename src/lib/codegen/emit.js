// Builds code from a parsed recording: a plain spec, or a Page Object Model (one class per page,
// locators as fields, consecutive actions as methods). Pure functions, used by the editor for the
// live preview and by the server for downloads.
//
// A script is { title, recording: parseCodegen() result, edits }. `edits` holds what the user changed:
//   removed:   step ids left out of the output
//   pageNames: { stepId: name }  a new page starts at that step
//   renames:   { ClassName: name } renames every group of that page
import { TYPED_ACTIONS, VALUE_ACTIONS } from './actions.js';
import { className, classNameFromUrl, memberName, quote, slug, unique, words } from './naming.js';

const LIST_VALUE_ACTIONS = new Set(['selectOption', 'setInputFiles']);
const CLICK_ACTIONS = new Set(['click', 'dblclick', 'tap']);
const CLICK_NAMED_SUFFIXES = new Set(['Button', 'Link', 'MenuItem', 'Tab', 'Option', 'Text', 'Element', '']);

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

// Same-site URLs become paths, so the config's baseURL decides which environment runs.
function relativeUrl(url, origin) {
  try {
    const parsed = new URL(url);
    return parsed.origin === origin ? `${parsed.pathname}${parsed.search}${parsed.hash}` : url;
  } catch {
    return url;
  }
}

// The recorder writes goto() only for the first page; later pages are reached by clicking. A check
// such as expect(page).toHaveURL(/admin\/viewSystemUsers/) marks where one starts. Returns the
// URL path it checks, without regex syntax, or null.
function urlCheck(step) {
  const m = step.kind === 'assert' && !step.locator ? /^\.toHaveURL\(\s*(['"`/])(.*)\1[a-z]*\s*[,)]/.exec(step.matcher) : null;
  return m ? m[2].replace(/\\(.)/g, '$1').replace(/[\^$*+?()[\]{}|]/g, '') : null;
}

// The steps that end up in the output, each with the page class it belongs to. Raw steps take the
// page of the step before them, for display only.
export function prepareSteps(script) {
  const { recording, edits = {} } = script;
  const removed = new Set(edits.removed ?? []);
  const pageNames = edits.pageNames ?? {};
  const renames = edits.renames ?? {};
  const rename = (name) => (renames[name] ? className(renames[name]) : name);

  const current = new Map(); // page variable -> class name
  let popups = 0;
  const out = [];
  let lastBase = null;
  for (const step of recording.steps) {
    if (removed.has(step.id)) continue;
    let basePage = lastBase; // the name before renames, which is what `renames` is keyed by
    if (step.kind !== 'raw') {
      if (pageNames[step.id]) basePage = className(pageNames[step.id]);
      else if (step.kind === 'goto') basePage = classNameFromUrl(step.url, recording.startUrl);
      else if (urlCheck(step)) basePage = classNameFromUrl(urlCheck(step), recording.startUrl);
      else if (current.has(step.target)) basePage = current.get(step.target);
      else if (step.target === 'page') basePage = classNameFromUrl(recording.startUrl);
      else basePage = `Popup${++popups > 1 ? popups : ''}Page`;
      current.set(step.target, basePage);
    }
    lastBase = basePage;
    out.push({ ...step, basePage, page: basePage && rename(basePage) });
  }
  return out;
}

// Steps grouped as the editor shows them: a new group whenever the page changes.
export function pageGroups(script) {
  const groups = [];
  for (const step of prepareSteps(script)) {
    const group = groups.at(-1);
    if (group && group.page === step.page) group.steps.push(step);
    else groups.push({ page: step.page ?? 'Setup', basePage: step.basePage, steps: [step] });
  }
  return groups;
}

const specPath = (title) => `tests/${slug(title)}.spec.ts`;

function testBlock(script, imports, body) {
  const preamble = script.recording.preamble ?? [];
  return [
    "import { test, expect } from '@playwright/test';",
    ...imports,
    '',
    ...(preamble.length ? [...preamble, ''] : []),
    `test(${quote(script.title || 'recorded flow')}, async ({ page }) => {`,
    // Only the first line is indented: later lines of a multi-line raw statement keep the
    // indentation they had inside the recorded test.
    ...body.map((line) => `  ${line}`),
    '});',
    '',
  ].join('\n');
}

export function emitPlain(script) {
  const origin = originOf(script.recording.startUrl);
  const body = prepareSteps(script).map((step) => {
    if (step.kind === 'goto') return `await ${step.target}.goto(${quote(relativeUrl(step.url, origin))});`;
    if (step.kind === 'action') return `await ${step.target}.${step.locator}.${step.action}(${step.args.join(', ')});`;
    if (step.kind === 'assert') return `await expect(${step.target}${step.locator ? `.${step.locator}` : ''})${step.matcher};`;
    return step.source;
  });
  return { [specPath(script.title)]: testBlock(script, [], body) };
}

const BASE_PAGE = `import type { Page } from '@playwright/test';

// Shared by every page object. Put helpers that all pages need here.
export class BasePage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }
}
`;

export function emitPom(script) {
  const origin = originOf(script.recording.startUrl);
  const classes = new Map(); // class name -> { name, fields: Map(locator -> field), taken, methods, gotoPath }
  const instances = new Map(); // `${class}|${page variable}` -> instance variable
  const instanceNames = new Set(['page']);
  const body = [];

  const classFor = (name) => {
    if (!classes.has(name)) classes.set(name, { name, fields: new Map(), taken: new Set(['page', 'goto', 'constructor']), methods: [], gotoPath: null });
    return classes.get(name);
  };
  const instanceFor = (cls, target) => {
    const key = `${cls.name}|${target}`;
    if (!instances.has(key)) {
      const name = unique(memberName(words(cls.name)), instanceNames);
      instances.set(key, name);
      body.push(`const ${name} = new ${cls.name}(${target});`);
    }
    return instances.get(key);
  };
  const fieldFor = (cls, step) => {
    if (!cls.fields.has(step.locator)) cls.fields.set(step.locator, unique(memberName(step.words, step.suffix), cls.taken));
    return cls.fields.get(step.locator);
  };

  let run = null; // consecutive actions on one page object, turned into one method
  const flush = () => {
    if (!run) return;
    const { cls, target } = run;
    // The recorder clicks a field before typing into it; fill() focuses it anyway. Dropping that
    // click lets repeated flows share one method.
    const steps = run.steps.filter((step, i, all) => !isFocusClick(step, all[i + 1]));
    run = null;
    const params = [];
    const values = [];
    const paramNames = new Set();
    // Other arguments may point at the page, e.g. dragTo(page.getByText('Bin')).
    const own = (arg) => arg.replace(new RegExp(`\\b${target}\\.`, 'g'), 'this.page.');
    const lines = steps.map((step) => {
      const field = fieldFor(cls, step);
      if (VALUE_ACTIONS.has(step.action) && step.args.length > 0) {
        const param = unique(step.words.length ? memberName(step.words) : 'value', paramNames);
        params.push(`${param}: ${LIST_VALUE_ACTIONS.has(step.action) ? 'string | string[]' : 'string'}`);
        values.push(step.args[0]);
        return `await this.${field}.${step.action}(${[param, ...step.args.slice(1).map(own)].join(', ')});`;
      }
      return `await this.${field}.${step.action}(${step.args.map(own).join(', ')});`;
    });
    const key = `${params.join(', ')}|${lines.join('\n')}`;
    let method = cls.methods.find((m) => m.key === key);
    if (!method) {
      method = { name: unique(methodName(steps), cls.taken), params, lines, key };
      cls.methods.push(method);
    }
    body.push(`await ${instanceFor(cls, target)}.${method.name}(${values.join(', ')});`);
  };

  for (const step of prepareSteps(script)) {
    if (step.kind === 'action') {
      const cls = classFor(step.page);
      if (run && (run.cls !== cls || run.target !== step.target)) flush();
      run ??= { cls, target: step.target, steps: [] };
      run.steps.push(step);
      if (endsMethod(step)) flush();
      continue;
    }
    flush();
    if (step.kind === 'goto') {
      const cls = classFor(step.page);
      const path = relativeUrl(step.url, origin);
      cls.gotoPath ??= path;
      body.push(`await ${instanceFor(cls, step.target)}.goto(${path === cls.gotoPath ? '' : quote(path)});`);
    } else if (step.kind === 'assert' && step.locator) {
      const cls = classFor(step.page);
      const field = fieldFor(cls, step);
      body.push(`await expect(${instanceFor(cls, step.target)}.${field})${step.matcher};`);
    } else if (step.kind === 'assert') {
      body.push(`await expect(${step.target})${step.matcher};`);
    } else {
      body.push(step.source);
    }
  }
  flush();

  const files = { 'pages/BasePage.ts': BASE_PAGE };
  for (const cls of classes.values()) files[`pages/${cls.name}.ts`] = classFile(cls);
  const imports = [...classes.keys()].map((name) => `import { ${name} } from '../pages/${name}';`);
  files[specPath(script.title)] = testBlock(script, imports, body);
  return files;
}

const isFocusClick = (step, next) =>
  step.action === 'click' && step.args.length === 0 && next?.locator === step.locator && TYPED_ACTIONS.has(next.action);

// A method ends where the user submits something: Enter, or a click on anything but a field
// (the recorder often clicks a field before filling it). Repeated flows then reuse one method.
const endsMethod = (step) =>
  (CLICK_ACTIONS.has(step.action) && !['Input', 'Select'].includes(step.suffix)) ||
  (step.action === 'press' && /Enter/.test(step.args[0] ?? ''));

// Names a method after what it ends with: clicking "Log in" -> logIn(), filling "Search" -> fillSearch().
function methodName(steps) {
  const last = steps.at(-1);
  const named = last.words.slice(0, 3);
  if (CLICK_ACTIONS.has(last.action) && named.length && CLICK_NAMED_SUFFIXES.has(last.suffix)) return memberName(named);
  const verb = last.action === 'press' && /Enter/.test(last.args[0] ?? '') ? ['submit'] : words(last.action === 'pressSequentially' ? 'type' : last.action);
  return memberName([...verb, ...(named.length ? named : words(last.suffix))]);
}

function classFile(cls) {
  const fields = [...cls.fields.entries()];
  const out = [
    `import type { ${fields.length ? 'Locator, ' : ''}Page } from '@playwright/test';`,
    "import { BasePage } from './BasePage';",
    '',
    `export class ${cls.name} extends BasePage {`,
  ];
  if (fields.length) out.push(...fields.map(([, name]) => `  readonly ${name}: Locator;`), '');
  out.push('  constructor(page: Page) {', '    super(page);', ...fields.map(([locator, name]) => `    this.${name} = page.${locator};`), '  }');
  if (cls.gotoPath !== null) {
    out.push('', `  async goto(path = ${quote(cls.gotoPath)}) {`, '    await this.page.goto(path);', '  }');
  }
  for (const method of cls.methods) {
    out.push('', `  async ${method.name}(${method.params.join(', ')}) {`, ...method.lines.map((l) => `    ${l}`), '  }');
  }
  out.push('}', '');
  return out.join('\n');
}
