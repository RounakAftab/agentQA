'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import Header from '@/components/Header';
import { getStatusColor, getStatusLabel } from '@/lib/format';
import { useProjects } from '@/lib/dataStores';
import {
  buildSource,
  buildSteps,
  buildScriptRevision,
  averageConfidence,
} from '@/lib/workflowScenarios';
import { useWorkflowStore, upsertRecord, patchRecord } from '@/lib/workflowStore';
import { useTeamUsers, useCurrentUser } from '@/lib/teamStore';
import {
  Play,
  CheckCircle2,
  XCircle,
  Circle,
  Loader2,
  FileSearch,
  TestTubes,
  Code2,
  UserCheck,
  GitPullRequest,
  Activity,
  ChevronDown,
  RotateCcw,
  Clock,
  Bot,
  Sparkles,
  Database,
  ShieldCheck,
  Check,
  AlertCircle,
  X,
  ExternalLink,
  FolderPlus,
} from 'lucide-react';
import styles from './page.module.css';

const STEP_ICONS = [FileSearch, TestTubes, Code2, UserCheck, GitPullRequest, Activity];
const STEP_COUNT = STEP_ICONS.length;
const GATE_STEP = 3;
const LOG_INTERVAL = 350;
const STEP_PAUSE = 700;

// Ids for records created while the page is used; kept out of the component body.
const makeId = (prefix, seq = 0) => `${prefix}-${Date.now().toString(36)}${seq ? `-${seq}` : ""}`;

const idleStates = () => Array(STEP_COUNT).fill('pending');
const idleResults = () => Array(STEP_COUNT).fill('');

export default function WorkflowPage() {
  const [projectId, setProjectId] = useState('');
  const [requirement, setRequirement] = useState('');
  const [reviewerId, setReviewerId] = useState('');
  const [phase, setPhase] = useState('idle'); // idle | running | awaiting_review | completed | rejected
  const [stepStates, setStepStates] = useState(idleStates);
  const [stepResults, setStepResults] = useState(idleResults);
  const [allLogs, setAllLogs] = useState([]);
  const [gate, setGate] = useState(null);
  const [gateTab, setGateTab] = useState('cases');
  const [comment, setComment] = useState('');
  const [showExistingRuns, setShowExistingRuns] = useState(false);

  const logEndRef = useRef(null);
  const gateRef = useRef(null);
  const timersRef = useRef([]);
  const runRef = useRef(null);
  const gateOpenRef = useRef(false);
  const auditSeqRef = useRef(0);

  const store = useWorkflowStore();
  const { projects, loaded: projectsLoaded } = useProjects();
  const teamUsers = useTeamUsers().filter((u) => u.status !== 'disabled');
  const currentUser = useCurrentUser();

  const project = projects.find((p) => p.id === projectId) ?? projects[0] ?? null;
  const defaultReviewer =
    teamUsers.find((u) => u.role === 'QA Lead') ?? teamUsers.find((u) => u.role === 'Admin') ?? teamUsers[0] ?? null;
  const reviewer = teamUsers.find((u) => u.id === reviewerId) ?? defaultReviewer;
  const requirementTitle = requirement.trim();
  const canStart = Boolean(project && reviewer && requirementTitle.length >= 3);

  // Placeholders keep the step list visible before a project and requirement are chosen.
  const previewProject = project ?? { id: null, name: 'your project', language: '', framework: '', repoUrl: 'https://example.com/repo', automationRepoUrl: '' };
  const previewReviewer = reviewer ?? { id: null, name: 'a reviewer', email: '', role: 'Reviewer' };
  const source = buildSource(previewProject, requirementTitle || 'your requirement', store.runs.length + 1);
  const steps = buildSteps(source, previewProject, previewReviewer);

  const isBusy = phase === 'running' || phase === 'awaiting_review';

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [allLogs]);

  useEffect(() => {
    if (gate && gateRef.current) {
      gateRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [gate]);

  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  };

  // Stop any in-flight simulation when leaving the page.
  useEffect(() => clearTimers, []);

  const schedule = (fn, ms) => {
    timersRef.current.push(setTimeout(fn, ms));
  };

  // ---- Persistence helpers (shared with the Approvals / Audit pages) ----

  const logAudit = (action, target, details, userId = null) => {
    const run = runRef.current;
    auditSeqRef.current += 1;
    upsertRecord('audit', {
      id: makeId("ae-live", auditSeqRef.current),
      userId,
      projectId: run.project.id,
      action,
      target,
      details,
      timestamp: new Date().toISOString(),
    });
  };

  const syncRun = (status, checkpoint = null) => {
    const run = runRef.current;
    const finished = status === 'completed' || status === 'rejected';
    upsertRecord('runs', {
      id: run.id,
      projectId: run.project.id,
      requirementId: null,
      title: `${run.source.feature} — QA Pipeline`,
      status,
      startedAt: run.startedAt,
      completedAt: finished ? new Date().toISOString() : null,
      steps: run.records.map((r) => ({ ...r })),
      checkpoint,
    });
  };

  // ---- Step state helpers ----

  const setStep = (index, status) =>
    setStepStates((prev) => prev.map((s, i) => (i === index ? status : s)));

  const setResult = (index, text) =>
    setStepResults((prev) => prev.map((r, i) => (i === index ? text : r)));

  const playLogs = (header, logs, done) => {
    if (header) {
      schedule(() => setAllLogs((prev) => [...prev, { kind: 'header', msg: header }]), 0);
    }
    logs.forEach((log, i) => {
      schedule(() => setAllLogs((prev) => [...prev, log]), (i + 1) * LOG_INTERVAL);
    });
    schedule(done, (logs.length + 1) * LOG_INTERVAL);
  };

  const completeStep = (index, result, duration) => {
    const run = runRef.current;
    setStep(index, 'completed');
    setResult(index, result);
    run.records[index] = { name: run.steps[index].name, status: 'completed', duration, details: result };
  };

  // ---- Pipeline engine ----

  const runStep = (index) => {
    const run = runRef.current;
    if (!run) return;
    if (index >= run.steps.length) {
      finishRun('completed');
      return;
    }

    const step = run.steps[index];
    setStep(index, 'running');
    run.records[index] = { name: step.name, status: 'in_progress', duration: null, details: step.description };

    playLogs(step.name, step.logs, () => {
      if (step.gate) {
        openGate();
        return;
      }
      completeStep(index, step.result, Math.round(parseFloat(step.logs[step.logs.length - 1].time)));
      if (index === 1) {
        const n = run.source.testCases.length;
        const pct = Math.round(averageConfidence(run.source.testCases) * 100);
        logAudit('ai.generated', `Test cases for ${run.source.feature}`, `AI generated ${n} test cases with ${pct}% confidence`);
      }
      syncRun('in_progress', { step: index + 1, state: `${step.name.toLowerCase().replace(/\W+/g, '_')}_complete`, savedAt: new Date().toISOString() });
      schedule(() => runStep(index + 1), STEP_PAUSE);
    });
  };

  const openGate = () => {
    const run = runRef.current;
    const version = run.revision + 1;
    const confidence = Math.min(0.99, averageConfidence(run.source.testCases) + 0.02 * run.revision);
    const now = new Date().toISOString();

    gateOpenRef.current = true;
    setStep(GATE_STEP, 'waiting');
    setPhase('awaiting_review');
    setGate({ version, testCases: run.source.testCases, script: run.script, confidence });
    setGateTab('cases');
    setComment('');

    run.records[GATE_STEP] = {
      name: run.steps[GATE_STEP].name,
      status: 'in_progress',
      duration: null,
      details: `Awaiting review from ${run.reviewer.name}`,
    };

    upsertRecord('approvals', {
      id: run.approvalId,
      projectId: run.project.id,
      type: 'automation_script',
      title: `${run.source.feature} — AI Test Suite (v${version})`,
      description: `${run.source.testCases.length} AI-generated test cases and ${run.source.specFiles.length + 1} automation files for ${run.source.ref}, produced by the AI workflow.`,
      status: 'pending',
      requestedBy: 'AI Agent',
      assignedTo: run.reviewer.id,
      priority: 'high',
      testCaseId: null,
      aiConfidence: Math.round(confidence * 100) / 100,
      createdAt: now,
      comments: [...run.comments],
      codePreview: run.script,
      workflowRunId: run.id,
    });
    logAudit('approval.requested', `${run.source.feature} test suite v${version}`, `Awaiting review from ${run.reviewer.name}`);
    syncRun('awaiting_approval', { step: GATE_STEP, state: 'awaiting_human_review', savedAt: now });
  };

  const finishRun = (status) => {
    const run = runRef.current;
    setPhase(status);
    syncRun(status);
    if (status === 'completed') {
      logAudit('workflow.completed', `${run.source.feature} pipeline`, `Full pipeline completed successfully. PR #${run.source.prNumber} created.`);
    } else {
      logAudit('workflow.cancelled', `${run.source.feature} pipeline`, 'Run cancelled after the test suite was rejected in review.', currentUser.id);
    }
  };

  const startWorkflow = () => {
    if (!canStart) return;
    clearTimers();
    runRef.current = {
      id: makeId("wf-live"),
      approvalId: makeId("apr-live"),
      source,
      project,
      reviewer,
      steps,
      script: source.script,
      revision: 0,
      comments: [],
      startedAt: new Date().toISOString(),
      records: steps.map((s) => ({ name: s.name, status: 'pending', duration: null, details: '' })),
    };
    gateOpenRef.current = false;
    setAllLogs([]);
    setStepStates(idleStates());
    setStepResults(idleResults());
    setGate(null);
    setComment('');
    setPhase('running');
    logAudit('workflow.started', `${source.feature} pipeline`, `Started requirements analysis for ${source.ref}`);
    syncRun('in_progress', { step: 0, state: 'requirements_analysis', savedAt: runRef.current.startedAt });
    runStep(0);
  };

  const decide = (decision) => {
    const run = runRef.current;
    const text = comment.trim();
    if (!run || !gateOpenRef.current) return;
    if (decision === 'changes_requested' && !text) return;

    gateOpenRef.current = false;
    const now = new Date().toISOString();
    const version = run.revision + 1;
    const stamp = (i) => `${(2.5 + i * 0.5).toFixed(1)}s`;
    if (text) run.comments.push({ user: currentUser.id, text, createdAt: now });

    patchRecord('approvals', run.approvalId, {
      status: decision,
      comments: [...run.comments],
      ...(decision === 'approved' ? { approvedBy: currentUser.id, approvedAt: now } : {}),
    });
    setGate(null);
    setComment('');

    if (decision === 'approved') {
      const result = `Approved by ${currentUser.name}${text ? ` — "${text}"` : ''}`;
      setPhase('running');
      playLogs(
        null,
        [
          { time: stamp(0), msg: `[Human] ✓ ${currentUser.name} approved v${version}${text ? ` with comment: "${text}"` : ''}` },
          { time: stamp(1), msg: '✓ Human review complete — Approved' },
        ],
        () => {
          completeStep(GATE_STEP, result, 3);
          logAudit('approval.approved', `${run.source.feature} test suite v${version}`, `Approved ${run.source.testCases.length} AI-generated test cases`, currentUser.id);
          syncRun('in_progress', { step: GATE_STEP + 1, state: 'review_approved', savedAt: new Date().toISOString() });
          schedule(() => runStep(GATE_STEP + 1), STEP_PAUSE);
        }
      );
      return;
    }

    if (decision === 'changes_requested') {
      run.revision += 1;
      const next = run.revision + 1;
      run.script = buildScriptRevision(run.source.script, text, next);
      const confidence = Math.min(0.99, averageConfidence(run.source.testCases) + 0.02 * run.revision);
      setPhase('running');
      setStep(GATE_STEP, 'running');
      logAudit('approval.changes_requested', `${run.source.feature} test suite v${version}`, `Requested changes: "${text}"`, currentUser.id);
      playLogs(
        null,
        [{ time: stamp(0), msg: `[Human] Changes requested by ${currentUser.name}: "${text}"` }],
        () => {
          playLogs(
            `Revision v${next}`,
            [
              { time: '0.0s', msg: '[Agent] Re-planning with reviewer feedback...' },
              { time: '0.8s', msg: `[AI] Applying feedback: "${text}"` },
              { time: '2.0s', msg: `[AI] Regenerating affected script: ${run.source.specFiles[0]}` },
              { time: '3.2s', msg: '[AI] Running static analysis on revised code... 0 issues found' },
              { time: '3.8s', msg: `[AI] Confidence recalculated: avg ${confidence.toFixed(2)}` },
              { time: '4.2s', msg: `[Checkpoint] State saved to PostgreSQL (step: awaiting_review_v${next})` },
              { time: '4.4s', msg: '⏳ Awaiting human approval — pipeline paused' },
            ],
            openGate
          );
        }
      );
      return;
    }

    // rejected
    const result = `Rejected by ${currentUser.name}${text ? ` — "${text}"` : ''}`;
    setStep(GATE_STEP, 'rejected');
    setResult(GATE_STEP, result);
    run.records[GATE_STEP] = { name: run.steps[GATE_STEP].name, status: 'rejected', duration: 3, details: result };
    logAudit('approval.rejected', `${run.source.feature} test suite v${version}`, text ? `Rejected: "${text}"` : 'Rejected without comment', currentUser.id);
    playLogs(
      null,
      [
        { time: stamp(0), msg: `[Human] ✗ Rejected by ${currentUser.name}${text ? `: "${text}"` : ''}` },
        { time: stamp(1), msg: '✗ Workflow cancelled — no Draft PR created' },
      ],
      () => finishRun('rejected')
    );
  };

  const resetWorkflow = () => {
    clearTimers();
    runRef.current = null;
    gateOpenRef.current = false;
    setPhase('idle');
    setStepStates(idleStates());
    setStepResults(idleResults());
    setAllLogs([]);
    setGate(null);
    setComment('');
  };

  const activeIndex = stepStates.findIndex((s) => s === 'running' || s === 'waiting' || s === 'rejected');
  const stepCounter = activeIndex >= 0 ? activeIndex + 1 : stepStates.filter((s) => s === 'completed').length;

  const checkpointText = {
    running: `Step ${Math.max(activeIndex + 1, 1)} state saved — recovery supported`,
    awaiting_review: 'Paused at human review — state saved, resumes on your decision',
    completed: 'Pipeline complete — all states persisted',
    rejected: 'Run cancelled at review — state persisted',
  }[phase];

  const runsList = store.runs;
  const gateCaseCount = gate ? gate.testCases.length : 0;

  return (
    <>
      <Header title="AI QA Workflow" subtitle="Preview of the AI-assisted test generation pipeline" />
      <div className={styles.content}>
        <div className={styles.simNotice} id="simulation-notice">
          <Bot size={16} />
          <span>
            <strong>Simulation.</strong> This page demonstrates the planned pipeline with generated placeholder output. No AI
            model, GitHub repository or CI system is connected yet, so nothing is read from or written to your repositories.
          </span>
        </div>

        {projectsLoaded && projects.length === 0 && (
          <div className={styles.simNotice} id="workflow-no-projects">
            <FolderPlus size={16} />
            <span>
              Create a project first. <Link href="/dashboard/projects">Go to Projects</Link>
            </span>
          </div>
        )}

        {/* Controls */}
        <div className={styles.controlBar}>
          <div className={styles.controlLeft}>
            <div className={styles.projectSelect}>
              <label className={styles.selectLabel} htmlFor="workflow-project-select">Project</label>
              <select
                className="select"
                value={project?.id ?? ''}
                onChange={(e) => setProjectId(e.target.value)}
                disabled={phase !== 'idle' || projects.length === 0}
                id="workflow-project-select"
              >
                {projects.length === 0 && <option value="">{projectsLoaded ? 'No projects yet' : 'Loading...'}</option>}
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className={styles.projectSelect}>
              <label className={styles.selectLabel} htmlFor="workflow-requirement">Requirement</label>
              <input
                id="workflow-requirement"
                className="input"
                placeholder="e.g. Add coupon code validation at checkout"
                value={requirement}
                onChange={(e) => setRequirement(e.target.value)}
                disabled={phase !== 'idle'}
                maxLength={120}
              />
            </div>
            <div className={styles.projectSelect}>
              <label className={styles.selectLabel} htmlFor="workflow-reviewer-select">Reviewer</label>
              <select
                className="select"
                value={reviewer?.id ?? ''}
                onChange={(e) => setReviewerId(e.target.value)}
                disabled={phase !== 'idle' || teamUsers.length === 0}
                id="workflow-reviewer-select"
              >
                {teamUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                ))}
              </select>
            </div>
          </div>
          <div className={styles.controlActions}>
            {phase === 'idle' && (
              <button
                className="btn btn-primary btn-lg"
                onClick={startWorkflow}
                disabled={!canStart}
                title={canStart ? undefined : 'Choose a project and describe the requirement first'}
                id="start-workflow-btn"
              >
                <Play size={18} /> Start AI Pipeline
              </button>
            )}
            {phase === 'running' && (
              <button className="btn btn-secondary" disabled>
                <Loader2 size={18} className="animate-spin" /> Running...
              </button>
            )}
            {phase === 'awaiting_review' && (
              <button className="btn btn-secondary" disabled>
                <UserCheck size={18} /> Awaiting your review
              </button>
            )}
            {(phase === 'completed' || phase === 'rejected') && (
              <button className="btn btn-secondary" onClick={resetWorkflow} id="reset-workflow-btn">
                <RotateCcw size={16} /> Reset
              </button>
            )}
          </div>
        </div>

        {/* Human review gate */}
        {gate && (
          <section className={styles.gatePanel} ref={gateRef} id="review-gate">
            <div className={styles.gateHeader}>
              <div className={styles.gateTitleWrap}>
                <ShieldCheck size={22} className={styles.gateIcon} />
                <div>
                  <h3 className={styles.gateTitle}>Human review required — v{gate.version}</h3>
                  <p className={styles.gateSub}>
                    The pipeline is paused. No branch, commit or PR is created until you decide.
                  </p>
                </div>
              </div>
              <div className={styles.gateMeta}>
                <span className={styles.gateChip}>
                  <Sparkles size={13} /> AI confidence {Math.round(gate.confidence * 100)}%
                </span>
                <Link href="/dashboard/approvals" className={styles.gateLink}>
                  Open in Approvals <ExternalLink size={13} />
                </Link>
              </div>
            </div>

            <div className={styles.gateTabs} role="tablist">
              <button
                role="tab"
                aria-selected={gateTab === 'cases'}
                className={`${styles.gateTab} ${gateTab === 'cases' ? styles.gateTabActive : ''}`}
                onClick={() => setGateTab('cases')}
              >
                <TestTubes size={14} /> Test cases ({gateCaseCount})
              </button>
              <button
                role="tab"
                aria-selected={gateTab === 'script'}
                className={`${styles.gateTab} ${gateTab === 'script' ? styles.gateTabActive : ''}`}
                onClick={() => setGateTab('script')}
              >
                <Code2 size={14} /> Generated script
              </button>
            </div>

            {gateTab === 'cases' ? (
              <div className={styles.caseList}>
                {gate.testCases.map((t, i) => (
                  <div key={t.title} className={styles.caseRow}>
                    <span className={styles.caseIndex}>{i + 1}</span>
                    <span className={styles.caseTitle}>{t.title}</span>
                    <span className={`badge badge-${t.priority === 'critical' ? 'danger' : t.priority === 'high' ? 'warning' : 'neutral'}`}>
                      {t.priority}
                    </span>
                    <span className={styles.caseConf}>{Math.round(t.confidence * 100)}%</span>
                  </div>
                ))}
              </div>
            ) : (
              <pre className={styles.gateCode}>
                <code>{gate.script}</code>
              </pre>
            )}

            <div className={styles.gateDecision}>
              <textarea
                className={`input ${styles.gateComment}`}
                placeholder="Reviewer comment — required to request changes, optional otherwise"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                id="gate-comment"
              />
              <div className={styles.gateActions}>
                <button className="btn btn-success" onClick={() => decide('approved')} id="gate-approve">
                  <Check size={16} /> Approve & continue
                </button>
                <button
                  className={`btn btn-secondary ${styles.btnChanges}`}
                  onClick={() => decide('changes_requested')}
                  disabled={!comment.trim()}
                  title={comment.trim() ? undefined : 'Add a comment describing the changes'}
                  id="gate-request-changes"
                >
                  <AlertCircle size={16} /> Request changes
                </button>
                <button className="btn btn-danger" onClick={() => decide('rejected')} id="gate-reject">
                  <X size={16} /> Reject
                </button>
              </div>
            </div>
          </section>
        )}

        <div className={styles.workflowGrid}>
          {/* Pipeline Steps */}
          <div className={styles.pipelineSection}>
            <h3 className={styles.pipelineTitle}>
              <Sparkles size={18} /> Pipeline Steps
            </h3>
            <div className={styles.stepList}>
              {steps.map((step, index) => {
                const status = stepStates[index];
                const Icon = STEP_ICONS[index];
                return (
                  <div key={step.name} className={`${styles.stepCard} ${styles[status]}`}>
                    <div className={styles.stepConnector}>
                      <div className={`${styles.stepDot} ${styles[`dot_${status}`]}`}>
                        {status === 'completed' && <CheckCircle2 size={18} />}
                        {status === 'running' && <Loader2 size={18} className="animate-spin" />}
                        {status === 'waiting' && <UserCheck size={14} />}
                        {status === 'rejected' && <XCircle size={18} />}
                        {status === 'pending' && <Circle size={18} />}
                      </div>
                      {index < steps.length - 1 && (
                        <div className={`${styles.stepLine} ${status === 'completed' ? styles.stepLineActive : ''}`} />
                      )}
                    </div>
                    <div className={styles.stepContent}>
                      <div className={styles.stepHeader}>
                        <Icon size={16} className={styles.stepIcon} />
                        <span className={styles.stepName}>{step.name}</span>
                        {status === 'completed' && <span className="badge badge-success">Done</span>}
                        {status === 'running' && <span className="badge badge-primary">Running</span>}
                        {status === 'waiting' && <span className="badge badge-warning">Awaiting review</span>}
                        {status === 'rejected' && <span className="badge badge-danger">Rejected</span>}
                      </div>
                      <p className={styles.stepDesc}>{step.description}</p>
                      {(status === 'completed' || status === 'rejected') && (
                        <div className={`${styles.stepResult} ${status === 'rejected' ? styles.stepResultRejected : ''}`}>
                          {status === 'rejected' ? <XCircle size={13} /> : <CheckCircle2 size={13} />}
                          {stepResults[index]}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Checkpoint Info */}
            {checkpointText && (
              <div className={`${styles.checkpointInfo} ${phase === 'rejected' ? styles.checkpointRejected : ''} ${phase === 'awaiting_review' ? styles.checkpointWaiting : ''}`}>
                <Database size={16} />
                <div>
                  <div className={styles.checkpointTitle}>PostgreSQL Checkpoint</div>
                  <div className={styles.checkpointMeta}>{checkpointText}</div>
                </div>
              </div>
            )}
          </div>

          {/* Live Log Console */}
          <div className={styles.consoleSection}>
            <div className={styles.consoleHeader}>
              <div className={styles.consoleTitleGroup}>
                <h3 className={styles.consoleTitle}>Live Execution Log</h3>
                {phase === 'running' && (
                  <span className={styles.liveIndicator}>
                    <span className={styles.liveDot} />
                    LIVE
                  </span>
                )}
                {phase === 'awaiting_review' && (
                  <span className={styles.pausedIndicator}>PAUSED</span>
                )}
              </div>
              {phase !== 'idle' && (
                <span className="text-xs text-muted">
                  Step {Math.min(stepCounter, STEP_COUNT)}/{STEP_COUNT}
                </span>
              )}
            </div>
            <div className={styles.consoleBody}>
              {allLogs.length === 0 ? (
                <div className={styles.consoleEmpty}>
                  <Bot size={32} />
                  <p>Click &quot;Start AI Pipeline&quot; to begin the workflow</p>
                  <p className="text-xs text-muted">The AI agent will analyze requirements, generate tests, wait for your review, then create a Draft PR</p>
                </div>
              ) : (
                <div className={styles.logList}>
                  {allLogs.map((log, i) =>
                    log.kind === 'header' ? (
                      <div key={i} className={styles.logHeader}>{log.msg}</div>
                    ) : (
                      <div key={i} className={styles.logEntry}>
                        <span className={styles.logTime}>{log.time}</span>
                        <span
                          className={`${styles.logMsg} ${
                            log.msg.startsWith('✓')
                              ? styles.logSuccess
                              : log.msg.startsWith('⏳')
                                ? styles.logWaiting
                                : log.msg.startsWith('✗')
                                  ? styles.logError
                                  : ''
                          }`}
                        >
                          {log.msg}
                        </span>
                      </div>
                    )
                  )}
                  <div ref={logEndRef} />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Existing Workflow Runs */}
        <div className={styles.existingSection}>
          <button
            className={styles.existingToggle}
            onClick={() => setShowExistingRuns(!showExistingRuns)}
            id="toggle-existing-runs"
          >
            <Clock size={16} />
            Previous Workflow Runs ({runsList.length})
            <ChevronDown size={16} className={showExistingRuns ? styles.chevronUp : ''} />
          </button>
          {showExistingRuns && (
            <div className={styles.existingList}>
              {runsList.map((run) => (
                <div key={run.id} className={styles.existingCard}>
                  <div className={styles.existingTop}>
                    <span className={styles.existingTitle}>{run.title}</span>
                    <span className={`badge badge-${getStatusColor(run.status)}`}>
                      {getStatusLabel(run.status)}
                    </span>
                  </div>
                  <div className={styles.existingSteps}>
                    {run.steps.map((step, i) => (
                      <div key={i} className={`${styles.miniStep} ${styles[`mini_${step.status}`]}`} title={`${step.name}: ${step.status.replace('_', ' ')}`}>
                        {step.status === 'completed' && <CheckCircle2 size={12} />}
                        {step.status === 'in_progress' && <Loader2 size={12} />}
                        {step.status === 'pending' && <Circle size={12} />}
                        {step.status === 'rejected' && <XCircle size={12} />}
                      </div>
                    ))}
                  </div>
                  {run.checkpoint && (
                    <div className={styles.existingCheckpoint}>
                      <Database size={12} /> Checkpoint: {run.checkpoint.state}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
