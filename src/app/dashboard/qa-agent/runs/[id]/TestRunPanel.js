'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Monitor, Play, Square, XCircle, MinusCircle, MonitorPlay } from 'lucide-react';
import { formatDateTime, getRelativeTime } from '@/lib/format';
import { cancelTestRun, isRunActive, startTestRun, TEST_RUN_STATUS } from '@/lib/qaAgentClient';
import styles from './TestRunPanel.module.css';

const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;
const TEST_ICON = {
  passed: <CheckCircle2 size={15} className={styles.good} />,
  failed: <XCircle size={15} className={styles.bad} />,
  timedOut: <XCircle size={15} className={styles.bad} />,
  interrupted: <XCircle size={15} className={styles.bad} />,
  skipped: <MinusCircle size={15} className={styles.muted} />,
  running: <Loader2 size={15} className="animate-spin" />,
};

// "Run test": runs the run's saved test (spec + page objects) again on the worker, without the AI,
// headless or with the browser visible on the worker's computer.
export default function TestRunPanel({ run, worker, canOperate, onChange }) {
  const [headed, setHeaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const latest = run.testRuns[0] ?? null;
  const active = isRunActive(latest);
  const consoleRef = useRef(null);
  const consoleText = latest?.console ?? '';

  // Follow the console while it grows.
  useEffect(() => {
    const el = consoleRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [consoleText.length]);

  const start = async () => {
    setBusy(true);
    setError('');
    const result = await startTestRun(run.id, { headed });
    setBusy(false);
    if (!result.ok) setError(result.data.error ?? 'Could not start the test');
    onChange();
  };
  const cancel = async () => {
    const result = await cancelTestRun(latest.id);
    if (!result.ok) setError(result.data.error ?? 'Could not cancel');
    onChange();
  };

  const status = latest ? TEST_RUN_STATUS[latest.status] : null;
  const tests = latest?.results?.tests ?? [];

  return (
    <section className={`card ${styles.panel}`} aria-labelledby="test-run-title">
      <h3 id="test-run-title" className={styles.title}>
        <MonitorPlay size={16} /> Run test
      </h3>
      <p className={styles.hint}>
        Runs the saved test and its page objects again, without the AI. Headless by default; <strong>Show browser</strong> opens a browser window
        on the computer the worker runs on, so you can watch it.
      </p>

      {canOperate && (
        <div className={styles.toolbar}>
          <button className="btn btn-primary" onClick={start} disabled={busy || active} id="btn-run-test">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} Run test
          </button>
          <label className={styles.check}>
            <input type="checkbox" checked={headed} onChange={(e) => setHeaded(e.target.checked)} id="chk-show-browser" /> Show browser
          </label>
          {active && (
            <button className="btn btn-secondary btn-sm" onClick={cancel} disabled={latest.cancelRequested} id="btn-cancel-test-run">
              <Square size={13} /> {latest.cancelRequested ? 'Cancelling…' : 'Cancel'}
            </button>
          )}
        </div>
      )}

      {worker && !worker.online && (
        <p className={`${styles.notice} ${styles.noticeWarn}`} role="status">
          <AlertCircle size={14} />
          <span>
            Test runs need a worker running on a computer: start <code>npm run agent:worker</code> (or <code>agent:worker:prod</code>). GitHub
            Actions runners don&apos;t take them. Queued runs start as soon as a worker is up.
          </span>
        </p>
      )}
      {error && (
        <p className={`${styles.notice} ${styles.noticeWarn}`} role="alert">
          <AlertCircle size={14} /> {error}
        </p>
      )}

      {latest && (
        <div className={styles.latest}>
          <div className={styles.summary}>
            <span className={`badge badge-${status.color}`}>{status.label}</span>
            <span className={styles.meta}>
              {latest.headed ? <><Monitor size={12} /> Browser shown</> : 'Headless'}
              {latest.hostname ? ` on ${latest.hostname}` : ''}
            </span>
            {latest.results?.duration > 0 && <span className={styles.meta}>{seconds(latest.results.duration)}</span>}
            <span className={styles.meta}>
              {latest.requestedBy ? `${latest.requestedBy.name} · ` : ''}
              {getRelativeTime(latest.createdAt)}
            </span>
          </div>
          {latest.status === 'QUEUED' && worker?.online && <p className={styles.hint}>Waiting for the worker to pick it up…</p>}
          {latest.error && <p className={`${styles.notice} ${styles.noticeBad}`}>{latest.error}</p>}

          {tests.length > 0 && (
            <ul className={styles.tests}>
              {tests.map((t, i) => (
                <li key={i} className={styles.test}>
                  {TEST_ICON[t.status] ?? TEST_ICON.running}
                  <div className={styles.testMain}>
                    <span className={styles.testTitle}>{t.title}</span>
                    <span className={styles.meta}>
                      {t.steps.length} action(s) and check(s){t.duration ? ` · ${seconds(t.duration)}` : ''}
                    </span>
                    {t.error && <pre className={styles.testError}>{t.error}</pre>}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {consoleText && (
            <details className={styles.consoleBox} open={active || latest.status !== 'PASSED'}>
              <summary>Console</summary>
              <pre ref={consoleRef} className={styles.console}>{consoleText}</pre>
            </details>
          )}
        </div>
      )}

      {run.testRuns.length > 1 && (
        <details className={styles.history}>
          <summary>Earlier test runs ({run.testRuns.length - 1})</summary>
          <ul>
            {run.testRuns.slice(1).map((t) => (
              <li key={t.id}>
                <span className={`badge badge-${TEST_RUN_STATUS[t.status].color}`}>{TEST_RUN_STATUS[t.status].label}</span>
                <span className={styles.meta}>{t.headed ? 'Browser shown' : 'Headless'}</span>
                <span className={styles.meta}>
                  {t.requestedBy ? `${t.requestedBy.name} · ` : ''}
                  {formatDateTime(t.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
