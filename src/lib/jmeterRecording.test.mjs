// node --test src/lib/jmeterRecording.test.mjs
// JMeter's HTTP(S) Test Script Recorder for load tests: the recording plan we hand out, and the saved
// .jmx read back into scenario steps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSelection, parseXml, readJmeterPlan, recordingPlanFileName, recordingPlanJmx, stepsFromRecording } from './jmeterRecording.js';

const APP = 'https://shop.example.com';
const ACCOUNT = { username: 'qa@example.com', password: 'S3cret pass!' };

const sampler = ({ name, method = 'GET', domain = 'shop.example.com', protocol = 'https', port = '', path, raw = false, args = [], enabled = true }, tree = '') => `
  <HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="${name}" enabled="${enabled}">
    ${raw ? '<boolProp name="HTTPSampler.postBodyRaw">true</boolProp>' : ''}
    <elementProp name="HTTPsampler.Arguments" elementType="Arguments">
      <collectionProp name="Arguments.arguments">
        ${args
          .map(
            (a) => `<elementProp name="${a.name ?? ''}" elementType="HTTPArgument">
              <boolProp name="HTTPArgument.always_encode">${a.encode ?? false}</boolProp>
              <stringProp name="Argument.name">${a.name ?? ''}</stringProp>
              <stringProp name="Argument.value">${a.value}</stringProp>
              <boolProp name="HTTPArgument.use_equals">true</boolProp>
            </elementProp>`
          )
          .join('')}
      </collectionProp>
    </elementProp>
    <stringProp name="HTTPSampler.domain">${domain}</stringProp>
    <stringProp name="HTTPSampler.port">${port}</stringProp>
    <stringProp name="HTTPSampler.protocol">${protocol}</stringProp>
    <stringProp name="HTTPSampler.path">${path}</stringProp>
    <stringProp name="HTTPSampler.method">${method}</stringProp>
  </HTTPSamplerProxy>
  <hashTree>${tree}</hashTree>`;

const headers = (list) => `
  <HeaderManager guiclass="HeaderPanel" testclass="HeaderManager" testname="HTTP Header Manager">
    <collectionProp name="HeaderManager.headers">
      ${list.map(([n, v]) => `<elementProp name="${n}" elementType="Header"><stringProp name="Header.name">${n}</stringProp><stringProp name="Header.value">${v}</stringProp></elementProp>`).join('')}
    </collectionProp>
  </HeaderManager>
  <hashTree/>`;

const timer = (ms) => `<ConstantTimer guiclass="ConstantTimerGui" testclass="ConstantTimer" testname="t"><stringProp name="ConstantTimer.delay">${ms}</stringProp></ConstantTimer><hashTree/>`;

const plan = (body) => `<?xml version="1.0" encoding="UTF-8"?>
<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.6.3">
  <hashTree>
    <TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname="Plan"/>
    <hashTree>
      <ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup" testname="TG"/>
      <hashTree>
        ${headers([['Accept-Language', 'en']])}
        <RecordingController guiclass="RecordController" testclass="RecordingController" testname="Recording Controller"/>
        <hashTree>${body}</hashTree>
      </hashTree>
    </hashTree>
  </hashTree>
</jmeterTestPlan>`;

const RECORDING = plan(
  [
    sampler({ name: '/', path: '/' }, headers([['Cookie', 'sid=abc'], ['User-Agent', 'Mozilla'], ['Sec-Fetch-Mode', 'navigate']]) + timer(5000)),
    sampler({ name: '/static/app.js', path: '/static/app.js' }),
    sampler({ name: '/collect', domain: 'www.google-analytics.com', path: '/collect' }),
    sampler(
      { name: '/api/login', method: 'POST', path: '/api/login', raw: true, args: [{ value: '{&quot;email&quot;:&quot;qa@example.com&quot;,&quot;password&quot;:&quot;S3cret pass!&quot;}' }] },
      headers([['Content-Type', 'application/json'], ['Host', 'shop.example.com']]) + timer(2500)
    ),
    sampler({ name: '/search', path: '/search', args: [{ name: 'q', value: 'red shoes', encode: true }, { name: 'page', value: '1' }] }, timer(1200)),
    sampler({ name: '/old', path: '/old', enabled: false }),
    sampler({ name: '/cart', method: 'POST', path: '/cart', args: [{ name: 'sku', value: 'A 1', encode: true }] }, headers([['Authorization', 'Bearer xyz']]) + timer(800)),
  ].join('')
);

test('parseXml reads elements, attributes, entities and CDATA, and rejects broken XML', () => {
  const root = parseXml('<?xml version="1.0"?><!DOCTYPE x><a k="1 &amp; 2"><!-- c --><b>x &lt; y &#65;&#x42;</b><c><![CDATA[<raw>]]></c><d/></a>');
  assert.equal(root.name, 'a');
  assert.equal(root.attrs.k, '1 & 2');
  assert.deepEqual(root.children.map((c) => [c.name, c.text]), [['b', 'x < y AB'], ['c', '<raw>'], ['d', '']]);
  assert.throws(() => parseXml('<a><b></a>'), /not valid XML/);
  assert.throws(() => parseXml('<a>'), /never closed/);
});

test('readJmeterPlan keeps the app’s requests in order and explains what it left out', () => {
  const { requests, notes, error } = readJmeterPlan(RECORDING, { appBaseUrl: `${APP}/home`, account: ACCOUNT });
  assert.equal(error, '');
  assert.deepEqual(requests.map((r) => `${r.method} ${r.path}`), ['GET /', 'POST /api/login', 'GET /search?q=red%20shoes&page=1', 'POST /cart']);
  assert.ok(requests.every((r) => r.problem === null));

  const [home, login, , cart] = requests;
  // Thread-group headers are inherited; browser, session and connection headers dropped.
  assert.deepEqual(home.headers, [{ name: 'Accept-Language', value: 'en' }, { name: 'User-Agent', value: 'Mozilla' }]);
  assert.deepEqual(home.warnings, ['Recorded Cookie/Authorization removed']);
  // The test account becomes {{username}} / {{password}}.
  assert.equal(login.body, '{"email":"{{username}}","password":"{{password}}"}');
  assert.deepEqual(login.headers.map((h) => h.name), ['Accept-Language', 'Content-Type']);
  // A parameters table on POST is a form body.
  assert.equal(cart.body, 'sku=A%201');
  assert.ok(cart.headers.some((h) => h.name === 'Content-Type' && h.value === 'application/x-www-form-urlencoded'));
  assert.ok(!cart.headers.some((h) => h.name === 'Authorization'));

  const text = notes.join('\n');
  assert.match(text, /1 request to other servers \(https:\/\/www\.google-analytics\.com\)/);
  assert.match(text, /1 static file/);
  assert.match(text, /1 disabled request/);
  assert.match(text, /Cookie and Authorization headers from 2 requests/);
  assert.match(text, /\{\{username\}\} and \{\{password\}\}/);
});

test('stepsFromRecording turns recorded gaps into think time and keeps names unique', () => {
  const { requests } = readJmeterPlan(RECORDING, { appBaseUrl: APP, account: ACCOUNT });
  const all = stepsFromRecording(requests, requests.map((r) => r.key));
  // A timer holds the pause before its request, so it is the think time after the previous step.
  assert.deepEqual(all.map((s) => [s.name, s.thinkTimeSec]), [['/', 2.5], ['/api/login', 1.2], ['/search', 0.8], ['/cart', 1]]);
  assert.equal(all[0].body, null);
  assert.deepEqual(all[0].extract, []);

  // Skipping a request adds its gap to the pause before the next kept one.
  const some = stepsFromRecording(requests, ['0', '3']);
  assert.deepEqual(some.map((s) => [s.name, s.thinkTimeSec]), [['/', 4.5], ['/cart', 1]]);

  const twice = stepsFromRecording([...requests, { ...requests[0], key: '9' }], ['0', '9']);
  assert.deepEqual(twice.map((s) => s.name), ['/', '/ (2)']);
});

test('readJmeterPlan uses HTTP Request Defaults, full URLs in the path, and flags what can’t be a step', () => {
  const xml = plan(
    `<ConfigTestElement guiclass="HttpDefaultsGui" testclass="ConfigTestElement" testname="Defaults">
       <stringProp name="HTTPSampler.domain">shop.example.com</stringProp>
       <stringProp name="HTTPSampler.protocol">https</stringProp>
     </ConfigTestElement><hashTree/>` +
      sampler({ name: 'a', domain: '', protocol: '', path: '/a' }) +
      sampler({ name: 'b', domain: '', protocol: '', path: 'https://shop.example.com:443/b?x=1' }) +
      sampler({ name: 'c', method: 'OPTIONS', path: '/c' }) +
      sampler({ name: 'd', path: '/d/${id}' })
  );
  const { requests, notes } = readJmeterPlan(xml, { appBaseUrl: APP });
  assert.deepEqual(requests.map((r) => r.path), ['/a', '/b?x=1', '/c', '/d/${id}']);
  assert.match(requests[2].problem, /OPTIONS/);
  assert.match(requests[3].warnings[0], /JMeter \$\{variable\}/);
  assert.match(notes.join(), /no timers/);
  assert.deepEqual(defaultSelection(requests, 2), ['0', '1']);
  assert.deepEqual(stepsFromRecording(requests, ['0', '1']).map((s) => s.thinkTimeSec), [1, 1]);
});

test('readJmeterPlan explains files it can’t use', () => {
  assert.match(readJmeterPlan('', { appBaseUrl: APP }).error, /empty/);
  assert.match(readJmeterPlan('<html></html>', { appBaseUrl: APP }).error, /not a JMeter test plan/);
  assert.match(readJmeterPlan('<jmeterTestPlan><hashTree>', { appBaseUrl: APP }).error, /not valid XML/);
  assert.match(readJmeterPlan(plan(''), { appBaseUrl: APP }).error, /no HTTP requests/);
  assert.match(readJmeterPlan(plan(sampler({ name: 'x', domain: 'other.test', path: '/' })), { appBaseUrl: APP }).error, /found https:\/\/other\.test/);
  assert.match(readJmeterPlan(RECORDING, { appBaseUrl: '' }).error, /app link/);
});

test('recordingPlanJmx is a JMeter plan with the recorder set up for the project’s app', () => {
  const xml = recordingPlanJmx({ projectName: 'Shop <QA>', appBaseUrl: 'http://localhost:3000/app' });
  const root = parseXml(xml);
  assert.equal(root.name, 'jmeterTestPlan');
  assert.match(xml, /testname="AgentQA recording: Shop &lt;QA&gt;"/);
  assert.match(xml, /<ProxyControl guiclass="ProxyControlGui" testclass="ProxyControl"/);
  assert.match(xml, /<stringProp name="ProxyControlGui.port">8888<\/stringProp>/);
  assert.match(xml, /\(\?i\)localhost\(:\\d\+\)\?\(\[\/\?\]\.\*\)\?/);
  assert.match(xml, /ProxyControlGui.sampler_follow_redirects">false/);
  assert.match(xml, /<stringProp name="ConstantTimer.delay">\$\{T\}<\/stringProp>/);
  // The include pattern matches what the recorder checks, whole (Java's matches()): host:port/path?query.
  const include = new RegExp(`^(?:${/include_list">\s*<stringProp name="-?\d+">\(\?i\)(.*?)<\/stringProp>/.exec(xml)[1]})$`, 'i');
  assert.ok(include.test('localhost:3000/api/login?x=1'));
  assert.ok(!include.test('evil.localhost.test:80/'));
  // An untouched plan has no requests yet.
  assert.match(readJmeterPlan(xml, { appBaseUrl: 'http://localhost:3000' }).error, /no HTTP requests/);
  assert.equal(recordingPlanFileName('Shop <QA>'), 'agentqa-recording-shop-qa.jmx');
});
