// JMeter's HTTP(S) Test Script Recorder (a Non-Test Element) for load tests. Two halves:
//   recordingPlanJmx()  a .jmx test plan with the recorder already set up for one project's app, to
//                       open in JMeter, record with, and save;
//   readJmeterPlan()    the saved .jmx back as requests the load test form turns into scenario steps.
// No "@/" imports and no Node APIs: the form (browser), the API route and node --test all load it.

export const MAX_JMX_BYTES = 5 * 1024 * 1024;
export const RECORDER_PORT = 8888;
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const MAX_PATH = 2000;
const MAX_BODY = 64_000;
const MAX_NAME = 60;
const MAX_THINK_SEC = 60;
const DEFAULT_THINK_SEC = 1;

// Static files a load test of the app shouldn't replay: the recorder's exclude list, and the same
// check on import for plans recorded without it.
const STATIC_EXTENSIONS = 'bmp|css|js|mjs|gif|ico|jpe?g|png|svg|webp|avif|swf|eot|otf|ttf|woff2?|map|mp4|webm';
const STATIC_PATH = new RegExp(`\\.(${STATIC_EXTENSIONS})$`, 'i');

// Browser and connection headers the recorder captures but k6 sets itself or doesn't need, plus
// those the load test form refuses (Host, Content-Length, ...).
const DROPPED_HEADERS = new Set([
  'host', 'content-length', 'transfer-encoding', 'connection', 'keep-alive', 'proxy-connection', 'proxy-authorization',
  'accept-encoding', 'upgrade-insecure-requests', 'priority', 'te', 'dnt', 'pragma', 'cache-control', 'if-none-match', 'if-modified-since',
]);
const DROPPED_HEADER_PREFIXES = ['sec-fetch-', 'sec-ch-'];
// Recorded session values: they expire, so replaying them would fail or reuse one person's session.
const SESSION_HEADERS = new Set(['cookie', 'authorization']);
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/;

// --- A small XML reader, enough for .jmx files (no DTDs or custom entities are expanded) ---------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (text) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, name) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[name] ?? match;
  });

// Returns the root element as { name, attrs, children, text }, or throws with a readable message.
export function parseXml(xml) {
  const root = { name: '#document', attrs: {}, children: [], text: '' };
  const stack = [root];
  let i = 0;
  const fail = (what) => {
    throw new Error(`The file is not valid XML (${what} near character ${i}).`);
  };
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    const top = stack[stack.length - 1];
    if (lt === -1) {
      top.text += decode(xml.slice(i));
      break;
    }
    if (lt > i) top.text += decode(xml.slice(i, lt));
    i = lt;
    if (xml.startsWith('<!--', i)) {
      const end = xml.indexOf('-->', i + 4);
      if (end === -1) fail('an unclosed comment');
      i = end + 3;
    } else if (xml.startsWith('<![CDATA[', i)) {
      const end = xml.indexOf(']]>', i + 9);
      if (end === -1) fail('an unclosed CDATA section');
      top.text += xml.slice(i + 9, end);
      i = end + 3;
    } else if (xml.startsWith('<?', i)) {
      const end = xml.indexOf('?>', i + 2);
      if (end === -1) fail('an unclosed declaration');
      i = end + 2;
    } else if (xml.startsWith('<!', i)) {
      // A DOCTYPE: skipped, internal subset included, and never used to expand anything.
      let depth = 0;
      let j = i + 2;
      for (; j < xml.length; j++) {
        if (xml[j] === '[') depth++;
        else if (xml[j] === ']') depth--;
        else if (xml[j] === '>' && depth <= 0) break;
      }
      if (j >= xml.length) fail('an unclosed DOCTYPE');
      i = j + 1;
    } else if (xml[i + 1] === '/') {
      const end = xml.indexOf('>', i);
      if (end === -1) fail('an unclosed tag');
      const name = xml.slice(i + 2, end).trim();
      if (stack.length === 1 || top.name !== name) fail(`a stray </${name}>`);
      stack.pop();
      i = end + 1;
    } else {
      const tag = /^<([A-Za-z_][\w.:-]*)/.exec(xml.slice(i, i + 200));
      if (!tag) fail('a malformed tag');
      const el = { name: tag[1], attrs: {}, children: [], text: '' };
      i += tag[0].length;
      const attr = /\s*([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')|\s*(\/?>)/y;
      for (;;) {
        attr.lastIndex = i;
        const m = attr.exec(xml);
        if (!m) fail(`a malformed <${el.name}> tag`);
        i = attr.lastIndex;
        if (m[5]) {
          top.children.push(el);
          if (m[5] === '>') stack.push(el);
          break;
        }
        el.attrs[m[1]] = decode(m[3] ?? m[4]);
      }
    }
  }
  if (stack.length > 1) throw new Error(`The file is not valid XML (<${stack[stack.length - 1].name}> is never closed).`);
  const elements = root.children;
  if (elements.length !== 1) throw new Error('The file is not valid XML (it needs exactly one root element).');
  return elements[0];
}

// --- JMeter test elements -------------------------------------------------------------------------

const PROP_TAGS = new Set(['stringProp', 'boolProp', 'intProp', 'longProp', 'doubleProp', 'floatProp']);
const child = (el, name) => el?.children.find((c) => c.attrs.name === name) ?? null;
const prop = (el, name) => {
  const c = child(el, name);
  return c && PROP_TAGS.has(c.name) ? c.text : '';
};
const boolProp = (el, name, fallback = false) => {
  const value = prop(el, name).trim();
  return value ? value === 'true' : fallback;
};
const isSampler = (el) => /^HTTPSampler(Proxy|2)?$/.test(el.name);
const isTimer = (el) => /Timer$/.test(el.name);

function readHeaders(manager) {
  const list = child(manager, 'HeaderManager.headers');
  return (list?.children ?? []).map((h) => ({ name: prop(h, 'Header.name').trim(), value: prop(h, 'Header.value') })).filter((h) => h.name);
}

// HTTP Request Defaults: where samplers with an empty server name go.
const readDefaults = (el) => ({
  protocol: prop(el, 'HTTPSampler.protocol').trim(),
  domain: prop(el, 'HTTPSampler.domain').trim(),
  port: prop(el, 'HTTPSampler.port').trim(),
});
const isDefaults = (el) => el.name === 'ConfigTestElement' && (el.attrs.guiclass === 'HttpDefaultsGui' || child(el, 'HTTPSampler.domain'));

// Later headers win over earlier ones with the same name, as JMeter merges Header Managers.
function mergeHeaders(...lists) {
  const byName = new Map();
  for (const h of lists.flat()) byName.set(h.name.toLowerCase(), h);
  return [...byName.values()];
}

// The parameters table, encoded the way JMeter sends it.
function encodeArguments(args) {
  return args
    .map((a) => {
      const encode = (v) => (a.encode ? encodeURIComponent(v) : v.replace(/\s/g, (s) => encodeURIComponent(s)));
      return a.useEquals || a.value ? `${encode(a.name)}=${encode(a.value)}` : encode(a.name);
    })
    .join('&');
}

// A timer's delay in ms: the recorder writes the time since the previous request into a timer's ${T}.
function timerDelay(timer) {
  const delay = Number(prop(timer, 'ConstantTimer.delay').trim());
  if (!Number.isFinite(delay) || delay < 0) return null;
  const range = Number(prop(timer, 'RandomTimer.range').trim());
  // A uniform timer waits delay + up to `range`; on average, half of it.
  return delay + (timer.name === 'UniformRandomTimer' && Number.isFinite(range) && range > 0 ? range / 2 : 0);
}

function readSampler(el, tree, scope) {
  const own = tree?.children ?? [];
  const enabled = (c) => c.attrs.enabled !== 'false';
  const headers = mergeHeaders(scope.headers, ...own.filter((c) => c.name === 'HeaderManager' && enabled(c)).map(readHeaders));
  const delays = own.filter((c) => isTimer(c) && enabled(c)).map(timerDelay).filter((d) => d != null);

  const defaults = scope.defaults;
  let protocol = prop(el, 'HTTPSampler.protocol').trim() || defaults.protocol || 'http';
  let domain = prop(el, 'HTTPSampler.domain').trim() || defaults.domain;
  let port = prop(el, 'HTTPSampler.port').trim() || defaults.port;
  let path = prop(el, 'HTTPSampler.path').trim() || '/';
  // A full URL in the path field overrides the server fields.
  if (/^https?:\/\//i.test(path)) {
    try {
      const url = new URL(path);
      [protocol, domain, port, path] = [url.protocol.slice(0, -1), url.hostname, url.port, `${url.pathname}${url.search}`];
    } catch {
      /* left as it is; reported as an address problem */
    }
  }

  const argList = child(child(el, 'HTTPsampler.Arguments'), 'Arguments.arguments');
  const args = (argList?.children ?? []).map((a) => ({
    name: prop(a, 'Argument.name'),
    value: prop(a, 'Argument.value'),
    encode: boolProp(a, 'HTTPArgument.always_encode'),
    useEquals: boolProp(a, 'HTTPArgument.use_equals', true),
  }));
  const method = prop(el, 'HTTPSampler.method').trim().toUpperCase() || 'GET';
  const rawBody = boolProp(el, 'HTTPSampler.postBodyRaw');
  let body = null;
  if (rawBody) body = args.map((a) => a.value).join('');
  else if (args.length && BODY_METHODS.has(method)) body = encodeArguments(args);
  else if (args.length) path += `${path.includes('?') ? '&' : '?'}${encodeArguments(args)}`;

  const files = child(child(el, 'HTTPsampler.Files'), 'HTTPFileArgs.files');
  return {
    name: (el.attrs.testname ?? '').trim(),
    method,
    protocol: protocol.toLowerCase(),
    domain,
    port,
    path,
    body,
    formBody: !rawBody && body != null,
    headers,
    delayMs: delays.length ? Math.max(...delays) : null,
    hasFiles: Boolean(files?.children.length),
  };
}

// Walks a hashTree: each test element is followed by the hashTree of its children. Config elements
// (Header Managers, HTTP Request Defaults) apply to everything at their level and below.
function walk(tree, scope, out) {
  const items = [];
  const kids = tree.children;
  for (let i = 0; i < kids.length; i++) {
    if (kids[i].name === 'hashTree') continue;
    const sub = kids[i + 1]?.name === 'hashTree' ? kids[i + 1] : null;
    items.push([kids[i], sub]);
    if (sub) i++;
  }
  const active = items.filter(([el]) => {
    if (el.attrs.enabled !== 'false') return true;
    if (isSampler(el)) out.disabled++;
    return false;
  });
  const here = {
    headers: mergeHeaders(scope.headers, ...active.filter(([el]) => el.name === 'HeaderManager').map(([el]) => readHeaders(el))),
    defaults: { ...scope.defaults },
  };
  for (const [el] of active) {
    if (!isDefaults(el)) continue;
    for (const [k, v] of Object.entries(readDefaults(el))) if (v) here.defaults[k] = v;
  }
  for (const [el, sub] of active) {
    if (isSampler(el)) out.samplers.push(readSampler(el, sub, here));
    else if (el.name === 'ThreadGroup' || /ThreadGroup$/.test(el.name)) {
      out.threadGroups++;
      if (sub) walk(sub, here, out);
    }
    // The recorder itself only holds templates (a ${T} timer, listeners), never requests.
    else if (el.name !== 'ProxyControl' && sub) walk(sub, here, out);
  }
}

// --- Saved recording -> requests ------------------------------------------------------------------

const defaultPort = (protocol) => (protocol === 'https' ? '443' : '80');
function originOfSampler(s) {
  if (!s.domain) return null;
  const port = s.port && s.port !== defaultPort(s.protocol) ? `:${s.port}` : '';
  try {
    return new URL(`${s.protocol}://${s.domain}${port}`).origin;
  } catch {
    return null;
  }
}

// The test account's username and password, in each form a request can carry them, become
// {{username}} / {{password}}, so the saved steps hold no credentials.
function credentialReplacer({ username, password }) {
  const pairs = [];
  for (const [value, variable] of [[password, '{{password}}'], [username, '{{username}}']]) {
    if (!value || value.length < 3) continue;
    const forms = new Set([value, encodeURIComponent(value), encodeURIComponent(value).replace(/%20/g, '+'), JSON.stringify(value).slice(1, -1)]);
    for (const form of forms) pairs.push([form, variable]);
  }
  // Longest first, so a form that contains another is replaced whole.
  pairs.sort((a, b) => b[0].length - a[0].length);
  return (text) => {
    if (text == null) return { text, replaced: false };
    let out = String(text);
    let replaced = false;
    for (const [form, variable] of pairs) {
      if (out.includes(form)) {
        out = out.split(form).join(variable);
        replaced = true;
      }
    }
    return { text: out, replaced };
  };
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Reads a saved .jmx and keeps the requests to the project's app, in recorded order.
// `account` is the project's test account ({ username, password }), or null.
// Returns { requests, notes, error }; each request is
//   { key, name, method, path, headers: [{ name, value }], body, delayMs, problem, warnings }
// where `problem` (or null) says why it can't be a step.
export function readJmeterPlan(xml, { appBaseUrl, account = null }) {
  const empty = (error) => ({ requests: [], notes: [], error });
  if (typeof xml !== 'string' || !xml.trim()) return empty('The file is empty.');
  if (xml.length > MAX_JMX_BYTES) return empty(`The file is over ${MAX_JMX_BYTES / 1024 / 1024} MB.`);
  let root;
  try {
    root = parseXml(xml.replace(/^﻿/, ''));
  } catch (err) {
    return empty(err.message);
  }
  if (root.name !== 'jmeterTestPlan') return empty('This is not a JMeter test plan (.jmx).');
  let appOrigin;
  try {
    appOrigin = new URL(appBaseUrl).origin;
  } catch {
    return empty("Set the project's app link (Projects → Edit project → Test environment) first.");
  }

  const found = { samplers: [], disabled: 0, threadGroups: 0 };
  const top = root.children.find((c) => c.name === 'hashTree');
  if (top) walk(top, { headers: [], defaults: {} }, found);
  if (found.samplers.length === 0) {
    return empty('The plan has no HTTP requests. In JMeter, start the HTTP(S) Test Script Recorder, use the app through it, then save the plan.');
  }

  const replaceCredentials = credentialReplacer(account ?? {});
  const otherHosts = new Map();
  let staticFiles = 0;
  let sessionHeaders = 0;
  let credentials = false;
  const requests = [];
  for (const s of found.samplers) {
    const origin = originOfSampler(s);
    if (origin !== appOrigin) {
      const host = origin ?? (s.domain || 'no server name');
      otherHosts.set(host, (otherHosts.get(host) ?? 0) + 1);
      continue;
    }
    const pathname = s.path.split('?')[0];
    if (STATIC_PATH.test(pathname)) {
      staticFiles++;
      continue;
    }

    const warnings = [];
    const headers = [];
    let removedSession = false;
    for (const h of s.headers) {
      const lower = h.name.toLowerCase();
      if (DROPPED_HEADERS.has(lower) || DROPPED_HEADER_PREFIXES.some((p) => lower.startsWith(p))) continue;
      if (SESSION_HEADERS.has(lower)) {
        removedSession = true;
        continue;
      }
      if (!HEADER_NAME.test(h.name) || h.value.length > 4000) continue;
      const value = replaceCredentials(h.value);
      credentials ||= value.replaced;
      headers.push({ name: h.name, value: value.text });
    }
    // A form body from the parameters table is sent form-encoded, as JMeter does.
    if (s.formBody && !headers.some((h) => h.name.toLowerCase() === 'content-type')) {
      headers.push({ name: 'Content-Type', value: 'application/x-www-form-urlencoded' });
    }
    if (removedSession) {
      sessionHeaders++;
      warnings.push('Recorded Cookie/Authorization removed');
    }

    const path = replaceCredentials(s.path);
    const body = replaceCredentials(BODY_METHODS.has(s.method) ? s.body : null);
    credentials ||= path.replaced || body.replaced;
    if (s.hasFiles) warnings.push('File uploads are not replayed');
    if (/\$\{[^}]+\}/.test(`${path.text}${body.text ?? ''}${headers.map((h) => h.value).join('')}`)) {
      warnings.push('Uses a JMeter ${variable}: change it to a {{value}}');
    }

    let problem = null;
    if (!METHODS.has(s.method)) problem = `${s.method} requests can't be load tested`;
    else if (!path.text.startsWith('/') || path.text.startsWith('//')) problem = 'The path must start with a single "/"';
    else if (path.text.length > MAX_PATH || /\s/.test(path.text)) problem = 'The address is too long or has spaces';
    else if (body.text && body.text.length > MAX_BODY) problem = 'The body is over 64,000 characters';

    requests.push({
      key: String(requests.length),
      name: s.name,
      method: s.method,
      path: path.text,
      headers: headers.slice(0, 20),
      body: body.text || null,
      delayMs: s.delayMs,
      problem,
      warnings,
    });
  }

  const notes = [];
  if (requests.length === 0) {
    const hosts = [...otherHosts.keys()].slice(0, 3).join(', ');
    return { requests, notes, error: `None of the recorded requests go to the project's app at ${appOrigin}${hosts ? ` (found ${hosts})` : ''}.` };
  }
  if (otherHosts.size) {
    const n = [...otherHosts.values()].reduce((a, b) => a + b, 0);
    notes.push(`Left out ${plural(n, 'request')} to other servers (${[...otherHosts.keys()].slice(0, 3).join(', ')}${otherHosts.size > 3 ? ', …' : ''}). Load only goes to ${appOrigin}.`);
  }
  if (staticFiles) notes.push(`Left out ${plural(staticFiles, 'static file')} (scripts, styles, images, fonts).`);
  if (found.disabled) notes.push(`Left out ${plural(found.disabled, 'disabled request')}.`);
  if (found.threadGroups > 1) notes.push(`The plan has ${found.threadGroups} thread groups; their requests are listed in order as one flow.`);
  if (sessionHeaders) {
    notes.push(
      `Removed recorded Cookie and Authorization headers from ${plural(sessionHeaders, 'request')}: k6 keeps cookies for each virtual user. For a token, save it from the login response ("Save a value") and send Authorization: Bearer {{token}}.`
    );
  }
  if (credentials) notes.push('Replaced the test account’s username and password with {{username}} and {{password}}.');
  if (!found.samplers.some((s) => s.delayMs != null)) notes.push(`The recording has no timers, so each step gets ${DEFAULT_THINK_SEC} s of think time.`);
  return { requests, notes, error: '' };
}

// The requests to keep (in recorded order) as scenario steps, the way the load test form's
// stepsToForm takes them. Think time after a step is the recorded gap before the next kept request.
export function stepsFromRecording(requests, keys) {
  const keep = new Set(keys);
  const anyDelays = requests.some((r) => r.delayMs != null);
  const steps = [];
  const names = new Set();
  let last = null;
  let gapMs = 0;
  for (const r of requests) {
    if (last) gapMs += r.delayMs ?? 0;
    if (!keep.has(r.key)) continue;
    if (last) last.thinkTimeSec = thinkTime(gapMs, anyDelays);
    gapMs = 0;

    const base = (r.name && !/^\d+$/.test(r.name) ? r.name : `${r.method} ${r.path.split('?')[0]}`).replace(/\s+/g, ' ').trim() || `Step ${steps.length + 1}`;
    let name = base.slice(0, MAX_NAME);
    for (let n = 2; names.has(name.toLowerCase()); n++) name = `${base.slice(0, MAX_NAME - String(n).length - 3)} (${n})`;
    names.add(name.toLowerCase());

    last = {
      name,
      method: r.method,
      path: r.path,
      headers: r.headers,
      body: BODY_METHODS.has(r.method) ? r.body : null,
      expectStatus: null,
      extract: [],
      thinkTimeSec: DEFAULT_THINK_SEC,
      maxP95Ms: null,
    };
    steps.push(last);
  }
  return steps;
}

function thinkTime(gapMs, anyDelays) {
  if (!anyDelays) return DEFAULT_THINK_SEC;
  return Math.min(MAX_THINK_SEC, Math.round(gapMs / 100) / 10);
}

// The first `max` requests that can be steps.
export const defaultSelection = (requests, max) => requests.filter((r) => !r.problem).slice(0, max).map((r) => r.key);

// --- Recording plan -------------------------------------------------------------------------------

const escapeXml = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A JMeter test plan ready to record the project's app: a Thread Group with a Cookie Manager and a
// Recording Controller, and the HTTP(S) Test Script Recorder (a Non-Test Element) on `port`. The
// recorder only keeps requests to the app's host, skips static files, records headers, doesn't follow
// redirects (as AgentQA's k6 runs), and writes the pause before each request into a timer.
export function recordingPlanJmx({ projectName, appBaseUrl, port = RECORDER_PORT }) {
  const url = new URL(appBaseUrl);
  const include = `(?i)${escapeRegex(url.hostname)}(:\\d+)?([/?].*)?`;
  const exclude = `(?i).*\\.(${STATIC_EXTENSIONS})(\\?.*)?`;
  const s = (name, value) => `<stringProp name="${name}">${escapeXml(value)}</stringProp>`;
  const b = (name, value) => `<boolProp name="${name}">${value}</boolProp>`;
  const i = (name, value) => `<intProp name="${name}">${value}</intProp>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.6.3">
  <hashTree>
    <TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname="${escapeXml(`AgentQA recording: ${projectName}`)}" enabled="true">
      ${s('TestPlan.comments', `Records ${url.origin} for an AgentQA load test. Start the HTTP(S) Test Script Recorder, use the app through the proxy, stop it, save this plan and import it in AgentQA.`)}
      ${b('TestPlan.functional_mode', false)}
      ${b('TestPlan.serialize_threadgroups', false)}
      <elementProp name="TestPlan.user_defined_variables" elementType="Arguments" guiclass="ArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true">
        <collectionProp name="Arguments.arguments"/>
      </elementProp>
    </TestPlan>
    <hashTree>
      <ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup" testname="Recorded flow" enabled="true">
        ${s('ThreadGroup.on_sample_error', 'continue')}
        <elementProp name="ThreadGroup.main_controller" elementType="LoopController" guiclass="LoopControlPanel" testclass="LoopController" testname="Loop Controller" enabled="true">
          ${b('LoopController.continue_forever', false)}
          ${s('LoopController.loops', '1')}
        </elementProp>
        ${s('ThreadGroup.num_threads', '1')}
        ${s('ThreadGroup.ramp_time', '1')}
      </ThreadGroup>
      <hashTree>
        <CookieManager guiclass="CookiePanel" testclass="CookieManager" testname="HTTP Cookie Manager" enabled="true">
          <collectionProp name="CookieManager.cookies"/>
          ${b('CookieManager.clearEachIteration', true)}
        </CookieManager>
        <hashTree/>
        <RecordingController guiclass="RecordController" testclass="RecordingController" testname="Recording Controller" enabled="true"/>
        <hashTree/>
      </hashTree>
      <ProxyControl guiclass="ProxyControlGui" testclass="ProxyControl" testname="HTTP(S) Test Script Recorder" enabled="true">
        ${s('ProxyControlGui.port', String(port))}
        <collectionProp name="ProxyControlGui.exclude_list">
          ${s(String(hash(exclude)), exclude)}
        </collectionProp>
        <collectionProp name="ProxyControlGui.include_list">
          ${s(String(hash(include)), include)}
        </collectionProp>
        ${b('ProxyControlGui.capture_http_headers', true)}
        ${i('ProxyControlGui.grouping', 0)}
        ${b('ProxyControlGui.add_assertion', false)}
        ${b('ProxyControlGui.sampler_redirect_automatically', false)}
        ${b('ProxyControlGui.sampler_follow_redirects', false)}
        ${b('ProxyControlGui.use_keepalive', true)}
        ${b('ProxyControlGui.sampler_download_images', false)}
        ${b('ProxyControlGui.regex_match', false)}
        ${s('ProxyControlGui.default_encoding', 'UTF-8')}
      </ProxyControl>
      <hashTree>
        <ConstantTimer guiclass="ConstantTimerGui" testclass="ConstantTimer" testname="Think time (recorded)" enabled="true">
          ${s('ConstantTimer.delay', '${T}')}
        </ConstantTimer>
        <hashTree/>
      </hashTree>
    </hashTree>
  </hashTree>
</jmeterTestPlan>
`;
}

// JMeter names collection entries by their value's Java hashCode.
function hash(text) {
  let h = 0;
  for (let k = 0; k < text.length; k++) h = (Math.imul(31, h) + text.charCodeAt(k)) | 0;
  return h;
}

export const recordingPlanFileName = (projectName) =>
  `agentqa-recording-${String(projectName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project'}.jmx`;
