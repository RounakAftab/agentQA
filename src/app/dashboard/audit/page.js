'use client';

import { useEffect, useState } from 'react';
import Header from '@/components/Header';
import { formatDateTime, getRelativeTime } from '@/lib/format';
import { useProjects, useAuditEvents, refreshAudit } from '@/lib/dataStores';
import { useWorkflowStore } from '@/lib/workflowStore';
import { useUserDirectory } from '@/lib/teamStore';
import {
  ScrollText,
  ShieldCheck,
  Search,
  Filter,
  Download,
  Key,
  User,
  Bot,
  Activity,
  CheckCircle2,
  AlertTriangle,
  FolderKanban,
  Lock,
  FileCheck,
  Check,
} from 'lucide-react';
import styles from './page.module.css';

export default function AuditTrailPage() {
  const { audit: workflowEvents } = useWorkflowStore();
  const users = useUserDirectory();
  const { projects } = useProjects();
  const { events: savedEvents, loaded } = useAuditEvents();

  // Always show the latest log when this page opens.
  useEffect(() => {
    refreshAudit();
  }, []);

  // Saved events come from the database; workflow-simulation events live in this browser.
  const eventsList = [...workflowEvents, ...savedEvents].sort(
    (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [exportNotice, setExportNotice] = useState(false);

  const filteredEvents = eventsList.filter((event) => {
    if (actionFilter !== 'all') {
      if (!event.action.startsWith(actionFilter)) return false;
    }
    if (projectFilter !== 'all' && event.projectId !== projectFilter) {
      return false;
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const user = users.find((u) => u.id === event.userId);
      return (
        event.action.toLowerCase().includes(q) ||
        event.target.toLowerCase().includes(q) ||
        event.details.toLowerCase().includes(q) ||
        (user && user.name.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const handleExport = (format) => {
    const rows = filteredEvents.map((e) => ({
      timestamp: e.timestamp,
      actor: users.find((u) => u.id === e.userId)?.name ?? 'System',
      action: e.action,
      target: e.target,
      details: e.details,
      project: projects.find((p) => p.id === e.projectId)?.name ?? '',
    }));
    const quote = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const content =
      format === 'json'
        ? JSON.stringify(rows, null, 2)
        : [Object.keys(rows[0] ?? { timestamp: '', actor: '', action: '', target: '', details: '', project: '' }).join(',')]
            .concat(rows.map((r) => Object.values(r).map(quote).join(',')))
            .join('\n');
    const url = URL.createObjectURL(new Blob([content], { type: format === 'json' ? 'application/json' : 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `audit-log.${format}`;
    link.click();
    URL.revokeObjectURL(url);
    setExportNotice(`Exported ${rows.length} event(s) as ${format.toUpperCase()}.`);
    setTimeout(() => setExportNotice(false), 4000);
  };

  const getActionIcon = (action) => {
    if (action.startsWith('user.')) return <Key size={15} className={styles.iconKeycloak} />;
    if (action.startsWith('approval.')) return <FileCheck size={15} className={styles.iconApproval} />;
    if (action.startsWith('workflow.')) return <Bot size={15} className={styles.iconWorkflow} />;
    if (action.startsWith('ci.')) return <Activity size={15} className={styles.iconCI} />;
    return <FolderKanban size={15} className={styles.iconProject} />;
  };

  return (
    <>
      <Header
        title="Security & Enterprise Audit Trail"
        subtitle="A record of sign-ins, user changes and project changes"
      />

      <div className={styles.content}>
        {/* Compliance Banner */}
        <div className={styles.complianceBanner}>
          <div className={styles.complianceLeft}>
            <div className={styles.complianceIcon}>
              <ShieldCheck size={24} />
            </div>
            <div>
              <h4 className={styles.complianceTitle}>Audit trail</h4>
              <p className={styles.complianceDesc}>
                Sign-ins, invitations, user changes and project changes are saved to the database as they happen.
                Use the filters to narrow the list, then export it as CSV or JSON.
              </p>
            </div>
          </div>
          <div className={styles.complianceBadges}>
            <span className={styles.secBadge}><Lock size={12} /> Password sign-in</span>
            <span className={styles.secBadge}><ShieldCheck size={12} /> Role-based access</span>
          </div>
        </div>

        {exportNotice && (
          <div className={styles.alertNotice}>
            <Check size={16} />
            <span>{exportNotice}</span>
          </div>
        )}

        {/* Filter & Action Controls */}
        <div className={styles.controlBar}>
          <div className={styles.searchBox}>
            <Search size={16} className={styles.searchIcon} />
            <input
              type="text"
              className="input"
              placeholder="Search audit trail by user, action, target, or details..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              id="audit-search"
            />
          </div>

          <div className={styles.filterActions}>
            <select
              className="select"
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              id="audit-action-filter"
            >
              <option value="all">All Action Types</option>
              <option value="user">User & Keycloak Auth</option>
              <option value="approval">Human Approvals</option>
              <option value="workflow">AI Workflows</option>
              <option value="ci">CI Executions</option>
              <option value="project">Project Updates</option>
            </select>

            <select
              className="select"
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              id="audit-project-filter"
            >
              <option value="all">All Projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>

            <div className={styles.btnExportGroup}>
              <button
                className="btn btn-secondary"
                onClick={() => handleExport('csv')}
                title="Download CSV for compliance reporting"
                id="btn-export-csv"
              >
                <Download size={14} /> Export CSV
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => handleExport('json')}
                title="Download raw JSON audit records"
                id="btn-export-json"
              >
                JSON
              </button>
            </div>
          </div>
        </div>

        {/* Audit Table */}
        <div className={styles.tableCard}>
          <div className={styles.tableCardHeader}>
            <h3 className={styles.tableTitle}>
              <ScrollText size={16} /> Security Event Stream ({filteredEvents.length} events logged)
            </h3>
            <span className={styles.liveSyncTag}>
              <span className={styles.dotPulse} /> Saved to database
            </span>
          </div>

          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Actor</th>
                  <th>Action Event</th>
                  <th>Target Resource</th>
                  <th>Details & Context</th>
                  <th>Project</th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.length === 0 ? (
                  <tr>
                    <td colSpan="6" className={styles.emptyTable}>
                      {!loaded
                        ? 'Loading audit events...'
                        : eventsList.length === 0
                          ? 'No activity recorded yet. Events appear here as people sign in and manage users and projects.'
                          : 'No audit events matching criteria.'}
                    </td>
                  </tr>
                ) : (
                  filteredEvents.map((event) => {
                    const user = users.find((u) => u.id === event.userId);
                    const project = projects.find((p) => p.id === event.projectId);

                    return (
                      <tr key={event.id} id={`audit-row-${event.id}`}>
                        <td className={styles.cellTime}>
                          <div className={styles.timeMain}>{getRelativeTime(event.timestamp)}</div>
                          <div className={styles.timeSub}>{formatDateTime(event.timestamp)}</div>
                        </td>

                        <td>
                          {user ? (
                            <div className={styles.actorWrap}>
                              <span className={styles.userAvatar}>{user.avatar}</span>
                              <div>
                                <div className={styles.actorName}>{user.name}</div>
                                <div className={styles.actorRole}>{user.role}</div>
                              </div>
                            </div>
                          ) : (
                            <div className={styles.actorWrap}>
                              <span className={styles.botAvatar}><Bot size={14} /></span>
                              <div>
                                <div className={styles.actorName}>System</div>
                                <div className={styles.actorRole}>Automated</div>
                              </div>
                            </div>
                          )}
                        </td>

                        <td>
                          <div className={styles.actionWrap}>
                            {getActionIcon(event.action)}
                            <span className={styles.actionBadge}>{event.action}</span>
                          </div>
                        </td>

                        <td className={styles.targetCell}>
                          <strong>{event.target}</strong>
                        </td>

                        <td className={styles.detailsCell}>
                          {event.details}
                        </td>

                        <td>
                          {project ? (
                            <span className="badge badge-neutral">{project.name}</span>
                          ) : (
                            <span className="badge badge-neutral">Global / System</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
