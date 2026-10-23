'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import ProjectFormModal from '@/components/ProjectFormModal';
import RequirementFormModal from '@/components/RequirementFormModal';
import { useProjects, refreshProjects } from '@/lib/dataStores';
import { useCurrentUser } from '@/lib/teamStore';
import { getRelativeTime } from '@/lib/format';
import { AGENT_STEPS, stepLabel } from '@/lib/agentSteps';
import {
  useAgentRuns,
  useJiraIssues,
  useRequirements,
  startAgentRun,
  deleteRequirement,
  RUN_STATUS,
  isRunActive,
} from '@/lib/qaAgentClient';
import {
  Bot,
  Play,
  Loader2,
  RefreshCw,
  ExternalLink,
  AlertCircle,
  CheckCircle2,
  Server,
  Ticket,
  ChevronRight,
  PlugZap,
  Settings2,
  FileText,
  Plus,
  Pencil,
  Trash2,
  MonitorPlay,
  GitPullRequest,
} from 'lucide-react';
import styles from './page.module.css';

const OPERATOR_ROLES = ['Admin', 'QA Lead', 'QA Engineer'];
const PRIORITY_COLOR = { critical: 'danger', high: 'warning', medium: 'info', low: 'neutral' };
const REQUIREMENT_STATUS = {
  open: { label: 'Not automated', color: 'neutral' },
  in_progress: { label: 'Running', color: 'info' },
  automated: { label: 'Automated', color: 'success' },
  failed: { label: 'Failed', color: 'danger' },
};

const runStepLabel = (run) => {
  const step = AGENT_STEPS.find((s) => s.id === run.step);
  return step ? stepLabel(step, run.source) : '';
};
const host = (url) => url.replace(/^https?:\/\//, '').replace(/\/.*$/, '');

export default function QaAgentPage() {
  const router = useRouter();
  const me = useCurrentUser();
  const { projects, loaded: projectsLoaded } = useProjects();
  const [projectId, setProjectId] = useState('');
  const [tab, setTab] = useState(null); // null = pick a default for the project
  const [jiraKey, setJiraKey] = useState('');
  const [starting, setStarting] = useState('');
  const [notice, setNotice] = useState(null);
  const [editingSection, setEditingSection] = useState(null);
  const [requirementForm, setRequirementForm] = useState(null); // { requirement? }
  const [confirmDelete, setConfirmDelete] = useState(null);

  const project = projects.find((p) => p.id === projectId) ?? projects.find((p) => p.jiraConnected) ?? projects[0] ?? null;
  const jiraConnected = Boolean(project?.jiraConnected);
  const activeTab = tab ?? (jiraConnected ? 'jira' : 'manual');

  const { runs, worker, loaded: runsLoaded, refresh: refreshRuns } = useAgentRuns(project?.id);
  const { issues, loaded: issuesLoaded, error: issuesError, refresh: refreshIssues } = useJiraIssues(jiraConnected ? project.id : null);
  const { requirements, loaded: requirementsLoaded, refresh: refreshRequirements } = useRequirements(project?.id);

  const canManage = me?.role === 'Admin' || me?.role === 'QA Lead';
  const canOperate = OPERATOR_ROLES.includes(me?.role);
  const canAutomate = Boolean(project?.appBaseUrl);
  const activeByKey = new Map(runs.filter(isRunActive).map((r) => [r.issueKey, r]));

  const selectProject = (id) => {
    setProjectId(id);
    setTab(null);
    setNotice(null);
  };

  const start = async (key, payload) => {
    setStarting(key);
    setNotice(null);
    const result = await startAgentRun({ projectId: project.id, ...payload });
    setStarting('');
    if (result.ok || (result.status === 409 && result.data.runId)) {
      router.push(`/dashboard/qa-agent/runs/${result.ok ? result.data.run.id : result.data.runId}`);
      return;
    }
    setNotice({ type: 'danger', text: result.data.error ?? 'Could not start the run' });
    refreshRuns();
  };

  const submitJiraKey = (e) => {
    e.preventDefault();
    const raw = jiraKey.trim().toUpperCase().replace(/^PICK UP\s+/, '');
    const key = /^\d+$/.test(raw) && project?.jiraProjectKey ? `${project.jiraProjectKey}-${raw}` : raw;
    if (key) start(key, { issueKey: key });
  };

  const removeRequirement = async () => {
    const target = confirmDelete;
    const result = await deleteRequirement(target.id);
    setConfirmDelete(null);
    setNotice(result.ok ? { type: 'success', text: `Deleted ${target.key}` } : { type: 'danger', text: result.data.error ?? 'Could not delete' });
    refreshRequirements();
  };

  const runButton = (key, payload, label = 'Run') =>
    canOperate && (
      <button className="btn btn-primary btn-sm" onClick={() => start(key, payload)} disabled={!canAutomate || Boolean(starting)} id={`run-${key}`}>
        {starting === key ? <Loader2 size={14} className="animate-spin" /> : <Bot size={14} />} {label}
      </button>
    );

  return (
    <>
      <Header title="QA Agent" subtitle="Turn Jira tickets and written requirements into verified Playwright tests" />
      <div className={styles.content}>
        <div className={styles.statusBar}>
          <label className={styles.projectPicker}>
            <span className={styles.pickerLabel}>Project</span>
            <select className="select" value={project?.id ?? ''} onChange={(e) => selectProject(e.target.value)} disabled={!projects.length}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.jiraProjectKey ? ` (${p.jiraProjectKey})` : ''}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.statusItems}>
            <Capability
              on
              icon={FileText}
              label="Requirements"
              detail={jiraConnected ? `Manual + Jira ${project.jiraProjectKey}` : 'Manual'}
            />
            <Capability
              on={canAutomate}
              icon={MonitorPlay}
              label="Automation"
              detail={canAutomate ? host(project.appBaseUrl) : 'Add an app link'}
              onClick={canManage && project && !canAutomate ? () => setEditingSection('testing') : null}
            />
            <Capability
              on={Boolean(project?.automationRepoUrl)}
              icon={GitPullRequest}
              label="Delivery"
              detail={project?.automationRepoUrl ? 'Pull request' : 'Saved in AgentQA'}
              neutral
            />
            <Capability on={worker.online} icon={Server} label="Worker" detail={worker.online ? 'Online' : 'Offline'} />
          </div>
        </div>

        {projectsLoaded && !project && (
          <div className={`${styles.alert} ${styles.alertWarning}`} role="status">
            <AlertCircle size={16} /> Create a project first. Only a name is needed.
            <Link href="/dashboard/projects" className="btn btn-secondary btn-sm">Projects</Link>
          </div>
        )}
        {project && !canAutomate && (
          <div className={`${styles.alert} ${styles.alertWarning}`} role="status">
            <AlertCircle size={16} />
            <span>Add the link of the site the tests should run against (a staging environment works best) to start runs.</span>
            {canManage && (
              <button className="btn btn-secondary btn-sm" onClick={() => setEditingSection('testing')}>
                Add app link
              </button>
            )}
          </div>
        )}
        {project && canAutomate && !worker.online && (
          <div className={`${styles.alert} ${styles.alertWarning}`} role="status">
            <AlertCircle size={16} />
            <span>
              No QA Agent worker is running, so runs will wait in the queue. Start one with <code>npm run agent:worker</code>.
              {worker.lastSeenAt && ` Last seen ${getRelativeTime(worker.lastSeenAt)}.`}
            </span>
          </div>
        )}
        {notice && (
          <div className={`${styles.alert} ${notice.type === 'danger' ? styles.alertDanger : styles.alertSuccess}`} role="alert">
            {notice.type === 'danger' ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />} {notice.text}
          </div>
        )}

        <div className={styles.grid}>
          <section className={`card ${styles.panel}`}>
            <div className={styles.tabs} role="tablist" aria-label="Requirement sources">
              <button
                role="tab"
                aria-selected={activeTab === 'manual'}
                className={`${styles.tab} ${activeTab === 'manual' ? styles.tabActive : ''}`}
                onClick={() => setTab('manual')}
                id="tab-manual"
              >
                <FileText size={15} /> Requirements
                {requirements.length > 0 && <span className={styles.count}>{requirements.length}</span>}
              </button>
              <button
                role="tab"
                aria-selected={activeTab === 'jira'}
                className={`${styles.tab} ${activeTab === 'jira' ? styles.tabActive : ''}`}
                onClick={() => setTab('jira')}
                id="tab-jira"
              >
                <Ticket size={15} /> Jira tickets
                {!jiraConnected && <span className={styles.tabHint}>Not connected</span>}
              </button>
            </div>

            {activeTab === 'manual' && (
              <div role="tabpanel" aria-labelledby="tab-manual">
                <div className={styles.panelHeader}>
                  <p className={styles.panelIntro}>Write or paste what to test. No Jira or GitHub needed.</p>
                  {canOperate && project && (
                    <button className="btn btn-primary btn-sm" onClick={() => setRequirementForm({})} id="btn-new-requirement">
                      <Plus size={14} /> New requirement
                    </button>
                  )}
                </div>
                {!project ? null : !requirementsLoaded ? (
                  <p className={styles.empty}>
                    <Loader2 size={14} className="animate-spin" /> Loading requirements…
                  </p>
                ) : requirements.length === 0 ? (
                  <div className={styles.emptyState}>
                    <FileText size={28} />
                    <h4>No requirements yet</h4>
                    <p>Add a user story or acceptance criteria. The agent turns it into a Playwright test and checks it against your app.</p>
                    {canOperate && (
                      <button className="btn btn-primary" onClick={() => setRequirementForm({})}>
                        <Plus size={15} /> New requirement
                      </button>
                    )}
                  </div>
                ) : (
                  <ul className={styles.list}>
                    {requirements.map((req) => {
                      const active = req.lastRun && isRunActive(req.lastRun) ? req.lastRun : null;
                      const status = REQUIREMENT_STATUS[req.status] ?? REQUIREMENT_STATUS.open;
                      return (
                        <li key={req.id} className={styles.issue}>
                          <div className={styles.issueMain}>
                            <div className={styles.issueTop}>
                              <span className={styles.issueKey}>{req.key}</span>
                              <span className={`badge badge-${status.color}`}>{status.label}</span>
                              <span className={`badge badge-${PRIORITY_COLOR[req.priority] ?? 'neutral'}`}>{req.priority}</span>
                            </div>
                            <span className={styles.issueSummary}>{req.title}</span>
                            <span className={styles.meta}>
                              {req.createdBy ? `${req.createdBy.name} · ` : ''}
                              {getRelativeTime(req.createdAt)}
                              {req.lastRun && (
                                <>
                                  {' · '}
                                  <Link href={`/dashboard/qa-agent/runs/${req.lastRun.id}`} className={styles.inlineLink}>
                                    last run {RUN_STATUS[req.lastRun.status].label.toLowerCase()}
                                  </Link>
                                </>
                              )}
                            </span>
                          </div>
                          <div className={styles.rowActions}>
                            {active ? (
                              <Link href={`/dashboard/qa-agent/runs/${active.id}`} className="btn btn-secondary btn-sm">
                                <Loader2 size={14} className="animate-spin" /> {RUN_STATUS[active.status].label}
                              </Link>
                            ) : (
                              <>
                                {canOperate && (
                                  <>
                                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setRequirementForm({ requirement: req })} aria-label={`Edit ${req.key}`} title="Edit">
                                      <Pencil size={14} />
                                    </button>
                                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setConfirmDelete(req)} aria-label={`Delete ${req.key}`} title="Delete">
                                      <Trash2 size={14} />
                                    </button>
                                  </>
                                )}
                                {runButton(req.key, { requirementId: req.id }, req.lastRun ? 'Run again' : 'Run')}
                              </>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}

            {activeTab === 'jira' && (
              <div role="tabpanel" aria-labelledby="tab-jira">
                {!jiraConnected ? (
                  <div className={styles.emptyState}>
                    <PlugZap size={28} />
                    <h4>Connect {project?.name ?? 'this project'} to Jira</h4>
                    <p>Optional. With Jira connected the agent lists open tickets here, moves them to In Progress and Done, and adds a note to each one it automates.</p>
                    {canManage && project ? (
                      <button className="btn btn-primary" onClick={() => setEditingSection('jira')} id="btn-connect-jira">
                        <PlugZap size={15} /> Connect Jira
                      </button>
                    ) : (
                      <span className={styles.meta}>Ask an admin or QA lead to connect Jira.</span>
                    )}
                  </div>
                ) : (
                  <>
                    <div className={styles.panelHeader}>
                      <p className={styles.panelIntro}>
                        Open tickets in {project.jiraProjectKey} on {host(project.jiraBaseUrl)}
                      </p>
                      <div className={styles.headerActions}>
                        {canManage && (
                          <button className="btn btn-ghost btn-sm" onClick={() => setEditingSection('jira')} title="Jira settings">
                            <Settings2 size={14} /> Settings
                          </button>
                        )}
                        <button className="btn btn-ghost btn-sm" onClick={refreshIssues} title="Reload tickets">
                          <RefreshCw size={14} /> Reload
                        </button>
                      </div>
                    </div>
                    {canOperate && (
                      <form className={styles.manualForm} onSubmit={submitJiraKey}>
                        <input
                          className="input"
                          value={jiraKey}
                          onChange={(e) => setJiraKey(e.target.value)}
                          placeholder={`pick up ${project.jiraProjectKey}-1`}
                          aria-label="Ticket key to pick up"
                          disabled={!canAutomate}
                        />
                        <button type="submit" className="btn btn-primary" disabled={!canAutomate || !jiraKey.trim() || Boolean(starting)}>
                          <Play size={15} /> Pick up
                        </button>
                      </form>
                    )}
                    {!issuesLoaded ? (
                      <p className={styles.empty}>
                        <Loader2 size={14} className="animate-spin" /> Loading tickets…
                      </p>
                    ) : issuesError ? (
                      <p className={`${styles.empty} ${styles.errorText}`}>{issuesError}</p>
                    ) : issues.length === 0 ? (
                      <p className={styles.empty}>No open tickets in {project.jiraProjectKey}.</p>
                    ) : (
                      <ul className={styles.list}>
                        {issues.map((issue) => {
                          const active = activeByKey.get(issue.key);
                          return (
                            <li key={issue.key} className={styles.issue}>
                              <div className={styles.issueMain}>
                                <div className={styles.issueTop}>
                                  <a href={issue.url} target="_blank" rel="noopener" className={styles.issueKey}>
                                    {issue.key} <ExternalLink size={11} />
                                  </a>
                                  <span className="badge badge-neutral">{issue.status}</span>
                                  {issue.type && <span className={styles.meta}>{issue.type}</span>}
                                </div>
                                <span className={styles.issueSummary}>{issue.summary}</span>
                              </div>
                              {active ? (
                                <Link href={`/dashboard/qa-agent/runs/${active.id}`} className="btn btn-secondary btn-sm">
                                  <Loader2 size={14} className="animate-spin" /> {RUN_STATUS[active.status].label}
                                </Link>
                              ) : (
                                runButton(issue.key, { issueKey: issue.key, summary: issue.summary }, 'Pick up')
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </>
                )}
              </div>
            )}
          </section>

          <section className={`card ${styles.panel}`}>
            <div className={styles.panelHeader}>
              <h3 className={styles.panelTitle}>
                <Bot size={16} /> Recent runs
              </h3>
            </div>
            {!runsLoaded ? (
              <p className={styles.empty}>
                <Loader2 size={14} className="animate-spin" /> Loading runs…
              </p>
            ) : runs.length === 0 ? (
              <p className={styles.empty}>No runs yet. Run a requirement or pick up a ticket to start one.</p>
            ) : (
              <ul className={styles.list}>
                {runs.map((run) => (
                  <li key={run.id}>
                    <Link href={`/dashboard/qa-agent/runs/${run.id}`} className={styles.run}>
                      <div className={styles.issueMain}>
                        <div className={styles.issueTop}>
                          <span className={styles.issueKey}>{run.issueKey}</span>
                          <span className={`badge badge-${RUN_STATUS[run.status].color}`}>{RUN_STATUS[run.status].label}</span>
                          <span className={styles.meta}>{run.source === 'manual' ? 'Requirement' : 'Jira'}</span>
                        </div>
                        <span className={styles.issueSummary}>{run.issueSummary || '—'}</span>
                        <span className={styles.meta}>
                          {run.status === 'RUNNING' && run.step ? `${runStepLabel(run)} · ` : ''}
                          {run.startedBy ? `${run.startedBy.name} · ` : ''}
                          {getRelativeTime(run.queuedAt)}
                        </span>
                      </div>
                      <ChevronRight size={16} className={styles.chevron} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {editingSection && project && (
        <ProjectFormModal
          project={project}
          initialSection={editingSection}
          onClose={() => setEditingSection(null)}
          onSaved={() => {
            setEditingSection(null);
            refreshProjects();
            refreshIssues();
          }}
        />
      )}

      {requirementForm && project && (
        <RequirementFormModal
          projectId={project.id}
          requirement={requirementForm.requirement}
          onClose={() => setRequirementForm(null)}
          onSaved={(saved) => {
            setRequirementForm(null);
            setTab('manual');
            setNotice({ type: 'success', text: requirementForm.requirement ? `Saved ${saved.key}` : `Added ${saved.key}. Run it when you are ready.` });
            refreshRequirements();
          }}
        />
      )}

      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-req-title" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 id="delete-req-title">Delete {confirmDelete.key}?</h3>
            </div>
            <div className="modal-body">
              <p>
                &quot;{confirmDelete.title}&quot; will be removed. Past runs and their specs stay in the run history.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={removeRequirement} id="btn-confirm-delete-requirement">
                <Trash2 size={15} /> Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// One entry in the status bar: what the project can do, and why not when it can't.
function Capability({ on, neutral, icon: Icon, label, detail, onClick }) {
  const tone = on ? styles.capOn : neutral ? styles.capNeutral : styles.capOff;
  const body = (
    <>
      <Icon size={15} />
      <span className={styles.capText}>
        <span className={styles.capLabel}>{label}</span>
        <span className={styles.capDetail}>{detail}</span>
      </span>
    </>
  );
  return onClick ? (
    <button type="button" className={`${styles.capability} ${tone} ${styles.capButton}`} onClick={onClick}>
      {body}
    </button>
  ) : (
    <span className={`${styles.capability} ${tone}`}>{body}</span>
  );
}
