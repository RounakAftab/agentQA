'use client';

import { useState } from 'react';
import Link from 'next/link';
import Header from '@/components/Header';
import ProjectFormModal from '@/components/ProjectFormModal';
import { useProjects } from '@/lib/dataStores';
import { useCurrentUser } from '@/lib/teamStore';
import { getHealthColor, getHealthLabel } from '@/lib/format';
import { Plus, Search, GitBranch, ChevronRight, FolderKanban, Loader2 } from 'lucide-react';
import styles from './page.module.css';

const pct = (value) => (value == null ? '—' : `${value}%`);

export default function ProjectsPage() {
  const { projects, loaded } = useProjects();
  const me = useCurrentUser();
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);

  const canManage = me.role === 'Admin' || me.role === 'QA Lead';
  const q = query.trim().toLowerCase();
  const visible = q
    ? projects.filter((p) => [p.name, p.description, p.language, p.framework].some((v) => v.toLowerCase().includes(q)))
    : projects;

  return (
    <>
      <Header title="Projects" subtitle="Manage and monitor all QA projects" />
      <div className={styles.content}>
        <div className={styles.topBar}>
          <div className={styles.searchWrap}>
            <Search size={16} className={styles.searchIcon} />
            <input
              type="text"
              placeholder="Search projects..."
              className={styles.searchInput}
              id="project-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className={styles.actions}>
            {canManage && (
              <button className="btn btn-primary" id="add-project-btn" onClick={() => setCreating(true)}>
                <Plus size={16} /> New Project
              </button>
            )}
          </div>
        </div>

        {!loaded ? (
          <div className={styles.empty}>
            <Loader2 size={24} className="animate-spin" />
            <p>Loading projects...</p>
          </div>
        ) : projects.length === 0 ? (
          <div className={styles.empty} id="projects-empty">
            <FolderKanban size={36} />
            <h3>No projects yet</h3>
            <p>
              {canManage
                ? 'Create your first project to start tracking test cases, approvals and CI results.'
                : 'An administrator or QA lead needs to create the first project.'}
            </p>
            {canManage && (
              <button className="btn btn-primary" onClick={() => setCreating(true)}>
                <Plus size={16} /> New Project
              </button>
            )}
          </div>
        ) : visible.length === 0 ? (
          <div className={styles.empty}>
            <Search size={28} />
            <p>No projects match &quot;{query}&quot;.</p>
          </div>
        ) : (
          <div className={styles.projectGrid}>
            {visible.map((project, index) => {
              const healthColor = getHealthColor(project.health);
              return (
                <Link
                  href={`/dashboard/projects/${project.id}`}
                  key={project.id}
                  className={`${styles.projectCard} animate-fade-in stagger-${Math.min(index + 1, 5)}`}
                  id={`project-card-${project.id}`}
                >
                  <div className={styles.cardTop}>
                    <div className={styles.cardStatus}>
                      <span className={`status-dot ${healthColor === 'success' ? 'online' : healthColor === 'warning' ? 'warning' : 'offline'}`} />
                      <span className={`badge badge-${healthColor}`}>{getHealthLabel(project.health)}</span>
                    </div>
                    <ChevronRight size={16} className={styles.cardArrow} />
                  </div>

                  <h3 className={styles.cardTitle}>{project.name}</h3>
                  {project.description && <p className={styles.cardDesc}>{project.description}</p>}

                  {(project.language || project.framework) && (
                    <div className={styles.cardTech}>
                      {project.language && <span className={styles.techBadge}>{project.language}</span>}
                      {project.framework && <span className={styles.techBadge}>{project.framework}</span>}
                    </div>
                  )}

                  <div className={styles.cardStats}>
                    <div className={styles.stat}>
                      <div className={styles.statNum}>{project.totalTestCases}</div>
                      <div className={styles.statName}>Test Cases</div>
                    </div>
                    <div className={styles.stat}>
                      <div className={styles.statNum}>{pct(project.passRate)}</div>
                      <div className={styles.statName}>Pass Rate</div>
                    </div>
                    <div className={styles.stat}>
                      <div className={styles.statNum}>{pct(project.testCoverage)}</div>
                      <div className={styles.statName}>Coverage</div>
                    </div>
                  </div>

                  <div className={styles.cardProgress}>
                    <div className="progress-bar">
                      <div
                        className={`progress-bar-fill ${healthColor === 'success' ? 'success' : healthColor === 'warning' ? 'warning' : 'danger'}`}
                        style={{ width: `${project.passRate ?? 0}%` }}
                      />
                    </div>
                  </div>

                  <div className={styles.cardFooter}>
                    <div className={styles.repoLink}>
                      <GitBranch size={13} />
                      <span>
                        {project.repoUrl
                          ? project.repoUrl.split('/').filter(Boolean).pop()
                          : project.jiraProjectKey
                            ? `Jira ${project.jiraProjectKey}`
                            : 'No repository'}
                      </span>
                    </div>
                    {project.pendingApprovals > 0 && (
                      <span className="badge badge-warning">{project.pendingApprovals} pending</span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {creating && (
        <ProjectFormModal
          onClose={() => setCreating(false)}
          onSaved={() => setCreating(false)}
        />
      )}
    </>
  );
}
