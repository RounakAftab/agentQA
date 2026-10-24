'use client';

import { use, Suspense } from 'react';
import Link from 'next/link';
import Header from '@/components/Header';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import ProjectFormModal from '@/components/ProjectFormModal';
import { useProjects, deleteProject } from '@/lib/dataStores';
import { useCurrentUser } from '@/lib/teamStore';
import { useAgentRuns, useRequirements, RUN_STATUS } from '@/lib/qaAgentClient';
import { getHealthColor, getHealthLabel, getRelativeTime } from '@/lib/format';
import {
  ArrowLeft,
  GitBranch,
  ExternalLink,
  Activity,
  TestTubes,
  AlertCircle,
  TrendingUp,
  Pencil,
  Trash2,
  Loader2,
  Bot,
  FileText,
  MonitorPlay,
  GitPullRequest,
  CheckCircle2,
  Circle,
} from 'lucide-react';
import styles from './page.module.css';

const LIST_SIZE = 6;
const REQUIREMENT_STATUS = {
  open: { label: 'Not automated', color: 'neutral' },
  analyzed: { label: 'Not automated', color: 'neutral' },
  in_progress: { label: 'Running', color: 'info' },
  automated: { label: 'Automated', color: 'success' },
  failed: { label: 'Failed', color: 'danger' },
};

function ProjectDetailContent({ params }) {
  const resolvedParams = use(params);
  const router = useRouter();
  const { projects, loaded } = useProjects();
  const me = useCurrentUser();
  const [editing, setEditing] = useState(false); // false, or the form section to open
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const project = projects.find((p) => p.id === resolvedParams.id);
  const canManage = me.role === 'Admin' || me.role === 'QA Lead';

  const { requirements, loaded: requirementsLoaded } = useRequirements(resolvedParams.id, { withJira: true });
  const { runs, loaded: runsLoaded } = useAgentRuns(resolvedParams.id);
  // Runs are newest first, so the first passing run of each requirement is its current test.
  const automatedTests = runs.filter(
    (run, i) => run.status === 'PASSED' && runs.findIndex((r) => r.status === 'PASSED' && r.issueKey === run.issueKey) === i
  );

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError('');
    const result = await deleteProject(project.id);
    if (result.ok) {
      router.push('/dashboard/projects');
      return;
    }
    setDeleting(false);
    setDeleteError(result.data.error ?? 'Could not delete the project');
  };

  if (!loaded) {
    return (
      <>
        <Header title="Project" />
        <div className={styles.content}>
          <p>Loading project...</p>
        </div>
      </>
    );
  }

  if (!project) {
    return (
      <>
        <Header title="Project Not Found" />
        <div className={styles.content}>
          <p>The requested project could not be found.</p>
          <Link href="/dashboard/projects" className="btn btn-primary">Back to Projects</Link>
        </div>
      </>
    );
  }

  return (
    <>
      <Header title={project.name} subtitle={project.description} />
      <div className={styles.content}>
        {/* Breadcrumb */}
        <Link href="/dashboard/projects" className={styles.backLink}>
          <ArrowLeft size={16} /> Back to Projects
        </Link>

        {/* Project Info Header */}
        <div className={styles.projectHeader}>
          <div className={styles.headerLeft}>
            <div className={styles.headerMeta}>
              <span className={`badge badge-${getHealthColor(project.health)}`}>
                {getHealthLabel(project.health)}
              </span>
              {project.language && <span className={styles.techTag}>{project.language}</span>}
              {project.framework && <span className={styles.techTag}>{project.framework}</span>}
              <span className={styles.techTag}>Branch: {project.defaultBranch}</span>
              {project.jiraProjectKey && <span className={styles.techTag}>Jira: {project.jiraProjectKey}</span>}
            </div>
            <div className={styles.repoLinks}>
              {project.repoUrl && (
                <a href={project.repoUrl} className={styles.repoLink} target="_blank" rel="noopener">
                  <GitBranch size={14} /> Source Code <ExternalLink size={12} />
                </a>
              )}
              {project.automationRepoUrl && (
                <a href={project.automationRepoUrl} className={styles.repoLink} target="_blank" rel="noopener">
                  <TestTubes size={14} /> Test Repo <ExternalLink size={12} />
                </a>
              )}
            </div>
          </div>
          <div className={styles.headerActions}>
            {canManage && (
              <>
                <button className="btn btn-secondary" onClick={() => setEditing('general')} id="edit-project-btn">
                  <Pencil size={16} /> Edit
                </button>
                <button className="btn btn-secondary" onClick={() => setConfirmingDelete(true)} id="delete-project-btn">
                  <Trash2 size={16} /> Delete
                </button>
              </>
            )}
            <Link href="/dashboard/qa-agent" className="btn btn-primary">
              <Bot size={16} /> Open QA Agent
            </Link>
          </div>
        </div>

        <Readiness project={project} canManage={canManage} onSetUp={setEditing} />

        {/* Stats Cards: computed from QA Agent runs and requirements */}
        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <TestTubes size={20} style={{ color: 'var(--primary-600)' }} />
            <div className={styles.statInfo}>
              <span className={styles.statValue}>{project.totalTestCases}</span>
              <span className={styles.statLabel}>Automated tests</span>
              <span className={styles.statHint}>Requirements with a passing test</span>
            </div>
          </div>
          <div className={styles.statCard}>
            <TrendingUp size={20} style={{ color: 'var(--success-600)' }} />
            <div className={styles.statInfo}>
              <span className={styles.statValue}>{project.passRate == null ? '—' : `${project.passRate}%`}</span>
              <span className={styles.statLabel}>Pass rate</span>
              <span className={styles.statHint}>{project.passRate == null ? 'No finished runs yet' : 'Of finished QA Agent runs'}</span>
            </div>
          </div>
          <div className={styles.statCard}>
            <Activity size={20} style={{ color: 'var(--warning-600)' }} />
            <div className={styles.statInfo}>
              <span className={styles.statValue}>{project.testCoverage == null ? '—' : `${project.testCoverage}%`}</span>
              <span className={styles.statLabel}>Coverage</span>
              <span className={styles.statHint}>
                {project.totalRequirements ? `${project.totalTestCases} of ${project.totalRequirements} requirements automated` : 'No requirements yet'}
              </span>
            </div>
          </div>
          <div className={styles.statCard}>
            <AlertCircle size={20} style={{ color: 'var(--danger-600)' }} />
            <div className={styles.statInfo}>
              <span className={styles.statValue}>{project.failingRequirements}</span>
              <span className={styles.statLabel}>Need attention</span>
              <span className={styles.statHint}>Requirements whose last run failed</span>
            </div>
          </div>
        </div>

        <div className={styles.detailGrid}>
          {/* Requirements: written in AgentQA or picked up from Jira */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Requirements</h3>
            {!requirementsLoaded ? (
              <p className={styles.emptyText}>Loading…</p>
            ) : requirements.length > 0 ? (
              <div className={styles.itemList}>
                {requirements.slice(0, LIST_SIZE).map((req) => {
                  const status = REQUIREMENT_STATUS[req.status] ?? REQUIREMENT_STATUS.open;
                  return (
                    <div key={req.id} className={styles.listItem}>
                      <div className={styles.listItemTop}>
                        <span className={styles.listItemTitle}>{req.key}: {req.title}</span>
                        <span className={`badge badge-${status.color}`}>{status.label}</span>
                      </div>
                      <div className={styles.listItemMeta}>
                        <span>{req.source === 'jira' ? 'Jira' : 'Written in AgentQA'}</span>
                        <span>Priority: {req.priority}</span>
                        {req.lastRun && (
                          <Link href={`/dashboard/qa-agent/runs/${req.lastRun.id}`} className={styles.metaLink}>
                            Last run {getRelativeTime(req.lastRun.queuedAt)}
                          </Link>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className={styles.emptyText}>
                No requirements yet. Add one, or pick up a Jira ticket, in the <Link href="/dashboard/qa-agent">QA Agent</Link>.
              </p>
            )}
          </div>

          {/* Automated tests: the latest passing run of each requirement */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Automated tests</h3>
            {!runsLoaded ? (
              <p className={styles.emptyText}>Loading…</p>
            ) : automatedTests.length > 0 ? (
              <div className={styles.itemList}>
                {automatedTests.slice(0, LIST_SIZE).map((run) => (
                  <Link key={run.id} href={`/dashboard/qa-agent/runs/${run.id}`} className={`${styles.listItem} ${styles.listLink}`}>
                    <div className={styles.listItemTop}>
                      <span className={styles.listItemTitle}>{run.issueKey}: {run.issueSummary}</span>
                      <span className="badge badge-success">Passed</span>
                    </div>
                    <div className={styles.listItemMeta}>
                      {run.specPath && <span>{run.specPath}</span>}
                      <span>{getRelativeTime(run.finishedAt ?? run.queuedAt)}</span>
                      {run.prUrl && <span><GitPullRequest size={11} /> Pull request</span>}
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <p className={styles.emptyText}>No automated tests yet. They appear here when a QA Agent run passes.</p>
            )}
          </div>

          {/* Recent QA Agent runs */}
          <div className={`${styles.section} ${styles.sectionWide}`}>
            <h3 className={styles.sectionTitle}>Recent QA Agent runs</h3>
            {!runsLoaded ? (
              <p className={styles.emptyText}>Loading…</p>
            ) : runs.length > 0 ? (
              <div className={styles.itemList}>
                {runs.slice(0, LIST_SIZE).map((run) => (
                  <Link key={run.id} href={`/dashboard/qa-agent/runs/${run.id}`} className={`${styles.listItem} ${styles.listLink}`}>
                    <div className={styles.listItemTop}>
                      <span className={styles.listItemTitle}>{run.issueKey}: {run.issueSummary || '—'}</span>
                      <span className={`badge badge-${RUN_STATUS[run.status].color}`}>{RUN_STATUS[run.status].label}</span>
                    </div>
                    <div className={styles.listItemMeta}>
                      <span>{run.source === 'manual' ? 'Requirement' : 'Jira'}</span>
                      {run.startedBy && <span>Started by {run.startedBy.name}</span>}
                      <span>{getRelativeTime(run.queuedAt)}</span>
                      {run.error && <span className={styles.metaError}>{run.error.slice(0, 120)}</span>}
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <p className={styles.emptyText}>No runs yet.</p>
            )}
          </div>
        </div>
      </div>

      {editing && <ProjectFormModal project={project} initialSection={editing} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}

      {confirmingDelete && (
        <div className="modal-overlay" onClick={() => !deleting && setConfirmingDelete(false)}>
          <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-project-title" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 id="delete-project-title">Delete {project.name}?</h3>
            </div>
            <div className="modal-body">
              <p>
                This permanently deletes the project together with its requirements, test cases, CI runs and approvals.
                This cannot be undone.
              </p>
              {deleteError && <p role="alert" style={{ color: 'var(--danger-600)', marginTop: 'var(--space-3)' }}>{deleteError}</p>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setConfirmingDelete(false)} disabled={deleting}>Cancel</button>
              <button className="btn btn-danger" onClick={handleDelete} disabled={deleting} id="btn-confirm-delete-project">
                {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Delete project
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// What the QA Agent can do for this project, with a shortcut to set up what's missing.
function Readiness({ project, canManage, onSetUp }) {
  const items = [
    {
      icon: FileText,
      label: 'Requirements',
      ok: true,
      detail: project.jiraConnected ? `Written in AgentQA, and Jira ${project.jiraProjectKey}` : 'Written in AgentQA',
      action: !project.jiraConnected && { label: 'Connect Jira', section: 'jira' },
    },
    {
      icon: MonitorPlay,
      label: 'Automation',
      ok: Boolean(project.appBaseUrl),
      detail: project.appBaseUrl ? `Tests run against ${project.appBaseUrl.replace(/^https?:\/\//, '')}` : 'Add the app link the tests run against',
      action: !project.appBaseUrl && { label: 'Add app link', section: 'testing' },
    },
    {
      icon: GitPullRequest,
      label: 'Delivery',
      ok: true,
      detail: project.automationRepoUrl ? 'Specs open as pull requests in the test repository' : 'Specs are saved in AgentQA for download',
      action: !project.automationRepoUrl && { label: 'Add test repo', section: 'repos' },
    },
  ];
  return (
    <div className={styles.readiness}>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div key={item.label} className={styles.readyItem}>
            <span className={item.ok ? styles.readyOk : styles.readyMissing}>
              {item.ok ? <CheckCircle2 size={16} /> : <Circle size={16} />}
            </span>
            <div className={styles.readyText}>
              <span className={styles.readyLabel}>
                <Icon size={13} /> {item.label}
              </span>
              <span className={styles.readyDetail}>{item.detail}</span>
            </div>
            {canManage && item.action && (
              <button className="btn btn-ghost btn-sm" onClick={() => onSetUp(item.action.section)}>
                {item.action.label}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function ProjectDetailPage({ params }) {
  return (
    <Suspense fallback={<div className={styles.content}>Loading project details...</div>}>
      <ProjectDetailContent params={params} />
    </Suspense>
  );
}
