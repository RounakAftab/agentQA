'use client';

import { useState } from 'react';
import Header from '@/components/Header';
import { getStatusLabel, getStatusColor, getRelativeTime } from '@/lib/format';
import { useProjects } from '@/lib/dataStores';
import { useWorkflowStore, patchRecord } from '@/lib/workflowStore';
import { useUserDirectory, useCurrentUser } from '@/lib/teamStore';
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  MessageSquare,
  Bot,
  User,
  ExternalLink,
  Code2,
  Check,
  X,
  Sparkles,
  Filter,
  CheckSquare,
  Clock,
  Send,
} from 'lucide-react';
import styles from './page.module.css';

export default function ApprovalsPage() {
  const [selectedId, setSelectedId] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [commentText, setCommentText] = useState('');
  const [actionFeedback, setActionFeedback] = useState(null);

  // Requests raised by the AI Workflow page live in the shared store.
  const { approvals: workflowApprovals } = useWorkflowStore();
  const users = useUserDirectory();
  const me = useCurrentUser();
  const { projects } = useProjects();
  const approvalsList = workflowApprovals;
  const selectedApproval = approvalsList.find((a) => a.id === selectedId) ?? approvalsList[0] ?? null;

  const filteredApprovals = approvalsList.filter((item) => {
    if (statusFilter !== 'all' && item.status !== statusFilter) return false;
    if (projectFilter !== 'all' && item.projectId !== projectFilter) return false;
    return true;
  });

  const handleAction = (id, newStatus, message) => {
    const patch = (item) => ({
      ...item,
      status: newStatus,
      approvedBy: newStatus === 'approved' ? me.id : item.approvedBy,
      approvedAt: newStatus === 'approved' ? new Date().toISOString() : item.approvedAt,
    });

    patchRecord('approvals', id, patch(workflowApprovals.find((a) => a.id === id)));

    setActionFeedback({
      type: newStatus === 'approved' ? 'success' : newStatus === 'rejected' ? 'danger' : 'warning',
      text: message,
    });

    setTimeout(() => {
      setActionFeedback(null);
    }, 4000);
  };

  const handleAddComment = (e) => {
    e.preventDefault();
    if (!commentText.trim() || !selectedApproval) return;

    const newComment = {
      user: me.id,
      text: commentText.trim(),
      createdAt: new Date().toISOString(),
    };

    const comments = [...(selectedApproval.comments || []), newComment];
    patchRecord('approvals', selectedApproval.id, { comments });

    setCommentText('');
  };

  const pendingCount = approvalsList.filter((a) => a.status === 'pending').length;

  return (
    <>
      <Header
        title="Human-in-the-Loop Approvals"
        subtitle="Review, test design verification, and code authorization before publication"
      />

      <div className={styles.content}>
        {/* Action feedback alert banner */}
        {actionFeedback && (
          <div className={`${styles.alert} ${styles[`alert_${actionFeedback.type}`]}`}>
            <CheckCircle2 size={18} />
            <span>{actionFeedback.text}</span>
          </div>
        )}

        {/* Filter Bar */}
        <div className={styles.filterBar}>
          <div className={styles.filterLeft}>
            <div className={styles.filterGroup}>
              <Filter size={16} className={styles.filterIcon} />
              <span className={styles.filterLabel}>Status:</span>
              <div className={styles.pillGroup}>
                {[
                  { id: 'all', label: 'All', count: approvalsList.length },
                  { id: 'pending', label: 'Pending', count: pendingCount },
                  { id: 'approved', label: 'Approved', count: approvalsList.filter((a) => a.status === 'approved').length },
                  { id: 'changes_requested', label: 'Changes Req.', count: approvalsList.filter((a) => a.status === 'changes_requested').length },
                  { id: 'rejected', label: 'Rejected', count: approvalsList.filter((a) => a.status === 'rejected').length },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    className={`${styles.filterPill} ${statusFilter === tab.id ? styles.activePill : ''}`}
                    onClick={() => setStatusFilter(tab.id)}
                  >
                    {tab.label}
                    <span className={styles.pillCount}>{tab.count}</span>
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
          {/* Approval Items Queue */}
          <div className={styles.queuePane}>
            <div className={styles.queueHeader}>
              <h3 className={styles.queueTitle}>
                <CheckSquare size={16} /> Review Queue ({filteredApprovals.length})
              </h3>
            </div>
            <div className={styles.queueList}>
              {filteredApprovals.length === 0 ? (
                <div className={styles.emptyQueue}>
                  <AlertCircle size={28} />
                  <p>
                    {approvalsList.length === 0
                      ? 'No approval requests. To review a test the QA Agent wrote, open its run and the pull request it created.'
                      : 'No approval requests match the filter'}
                  </p>
                </div>
              ) : (
                filteredApprovals.map((item) => {
                  const project = projects.find((p) => p.id === item.projectId);
                  const isSelected = selectedApproval?.id === item.id;
                  return (
                    <div
                      key={item.id}
                      className={`${styles.queueCard} ${isSelected ? styles.selectedCard : ''}`}
                      onClick={() => setSelectedId(item.id)}
                      id={`approval-card-${item.id}`}
                    >
                      <div className={styles.cardHeader}>
                        <span className={`badge badge-${getStatusColor(item.status)}`}>
                          {getStatusLabel(item.status)}
                        </span>
                        <span className={styles.confidenceBadge}>
                          <Sparkles size={12} />
                          {Math.round(item.aiConfidence * 100)}% AI Conf.
                        </span>
                      </div>

                      <h4 className={styles.itemTitle}>{item.title}</h4>
                      <div className={styles.itemMeta}>
                        <span className={styles.metaProject}>{project?.name}</span>
                        <span>•</span>
                        <span className={styles.metaTime}>{getRelativeTime(item.createdAt)}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Detailed Review & Diff Viewer */}
          <div className={styles.detailPane}>
            {selectedApproval ? (
              <div className={styles.detailCard}>
                <div className={styles.detailHeader}>
                  <div>
                    <div className={styles.detailBadgeRow}>
                      <span className={`badge badge-${getStatusColor(selectedApproval.status)}`}>
                        {getStatusLabel(selectedApproval.status)}
                      </span>
                      <span className="badge badge-neutral">
                        Type: {selectedApproval.type.replace('_', ' ').toUpperCase()}
                      </span>
                      <span className={styles.confidenceScore}>
                        <Sparkles size={14} /> AI Confidence: {Math.round(selectedApproval.aiConfidence * 100)}%
                      </span>
                    </div>
                    <h2 className={styles.detailTitle}>{selectedApproval.title}</h2>
                    <p className={styles.detailDesc}>{selectedApproval.description}</p>
                  </div>

                  {/* Actions Bar */}
                  {selectedApproval.status === 'pending' && (
                    <div className={styles.actionButtons}>
                      <button
                        className="btn btn-success"
                        onClick={() =>
                          handleAction(selectedApproval.id, 'approved', `Approved "${selectedApproval.title}". Draft PR branch authorized for merge.`)
                        }
                        id="btn-approve"
                      >
                        <Check size={16} /> Approve & Authorize
                      </button>
                      <button
                        className="btn btn-warning"
                        onClick={() =>
                          handleAction(
                            selectedApproval.id,
                            'changes_requested',
                            `Changes requested for "${selectedApproval.title}". AI agent notified to refine code.`
                          )
                        }
                        id="btn-request-changes"
                      >
                        <AlertCircle size={16} /> Request Changes
                      </button>
                      <button
                        className="btn btn-danger"
                        onClick={() =>
                          handleAction(selectedApproval.id, 'rejected', `Rejected "${selectedApproval.title}". Workflow cancelled.`)
                        }
                        id="btn-reject"
                      >
                        <X size={16} /> Reject
                      </button>
                    </div>
                  )}
                </div>

                {/* Metadata Grid */}
                <div className={styles.metaGrid}>
                  <div className={styles.metaCol}>
                    <span className={styles.metaColLabel}>Requested By</span>
                    <span className={styles.metaColVal}>
                      <Bot size={15} className={styles.iconBot} /> {selectedApproval.requestedBy}
                    </span>
                  </div>
                  <div className={styles.metaCol}>
                    <span className={styles.metaColLabel}>Assigned Reviewer</span>
                    <span className={styles.metaColVal}>
                      <User size={15} /> {users.find((u) => u.id === selectedApproval.assignedTo)?.name || 'QA Lead'}
                    </span>
                  </div>
                  <div className={styles.metaCol}>
                    <span className={styles.metaColLabel}>Submitted At</span>
                    <span className={styles.metaColVal}>
                      <Clock size={15} /> {getRelativeTime(selectedApproval.createdAt)}
                    </span>
                  </div>
                  <div className={styles.metaCol}>
                    <span className={styles.metaColLabel}>Target Project</span>
                    <span className={styles.metaColVal}>
                      {projects.find((p) => p.id === selectedApproval.projectId)?.name}
                    </span>
                  </div>
                </div>

                {/* Code Preview & Generated Spec */}
                <div className={styles.codeSection}>
                  <div className={styles.codeHeader}>
                    <div className={styles.codeHeaderLeft}>
                      <Code2 size={16} />
                      <span className={styles.codeFilename}>AI-Generated Test Design / Code Preview</span>
                    </div>
                    <span className="badge badge-info">Syntax Verified</span>
                  </div>
                  <pre className={styles.codeBlock}>
                    <code>{selectedApproval.codePreview || '// No code preview attached for this item.'}</code>
                  </pre>
                </div>

                {/* Comments & Audit Notes */}
                <div className={styles.commentsSection}>
                  <h4 className={styles.commentsTitle}>
                    <MessageSquare size={16} /> Reviewer Feedback & Comments ({selectedApproval.comments?.length || 0})
                  </h4>

                  <div className={styles.commentList}>
                    {(!selectedApproval.comments || selectedApproval.comments.length === 0) ? (
                      <div className={styles.noComments}>No feedback comments posted yet.</div>
                    ) : (
                      selectedApproval.comments.map((c, i) => {
                        const commenter = users.find((u) => u.id === c.user) || { name: 'Reviewer' };
                        return (
                          <div key={i} className={styles.commentItem}>
                            <div className={styles.commentTop}>
                              <span className={styles.commentAuthor}>{commenter.name}</span>
                              <span className={styles.commentDate}>{getRelativeTime(c.createdAt)}</span>
                            </div>
                            <p className={styles.commentBody}>{c.text}</p>
                          </div>
                        );
                      })
                    )}
                  </div>

                  <form className={styles.commentForm} onSubmit={handleAddComment}>
                    <input
                      type="text"
                      className="input"
                      placeholder="Add review comment or instructions for AI agent..."
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      id="input-comment"
                    />
                    <button type="submit" className="btn btn-primary" id="btn-post-comment">
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
