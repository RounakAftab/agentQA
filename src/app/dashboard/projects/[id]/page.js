'use client';

import { use, Suspense } from 'react';
import Link from 'next/link';
import Header from '@/components/Header';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import ProjectFormModal from '@/components/ProjectFormModal';
import { useProjects, deleteProject } from '@/lib/dataStores';
import { useCurrentUser } from '@/lib/teamStore';
import { useWorkflowStore } from '@/lib/workflowStore';
import {
  getHealthColor,
  getHealthLabel,
  getRelativeTime,
  getStatusLabel,
  getStatusColor,
} from '@/lib/format';
import {
  ArrowLeft,
  GitBranch,
  ExternalLink,
  Activity,
  TestTubes,
  CheckSquare,
  Workflow,
  Clock,
  TrendingUp,
  Users,
  Pencil,
  Trash2,
  Loader2,
} from 'lucide-react';
import styles from './page.module.css';

function ProjectDetailContent({ params }) {
  const resolvedParams = use(params);
  const router = useRouter();
  const { projects, loaded } = useProjects();
  const me = useCurrentUser();
  const store = useWorkflowStore();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const project = projects.find((p) => p.id === resolvedParams.id);
  const canManage = me.role === 'Admin' || me.role === 'QA Lead';

  // Requirements, test cases and CI runs have no source connected yet, so these stay empty
  // until the GitHub/CI integrations feed them. Workflow runs come from the AI Workflow page.
  const ciRuns = [];
  const projectRequirements = [];
  const projectTestCases = [];
  const workflows = store.runs.filter((run) => run.projectId === resolvedParams.id);

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
              <a href={project.repoUrl} className={styles.repoLink} target="_blank" rel="noopener">
                <GitBranch size={14} /> Source Code <ExternalLink size={12} />
              </a>
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
                <button className="btn btn-secondary" onClick={() => setEditing(true)} id="edit-project-btn">
                  <Pencil size={16} /> Edit
                </button>
                <button className="btn btn-secondary" onClick={() => setConfirmingDelete(true)} id="delete-project-btn">
                  <Trash2 size={16} /> Delete
                </button>
              </>
            )}
            <Link href="/dashboard/workflow" className="btn btn-primary">
              <Workflow size={16} /> Run AI Workflow
            </Link>
          </div>
        </div>

        {/* Stats Cards */}
        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <TestTubes size={20} style={{ color: 'var(--primary-600)' }} />
            <div className={styles.statInfo}>
              <span className={styles.statValue}>{project.totalTestCases}</span>
              <span className={styles.statLabel}>Test Cases</span>
            </div>
          </div>
          <div className={styles.statCard}>
            <TrendingUp size={20} style={{ color: 'var(--success-600)' }} />
            <div className={styles.statInfo}>
              <span className={styles.statValue}>{project.passRate == null ? '—' : `${project.passRate}%`}</span>
              <span className={styles.statLabel}>Pass Rate</span>
            </div>
          </div>
          <div className={styles.statCard}>
            <Activity size={20} style={{ color: 'var(--warning-600)' }} />
            <div className={styles.statInfo}>
              <span className={styles.statValue}>{project.testCoverage == null ? '—' : `${project.testCoverage}%`}</span>
              <span className={styles.statLabel}>Coverage</span>
            </div>
          </div>
          <div className={styles.statCard}>
            <CheckSquare size={20} style={{ color: 'var(--danger-600)' }} />
            <div className={styles.statInfo}>
              <span className={styles.statValue}>{project.pendingApprovals}</span>
              <span className={styles.statLabel}>Pending Approvals</span>
            </div>
          </div>
        </div>

        <div className={styles.detailGrid}>
          {/* Requirements */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Requirements</h3>
            {projectRequirements.length > 0 ? (
              <div className={styles.itemList}>
                {projectRequirements.map(req => (
                  <div key={req.id} className={styles.listItem}>
                    <div className={styles.listItemTop}>
                      <span className={styles.listItemTitle}>{req.title}</span>
                      <span className={`badge badge-${getStatusColor(req.status)}`}>{getStatusLabel(req.status)}</span>
                    </div>
                    <div className={styles.listItemMeta}>
                      <span>{req.source}</span>
                      <span>Priority: {req.priority}</span>
                      {req.generatedTests > 0 && <span>{req.generatedTests} tests generated</span>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.emptyText}>No requirements analyzed yet.</p>
            )}
          </div>

          {/* Recent Test Cases */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Test Cases</h3>
            {projectTestCases.length > 0 ? (
              <div className={styles.itemList}>
                {projectTestCases.map(tc => (
                  <div key={tc.id} className={styles.listItem}>
                    <div className={styles.listItemTop}>
                      <span className={styles.listItemTitle}>{tc.title}</span>
                      <span className={`badge badge-${getStatusColor(tc.status)}`}>{getStatusLabel(tc.status)}</span>
                    </div>
                    <div className={styles.listItemMeta}>
                      <span>{tc.type}</span>
                      {tc.aiGenerated && <span className={styles.aiBadge}>AI Generated</span>}
                      {tc.lastResult && <span className={`badge badge-${tc.lastResult === 'pass' ? 'success' : 'danger'}`}>{tc.lastResult.toUpperCase()}</span>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.emptyText}>No test cases yet.</p>
            )}
          </div>

          {/* Recent CI Runs */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Recent CI Runs</h3>
            {ciRuns.length > 0 ? (
              <div className={styles.itemList}>
                {ciRuns.map(run => (
                  <div key={run.id} className={styles.listItem}>
                    <div className={styles.listItemTop}>
                      <span className={styles.listItemTitle}>{run.commitMessage}</span>
                      <span className={`badge badge-${run.status === 'passed' ? 'success' : 'danger'}`}>{run.status.toUpperCase()}</span>
                    </div>
                    <div className={styles.listItemMeta}>
                      <span>{run.branch}</span>
                      <span>{run.commit}</span>
                      <span>{run.passed}/{run.totalTests} passed</span>
                      <span>{getRelativeTime(run.startedAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.emptyText}>No CI runs yet.</p>
            )}
          </div>

          {/* Active Workflows */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Workflow Runs</h3>
            {workflows.length > 0 ? (
              <div className={styles.itemList}>
                {workflows.map(wf => (
                  <div key={wf.id} className={styles.listItem}>
                    <div className={styles.listItemTop}>
                      <span className={styles.listItemTitle}>{wf.title}</span>
                      <span className={`badge badge-${getStatusColor(wf.status)}`}>{getStatusLabel(wf.status)}</span>
                    </div>
                    <div className={styles.listItemMeta}>
                      <span>{wf.steps.filter(s => s.status === 'completed').length}/{wf.steps.length} steps</span>
                      <span>{getRelativeTime(wf.startedAt)}</span>
                      {wf.checkpoint && <span className={styles.checkpointBadge}>Checkpoint saved</span>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.emptyText}>No workflow runs yet.</p>
            )}
          </div>
        </div>
      </div>

      {editing && <ProjectFormModal project={project} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}

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

export default function ProjectDetailPage({ params }) {
  return (
    <Suspense fallback={<div className={styles.content}>Loading project details...</div>}>
      <ProjectDetailContent params={params} />
    </Suspense>
  );
}
