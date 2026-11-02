'use client';

import { useRunReport, reportDownloadUrl } from '@/lib/codegenClient';
import { formatDuration } from '@/lib/codegen/report';
import { AlertCircle, AlertTriangle, CheckCircle2, Download, Info, Loader2, XCircle } from 'lucide-react';
import styles from './RunReport.module.css';

const INSIGHT_ICON = { good: CheckCircle2, bad: XCircle, warn: AlertTriangle, info: Info };
const STATUS_LABEL = { PASSED: 'Passed', FAILED: 'Failed' };

function Tile({ label, value, sub }) {
  return (
    <div className={styles.tile}>
      <span className={styles.tileLabel}>{label}</span>
      <span className={styles.tileValue}>{value}</span>
      {sub && <span className={styles.tileSub}>{sub}</span>}
    </div>
  );
}

function Bars({ rows }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className={styles.bars}>
      {rows.map((r, i) => (
        <div key={i} className={styles.barRow}>
          <div className={styles.barLabel}>{r.label}</div>
          <div className={styles.bar}>
            <span style={{ width: `${Math.max(2, Math.round((r.value / max) * 100))}%` }} />
          </div>
          <div className={styles.barValue}>{r.text}</div>
        </div>
      ))}
    </div>
  );
}

// The rule-based report of a finished test run: summary, insights, where the time went, the recent
// trend and the final page. Download gives the same report as one HTML file to share.
export default function RunReport({ runId }) {
  const { report, loaded, error } = useRunReport(runId);
  if (!loaded) {
    return (
      <div className={styles.empty}>
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }
  if (!report) {
    return (
      <div className={styles.empty}>
        <AlertCircle size={18} /> {error || 'No report for this run.'}
      </div>
    );
  }

  const s = report.summary;
  const maxTrend = Math.max(...report.trend.map((t) => t.durationMs ?? 0), 1);
  return (
    <div className={styles.report}>
      <div className={styles.head}>
        <div className={styles.tiles}>
          <Tile label="Duration" value={formatDuration(s.durationMs)} sub={s.usualDurationMs ? `usually ${formatDuration(s.usualDurationMs)}` : null} />
          <Tile label="Tests passed" value={`${s.passedTests}/${s.tests}`} />
          <Tile label="Actions" value={s.actions} sub={`${s.navigations} page ${s.navigations === 1 ? 'load' : 'loads'}`} />
          <Tile label="Checks" value={s.checks} sub={s.checks ? null : 'nothing verified'} />
        </div>
        <a className="btn btn-secondary btn-sm" href={reportDownloadUrl(runId)} download>
          <Download size={13} /> Download report
        </a>
      </div>

      <section>
        <h4 className={styles.title}>Insights</h4>
        <ul className={styles.insights}>
          {report.insights.map((insight, i) => {
            const Icon = INSIGHT_ICON[insight.level];
            return (
              <li key={i} className={`${styles.insight} ${styles[insight.level]}`}>
                <Icon size={15} />
                <div>
                  <strong>{insight.title}</strong>
                  {insight.detail && <p>{insight.detail}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <div className={styles.columns}>
        <section>
          <h4 className={styles.title}>Where the time went</h4>
          <Bars rows={report.slowest.map((x) => ({ label: <code>{x.label}</code>, value: x.durationMs, text: `${formatDuration(x.durationMs)} · ${x.sharePct}%` }))} />
          {report.pages && (
            <>
              <h4 className={`${styles.title} ${styles.spaced}`}>Time per page</h4>
              <Bars rows={report.pages.map((p) => ({ label: p.page, value: p.durationMs, text: `${formatDuration(p.durationMs)} · ${p.steps} ${p.steps === 1 ? 'step' : 'steps'}` }))} />
            </>
          )}
        </section>

        {report.trend.length > 1 && (
          <section>
            <h4 className={styles.title}>Last {report.trend.length} runs</h4>
            <div className={styles.trend} role="img" aria-label="Duration and result of the last runs, oldest first">
              {report.trend.map((t) => (
                <div
                  key={t.id}
                  className={`${styles.trendBar} ${t.status === 'PASSED' ? styles.trendPass : styles.trendFail} ${t.current ? styles.trendCurrent : ''}`}
                  style={{ height: `${Math.max(6, Math.round(((t.durationMs ?? 0) / maxTrend) * 100))}%` }}
                  title={`${STATUS_LABEL[t.status] ?? t.status} · ${formatDuration(t.durationMs)}${t.current ? ' · this run' : ''}`}
                />
              ))}
            </div>
            <p className={styles.legend}>
              Oldest first; height is duration. <span className={styles.dotPass} /> passed <span className={styles.dotFail} /> failed · outlined: this run
            </p>
          </section>
        )}
      </div>

      {report.screenshot && (
        <section>
          <h4 className={styles.title}>{report.run.status === 'PASSED' ? 'Final page' : 'Page at the failure'}</h4>
          {/* eslint-disable-next-line @next/next/no-img-element -- a data URL from the run, not a static asset */}
          <img className={styles.screenshot} src={report.screenshot} alt={report.run.status === 'PASSED' ? 'The page when the test finished' : 'The page when the test failed'} />
        </section>
      )}
    </div>
  );
}
