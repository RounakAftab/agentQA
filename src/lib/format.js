// Display helpers shared by the dashboard pages.

export function formatDuration(seconds) {
  if (seconds == null) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(dateStr) {
  return `${formatDate(dateStr)} at ${formatTime(dateStr)}`;
}

export function getRelativeTime(dateStr) {
  if (!dateStr) return 'Never';
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

export function getHealthColor(health) {
  switch (health) {
    case 'healthy': return 'success';
    case 'warning': return 'warning';
    case 'critical': return 'danger';
    default: return 'neutral';
  }
}

export function getHealthLabel(health) {
  return { healthy: 'Healthy', warning: 'Warning', critical: 'Critical' }[health] ?? 'No data yet';
}

const STATUS_LABELS = {
  pending: 'Pending',
  pending_review: 'Pending Review',
  in_progress: 'In Progress',
  analyzed: 'Analyzed',
  approved: 'Approved',
  changes_requested: 'Changes Requested',
  rejected: 'Rejected',
  completed: 'Completed',
  passed: 'Passed',
  failed: 'Failed',
  awaiting_approval: 'Awaiting Approval',
  superseded: 'Superseded',
};

const STATUS_COLORS = {
  pending: 'warning',
  pending_review: 'warning',
  in_progress: 'info',
  analyzed: 'primary',
  approved: 'success',
  changes_requested: 'warning',
  rejected: 'danger',
  completed: 'success',
  passed: 'success',
  failed: 'danger',
  awaiting_approval: 'warning',
  superseded: 'neutral',
};

export const getStatusLabel = (status) => STATUS_LABELS[status] || status;
export const getStatusColor = (status) => STATUS_COLORS[status] || 'neutral';
