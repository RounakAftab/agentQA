'use client';

import { useEffect, useRef, useState } from 'react';
import { getRelativeTime } from '@/lib/format';
import {
  useScriptRuns,
  useScriptRun,
  startScriptRun,
  cancelScriptRun,
  applyHealedFix,
  updateCodegenScript,
  isRunActive,
} from '@/lib/codegenClient';
import {
  Play,
  Square,
  Loader2,
  CheckCircle2,
  XCircle,
  CircleDashed,
  MinusCircle,
  KeyRound,
  Wand2,
  Terminal,
  ListChecks,
  History,
  AlertCircle,
  Monitor,
  Check,
} from 'lucide-react';
import styles from './RunPanel.module.css';

const RUN_STATUS = {
  QUEUED: { label: 'Waiting for the worker', color: 'neutral' },
  RUNNING: { label: 'Running', color: 'info' },
  PASSED: { label: 'Passed', color: 'success' },
  FAILED: { label: 'Failed', color: 'danger' },
  ERROR: { label: 'Error', color: 'danger' },
  CANCELLED: { label: 'Cancelled', color: 'warning' },
};
const seconds = (ms) => (ms == null ? '' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

function StatusIcon({ status, size = 15 }) {
  if (status === 'passed') return <CheckCircle2 size={size} className={styles.ok} />;
  if (status === 'running') return <Loader2 size={size} className={`animate-spin ${styles.running}`} />;
  if (status === 'skipped') return <MinusCircle size={size} className={styles.muted} />;
  if (status === 'pending') return <CircleDashed size={size} className={styles.muted} />;
  return <XCircle size={size} className={styles.bad} />;
}

function TestLoginForm({ script, onSaved, onClose }) {
  const [username, setUsername] = useState(script.testLogin.username);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const save = async (testLogin) => {
    const result = await updateCodegenScript(script.id, { testLogin });
    if (!result.ok) return setError(result.data.fieldErrors?.testLogin ?? result.data.error ?? 'Could not save');
    onSaved(result.data.script);
    onClose();
  };
  return (
    <form
      className={styles.loginForm}
      onSubmit={(e) => {
        e.preventDefault();
        save({ username, password });
      }}
    >
      <p className={styles.hint}>
        Used as E2E_USERNAME and E2E_PASSWORD when the test runs. The password is stored encrypted and never shown again.
      </p>
      <div className={styles.loginFields}>
        <input className="input" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} aria-label="Test username" />
        <input
          className="input"
          type="password"
          placeholder={script.testLogin.hasPassword ? 'Password (saved; type to replace)' : 'Password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-label="Test password"
          autoComplete="new-password"
        />
        <button className="btn btn-primary btn-sm">Save</button>
        {(script.testLogin.username || script.testLogin.hasPassword) && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => save({ clear: true })}>Remove</button>
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
      </div>
      {error && <p className="text-danger text-xs">{error}</p>}
    </form>
  );
}

function TestsTab({ run, onOpenLine }) {
  const tests = run.results?.tests ?? [];
  if (tests.length === 0) {
    return (
      <div className={styles.empty}>
        {isRunActive(run) ? <Loader2 size={18} className="animate-spin" /> : <AlertCircle size={18} />}
        <span>{isRunActive(run) ? 'Waiting for the first test to start…' : run.error ?? 'No test results. See the console.'}</span>
      </div>
    );
  }
  return (
    <div className={styles.tests}>
      {tests.map((test, ti) => (
        <div key={`${test.title}-${ti}`} className={styles.test}>
          <div className={styles.testHead}>
            <StatusIcon status={test.status} />
            <strong>{test.title}</strong>
            <span className={styles.file}>{test.file}</span>
            <span className={styles.duration}>{seconds(test.duration)}</span>
          </div>
          <ol className={styles.steps}>
            {test.steps.map((step, si) => (
              <li key={si} className={`${styles.step} ${step.error ? styles.stepFailed : ''}`}>
                <StatusIcon status={step.error ? 'failed' : 'passed'} size={13} />
                <span className={styles.stepTitle} title={step.title}>
                  <span className={styles.stepKind}>{step.title}</span>
                  {step.code && <code>{step.code}</code>}
                </span>
                {step.file && (
                  <button type="button" className={styles.location} onClick={() => onOpenLine(run.style, `${step.folder}/${step.file}`)}>
                    {step.folder}/{step.file}:{step.line}
                  </button>
                )}
                <span className={styles.duration}>{seconds(step.duration)}</span>
                {step.error && <pre className={styles.error}>{step.error}</pre>}
              </li>
            ))}
          </ol>
          {test.error && !test.steps.some((s) => s.error) && <pre className={styles.error}>{test.error}</pre>}
          {test.screenshot && (
            <details className={styles.shot}>
              <summary>Screenshot at the failure</summary>
              {/* eslint-disable-next-line @next/next/no-img-element -- a data URL from the run, not a static asset */}
              <img src={test.screenshot} alt={`Page when "${test.title}" failed`} />
            </details>
          )}
        </div>
      ))}
    </div>
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
      {run.console || (isRunActive(run) ? 'Waiting for output…' : 'No output.')}
    </pre>
  );
}

function HealCard({ run, canEdit, onApplied }) {
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  if (run.kind !== 'heal' || isRunActive(run)) return null;
  const apply = async () => {
    setApplying(true);
    const result = await applyHealedFix(run.id);
    setApplying(false);
    if (result.ok) onApplied(result.data.script);
    else setError(result.data.error ?? 'Could not apply the fix');
  };
  return (
    <div className={`${styles.healCard} ${run.status === 'PASSED' ? styles.healOk : ''}`}>
      <div className={styles.healHead}>
        <Wand2 size={15} />
        <strong>
          {run.status === 'PASSED'
            ? 'The healer fixed the test and it passes.'
            : run.healedSource
              ? 'The healer changed the test, but it still fails.'
              : 'The healer could not fix the test.'}
        </strong>
        {run.costUsd != null && <span className={styles.muted}>${run.costUsd.toFixed(3)}</span>}
      </div>
      {/* The model writes Markdown; bold markers read as noise in plain text. */}
      {run.healSummary && <p className={styles.healSummary}>{run.healSummary.replace(/\*\*/g, '')}</p>}
      {run.healedSource && (
        <>
          <details>
            <summary>Healed code</summary>
            <pre className={styles.console}>{run.healedSource}</pre>
          </details>
          {canEdit &&
            (run.appliedAt ? (
              <p className={styles.applied}><Check size={13} /> Applied {getRelativeTime(run.appliedAt)}. Run the test again to check the page objects.</p>
            ) : (
              <div>
                <button className={`btn btn-sm ${run.status === 'PASSED' ? 'btn-primary' : 'btn-secondary'}`} onClick={apply} disabled={applying}>
                  {applying ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {run.status === 'PASSED' ? 'Apply fix' : 'Apply anyway'}
                </button>
                <span className={styles.hint}> Replaces the recording; page names you set are kept.</span>
              </div>
            ))}
          {error && <p className="text-danger text-xs">{error}</p>}
        </>
      )}
    </div>
  );
}

// Runs the generated code on the worker and shows the result: Tests, Console and History tabs.
export default function RunPanel({ script, style, canEdit, onScriptChange, onReplaced, onOpenLine }) {
  const { runs, worker, refresh } = useScriptRuns(script.id);
  const [selectedId, setSelectedId] = useState(null);
  const [tab, setTab] = useState('tests');
  const [headed, setHeaded] = useState(false);
  const [editingLogin, setEditingLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const runId = selectedId ?? runs[0]?.id ?? null;
  const run = useScriptRun(runId);
  const active = isRunActive(run);
  const needsLogin = (script.recording.secrets ?? []).length > 0 && !script.testLogin.hasPassword;

  // When a run ends, refresh the list so its summary and the heal button update.
  const lastStatus = useRef(null);
  useEffect(() => {
    if (lastStatus.current && run && lastStatus.current !== run.status && !isRunActive(run)) refresh();
    lastStatus.current = run?.status ?? null;
  }, [run, refresh]);

  const start = async (options) => {
    setBusy(true);
    setError('');
    const result = await startScriptRun(script.id, options);
    setBusy(false);
    if (!result.ok && result.status !== 409) return setError(result.data.error ?? 'Could not start the run');
    setSelectedId(result.data.run.id);
    setTab(options.kind === 'heal' ? 'console' : 'tests');
    refresh();
  };

  const status = run ? RUN_STATUS[run.status] : null;
  const canHeal = canEdit && run && ['FAILED', 'ERROR'].includes(run.status) && !run.appliedAt;

  return (
    <section className={styles.panel} id="codegen-run">
      <div className={styles.toolbar}>
        {canEdit && (
          <button className="btn btn-primary" onClick={() => start({ kind: 'run', style, headed })} disabled={busy || active} id="codegen-run-test">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} Run test ({style === 'pom' ? 'Page Object Model' : 'plain spec'})
          </button>
        )}
        {canEdit && (
          <label className={styles.check}>
            <input type="checkbox" checked={headed} onChange={(e) => setHeaded(e.target.checked)} /> Show browser
          </label>
        )}
        {canEdit && (
          <button className={`btn btn-ghost btn-sm ${needsLogin ? styles.loginMissing : ''}`} onClick={() => setEditingLogin((v) => !v)}>
            <KeyRound size={13} /> {script.testLogin.hasPassword ? `Test login: ${script.testLogin.username || 'saved'}` : 'Set test login'}
          </button>
        )}
        <span className={styles.spacer} />
        {run && (
          <span className={styles.summary}>
            <span className={`badge badge-${status.color}`}>{run.kind === 'heal' ? `Heal: ${status.label}` : status.label}</span>
            {(run.passed > 0 || run.failed > 0) && (
              <span>
                {run.passed} passed{run.failed ? ` · ${run.failed} failed` : ''}
                {run.duration != null ? ` · ${seconds(run.duration)}` : ''}
              </span>
            )}
          </span>
        )}
        {active && canEdit && (
          <button className="btn btn-secondary btn-sm" onClick={() => cancelScriptRun(run.id)}>
            <Square size={13} /> Cancel
          </button>
        )}
      </div>

      {editingLogin && <TestLoginForm script={script} onSaved={onScriptChange} onClose={() => setEditingLogin(false)} />}
      {needsLogin && !editingLogin && (
        <p className={`${styles.notice} ${styles.noticeWarn}`}>
          <KeyRound size={13} /> This flow logs in. Set the test login before running, or the login steps will type nothing.
        </p>
      )}
      {worker && !worker.online && (
        <p className={`${styles.notice} ${styles.noticeWarn}`}>
          <AlertCircle size={13} /> No worker is running. Start <code>npm run agent:worker</code>; queued runs start as soon as it is up.
        </p>
      )}
      {worker?.online && active && run.hostname && (
        <p className={styles.hint}>
          <Monitor size={12} /> Running on {run.hostname}{run.headed ? ', with the browser visible there' : ''}.
        </p>
      )}
      {error && <p className={`${styles.notice} ${styles.noticeWarn}`}>{error}</p>}

      {canHeal && (
        <div className={styles.healOffer}>
          <AlertCircle size={15} className={styles.bad} />
          <span>
            {run.kind === 'heal' ? 'The healed test still fails.' : 'The test failed.'} The healer can inspect the live site, fix the recorded steps
            (locators, waits) and run them again. It uses the QA Agent model.
          </span>
          <button className="btn btn-primary btn-sm" onClick={() => start({ kind: 'heal', fromRunId: run.id, headed })} disabled={busy || active}>
            <Wand2 size={13} /> Heal test
          </button>
        </div>
      )}

      {run && <HealCard run={run} canEdit={canEdit} onApplied={onReplaced} />}

      {runs.length > 0 && (
        <>
          <div className="tabs">
            <button className={`tab ${tab === 'tests' ? 'active' : ''}`} onClick={() => setTab('tests')}>
              <ListChecks size={13} /> Tests
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
              <ul className={styles.history}>
                {runs.map((r) => (
                  <li key={r.id}>
                    <button
                      className={`${styles.historyRow} ${r.id === runId ? styles.historyActive : ''}`}
                      onClick={() => {
                        setSelectedId(r.id);
                        setTab('tests');
                      }}
                    >
                      <span className={`badge badge-${RUN_STATUS[r.status].color}`}>{RUN_STATUS[r.status].label}</span>
                      <span>{r.kind === 'heal' ? 'Heal' : `Run · ${r.style === 'pom' ? 'POM' : 'plain'}`}</span>
                      <span className={styles.muted}>
                        {r.passed + r.failed > 0 ? `${r.passed} passed${r.failed ? `, ${r.failed} failed` : ''}` : ''}
                      </span>
                      <span className={styles.spacer} />
                      <span className={styles.muted}>{getRelativeTime(r.createdAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : !run ? (
              <div className={styles.empty}>
                <Loader2 size={18} className="animate-spin" />
              </div>
            ) : tab === 'tests' ? (
              <TestsTab run={run} onOpenLine={onOpenLine} />
            ) : (
              <ConsoleTab run={run} />
            )}
          </div>
        </>
      )}
      {runs.length === 0 && (
        <p className={styles.hint}>Run the test to check that the generated code works on the live site before you download it.</p>
      )}
    </section>
  );
}
