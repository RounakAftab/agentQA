'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import { useProjects } from '@/lib/dataStores';
import { useCurrentUser } from '@/lib/teamStore';
import { getRelativeTime } from '@/lib/format';
import { AGENT_STEPS } from '@/lib/agentSteps';
import { useAgentRuns, useJiraIssues, startAgentRun, RUN_STATUS, isRunActive } from '@/lib/qaAgentClient';
import { Bot, Play, Loader2, RefreshCw, ExternalLink, AlertCircle, CheckCircle2, Server, Ticket, ChevronRight } from 'lucide-react';
import styles from './page.module.css';

const OPERATOR_ROLES = ['Admin', 'QA Lead', 'QA Engineer'];
const stepLabel = (id) => AGENT_STEPS.find((s) => s.id === id)?.label ?? '';

export default function QaAgentPage() {
  const router = useRouter();
  const me = useCurrentUser();
  const { projects, loaded: projectsLoaded } = useProjects();
  const [projectId, setProjectId] = useState('');
  const [manualKey, setManualKey] = useState('');
  const [starting, setStarting] = useState('');
  const [notice, setNotice] = useState(null);

  const project = projects.find((p) => p.id === projectId) ?? projects.find((p) => p.jiraProjectKey) ?? projects[0] ?? null;
  const { runs, worker, jiraConfigured, loaded: runsLoaded, refresh: refreshRuns } = useAgentRuns(project?.id);
  const { issues, missingKey, loaded: issuesLoaded, error: issuesError, refresh: refreshIssues } = useJiraIssues(project?.id);

  const canOperate = OPERATOR_ROLES.includes(me?.role);
  const missingSettings = project
    ? [!project.jiraProjectKey && 'Jira project key', !project.appBaseUrl && 'app link for tests', !project.automationRepoUrl && 'test repository link'].filter(Boolean)
    : [];
  const ready = Boolean(project && jiraConfigured && missingSettings.length === 0);
  const activeByKey = new Map(runs.filter(isRunActive).map((r) => [r.issueKey, r]));

  const pickUp = async (issueKey, summary = '') => {
    setStarting(issueKey);
    setNotice(null);
    const result = await startAgentRun({ projectId: project.id, issueKey, summary });
    setStarting('');
    if (result.ok) {
      router.push(`/dashboard/qa-agent/runs/${result.data.run.id}`);
      return;
    }
    if (result.status === 409 && result.data.runId) {
      router.push(`/dashboard/qa-agent/runs/${result.data.runId}`);
      return;
    }
    setNotice({ type: 'danger', text: result.data.error ?? 'Could not start the run' });
    refreshRuns();
  };

  const submitManual = (e) => {
    e.preventDefault();
    const raw = manualKey.trim().toUpperCase().replace(/^PICK UP\s+/, '');
    const key = /^\d+$/.test(raw) && project?.jiraProjectKey ? `${project.jiraProjectKey}-${raw}` : raw;
    if (key) pickUp(key);
  };

  return (
    <>
      <Header title="QA Agent" subtitle="Turn Jira tickets into verified Playwright tests" />
      <div className={styles.content}>
        <div className={styles.statusBar}>
          <div className={styles.statusItems}>
            <span className={styles.statusItem}>
              <span className={`status-dot ${jiraConfigured ? styles.dotOn : styles.dotOff}`} />
              Jira {jiraConfigured ? 'connected' : 'not connected'}
            </span>
            <span className={styles.statusItem}>
              <span className={`status-dot ${worker.online ? styles.dotOn : styles.dotOff}`} />
              <Server size={14} /> Worker {worker.online ? 'online' : 'offline'}
            </span>
          </div>
          <label className={styles.projectPicker}>
            <span className={styles.pickerLabel}>Project</span>
            <select className="select" value={project?.id ?? ''} onChange={(e) => setProjectId(e.target.value)} disabled={!projects.length}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.jiraProjectKey ? ` (${p.jiraProjectKey})` : ''}
                </option>
              ))}
            </select>
          </label>
        </div>

        {!jiraConfigured && (
          <div className={`${styles.alert} ${styles.alertWarning}`} role="status">
            <AlertCircle size={16} /> Jira is not connected. Add JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN to the server&apos;s .env and restart it.
          </div>
        )}
        {jiraConfigured && !worker.online && (
          <div className={`${styles.alert} ${styles.alertWarning}`} role="status">
            <AlertCircle size={16} />
            <span>
              No QA Agent worker is running, so queued tickets will wait. Start one with <code>npm run agent:worker</code>.
              {worker.lastSeenAt && ` Last seen ${getRelativeTime(worker.lastSeenAt)}.`}
            </span>
          </div>
        )}
        {projectsLoaded && !project && (
          <div className={`${styles.alert} ${styles.alertWarning}`} role="status">
            <AlertCircle size={16} /> Create a project first, then add its Jira project key.
            <Link href="/dashboard/projects" className="btn btn-secondary btn-sm">Projects</Link>
          </div>
        )}
        {project && missingSettings.length > 0 && (
          <div className={`${styles.alert} ${styles.alertWarning}`} role="status">
            <AlertCircle size={16} />
            <span>
              {project.name} needs a {missingSettings.join(', ')} before the agent can run.
            </span>
            <Link href={`/dashboard/projects/${project.id}`} className="btn btn-secondary btn-sm">Edit project</Link>
          </div>
        )}
        {notice && (
          <div className={`${styles.alert} ${notice.type === 'danger' ? styles.alertDanger : styles.alertSuccess}`} role="alert">
            {notice.type === 'danger' ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />} {notice.text}
          </div>
        )}

        <div className={styles.grid}>
          <section className={`card ${styles.panel}`}>
            <div className={styles.panelHeader}>
              <h3 className={styles.panelTitle}>
                <Ticket size={16} /> Open Jira tickets
              </h3>
              <button className="btn btn-ghost btn-sm" onClick={refreshIssues} disabled={!project} title="Reload tickets">
                <RefreshCw size={14} /> Reload
              </button>
            </div>

            {canOperate && (
              <form className={styles.manualForm} onSubmit={submitManual}>
                <input
                  className="input"
                  value={manualKey}
                  onChange={(e) => setManualKey(e.target.value)}
                  placeholder={`pick up ${project?.jiraProjectKey ?? 'SCRUM'}-1`}
                  aria-label="Ticket key to pick up"
                  disabled={!ready}
                />
                <button type="submit" className="btn btn-primary" disabled={!ready || !manualKey.trim() || Boolean(starting)}>
                  <Play size={15} /> Pick up
                </button>
              </form>
            )}

            {!project || missingKey ? (
              <p className={styles.empty}>Add a Jira project key to this project to list its tickets.</p>
            ) : !issuesLoaded ? (
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
                        canOperate && (
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => pickUp(issue.key, issue.summary)}
                            disabled={!ready || Boolean(starting)}
                            id={`pick-up-${issue.key}`}
                          >
                            {starting === issue.key ? <Loader2 size={14} className="animate-spin" /> : <Bot size={14} />} Pick up
                          </button>
                        )
                      )}
                    </li>
                  );
                })}
              </ul>
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
              <p className={styles.empty}>No runs yet. Pick up a ticket to start one.</p>
            ) : (
              <ul className={styles.list}>
                {runs.map((run) => (
                  <li key={run.id}>
                    <Link href={`/dashboard/qa-agent/runs/${run.id}`} className={styles.run}>
                      <div className={styles.issueMain}>
                        <div className={styles.issueTop}>
                          <span className={styles.issueKey}>{run.issueKey}</span>
                          <span className={`badge badge-${RUN_STATUS[run.status].color}`}>{RUN_STATUS[run.status].label}</span>
                        </div>
                        <span className={styles.issueSummary}>{run.issueSummary || '—'}</span>
                        <span className={styles.meta}>
                          {run.status === 'RUNNING' && run.step ? `${stepLabel(run.step)} · ` : ''}
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
    </>
  );
}
