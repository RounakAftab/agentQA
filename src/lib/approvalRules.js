// The review lifecycle, shared by the API (which enforces it) and the Approvals page
// (which only offers the actions allowed here). Statuses are the lowercase enum names.
//
//   pending ──approve──────────▶ approved            (final)
//      │    ──request changes──▶ changes_requested ──reopen──▶ pending
//      │    ──reject───────────▶ rejected          ──reopen──▶ pending
//      └──── a newer run of the same ticket ───────▶ superseded (final, set by the worker)
export const APPROVAL_STATUSES = ['pending', 'approved', 'changes_requested', 'rejected', 'superseded'];

export const APPROVAL_TRANSITIONS = {
  pending: ['approved', 'changes_requested', 'rejected'],
  changes_requested: ['pending'],
  rejected: ['pending'],
  approved: [],
  superseded: [],
};

// Decisions that must say why, so the author knows what to fix.
export const REASON_REQUIRED = ['changes_requested', 'rejected'];

// Roles (labels, as the browser sees them) that may decide. Everyone signed in may comment.
export const APPROVER_ROLES = ['Admin', 'QA Lead'];

export const canTransition = (from, to) => (APPROVAL_TRANSITIONS[from] ?? []).includes(to);
