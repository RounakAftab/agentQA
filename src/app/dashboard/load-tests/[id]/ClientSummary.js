'use client';

import { useMemo } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Info, Download, Gauge, ShieldCheck, Users, Loader2 } from 'lucide-react';
import { buildLoadReport, RATING_GUIDE } from '@/lib/loadTestReport';
import { renderLoadReportHtml } from '@/lib/loadTestReportHtml';
import styles from './page.module.css';

const LEVEL_ICON = { good: CheckCircle2, bad: XCircle, warn: AlertTriangle, info: Info };
const CARD_ICON = { speed: Gauge, reliability: ShieldCheck, capacity: Users };

function downloadReport(report) {
  const html = renderLoadReportHtml(report);
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const link = document.createElement('a');
  const day = new Date(report.run.createdAt).toISOString().slice(0, 10);
  link.href = url;
  link.download = `${report.test.name.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'load-test'}-report-${day}.html`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// k6's numbers in plain language, for clients and anyone who doesn't read percentiles.
export default function ClientSummary({ test, run, active }) {
  const report = useMemo(() => buildLoadReport(test, run), [test, run]);

  if (!report) {
    return (
      <div className={styles.empty}>
        {active ? <Loader2 size={18} className="animate-spin" /> : <Info size={18} />}
        <span>
          {active
            ? 'The plain-language summary is ready when the run finishes. Live numbers are on the Charts tab.'
            : 'This run has no final numbers to summarize. See the console.'}
        </span>
      </div>
    );
  }

  const VerdictIcon = LEVEL_ICON[report.verdict.level];
  return (
    <div className={styles.client} id="load-client-summary">
      <div className={`${styles.verdict} ${styles[`lvl_${report.verdict.level}`]}`}>
        <VerdictIcon size={26} className={styles.verdictIcon} />
        <div className={styles.verdictBody}>
          <h3>{report.verdict.title}</h3>
          <p>{report.summaryLine}</p>
          <p className={styles.verdictDetail}>{report.verdict.detail}</p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => downloadReport(report)} id="load-download-report" title="A single HTML file you can send to clients">
          <Download size={14} /> Download report
        </button>
      </div>

      <div className={styles.ratingCards}>
        {report.cards.map((c) => {
          const Icon = CARD_ICON[c.key];
          return (
            <div key={c.key} className={styles.ratingCard}>
              <div className={styles.ratingHead}>
                <span className={styles.ratingTitle}>
                  <Icon size={15} /> {c.title}
                </span>
                <span className={`${styles.pill} ${styles[`lvl_${c.level}`]}`}>{c.label}</span>
              </div>
              <span className={styles.ratingQuestion}>{c.question}</span>
              <span className={styles.ratingValue}>{c.value}</span>
              <p className={styles.ratingHeadline}>{c.headline}</p>
              <p className={styles.ratingDetail}>{c.detail}</p>
            </div>
          );
        })}
      </div>

      <div>
        <h4 className={styles.clientHeading}>What we noticed</h4>
        <ul className={styles.insights}>
          {report.insights.map((i) => {
            const Icon = LEVEL_ICON[i.level];
            return (
              <li key={i.title} className={`${styles.insight} ${styles[`lvl_${i.level}`]}`}>
                <Icon size={16} />
                <div>
                  <strong>{i.title}</strong>
                  {i.detail && <p>{i.detail}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {report.next.length > 0 && (
        <div>
          <h4 className={styles.clientHeading}>Recommended next steps</h4>
          <ol className={styles.nextSteps}>
            {report.next.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ol>
        </div>
      )}

      <details className={styles.glossary}>
        <summary>How we rate, and what the terms mean</summary>
        <dl>
          {RATING_GUIDE.map(([t, d]) => [<dt key={`r-${t}`}>{t}</dt>, <dd key={`rd-${t}`}>{d}</dd>])}
          {report.glossary.map(([t, d]) => [<dt key={`g-${t}`}>{t}</dt>, <dd key={`gd-${t}`}>{d}</dd>])}
        </dl>
      </details>
    </div>
  );
}
