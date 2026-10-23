// Small helpers shared by the API route handlers.
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/session';
import { ROLE_LABEL } from '@/lib/roles';

export const json = (body, status = 200, headers) => Response.json(body, { status, headers });

export async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? body : {};
  } catch {
    return {};
  }
}

export function initialsFor(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

// What the browser is allowed to see about a user. Never includes the password hash.
export function publicUser(user) {
  const status = user.deletedAt ? 'deleted' : user.disabled ? 'disabled' : user.passwordHash ? 'active' : 'invited';
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: ROLE_LABEL[user.role],
    avatar: user.avatar ?? initialsFor(user.name),
    status,
    disabled: user.disabled,
    deleted: Boolean(user.deletedAt),
    lastActive: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
  };
}

// Writes an audit entry. A failure to log must never break the action being logged.
export async function recordAudit({ userId = null, projectId = null, action, target, details = '' }) {
  try {
    await db.auditEvent.create({ data: { userId, projectId, action, target, details } });
  } catch (err) {
    console.error('[audit] could not record event', action, err);
  }
}

// Resolves to { user } for a signed-in user, or { response } to return immediately.
export async function requireUser() {
  const user = await getSessionUser();
  return user ? { user } : { response: json({ error: 'Not signed in' }, 401) };
}

export async function requireAdmin() {
  const result = await requireUser();
  if (result.response) return result;
  if (result.user.role !== 'ADMIN') {
    return { response: json({ error: 'Only administrators can manage users' }, 403) };
  }
  return result;
}

// Admins and QA Leads manage projects.
export async function requireProjectManager() {
  const result = await requireUser();
  if (result.response) return result;
  if (!['ADMIN', 'QA_LEAD'].includes(result.user.role)) {
    return { response: json({ error: 'Only administrators and QA leads can manage projects' }, 403) };
  }
  return result;
}

// Admins, QA Leads and QA Engineers start and cancel QA Agent runs.
export async function requireAgentOperator() {
  const result = await requireUser();
  if (result.response) return result;
  if (!['ADMIN', 'QA_LEAD', 'QA_ENGINEER'].includes(result.user.role)) {
    return { response: json({ error: 'Only administrators, QA leads and QA engineers can run the QA Agent' }, 403) };
  }
  return result;
}

// True when changing or removing `user` would leave the platform without an active admin.
export async function isLastActiveAdmin(user) {
  if (user.role !== 'ADMIN' || user.deletedAt || user.disabled || !user.passwordHash) return false;
  const others = await db.user.count({
    where: { role: 'ADMIN', deletedAt: null, disabled: false, passwordHash: { not: null }, id: { not: user.id } },
  });
  return others === 0;
}
