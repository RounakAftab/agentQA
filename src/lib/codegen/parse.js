// Turns the output of `npx playwright codegen` (Playwright Test, TypeScript) into steps the
// converter works with. Credentials typed during the recording are replaced with environment
// variables here, before anything is saved.
//
// Codegen's TypeScript output is plain JavaScript, so acorn parses it. Statements the converter
// does not understand (popups, dialogs, keyboard) become `raw` steps and are kept as written.
import { parse as parseJs } from 'acorn';
import { ACTIONS, TYPED_ACTIONS, VALUE_ACTIONS } from './actions.js';
import { words } from './naming.js';

const ROLE_SUFFIX = {
  button: 'Button', link: 'Link', textbox: 'Input', searchbox: 'Input', checkbox: 'Checkbox', radio: 'Radio',
  combobox: 'Select', listbox: 'List', option: 'Option', heading: 'Heading', tab: 'Tab', menuitem: 'MenuItem',
  cell: 'Cell', row: 'Row', img: 'Image', listitem: 'Item', dialog: 'Dialog', switch: 'Switch',
};
const METHOD_SUFFIX = { getByLabel: 'Input', getByPlaceholder: 'Input', getByText: 'Text', getByAltText: 'Image', locator: 'Element' };

const PASSWORD_FIELD = /pass(word|wd|code)?\b|pwd|secret|\bpin\b/i;
const USERNAME_FIELD = /user|e-?mail|login/i;

const OTHER_LANGUAGES = [
  [/from\s+playwright\.(sync|async)_api|^\s*def\s+test_/m, 'Python'],
  [/import\s+com\.microsoft\.playwright/, 'Java'],
  [/using\s+Microsoft\.Playwright/, 'C#'],
];

// Returns { title, startUrl, steps, preamble, secrets, source, errors }. `source` is the input with
// typed credentials replaced; store that, never the original.
export function parseCodegen(input) {
  const original = String(input ?? '').replace(/\r\n/g, '\n');
  const failed = (error) => ({ title: '', startUrl: '', steps: [], preamble: [], secrets: [], source: original, errors: [error] });

  if (!original.trim()) return failed('Paste the code from the Playwright recorder.');
  for (const [re, language] of OTHER_LANGUAGES) {
    if (re.test(original)) return failed(`This looks like ${language} code. In the recorder window, set Target to "Playwright Test" (TypeScript) and copy the code again.`);
  }

  const first = read(original);
  if (first.error) return failed(first.error);

  // Replace credentials in the source, then read it again so every step sees the replacement.
  const secretEdits = findSecrets(first.steps, first.valueNodes);
  if (secretEdits.edits.length === 0) return { ...first.result, source: original, secrets: [], errors: [] };
  const source = applyEdits(original, secretEdits.edits);
  const second = read(source);
  if (second.error) return failed(second.error);
  return { ...second.result, source, secrets: secretEdits.secrets, errors: [] };
}

function read(source) {
  // `process.env.X!` (written by the credential replacement) is TypeScript. Blank the `!` for
  // acorn; offsets stay the same, so text() still returns the code as written.
  const js = source.replace(/(process\.env\.\w+)!/g, '$1 ');
  let program;
  try {
    program = parseJs(js, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  } catch (err) {
    const line = err.loc ? ` (line ${err.loc.line})` : '';
    return { error: `Could not read the code${line}. Paste the TypeScript code from the recorder without changes.` };
  }

  // A blanked `!` sits just past the end of its node; include it.
  const text = (node) => source.slice(node.start, source[node.end] === '!' && js[node.end] === ' ' ? node.end + 1 : node.end);
  const preamble = [];
  let testCall = null;
  for (const statement of program.body) {
    if (statement.type === 'ImportDeclaration') continue;
    const expr = statement.type === 'ExpressionStatement' ? statement.expression : null;
    if (!testCall && expr?.type === 'CallExpression' && expr.callee.type === 'Identifier' && expr.callee.name === 'test') {
      testCall = expr;
    } else if (!testCall) {
      preamble.push(text(statement)); // e.g. test.use({ ... }) written above the test
    }
  }
  const fn = testCall?.arguments.find((a) => a.type === 'ArrowFunctionExpression' || a.type === 'FunctionExpression');
  if (!fn || fn.body.type !== 'BlockStatement') {
    return { error: 'No test found. Paste the full code from the recorder, including the test(...) block.' };
  }

  const steps = [];
  const valueNodes = new Map(); // step id -> literal node of its value argument
  for (const statement of fn.body.body) {
    const step = toStep(statement, text);
    step.id = `s${steps.length + 1}`;
    if (step.valueNode) valueNodes.set(step.id, step.valueNode);
    delete step.valueNode;
    steps.push(step);
  }
  if (!steps.some((s) => s.kind !== 'raw')) return { error: 'The test has no recorded steps yet. Use the site in the recorder window, then copy the code.' };

  const titleArg = testCall.arguments[0];
  const title = titleArg?.type === 'Literal' && typeof titleArg.value === 'string' && titleArg.value !== 'test' ? titleArg.value : '';
  const startUrl = steps.find((s) => s.kind === 'goto')?.url ?? '';
  return { steps, valueNodes, result: { title, startUrl, steps, preamble } };
}

function toStep(statement, text) {
  const raw = { kind: 'raw', source: text(statement) };
  const expr = statement.type === 'ExpressionStatement' && statement.expression.type === 'AwaitExpression' ? statement.expression.argument : null;
  if (expr?.type !== 'CallExpression' || expr.callee.type !== 'MemberExpression' || expr.callee.computed) return raw;

  const callee = expr.callee;
  const method = callee.property.name;

  // await expect(subject)[.not].matcher(...)
  let expectCall = callee.object;
  if (expectCall.type === 'MemberExpression' && expectCall.property.name === 'not') expectCall = expectCall.object;
  if (expectCall.type === 'CallExpression' && expectCall.callee.type === 'Identifier' && expectCall.callee.name === 'expect') {
    const subject = splitTarget(expectCall.arguments[0], text);
    if (!subject) return raw;
    return { kind: 'assert', ...subject, matcher: text(expr).slice(expectCall.end - expr.start), source: raw.source };
  }

  // await page.goto('...')
  if (method === 'goto' && callee.object.type === 'Identifier') {
    const url = stringValue(expr.arguments[0]);
    return url === null ? raw : { kind: 'goto', target: callee.object.name, url, source: raw.source };
  }

  // await page.<locator>.<action>(...)
  if (!ACTIONS.has(method)) return raw;
  const subject = splitTarget(callee.object, text);
  if (!subject?.locator) return raw;
  const valueArg = expr.arguments[0];
  return {
    kind: 'action',
    ...subject,
    action: method,
    args: expr.arguments.map(text),
    value: VALUE_ACTIONS.has(method) ? stringValue(valueArg) : null,
    valueNode: VALUE_ACTIONS.has(method) && stringValue(valueArg) !== null ? valueArg : null,
    source: raw.source,
  };
}

// `page.getByRole('button', { name: 'Log in' })` -> { target: 'page', locator: "getByRole(...)", words, suffix }.
// A bare `page` (as in expect(page).toHaveURL) has no locator. Anything else is not a locator.
function splitTarget(node, text) {
  if (!node) return null;
  if (node.type === 'Identifier') return { target: node.name, locator: null };

  const calls = []; // outermost first
  let current = node;
  while (current.type === 'CallExpression' && current.callee.type === 'MemberExpression' && !current.callee.computed) {
    calls.unshift({ name: current.callee.property.name, args: current.arguments });
    current = current.callee.object;
  }
  if (current.type !== 'Identifier' || calls.length === 0) return null;
  if (!/^(getBy\w+|locator|frameLocator)$/.test(calls[0].name)) return null; // page.keyboard, page.mouse, ...

  const locator = text(node).slice(current.end - node.start).replace(/^\s*\.\s*/, '');
  return { target: current.name, locator, ...nameHint(calls) };
}

// Words and a suffix that name the element: getByRole('button', { name: 'Log in' }) -> log, in + Button.
function nameHint(calls) {
  let hint = { words: [], suffix: 'Element' };
  let context = []; // filter({ hasText }) words, kept in front of the next element's name
  const next = (found, suffix) => {
    hint = { words: [...context, ...(found.length ? found : hint.words)], suffix };
    context = [];
  };
  for (const call of calls) {
    const [arg0, arg1] = call.args;
    if (call.name === 'getByRole') {
      const role = stringValue(arg0) ?? '';
      const nameProp = arg1?.type === 'ObjectExpression' ? arg1.properties.find((p) => p.key?.name === 'name') : null;
      const name = nameProp ? stringValue(nameProp.value) ?? nameProp.value.regex?.pattern ?? '' : '';
      next(words(name).length || hint.words.length ? words(name) : words(role), ROLE_SUFFIX[role] ?? pascalWord(role));
    } else if (call.name.startsWith('getBy') || call.name === 'locator') {
      const value = stringValue(arg0) ?? arg0?.regex?.pattern ?? '';
      next(words(call.name === 'locator' ? value.replace(/\[[^\]]*=\s*["']?([^"'\]]*)["']?\]/g, ' $1 ') : value), METHOD_SUFFIX[call.name] ?? '');
    } else if (call.name === 'filter' && arg0?.type === 'ObjectExpression') {
      const hasText = arg0.properties.find((p) => p.key?.name === 'hasText');
      if (hasText) context = words(stringValue(hasText.value) ?? hasText.value.regex?.pattern ?? '');
    }
  }
  return { words: [...hint.words, ...context].slice(0, 4), suffix: hint.suffix };
}

const pascalWord = (w) => (w ? w[0].toUpperCase() + w.slice(1) : '');

function stringValue(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
  return null;
}

// Finds values typed into password fields, plus the username typed next to them, and returns
// the source edits that replace them with process.env.E2E_PASSWORD / E2E_USERNAME.
function findSecrets(steps, valueNodes) {
  const typed = steps.filter((s) => s.kind === 'action' && TYPED_ACTIONS.has(s.action) && valueNodes.has(s.id));
  const passwords = new Set(typed.filter((s) => PASSWORD_FIELD.test(s.locator)).map((s) => s.value));
  if (passwords.size === 0) return { edits: [], secrets: [] };
  const usernames = new Set(typed.filter((s) => !PASSWORD_FIELD.test(s.locator) && USERNAME_FIELD.test(s.locator)).map((s) => s.value));

  const edits = [];
  const secrets = new Set();
  for (const step of typed) {
    const env = passwords.has(step.value) ? 'E2E_PASSWORD' : usernames.has(step.value) ? 'E2E_USERNAME' : null;
    if (!env) continue;
    const node = valueNodes.get(step.id);
    edits.push({ start: node.start, end: node.end, text: `process.env.${env}!` });
    secrets.add(env);
  }
  return { edits, secrets: ['E2E_USERNAME', 'E2E_PASSWORD'].filter((e) => secrets.has(e)) };
}

function applyEdits(source, edits) {
  let out = source;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return out;
}
