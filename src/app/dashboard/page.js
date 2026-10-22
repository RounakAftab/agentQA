'use client';

import { Suspense, useMemo } from 'react';
import Link from 'next/link';
import Header from '@/components/Header';
import { useProjects, useAuditEvents } from '@/lib/dataStores';
import { useUserDirectory } from '@/lib/teamStore';
import { useWorkflowStore } from '@/lib/workflowStore';
import { getRelativeTime, getHealthColor, getHealthLabel } from '@/lib/format';
import {
  FolderKanban,
  TestTubes,
  Clock,
  TrendingUp,
  Activity,
  ChevronRight,
  Layers,
  BarChart3,
  Plus,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import styles from './page.module.css';

const DAY_MS = 24 * 60 * 60 * 1000;
const pct = (value) => (value == null ? '—' : `${value}%`);

// Events per day for the last 7 days, oldest first.
function weeklyActivity(events) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today.getTime() - (6 - i) * DAY_MS);
    return { key: d.toDateString(), day: d.toLocaleDateString('en-US', { weekday: 'short' }), events: 0 };
  });
  for (const e of events) {
    const slot = days.find((d) => d.key === new Date(e.timestamp).toDateString());
    if (slot) slot.events += 1;
  }
  return days;
}

// Reads the current date, so it renders inside <Suspense> instead of during the prerender.
function WeeklyActivityChart({ events }) {
  const activity = useMemo(() => weeklyActivity(events), [events]);
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={activity}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
        <XAxis dataKey="day" tick={{ fontSize: 12, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
        <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
        <Tooltip />
        <Bar dataKey="events" name="Events" fill="#2563EB" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function DashboardPage() {
  const { projects, loaded } = useProjects();
  const { events: savedEvents } = useAuditEvents();
  const { approvals: workflowApprovals } = useWorkflowStore();
  const users = useUserDirectory();

  const stats = useMemo(() => {
    const withRuns = projects.filter((p) => p.passRate != null);
    return {
      totalTests: projects.reduce((sum, p) => sum + p.totalTestCases, 0),
      avgPassRate: withRuns.length
        ? Math.round((withRuns.reduce((sum, p) => sum + p.passRate, 0) / withRuns.length) * 10) / 10
        : null,
      pending:
        projects.reduce((sum, p) => sum + p.pendingApprovals, 0) +
        workflowApprovals.filter((a) => a.status === 'pending').length,
    };
  }, [projects, workflowApprovals]);

  const recent = savedEvents.slice(0, 8);

  const metricCards = [
    { label: 'Total Projects', value: projects.length, icon: FolderKanban, color: '#2563EB', bg: '#EFF6FF' },
    { label: 'Total Test Cases', value: stats.totalTests, icon: TestTubes, color: '#059669', bg: '#ECFDF5' },
    { label: 'Avg Pass Rate', value: pct(stats.avgPassRate), icon: TrendingUp, color: '#7C3AED', bg: '#F5F3FF' },
    { label: 'Pending Approvals', value: stats.pending, icon: Clock, color: '#D97706', bg: '#FFFBEB' },
  ];

  return (
    <>
      <Header title="Dashboard" subtitle="Overview of all QA operations across projects" />

      <div className={styles.content}>
        <div className={styles.metricsGrid}>
          {metricCards.map((metric, index) => (
            <div key={metric.label} className={`${styles.metricCard} animate-fade-in stagger-${index + 1}`}>
              <div className={styles.metricHeader}>
                <div className={styles.metricIconWrap} style={{ background: metric.bg }}>
                  <metric.icon size={20} style={{ color: metric.color }} />
                </div>
                <span className={styles.metricLabel}>{metric.label}</span>
              </div>
              <div className={styles.metricValue}>{loaded ? metric.value : '—'}</div>
            </div>
          ))}
        </div>

        <div className={styles.chartsRow}>
          <div className={`${styles.chartCard} animate-fade-in stagger-2`}>
            <div className={styles.chartHeader}>
              <div>
                <h3 className={styles.chartTitle}>Pass Rate Trend</h3>
                <p className={styles.chartSubtitle}>Across all projects</p>
              </div>
            </div>
            <div className={styles.chartBody}>
              <div className={styles.emptyBlock} id="trend-empty">
                <TrendingUp size={28} />
                <p>No CI results yet. The trend appears after test runs report to this dashboard.</p>
              </div>
            </div>
          </div>

          <div className={`${styles.chartCard} animate-fade-in stagger-3`}>
            <div className={styles.chartHeader}>
              <div>
                <h3 className={styles.chartTitle}>Weekly Activity</h3>
                <p className={styles.chartSubtitle}>Recorded events per day, last 7 days</p>
              </div>
            </div>
            <div className={styles.chartBody}>
              {savedEvents.length === 0 ? (
                <div className={styles.emptyBlock}>
                  <BarChart3 size={28} />
                  <p>No activity recorded yet.</p>
                </div>
              ) : (
                <Suspense fallback={<div className={styles.emptyBlock}>Loading chart...</div>}>
                  <WeeklyActivityChart events={savedEvents} />
                </Suspense>
              )}
            </div>
          </div>
        </div>

        <div className={styles.bottomRow}>
          <div className={`${styles.projectsSection} animate-fade-in stagger-4`}>
            <div className={styles.sectionHeader}>
              <h3 className={styles.sectionTitle}>
                <Layers size={18} />
                Project Health
              </h3>
              <Link href="/dashboard/projects" className={styles.viewAllLink}>
                View All <ChevronRight size={14} />
              </Link>
            </div>

            {loaded && projects.length === 0 ? (
              <div className={styles.emptyBlock} id="dashboard-no-projects">
                <FolderKanban size={28} />
                <p>No projects yet. Create one to start tracking quality.</p>
                <Link href="/dashboard/projects" className="btn btn-primary">
                  <Plus size={16} /> Go to Projects
                </Link>
              </div>
            ) : (
              <div className={styles.projectList}>
                {projects.map((project) => {
                  const healthColor = getHealthColor(project.health);
                  return (
                    <Link
                      href={`/dashboard/projects/${project.id}`}
                      key={project.id}
                      className={styles.projectCard}
                      id={`project-${project.id}`}
                    >
                      <div className={styles.projectTop}>
                        <div className={styles.projectName}>
                          <span className={`status-dot ${healthColor === 'success' ? 'online' : healthColor === 'warning' ? 'warning' : 'offline'}`} />
                          {project.name}
                        </div>
                        <span className={`badge badge-${healthColor}`}>{getHealthLabel(project.health)}</span>
                      </div>
                      {(project.language || project.framework) && (
                        <div className={styles.projectMeta}>
                          <span>{[project.language, project.framework].filter(Boolean).join(' · ')}</span>
                        </div>
                      )}
                      <div className={styles.projectStats}>
                        <div className={styles.projectStat}>
                          <span className={styles.statValue}>{project.totalTestCases}</span>
                          <span className={styles.statLabel}>Tests</span>
                        </div>
                        <div className={styles.projectStat}>
                          <span className={styles.statValue}>{pct(project.passRate)}</span>
                          <span className={styles.statLabel}>Pass Rate</span>
                        </div>
                        <div className={styles.projectStat}>
                          <span className={styles.statValue}>{pct(project.testCoverage)}</span>
                          <span className={styles.statLabel}>Coverage</span>
                        </div>
                        <div className={styles.projectStat}>
                          <span className={styles.statValue}>{project.pendingApprovals}</span>
                          <span className={styles.statLabel}>Pending</span>
                        </div>
                      </div>
                      <div className={styles.progressBarWrap}>
                        <div className="progress-bar">
                          <div
                            className={`progress-bar-fill ${healthColor === 'success' ? 'success' : healthColor === 'warning' ? 'warning' : 'danger'}`}
                            style={{ width: `${project.passRate ?? 0}%` }}
                          />
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          <div className={`${styles.activitySection} animate-fade-in stagger-5`}>
            <div className={styles.sectionHeader}>
              <h3 className={styles.sectionTitle}>
                <Activity size={18} />
                Recent Activity
              </h3>
              <Link href="/dashboard/audit" className={styles.viewAllLink}>
                Audit trail <ChevronRight size={14} />
              </Link>
            </div>
            <div className={styles.activityList}>
              {recent.length === 0 ? (
                <div className={styles.emptyBlock}>
                  <Activity size={24} />
                  <p>Nothing has happened yet.</p>
                </div>
              ) : (
                recent.map((event) => {
                  const actor = users.find((u) => u.id === event.userId)?.name ?? 'System';
                  const project = projects.find((p) => p.id === event.projectId);
                  const warn = /deleted|disabled|cancelled/.test(event.action);
                  return (
                    <div key={event.id} className={styles.activityItem}>
                      <div className={`${styles.activityIcon} ${warn ? styles.warning : styles.success}`}>
                        <Activity size={16} />
                      </div>
                      <div className={styles.activityContent}>
                        <p className={styles.activityMessage}>
                          <strong>{actor}</strong> · {event.action.replace('.', ' ').replace('_', ' ')} · {event.target}
                        </p>
                        <div className={styles.activityMeta}>
                          <span className={styles.activityProject}>{project?.name ?? 'Platform'}</span>
                          <span className={styles.activityTime}>{getRelativeTime(event.timestamp)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
