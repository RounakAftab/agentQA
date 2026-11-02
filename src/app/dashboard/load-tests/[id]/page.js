'use client';

import { Suspense, use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Header from '@/components/Header';
import { useCurrentUser } from '@/lib/teamStore';
import { getRelativeTime } from '@/lib/format';
import {
  useLoadTest,
  useLoadRuns,
  useLoadRun,
  startLoadRun,
  cancelLoadRun,
  isLoadRunActive,
  LOAD_RUN_STATUS,
  formatMs,
  formatSeconds,
} from '@/lib/loadTestClient';
import { ArrowLeft, Play, Square, Pencil, Loader2, AlertCircle, Monitor, LineChart, Terminal, History, CheckCircle2, XCircle } from 'lucide-react';
import LoadTestForm from '../LoadTestForm';
import LoadCharts from './LoadCharts';
import styles from './page.module.css';

const OPERATOR_ROLES = ['Admin', 'QA Lead', 'QA Engineer'];

const loadShape = (c) => `${c.vus} virtual ${c.vus === 1 ? 'user' : 'users'} · ${c.rampUpSec ? `${formatSeconds(c.rampUpSec)} ramp-up + ` : ''}${formatSeconds(c.durationSec)} at full load`;

function limitsText(c) {
  const parts = [];
  if (c.maxP95Ms != null) parts.push(`p95 under ${formatMs(c.maxP95Ms)}`);
  if (c.maxErrorRatePct != null) parts.push(`at most ${c.maxErrorRatePct}% failed`);
  return parts.length ? `Passes with ${parts.join(' and ')}` : 'No pass/fail limits';
}

function Stat({ label, value, sub }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
      {sub && <span className={styles.statSub}>{sub}</span>}
    </div>
  );
}

// Final numbers from k6's summary, or the latest live sample while the run goes.
function Stats({ run }) {
  const s = run.summary;
  if (s) {
    return (
      <div className={styles.stats}>
        <Stat label="Requests" value={s.requests.toLocaleString()} sub={`${s.rps}/s over ${formatSeconds(Math.round(s.durationMs / 1000))}`} />
        <Stat label="Average" value={formatMs(s.avgMs)} sub={`median ${formatMs(s.medMs)}`} />
        <Stat label="p95" value={formatMs(s.p95Ms)} sub={`p90 ${formatMs(s.p90Ms)}`} />
        <Stat label="p99" value={formatMs(s.p99Ms)} sub={`max ${formatMs(s.maxMs)}`} />
        <Stat label="Failed" value={`${s.errorPct}%`} sub={`${s.failedRequests.toLocaleString()} requests`} />
      </div>
    );
  }
  const last = run.samples?.at(-1);
  if (!last) return null;
  const total = run.config.rampUpSec + run.config.durationSec;
  return (
    <div className={styles.stats}>
      <Stat label="Elapsed" value={formatSeconds(Math.min(last.t, total))} sub={`of ${formatSeconds(total)}`} />
      <Stat label="Users" value={last.vus} sub={`of ${run.config.vus}`} />
      <Stat label="Requests/s" value={last.rps} />
      <Stat label="Average" value={formatMs(last.avgMs)} sub="last few seconds" />
      <Stat label="Failed" value={last.errorPct == null ? '–' : `${last.errorPct}%`} sub="last few seconds" />
    </div>
  );
}

const THRESHOLD_LABEL = { http_req_duration: 'p95 response time', http_req_failed: 'Failed requests' };

function Thresholds({ run }) {
  const results = run.summary?.thresholds ?? [];
  if (results.length === 0) return null;
  return (
    <ul className={styles.thresholds}>
      {results.map((t) => (
        <li key={`${t.metric}-${t.rule}`} className={t.ok ? styles.ok : styles.bad}>
          {t.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
          <span>{THRESHOLD_LABEL[t.metric] ?? t.metric}</span>
          <code>{t.rule}</code>
          <strong>{t.ok ? 'within limit' : 'crossed'}</strong>
        </li>
      ))}
    </ul>
  );
}

function ConsoleTab({ run }) {
  const ref = useRef(null);
  const stick = useRef(true);
  useEffect(() => {
    if (ref.current && stick.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [run.console]);
  return (
    <pre
      ref={ref}
      className={styles.console}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
    >
      {run.console || (isLoadRunActive(run) ? 'Waiting for output…' : 'No output.')}
    </pre>
  );
}

function RunPanel({ test, canEdit }) {
  const { runs, worker, refresh } = useLoadRuns(test.id);
  const [selectedId, setSelectedId] = useState(null);
  const [tab, setTab] = useState('charts');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const runId = selectedId ?? runs[0]?.id ?? null;
  const run = useLoadRun(runId);
  const active = isLoadRunActive(run);

  // When a run ends, refresh the list so History shows its result.
  const lastStatus = useRef(null);
  useEffect(() => {
    if (lastStatus.current && run && lastStatus.current !== run.status && !isLoadRunActive(run)) refresh();
    lastStatus.current = run?.status ?? null;
  }, [run, refresh]);

  const start = async () => {
    setBusy(true);
    setError('');
    const result = await startLoadRun(test.id);
    setBusy(false);
    if (!result.ok && result.status !== 409) return setError(result.data.error ?? 'Could not start the run');
    setSelectedId(result.data.run.id);
    setTab('charts');
    refresh();
  };

  const status = run ? LOAD_RUN_STATUS[run.status] : null;

  return (
    <section className={styles.panel}>
      <div className={styles.toolbar}>
        {canEdit && (
          <button className="btn btn-primary" onClick={start} disabled={busy || active} id="load-run">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} Run load test
          </button>
        )}
        <span className={styles.spacer} />
        {run && (
          <span className={styles.summary}>
            <span className={`badge badge-${status.color}`}>{status.label}</span>
            <span>{getRelativeTime(run.createdAt)}</span>
          </span>
        )}
        {active && canEdit && (
          <button className="btn btn-secondary btn-sm" onClick={() => cancelLoadRun(run.id)} disabled={run.cancelRequested}>
            <Square size={13} /> Stop
          </button>
        )}
      </div>

      {worker && !worker.online && (
        <p className={`${styles.notice} ${styles.noticeWarn}`}>
          <AlertCircle size={13} /> No worker is running. Start <code>npm run agent:worker</code> on a computer with k6 installed; queued runs
          start as soon as it is up.
        </p>
      )}
      {active && run.hostname && (
        <p className={styles.hint}>
          <Monitor size={12} /> k6 is running on {run.hostname}. The load comes from that computer’s network.
        </p>
      )}
      {error && <p className={`${styles.notice} ${styles.noticeWarn}`}>{error}</p>}
      {run?.error && !active && (
        <p className={`${styles.notice} ${run.status === 'CANCELLED' ? styles.noticeWarn : styles.noticeBad}`}>
          <AlertCircle size={13} /> {run.error}
        </p>
      )}

      {run && <Stats run={run} />}
      {run && <Thresholds run={run} />}

      {runs.length > 0 ? (
        <>
          <div className="tabs">
            <button className={`tab ${tab === 'charts' ? 'active' : ''}`} onClick={() => setTab('charts')}>
              <LineChart size={13} /> Charts
            </button>
            <button className={`tab ${tab === 'console' ? 'active' : ''}`} onClick={() => setTab('console')}>
              <Terminal size={13} /> Console
            </button>
            <button className={`tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
              <History size={13} /> History ({runs.length})
            </button>
          </div>
          <div className={styles.tabBody}>
            {tab === 'history' ? (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Result</th>
                    <th>Load</th>
                    <th>Requests</th>
                    <th>p95</th>
                    <th>Failed</th>
                    <th>Started</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr
                      key={r.id}
                      className={`${styles.historyRow} ${r.id === runId ? styles.historyActive : ''}`}
                      onClick={() => {
                        setSelectedId(r.id);
                        setTab('charts');
                      }}
                    >
                      <td>
                        <span className={`badge badge-${LOAD_RUN_STATUS[r.status].color}`}>{LOAD_RUN_STATUS[r.status].label}</span>
                      </td>
                      <td>{r.config.vus} users · {formatSeconds(r.config.rampUpSec + r.config.durationSec)}</td>
                      <td>{r.summary ? `${r.summary.requests.toLocaleString()} (${r.summary.rps}/s)` : '–'}</td>
                      <td>{r.summary ? formatMs(r.summary.p95Ms) : '–'}</td>
                      <td>{r.summary ? `${r.summary.errorPct}%` : '–'}</td>
                      <td>{getRelativeTime(r.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : !run ? (
              <div className={styles.empty}>
                <Loader2 size={18} className="animate-spin" />
              </div>
            ) : tab === 'console' ? (
              <ConsoleTab run={run} />
            ) : run.samples.length > 0 ? (
              <LoadCharts samples={run.samples} config={run.config} />
            ) : (
              <div className={styles.empty}>
                {active ? <Loader2 size={18} className="animate-spin" /> : <AlertCircle size={18} />}
                <span>{active ? 'The charts fill in a few seconds after k6 starts.' : 'No numbers were recorded for this run. See the console.'}</span>
              </div>
            )}
          </div>
        </>
      ) : (
        <p className={styles.hint}>Run the test to see response times, throughput and errors as the load builds up.</p>
      )}
    </section>
  );
}

function LoadTestDetail({ params }) {
  const { id } = use(params);
  const me = useCurrentUser();
  const canEdit = OPERATOR_ROLES.includes(me.role);
  const { test: loadedTest, limits, loaded, error } = useLoadTest(id);
  const [saved, setSaved] = useState(null);
  const [editing, setEditing] = useState(false);
  const test = saved?.id === id ? saved : loadedTest;

  if (!loaded || !test) {
    return (
      <>
        <Header title="Load test" />
        <div className={styles.content}>
          <div className={styles.empty}>
            {loaded ? <AlertCircle size={22} /> : <Loader2 size={22} className="animate-spin" />}
            {loaded && <p>{error || 'Load test not found'}</p>}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Header title={test.name} subtitle={`Load test · ${test.project?.name ?? ''}`} />
      <div className={styles.content}>
        <Link href="/dashboard/load-tests" className={styles.back}>
          <ArrowLeft size={14} /> Load tests
        </Link>

        <div className={`card ${styles.testCard}`}>
          {editing ? (
            <LoadTestForm
              key={test.updatedAt}
              test={test}
              limits={limits}
              onSaved={(next) => {
                setSaved(next);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <div className={styles.testHead}>
              <div className={styles.testInfo}>
                <div className={styles.request}>
                  <span className={styles.method}>{test.method}</span>
                  <code>{test.url}</code>
                </div>
                <p className={styles.meta}>{loadShape(test)}</p>
                <p className={styles.meta}>
                  {limitsText(test)}
                  {test.headerNames.length > 0 && ` · Headers: ${test.headerNames.join(', ')}`}
                  {test.body && ' · With a body'}
                </p>
              </div>
              {canEdit && (
                <button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>
                  <Pencil size={13} /> Edit
                </button>
              )}
            </div>
          )}
        </div>

        <RunPanel test={test} canEdit={canEdit} />
      </div>
    </>
  );
}

export default function LoadTestPage({ params }) {
  return (
    <Suspense fallback={<div className={styles.content}>Loading load test…</div>}>
      <LoadTestDetail params={params} />
    </Suspense>
  );
}
