'use client';

import { use, Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Header from '@/components/Header';
import { useCurrentUser } from '@/lib/teamStore';
import { formatDateTime, formatDuration, formatTime, getRelativeTime } from '@/lib/format';
import { AGENT_STEPS, stepLabel } from '@/lib/agentSteps';
import { useAgentRun, cancelAgentRun, startRunner, RUN_STATUS, isRunActive } from '@/lib/qaAgentClient';
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Circle,
  Loader2,
  ExternalLink,
  GitPullRequest,
  Square,
  AlertCircle,
  ListChecks,
  FileCode2,
  ScrollText,
  Download,
  MinusCircle,
  Play,
} from 'lucide-react';
import styles from './page.module.css';

const OPERATOR_ROLES = ['Admin', 'QA Lead', 'QA Engineer'];

// Short names for the activity log, e.g. "jira.read" -> "Read requirement" for a manual run.
const LOG_NAMES = { runner: 'Runner', workspace: 'Test project', agent: 'Agent', verify: 'Verify', publish: 'Publish', done: 'Finished' };
// A GitHub Actions runner usually picks a run up within a minute or two.
const RUNNER_SLOW_MS = 4 * 60_000;
function logStepLabel(id, source) {
  if (LOG_NAMES[id]) return LOG_NAMES[id];
  const step = AGENT_STEPS.find((s) => s.id === id);
  return step ? stepLabel(step, source).replace(/ and .*$/, '') : id;
}

// Jira-only steps are left out for requirements written in AgentQA.
const stepsFor = (run) => AGENT_STEPS.filter((s) => !(s.jiraOnly && run.source === 'manual'));

function stepStates(run, steps) {
  const current = AGENT_STEPS.findIndex((s) => s.id === run.step);
  return steps.map((s) => {
    const i = AGENT_STEPS.indexOf(s);
    if (run.skippedSteps.includes(s.id)) return 'skipped';
    if (run.status === 'PASSED') return 'done';
    if (run.status === 'QUEUED' || current === -1) return 'pending';
    if (i < current) return 'done';
    if (i > current) return 'pending';
    if (run.status === 'RUNNING') return 'active';
    return run.status === 'FAILED' ? 'failed' : 'stopped';
  });
}

const STEP_ICON = {
  done: <CheckCircle2 size={18} className={styles.iconDone} />,
  active: <Loader2 size={18} className={`animate-spin ${styles.iconActive}`} />,
  failed: <XCircle size={18} className={styles.iconFailed} />,
  stopped: <Square size={16} className={styles.iconPending} />,
  skipped: <MinusCircle size={18} className={styles.iconPending} />,
  pending: <Circle size={18} className={styles.iconPending} />,
};

function RunDetail({ params }) {
  const { id } = use(params);
  const { run, worker, loaded, error, refresh } = useAgentRun(id);
  const me = useCurrentUser();
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState('');
  const [starting, setStarting] = useState(false);
  // Ticks so a queued run can tell when its runner is taking unusually long.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const logEndRef = useRef(null);
  const eventCount = run?.events.length ?? 0;

  useEffect(() => {
    if (eventCount && logEndRef.current) logEndRef.current.scrollIntoView({ block: 'nearest' });
  }, [eventCount]);

  if (!loaded) {
    return (
      <>
        <Header title="QA Agent run" />
        <div className={styles.content}>Loading run…</div>
      </>
    );
  }
  if (!run) {
    return (
      <>
        <Header title="Run not found" />
        <div className={styles.content}>
          <p>{error || 'This run does not exist.'}</p>
          <Link href="/dashboard/qa-agent" className="btn btn-primary">Back to QA Agent</Link>
        </div>
      </>
    );
  }

  const status = RUN_STATUS[run.status];
  const steps = stepsFor(run);
  const states = stepStates(run, steps);
  const isJira = run.source !== 'manual';
  const runnerEvents = run.events.filter((e) => e.step === 'runner');
  const runnerFailed = runnerEvents.at(-1)?.level === 'error';
  const lastRunnerStart = runnerEvents.findLast((e) => e.level !== 'error')?.at ?? run.queuedAt;
  const runnerSlow = runnerFailed || now - new Date(lastRunnerStart) > RUNNER_SLOW_MS;

  const downloadSpec = () => {
    const url = URL.createObjectURL(new Blob([run.specContent], { type: 'text/plain' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: run.specPath.split('/').pop() });
    a.click();
    URL.revokeObjectURL(url);
  };
  const active = isRunActive(run);
  const canCancel = active && !run.cancelRequested && OPERATOR_ROLES.includes(me?.role);
  const duration =
    run.startedAt && Math.round(((run.finishedAt ? new Date(run.finishedAt) : new Date()) - new Date(run.startedAt)) / 1000);

  const restartRunner = async () => {
    setStarting(true);
    setCancelError('');
    const result = await startRunner(run.id);
    setStarting(false);
    if (!result.ok) setCancelError(result.data.error ?? 'Could not start a runner');
    refresh();
  };

  const cancel = async () => {
    setCancelling(true);
    setCancelError('');
    const result = await cancelAgentRun(run.id);
    setCancelling(false);
    if (!result.ok) setCancelError(result.data.error ?? 'Could not cancel the run');
    refresh();
  };

  return (
    <>
      <Header title={`${run.issueKey} · QA Agent`} subtitle={run.issueSummary || undefined} />
      <div className={styles.content}>
        <Link href="/dashboard/qa-agent" className={styles.backLink}>
          <ArrowLeft size={16} /> Back to QA Agent
        </Link>

        <div className={styles.topBar}>
          <div className={styles.topMeta}>
            <span className={`badge badge-${status.color}`}>{run.cancelRequested && active ? 'Cancelling…' : status.label}</span>
            {run.projectName && <span className={styles.meta}>{run.projectName}</span>}
            {run.startedBy && <span className={styles.meta}>Started by {run.startedBy.name}</span>}
            <span className={styles.meta}>Queued {formatDateTime(run.queuedAt)}</span>
            {duration != null && <span className={styles.meta}>{formatDuration(duration)}</span>}
            {run.testAttempts > 0 && <span className={styles.meta}>{run.testAttempts} test run(s)</span>}
            {run.costUsd != null && <span className={styles.meta}>${run.costUsd.toFixed(2)}</span>}
          </div>
          <div className={styles.topActions}>
            {run.issueUrl && (
              <a href={run.issueUrl} target="_blank" rel="noopener" className="btn btn-secondary btn-sm">
                Jira <ExternalLink size={13} />
              </a>
            )}
            {run.prUrl && (
              <a href={run.prUrl} target="_blank" rel="noopener" className="btn btn-secondary btn-sm">
                <GitPullRequest size={14} /> Pull request
              </a>
            )}
            {canCancel && (
              <button className="btn btn-danger btn-sm" onClick={cancel} disabled={cancelling} id="btn-cancel-run">
                {cancelling ? <Loader2 size={14} className="animate-spin" /> : <Square size={13} />} Cancel
              </button>
            )}
          </div>
        </div>

        {cancelError && (
          <div className={`${styles.alert} ${styles.alertDanger}`} role="alert">
            <AlertCircle size={16} /> {cancelError}
          </div>
        )}
        {run.error && (
          <div className={`${styles.alert} ${run.status === 'CANCELLED' ? styles.alertWarning : styles.alertDanger}`} role="alert">
            <AlertCircle size={16} /> <span>{run.error}</span>
          </div>
        )}
        {run.status === 'PASSED' && (
          <div className={`${styles.alert} ${styles.alertSuccess}`} role="status">
            <CheckCircle2 size={16} />
            {isJira
              ? `Test verified, note appended and ${run.issueKey} moved to Done.`
              : `Test verified and saved${run.prUrl ? ' with a pull request' : ''}. Download it below${run.prUrl ? ' or review the pull request' : ''}.`}
          </div>
        )}
        {run.status === 'QUEUED' && worker?.online && (
          <div className={`${styles.alert} ${styles.alertInfo}`} role="status">
            <Loader2 size={16} className="animate-spin" /> Waiting for a worker to pick this run up.
          </div>
        )}
        {run.status === 'QUEUED' && worker && !worker.online && worker.onDemand && (
          <div className={`${styles.alert} ${runnerSlow ? styles.alertWarning : styles.alertInfo}`} role="status">
            {runnerSlow ? <AlertCircle size={16} /> : <Loader2 size={16} className="animate-spin" />}
            <span>
              {runnerFailed
                ? 'The GitHub Actions runner could not be started (see Activity below).'
                : runnerSlow
                  ? 'No runner has picked this run up yet. Check the "QA Agent runner" workflow in the repository’s Actions tab, or start another runner.'
                  : 'Starting a runner on GitHub Actions. This usually takes a minute or two.'}
            </span>
            {(runnerSlow || runnerFailed) && OPERATOR_ROLES.includes(me?.role) && (
              <button className="btn btn-secondary btn-sm" onClick={restartRunner} disabled={starting} id="btn-start-runner">
                {starting ? <Loader2 size={14} className="animate-spin" /> : <Play size={13} />} Start runner again
              </button>
            )}
          </div>
        )}
        {run.status === 'QUEUED' && worker && !worker.online && !worker.onDemand && (
          <div className={`${styles.alert} ${styles.alertWarning}`} role="status">
            <AlertCircle size={16} />
            <span>
              No QA Agent worker is online, so this run is waiting in the queue
              {worker.lastSeenAt ? ` (a worker was last seen ${getRelativeTime(worker.lastSeenAt)})` : ' (no worker has connected yet)'}. It
              starts automatically once a worker connected to this database is running (<code>npm run agent:worker</code>). You can also cancel it.
            </span>
          </div>
        )}

        <div className={styles.grid}>
          <section className={`card ${styles.panel}`}>
            <h3 className={`${styles.panelTitle} ${styles.titleWithHint}`}>Progress</h3>
            <p className={styles.hint}>What the AI is doing right now. Each step turns green when it is done.</p>
            <ol className={styles.steps}>
              {steps.map((s, i) => (
                <li key={s.id} className={`${styles.step} ${styles[`step_${states[i]}`]}`}>
                  {STEP_ICON[states[i]]}
                  <span>{stepLabel(s, run.source)}</span>
                  {states[i] === 'skipped' && <span className={styles.skippedTag}>Skipped</span>}
                </li>
              ))}
            </ol>
          </section>

          <section className={`card ${styles.panel}`}>
            <h3 className={`${styles.panelTitle} ${styles.titleWithHint}`}>
              <ListChecks size={16} /> Test cases
            </h3>
            <p className={styles.hint}>What the test checks: the steps it follows and the results it expects.</p>
            {run.testPlan ? (
              <div className={styles.plan}>
                <p className={styles.flow}>{run.testPlan.flow}</p>
                <h4 className={styles.subTitle}>Test steps</h4>
                <ol className={styles.planList}>
                  {run.testPlan.steps.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
                <h4 className={styles.subTitle}>Expected results</h4>
                <ul className={styles.planList}>
                  {run.testPlan.acceptanceCriteria.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              </div>
            ) : (
              <p className={styles.empty}>
                {active ? 'The AI writes the test cases after it has read the requirement.' : 'No test cases were written in this run.'}
              </p>
            )}
          </section>
        </div>

        <section className={`card ${styles.panel}`}>
          <h3 className={`${styles.panelTitle} ${styles.titleWithHint}`}>
            <FileCode2 size={16} /> Test code
            {run.verifiedPass && <span className="badge badge-success">Passed when run</span>}
            {run.specContent && (
              <button className={`btn btn-secondary btn-sm ${styles.titleAction}`} onClick={downloadSpec} id="btn-download-spec">
                <Download size={14} /> Download
              </button>
            )}
          </h3>
          <p className={styles.hint}>
            The automated Playwright test{run.specPath ? <> (<code>{run.specPath}</code>)</> : ''}.{' '}
            {run.prUrl ? 'It is also in the pull request linked at the top.' : 'Download it to add it to your test project.'}
          </p>
          {run.specContent ? (
            <pre className={styles.code}>{run.specContent}</pre>
          ) : (
            <p className={styles.empty}>
              {active ? 'The code appears here once the AI has written it.' : 'No test code was written in this run.'}
            </p>
          )}
        </section>

        <section className={`card ${styles.panel}`}>
          <h3 className={`${styles.panelTitle} ${styles.titleWithHint}`}>
            <ScrollText size={16} /> Activity
          </h3>
          <p className={styles.hint}>A detailed log of every action. Useful when a run fails.</p>
          {run.events.length === 0 ? (
            <p className={styles.empty}>Nothing logged yet.</p>
          ) : (
            <div className={styles.log}>
              {run.events.map((e) => (
                <div key={e.id} className={`${styles.logLine} ${styles[`log_${e.level}`] ?? ''}`}>
                  <span className={styles.logTime}>{formatTime(e.at)}</span>
                  <span className={styles.logStep} title={e.step}>{logStepLabel(e.step, run.source)}</span>
                  <span className={styles.logMessage}>{e.message}</span>
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          )}
        </section>
      </div>
    </>
  );
}

export default function QaAgentRunPage({ params }) {
  return (
    <Suspense fallback={<div className={styles.content}>Loading run…</div>}>
      <RunDetail params={params} />
    </Suspense>
  );
}
