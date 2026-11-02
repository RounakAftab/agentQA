// The Codegen run report (report.js) as one self-contained HTML file, to download and share with
// people who don't use AgentQA. No scripts or external files: styles and the screenshot are inline.
import { formatDuration } from './report.js';

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const STATUS = { PASSED: 'Passed', FAILED: 'Failed', ERROR: 'Error', CANCELLED: 'Cancelled' };
const ICON = { good: '✓', bad: '✕', warn: '!', info: 'i' };

const CSS = `
:root { --bg:#f8fafc; --card:#fff; --ink:#0f172a; --muted:#64748b; --line:#e2e8f0; --bar:#2563eb;
  --good:#047857; --good-bg:#ecfdf5; --bad:#b91c1c; --bad-bg:#fef2f2; --warn:#92400e; --warn-bg:#fffbeb; --info:#1d4ed8; --info-bg:#eff6ff; }
@media (prefers-color-scheme: dark) { :root { --bg:#0b1120; --card:#111827; --ink:#e5e7eb; --muted:#94a3b8; --line:#1f2937; --bar:#60a5fa;
  --good:#6ee7b7; --good-bg:#06281f; --bad:#fca5a5; --bad-bg:#2a0f12; --warn:#fcd34d; --warn-bg:#2a2208; --info:#93c5fd; --info-bg:#0c1d3a; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; }
main { max-width: 960px; margin: 0 auto; padding: 32px 16px 48px; }
header { display:flex; justify-content:space-between; gap:16px; align-items:flex-start; flex-wrap:wrap; margin-bottom:24px; }
h1 { font-size:22px; margin:0 0 4px; }
h2 { font-size:15px; margin:0 0 12px; }
.muted { color:var(--muted); font-size:13px; }
.badge { padding:4px 12px; border-radius:999px; font-weight:600; font-size:13px; }
.badge.PASSED { background:var(--good-bg); color:var(--good); } .badge.FAILED, .badge.ERROR { background:var(--bad-bg); color:var(--bad); }
.badge.CANCELLED { background:var(--warn-bg); color:var(--warn); }
section { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:18px 20px; margin-bottom:16px; }
.tiles { display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:12px; }
.tile { border:1px solid var(--line); border-radius:8px; padding:12px; }
.tile b { display:block; font-size:22px; font-variant-numeric:tabular-nums; }
ul.insights { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:8px; }
.insight { display:flex; gap:10px; padding:10px 12px; border-radius:8px; }
.insight .i { flex:0 0 20px; height:20px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:700; color:var(--card); }
.insight.good { background:var(--good-bg); } .insight.good .i { background:var(--good); }
.insight.bad { background:var(--bad-bg); } .insight.bad .i { background:var(--bad); }
.insight.warn { background:var(--warn-bg); } .insight.warn .i { background:var(--warn); }
.insight.info { background:var(--info-bg); } .insight.info .i { background:var(--info); }
.insight p { margin:2px 0 0; color:var(--muted); font-size:13px; }
code { font-family:'JetBrains Mono', Consolas, monospace; font-size:12px; word-break:break-word; }
.bars { display:flex; flex-direction:column; gap:8px; }
.bar-row { display:grid; grid-template-columns:minmax(0, 1fr) 160px 120px; gap:12px; align-items:center; }
.bar { height:8px; border-radius:4px; background:var(--line); overflow:hidden; }
.bar span { display:block; height:100%; background:var(--bar); border-radius:4px; }
.num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
.trend { display:flex; gap:6px; align-items:flex-end; height:80px; }
.trend div { flex:1; max-width:48px; border-radius:4px 4px 0 0; min-height:4px; }
.trend .PASSED { background:var(--good); } .trend .FAILED, .trend .ERROR { background:var(--bad); } .trend .CANCELLED { background:var(--warn); }
.trend .current { outline:2px solid var(--ink); outline-offset:2px; }
table { width:100%; border-collapse:collapse; font-size:13px; }
th { text-align:left; color:var(--muted); font-weight:600; font-size:12px; padding:6px 8px; border-bottom:1px solid var(--line); }
td { padding:6px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
tr.failed td { background:var(--bad-bg); }
.kind { font-size:11px; font-weight:600; color:var(--muted); }
img { max-width:100%; border:1px solid var(--line); border-radius:8px; }
@media (max-width: 640px) { .bar-row { grid-template-columns: 1fr 120px; } .bar-row .bar { display:none; } }
`;

function bars(rows) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return `<div class="bars">${rows
    .map(
      (r) =>
        `<div class="bar-row"><div>${r.label}</div><div class="bar"><span style="width:${Math.max(2, Math.round((r.value / max) * 100))}%"></span></div><div class="num">${esc(r.text)}</div></div>`
    )
    .join('')}</div>`;
}

export function renderReportHtml(report, { generatedAt = new Date() } = {}) {
  const { summary: s } = report;
  const date = new Date(report.run.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  const tile = (title, value, sub = '') => `<div class="tile"><span class="muted">${esc(title)}</span><b>${esc(value)}</b><span class="muted">${esc(sub)}</span></div>`;
  const maxTrend = Math.max(...report.trend.map((t) => t.durationMs ?? 0), 1);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(report.script.title)}: test report</title>
<style>${CSS}</style>
</head>
<body>
<main>
<header>
  <div>
    <h1>${esc(report.script.title)}</h1>
    <div class="muted">${esc(report.script.startUrl)}</div>
    <div class="muted">Run ${esc(date)} · ${report.run.style === 'pom' ? 'Page Object Model' : 'Plain spec'} · AgentQA Codegen</div>
  </div>
  <span class="badge ${esc(report.run.status)}">${esc(STATUS[report.run.status] ?? report.run.status)}</span>
</header>

<section>
  <div class="tiles">
    ${tile('Duration', formatDuration(s.durationMs), s.usualDurationMs ? `usually ${formatDuration(s.usualDurationMs)}` : '')}
    ${tile('Tests', `${s.passedTests}/${s.tests}`, 'passed')}
    ${tile('Actions', s.actions, `${s.navigations} page ${s.navigations === 1 ? 'load' : 'loads'}`)}
    ${tile('Checks', s.checks, s.checks ? 'all verified' : 'none')}
  </div>
</section>

<section>
  <h2>Insights</h2>
  <ul class="insights">${report.insights
    .map((i) => `<li class="insight ${i.level}"><span class="i">${ICON[i.level]}</span><div><strong>${esc(i.title)}</strong>${i.detail ? `<p>${esc(i.detail)}</p>` : ''}</div></li>`)
    .join('')}</ul>
</section>

<section>
  <h2>Where the time went</h2>
  ${bars(report.slowest.map((x) => ({ label: `<code>${esc(x.label)}</code>`, value: x.durationMs, text: `${formatDuration(x.durationMs)} · ${x.sharePct}%` })))}
  ${report.pages ? `<h2 style="margin-top:20px">Time per page</h2>${bars(report.pages.map((p) => ({ label: esc(p.page), value: p.durationMs, text: formatDuration(p.durationMs) })))}` : ''}
</section>

${
  report.trend.length > 1
    ? `<section>
  <h2>Last ${report.trend.length} runs</h2>
  <div class="trend" role="img" aria-label="Duration and result of the last runs, oldest first">${report.trend
    .map((t) => `<div class="${esc(t.status)}${t.current ? ' current' : ''}" style="height:${Math.max(6, Math.round(((t.durationMs ?? 0) / maxTrend) * 100))}%" title="${esc(STATUS[t.status] ?? t.status)} · ${esc(formatDuration(t.durationMs))}"></div>`)
    .join('')}</div>
  <p class="muted">Oldest first; height is duration, green passed, red failed. The outlined bar is this run.</p>
</section>`
    : ''
}

<section>
  <h2>Steps</h2>
  <table>
    <thead><tr><th>#</th><th>Step</th><th class="num">Time</th></tr></thead>
    <tbody>${report.steps
      .map(
        (x) =>
          `<tr class="${x.error ? 'failed' : ''}"><td>${x.n}</td><td><span class="kind">${x.isCheck ? 'CHECK' : 'ACTION'}</span> <code>${esc(x.label)}</code>${x.error ? `<div class="muted">${esc(x.error.split('\n')[0])}</div>` : ''}</td><td class="num">${esc(formatDuration(x.durationMs))}</td></tr>`
      )
      .join('')}</tbody>
  </table>
</section>

${report.screenshot && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(report.screenshot) ? `<section><h2>${report.run.status === 'PASSED' ? 'Final page' : 'Page at the failure'}</h2><img src="${report.screenshot}" alt="Screenshot of the page"></section>` : ''}

<p class="muted">Generated by AgentQA on ${esc(generatedAt.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }))}.</p>
</main>
</body>
</html>`;
}
