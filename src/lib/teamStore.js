'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { ROLES, ROLE_PERMISSIONS } from '@/lib/roles';

export { ROLES, ROLE_PERMISSIONS };

// Client-side view of the team, backed by /api/users and /api/auth/me.

const SIGNED_OUT = null;
let state = { users: [], me: SIGNED_OUT, loaded: false, smtpConfigured: false };
let loading = null;
const listeners = new Set();

function setState(next) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export async function refreshTeam() {
  loading = (async () => {
    try {
      const [meRes, usersRes] = await Promise.all([fetch('/api/auth/me'), fetch('/api/users')]);
      const me = meRes.ok ? (await meRes.json()).user : SIGNED_OUT;
      const data = usersRes.ok ? await usersRes.json() : null;
      setState({
        me,
        users: data ? data.users : state.users,
        smtpConfigured: data ? data.smtpConfigured : state.smtpConfigured,
        loaded: true,
      });
    } catch {
      setState({ loaded: true });
    } finally {
      loading = null;
    }
  })();
  return loading;
}

function useTeamState() {
  const snapshot = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => state
  );
  useEffect(() => {
    if (!state.loaded && !loading) refreshTeam();
  }, []);
  return snapshot;
}

// Every user including deleted ones (flagged `deleted`), for resolving names in history.
export function useUserDirectory() {
  return useTeamState().users;
}

// Users that currently exist on the team.
export function useTeamUsers() {
  return useTeamState().users.filter((u) => !u.deleted);
}

// The signed-in user. Empty placeholder fields until the session has loaded.
export function useCurrentUser() {
  return useTeamState().me ?? { id: null, name: '', email: '', role: '', avatar: '' };
}

export function useSmtpConfigured() {
  return useTeamState().smtpConfigured;
}

async function call(method, url, body) {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: 'Could not reach the server. Check your connection.' } };
  }
}

// Each mutation returns { ok, data } and refreshes the shared team list on success.
async function mutate(method, url, body) {
  const result = await call(method, url, body);
  if (result.ok) await refreshTeam();
  return result;
}

export const createUser = (form) => mutate('POST', '/api/users', form);
export const updateUser = (id, form) => mutate('PATCH', `/api/users/${id}`, form);
export const setUserDisabled = (id, disabled) => mutate('PATCH', `/api/users/${id}`, { disabled });
export const deleteUser = (id) => mutate('DELETE', `/api/users/${id}`);
export const resendInvite = (id) => mutate('POST', `/api/users/${id}/invite`);

export async function signOut() {
  await call('POST', '/api/auth/logout');
  setState({ me: SIGNED_OUT, users: [], loaded: false });
  window.location.href = '/';
}
