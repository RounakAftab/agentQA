// The plain-language load test report (loadTestReport.js) as one self-contained HTML file, to
// download and send to clients. No scripts or external files.
import { RATING_GUIDE } from './loadTestReport.js';

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const ICON = { good: '✓', bad: '✕', warn: '!', info: 'i' };
const fmtMs = (ms) => (ms == null ? '–' : ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`);

const CSS = `
:root { --bg:#f8fafc; --card:#fff; --ink:#0f172a; --muted:#64748b; --line:#e2e8f0;
  --good:#047857; --good-bg:#ecfdf5; --bad:#b91c1c; --bad-bg:#fef2f2; --warn:#92400e; --warn-bg:#fffbeb; --info:#1d4ed8; --info-bg:#eff6ff; }
@media (prefers-color-scheme: dark) { :root { --bg:#0b1120; --card:#111827; --ink:#e5e7eb; --muted:#94a3b8; --line:#1f2937;
  --good:#6ee7b7; --good-bg:#06281f; --bad:#fca5a5; --bad-bg:#2a0f12; --warn:#fcd34d; --warn-bg:#2a2208; --info:#93c5fd; --info-bg:#0c1d3a; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.55 -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; }
main { max-width: 900px; margin: 0 auto; padding: 32px 16px 48px; }
header { margin-bottom:20px; }
h1 { font-size:22px; margin:0 0 4px; }
h2 { font-size:15px; margin:0 0 12px; }
.muted { color:var(--muted); font-size:13px; }
section { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:18px 20px; margin-bottom:16px; }
.verdict { border-width:2px; }
.verdict.good { border-color:var(--good); background:var(--good-bg); } .verdict.bad { border-color:var(--bad); background:var(--bad-bg); }
.verdict.warn { border-color:var(--warn); background:var(--warn-bg); }
.verdict h2 { font-size:20px; margin:0 0 6px; display:flex; align-items:center; gap:10px; }
.verdict p { margin:6px 0 0; }
.dot { flex:0 0 26px; height:26px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:14px; font-weight:700; color:var(--card); }
.good .dot, .dot.good { background:var(--good); } .bad .dot, .dot.bad { background:var(--bad); } .warn .dot, .dot.warn { background:var(--warn); } .dot.info { background:var(--info); }
.cards { display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:12px; }
.card { border:1px solid var(--line); border-radius:8px; padding:14px; display:flex; flex-direction:column; gap:6px; }
.card .top { display:flex; justify-content:space-between; align-items:baseline; gap:8px; }
.card b.value { font-size:24px; font-variant-numeric:tabular-nums; }
.pill { font-size:12px; font-weight:600; padding:2px 10px; border-radius:999px; white-space:nowrap; }
.pill.good { background:var(--good-bg); color:var(--good); } .pill.bad { background:var(--bad-bg); color:var(--bad); } .pill.warn { background:var(--warn-bg); color:var(--warn); }
.card p { margin:0; }
ul.insights { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:8px; }
.insight { display:flex; gap:10px; padding:10px 12px; border-radius:8px; }
.insight .dot { flex-basis:20px; height:20px; font-size:12px; }
.insight.good { background:var(--good-bg); } .insight.bad { background:var(--bad-bg); } .insight.warn { background:var(--warn-bg); } .insight.info { background:var(--info-bg); }
.insight p { margin:2px 0 0; color:var(--muted); font-size:13px; }
ol.next { margin:0; padding-left:20px; display:flex; flex-direction:column; gap:6px; }
table { width:100%; border-collapse:collapse; font-size:13px; }
th { text-align:left; color:var(--muted); font-weight:600; font-size:12px; padding:6px 8px; border-bottom:1px solid var(--line); }
td { padding:6px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
td.num, th.num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
dl { margin:0; display:grid; grid-template-columns:minmax(120px, 200px) 1fr; gap:6px 16px; font-size:13px; }
dt { font-weight:600; } dd { margin:0; color:var(--muted); }
footer { text-align:center; }
@media (max-width: 560px) { dl { grid-template-columns:1fr; } dd { margin-bottom:6px; } }
@media print { body { background:#fff; } section { break-inside:avoid; } }
`;

export function renderLoadReportHtml(report, { generatedAt = new Date() } = {}) {
  const date = new Date(report.run.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  const n = report.numbers;
  const row = (label, value) => `<tr><td>${esc(label)}</td><td class="num">${esc(value)}</td></tr>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(report.test.name)}: load test report</title>
<style>${CSS}</style>
</head>
<body>
<main>
<header>
  <h1>${esc(report.test.name)}: load test report</h1>
  <div class="muted">${report.test.project ? `${esc(report.test.project)} · ` : ''}Run ${esc(date)} · ${esc(report.load.users)} simulated users${report.load.rampUpSec ? `, ${esc(report.load.rampUpSec)}s ramp-up` : ''}, ${esc(report.load.fullLoadSec)}s at full load</div>
</header>

<section class="verdict ${esc(report.verdict.level)}">
  <h2><span class="dot">${ICON[report.verdict.level]}</span>${esc(report.verdict.title)}</h2>
  <p>${esc(report.summaryLine)}</p>
  <p class="muted">${esc(report.verdict.detail)}</p>
</section>

<section>
  <div class="cards">${report.cards
    .map(
      (c) => `<div class="card">
    <div class="top"><strong>${esc(c.title)}</strong><span class="pill ${esc(c.level)}">${esc(c.label)}</span></div>
    <span class="muted">${esc(c.question)}</span>
    <b class="value">${esc(c.value)}</b>
    <p>${esc(c.headline)}</p>
    <p class="muted">${esc(c.detail)}</p>
  </div>`
    )
    .join('')}</div>
</section>

<section>
  <h2>What we noticed</h2>
  <ul class="insights">${report.insights
    .map((i) => `<li class="insight ${esc(i.level)}"><span class="dot ${esc(i.level)}">${ICON[i.level]}</span><div><strong>${esc(i.title)}</strong>${i.detail ? `<p>${esc(i.detail)}</p>` : ''}</div></li>`)
    .join('')}</ul>
</section>

${report.next.length ? `<section><h2>Recommended next steps</h2><ol class="next">${report.next.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></section>` : ''}

${
  report.steps
    ? `<section>
  <h2>Each step of the journey</h2>
  <table>
    <thead><tr><th>Step</th><th class="num">Requests</th><th class="num">Typical</th><th class="num">95 of 100 within</th><th class="num">Failed</th></tr></thead>
    <tbody>${report.steps
      .map((st, i) => `<tr><td>${i + 1}. ${esc(st.name)}</td><td class="num">${esc(st.requests.toLocaleString('en-US'))}</td><td class="num">${esc(fmtMs(st.avgMs))}</td><td class="num">${esc(fmtMs(st.p95Ms))}${st.maxP95Ms != null ? ` <span class="muted">(target ${esc(fmtMs(st.maxP95Ms))})</span>` : ''}</td><td class="num">${st.failedPct == null ? '–' : `${esc(st.failedPct)}%`}</td></tr>`)
      .join('')}</tbody>
  </table>
</section>`
    : ''
}

<section>
  <h2>The numbers</h2>
  <table>
    <tbody>
      ${row('Requests sent', n.requests.toLocaleString('en-US'))}
      ${row('Requests per second', n.rps)}
      ${row('Failed requests', `${n.failedRequests.toLocaleString('en-US')} (${n.errorPct}%)`)}
      ${row('Average response time', fmtMs(n.avgMs))}
      ${row('Median response time', fmtMs(n.medMs))}
      ${row('90 of 100 within (p90)', fmtMs(n.p90Ms))}
      ${row('95 of 100 within (p95)', fmtMs(n.p95Ms))}
      ${row('99 of 100 within (p99)', fmtMs(n.p99Ms))}
      ${row('Slowest response', fmtMs(n.maxMs))}
      ${row('Test length', `${Math.round(n.durationMs / 1000)} s`)}
    </tbody>
  </table>
</section>

<section>
  <h2>How we rate</h2>
  <dl>${RATING_GUIDE.map(([t, d]) => `<dt>${esc(t)}</dt><dd>${esc(d)}</dd>`).join('')}</dl>
</section>

<section>
  <h2>Terms used</h2>
  <dl>${report.glossary.map(([t, d]) => `<dt>${esc(t)}</dt><dd>${esc(d)}</dd>`).join('')}</dl>
</section>

<footer class="muted">Measured with k6 by AgentQA · Generated ${esc(generatedAt.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }))}</footer>
</main>
</body>
</html>`;
}
