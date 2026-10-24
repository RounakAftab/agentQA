'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Header from '@/components/Header';
import { getStatusLabel, getStatusColor, getRelativeTime } from '@/lib/format';
import { useProjects, useApprovals, refreshApprovals, decideApproval, commentOnApproval } from '@/lib/dataStores';
import { useCurrentUser } from '@/lib/teamStore';
import { APPROVAL_TRANSITIONS, APPROVER_ROLES, REASON_REQUIRED } from '@/lib/approvalRules';
import {
  CheckCircle2,
  AlertCircle,
  MessageSquare,
  Bot,
  User,
  ExternalLink,
  Code2,
  Check,
  X,
  Filter,
  CheckSquare,
  Clock,
  Send,
  RotateCcw,
  GitPullRequest,
  ShieldCheck,
  Lock,
} from 'lucide-react';
import styles from './page.module.css';

const TYPE_LABELS = {
  automation_script: 'Automation script',
  test_design: 'Test design',
  draft_pr: 'Draft PR',
};

// What each decision is called on its button, and what the reviewer is told afterwards.
const ACTIONS = {
  approved: { label: 'Approve', icon: Check, className: 'btn-success', done: 'Approved. The spec is signed off.' },
  changes_requested: { label: 'Request changes', icon: AlertCircle, className: 'btn-secondary', done: 'Changes requested. Your note is on the item.' },
  rejected: { label: 'Reject', icon: X, className: 'btn-danger', done: 'Rejected. Your reason is on the item.' },
  pending: { label: 'Reopen', icon: RotateCcw, className: 'btn-secondary', done: 'Reopened for review.' },
};

const STATUS_TABS = [
  { id: 'pending', label: 'Pending' },
  { id: 'changes_requested', label: 'Changes Req.' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'superseded', label: 'Superseded' },
  { id: 'all', label: 'All' },
];

export default function ApprovalsPage() {
  const [selectedId, setSelectedId] = useState(null);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [projectFilter, setProjectFilter] = useState('all');
  const [commentText, setCommentText] = useState('');
  // A decision that needs a reason opens an inline form first: { status, reason }.
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const { approvals, loaded } = useApprovals();
  const { projects } = useProjects();
  const me = useCurrentUser();
  const canDecide = APPROVER_ROLES.includes(me.role);

  // The list is cached across pages; fetch again so a run that just passed shows up.
  useEffect(() => {
    refreshApprovals();
  }, []);

  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 5000);
    return () => clearTimeout(timer);
  }, [feedback]);

  const inProject = approvals.filter((a) => projectFilter === 'all' || a.projectId === projectFilter);
  const filteredApprovals = inProject.filter((a) => statusFilter === 'all' || a.status === statusFilter);
  const countFor = (status) => (status === 'all' ? inProject.length : inProject.filter((a) => a.status === status).length);

  // Only show an item that is visible in the queue, so the detail never contradicts the filter.
  const selectedApproval = filteredApprovals.find((a) => a.id === selectedId) ?? filteredApprovals[0] ?? null;
  const nextStatuses = selectedApproval ? APPROVAL_TRANSITIONS[selectedApproval.status] ?? [] : [];

  const select = (id) => {
    setSelectedId(id);
    setDraft(null);
  };

  const submitDecision = async (status, reason) => {
    if (!selectedApproval || busy) return;
    setBusy(true);
    const { ok, data } = await decideApproval(selectedApproval.id, status, reason);
    setBusy(false);
    if (ok) {
      setDraft(null);
      // The decided item leaves the current tab, so the queue moves on to the next one.
      setFeedback({ type: 'success', text: ACTIONS[status].done });
    } else {
      setFeedback({ type: 'danger', text: data.error || 'Could not save the decision.' });
    }
  };

  const handleDecision = (status) => {
    if (REASON_REQUIRED.includes(status)) setDraft({ status, reason: '' });
    else submitDecision(status);
  };

  const handleAddComment = async (e) => {
    e.preventDefault();
    if (!commentText.trim() || !selectedApproval || busy) return;
    setBusy(true);
    const { ok, data } = await commentOnApproval(selectedApproval.id, commentText.trim());
    setBusy(false);
    if (ok) setCommentText('');
    else setFeedback({ type: 'danger', text: data.error || 'Could not post the comment.' });
  };

  const projectName = (item) => projects.find((p) => p.id === item.projectId)?.name ?? item.projectName ?? 'Unknown project';
  const fileName = selectedApproval?.run?.specPath?.split('/').pop();

  return (
    <>
      <Header title="Approvals" subtitle="Review and sign off the Playwright tests the QA Agent wrote and verified" />

      <div className={styles.content}>
        {feedback && (
          <div className={`${styles.alert} ${styles[`alert_${feedback.type}`]}`} role="status">
            {feedback.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
            <span>{feedback.text}</span>
          </div>
        )}

        {/* Filter Bar */}
        <div className={styles.filterBar}>
          <div className={styles.filterLeft}>
            <div className={styles.filterGroup}>
              <Filter size={16} className={styles.filterIcon} />
              <span className={styles.filterLabel}>Status:</span>
              <div className={styles.pillGroup}>
                {STATUS_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    className={`${styles.filterPill} ${statusFilter === tab.id ? styles.activePill : ''}`}
                    onClick={() => {
                      setStatusFilter(tab.id);
                      setDraft(null);
                    }}
                    id={`approvals-tab-${tab.id}`}
                  >
                    {tab.label}
                    <span className={styles.pillCount}>{countFor(tab.id)}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.selectWrap}>
              <select
                className="select"
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                id="approvals-project-filter"
              >
                <option value="all">All Projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Master-Detail Split Screen */}
        <div className={styles.splitLayout}>
          <div className={styles.queuePane}>
            <div className={styles.queueHeader}>
              <h3 className={styles.queueTitle}>
                <CheckSquare size={16} /> Review Queue ({filteredApprovals.length})
              </h3>
            </div>
            <div className={styles.queueList}>
              {!loaded ? (
                <div className={styles.emptyQueue}>
                  <p>Loading approvals…</p>
                </div>
              ) : filteredApprovals.length === 0 ? (
                <div className={styles.emptyQueue}>
                  <AlertCircle size={28} />
                  <p>
                    {approvals.length === 0
                      ? 'Nothing to review yet. When a QA Agent run passes, its test lands here for sign-off.'
                      : statusFilter === 'pending'
                        ? 'All caught up. No tests are waiting for review.'
                        : 'No approvals match the filter.'}
                  </p>
                </div>
              ) : (
                filteredApprovals.map((item) => (
                  <div
                    key={item.id}
                    className={`${styles.queueCard} ${selectedApproval?.id === item.id ? styles.selectedCard : ''}`}
                    onClick={() => select(item.id)}
                    id={`approval-card-${item.id}`}
                  >
                    <div className={styles.cardHeader}>
                      <span className={`badge badge-${getStatusColor(item.status)}`}>{getStatusLabel(item.status)}</span>
                      {item.run && <span className={styles.confidenceBadge}>{item.run.issueKey}</span>}
                    </div>
                    <h4 className={styles.itemTitle}>{item.title}</h4>
                    <div className={styles.itemMeta}>
                      <span className={styles.metaProject}>{projectName(item)}</span>
                      <span>•</span>
                      <span className={styles.metaTime}>{getRelativeTime(item.createdAt)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className={styles.detailPane}>
            {selectedApproval ? (
              <div className={styles.detailCard}>
                <div className={styles.detailHeader}>
                  <div>
                    <div className={styles.detailBadgeRow}>
                      <span className={`badge badge-${getStatusColor(selectedApproval.status)}`}>
                        {getStatusLabel(selectedApproval.status)}
                      </span>
                      <span className="badge badge-neutral">{TYPE_LABELS[selectedApproval.type] ?? selectedApproval.type}</span>
                      {selectedApproval.run && (
                        <span className={styles.confidenceScore}>
                          <ShieldCheck size={14} /> Verified passing by the worker
                        </span>
                      )}
                    </div>
                    <h2 className={styles.detailTitle}>{selectedApproval.title}</h2>
                    <p className={styles.detailDesc}>{selectedApproval.description}</p>
                    {selectedApproval.run && (
                      <div className={styles.linkRow}>
                        <Link href={`/dashboard/qa-agent/runs/${selectedApproval.run.id}`} className="btn btn-ghost btn-sm">
                          <Bot size={14} /> Open run
                        </Link>
                        {selectedApproval.run.prUrl && (
                          <a href={selectedApproval.run.prUrl} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
                            <GitPullRequest size={14} /> Pull request <ExternalLink size={12} />
                          </a>
                        )}
                      </div>
                    )}
                  </div>

                  {nextStatuses.length > 0 &&
                    (canDecide ? (
                      <div className={styles.actionButtons}>
                        {nextStatuses.map((status) => {
                          const { label, icon: Icon, className } = ACTIONS[status];
                          return (
                            <button
                              key={status}
                              className={`btn ${className}`}
                              onClick={() => handleDecision(status)}
                              disabled={busy || draft?.status === status}
                              id={`btn-${status.replace('_', '-')}`}
                            >
                              <Icon size={16} /> {label}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <span className={styles.lockedNote}>
                        <Lock size={14} /> Only Admins and QA Leads can decide
                      </span>
                    ))}
                </div>

                {draft && (
                  <form
                    className={styles.decisionForm}
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (draft.reason.trim()) submitDecision(draft.status, draft.reason.trim());
                    }}
                  >
                    <label htmlFor="decision-reason" className={styles.metaColLabel}>
                      {draft.status === 'rejected' ? 'Why is this test rejected?' : 'What should change?'}
                    </label>
                    <textarea
                      id="decision-reason"
                      className="input"
                      rows={3}
                      autoFocus
                      value={draft.reason}
                      onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
                      placeholder="This note is saved on the item and in the audit trail."
                    />
                    <div className={styles.actionButtons}>
                      <button type="submit" className={`btn ${ACTIONS[draft.status].className}`} disabled={busy || !draft.reason.trim()}>
                        {ACTIONS[draft.status].label}
                      </button>
                      <button type="button" className="btn btn-ghost" onClick={() => setDraft(null)} disabled={busy}>
                        Cancel
                      </button>
                    </div>
                  </form>
                )}

                <div className={styles.metaGrid}>
                  <div className={styles.metaCol}>
                    <span className={styles.metaColLabel}>Requested By</span>
                    <span className={styles.metaColVal}>
                      <Bot size={15} className={styles.iconBot} /> {selectedApproval.requestedBy}
                    </span>
                  </div>
                  <div className={styles.metaCol}>
                    <span className={styles.metaColLabel}>{selectedApproval.decidedBy ? 'Decided By' : 'Reviewer'}</span>
                    <span className={styles.metaColVal}>
                      <User size={15} />{' '}
                      {selectedApproval.decidedBy?.name ??
                        (selectedApproval.status === 'superseded' ? 'Replaced by a newer run' : selectedApproval.assignedTo?.name ?? 'Any QA Lead or Admin')}
                    </span>
                  </div>
                  <div className={styles.metaCol}>
                    <span className={styles.metaColLabel}>{selectedApproval.decidedAt ? 'Decided' : 'Submitted'}</span>
                    <span className={styles.metaColVal}>
                      <Clock size={15} /> {getRelativeTime(selectedApproval.decidedAt ?? selectedApproval.createdAt)}
                    </span>
                  </div>
                  <div className={styles.metaCol}>
                    <span className={styles.metaColLabel}>Target Project</span>
                    <span className={styles.metaColVal}>{projectName(selectedApproval)}</span>
                  </div>
                </div>

                <div className={styles.codeSection}>
                  <div className={styles.codeHeader}>
                    <div className={styles.codeHeaderLeft}>
                      <Code2 size={16} />
                      <span className={styles.codeFilename}>{fileName ?? 'Generated test'}</span>
                    </div>
                    {selectedApproval.run && <span className="badge badge-success">Passed</span>}
                  </div>
                  <pre className={styles.codeBlock}>
                    <code>{selectedApproval.codePreview || '// No code attached to this item.'}</code>
                  </pre>
                </div>

                <div className={styles.commentsSection}>
                  <h4 className={styles.commentsTitle}>
                    <MessageSquare size={16} /> Reviewer Feedback & Comments ({selectedApproval.comments.length})
                  </h4>

                  <div className={styles.commentList}>
                    {selectedApproval.comments.length === 0 ? (
                      <div className={styles.noComments}>No feedback comments posted yet.</div>
                    ) : (
                      selectedApproval.comments.map((c) => (
                        <div key={c.id} className={styles.commentItem}>
                          <div className={styles.commentTop}>
                            <span className={styles.commentAuthor}>{c.user?.name ?? 'Reviewer'}</span>
                            <span className={styles.commentDate}>{getRelativeTime(c.createdAt)}</span>
                          </div>
                          <p className={styles.commentBody}>{c.text}</p>
                        </div>
                      ))
                    )}
                  </div>

                  <form className={styles.commentForm} onSubmit={handleAddComment}>
                    <input
                      type="text"
                      className="input"
                      placeholder="Add a review comment..."
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      id="input-comment"
                    />
                    <button type="submit" className="btn btn-primary" id="btn-post-comment" disabled={busy || !commentText.trim()}>
                      <Send size={15} /> Send
                    </button>
                  </form>
                </div>
              </div>
            ) : (
              <div className={styles.detailEmpty}>
                <CheckSquare size={36} />
                <p>Select an item from the queue to review</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
