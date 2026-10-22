'use client';

import { useState } from 'react';
import Header from '@/components/Header';
import {
  ROLES,
  ROLE_PERMISSIONS,
  useTeamUsers,
  useCurrentUser,
  useSmtpConfigured,
  createUser,
  updateUser,
  setUserDisabled,
  deleteUser,
  resendInvite,
} from '@/lib/teamStore';
import { validateUserInput } from '@/lib/validation';
import {
  Shield,
  GitBranch,
  Users,
  Check,
  Save,
  UserPlus,
  Pencil,
  UserX,
  UserCheck,
  Trash2,
  X,
  Mail,
  Copy,
  Loader2,
} from 'lucide-react';
import styles from './page.module.css';

const EMPTY_FORM = { mode: 'create', id: null, name: '', email: '', role: '' };

const STATUS_BADGE = {
  active: { className: 'badge-success', label: 'Active' },
  invited: { className: 'badge-warning', label: 'Invited' },
  disabled: { className: 'badge-neutral', label: 'Disabled' },
};

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('enterprise');
  const [saveNotice, setSaveNotice] = useState(null);
  const [userForm, setUserForm] = useState(null);
  const [formErrors, setFormErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [actionError, setActionError] = useState('');
  const [inviteInfo, setInviteInfo] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const teamUsers = useTeamUsers();
  const me = useCurrentUser();
  const smtpConfigured = useSmtpConfigured();
  const isAdmin = me.role === 'Admin';

  // Form states
  const [keycloakConfig, setKeycloakConfig] = useState({
    serverUrl: '',
    realm: '',
    clientId: '',
    clientSecret: '',
    enforceMfa: false,
    sessionTimeoutMins: 60,
  });

  const [githubConfig, setGithubConfig] = useState({
    orgName: '',
    defaultReviewerTeam: '',
    autoCreateDraftPr: false,
    ciWebhookUrl: '',
    requireApprovalBeforePr: true,
  });

  const notify = (message) => {
    setSaveNotice(message);
    setTimeout(() => setSaveNotice(null), 4000);
  };

  const handleSave = (sectionName) => {
    notify(`${sectionName} settings are not stored yet: integrations have no backend, so this applies only until you leave the page.`);
  };

  // ---- Team management ----

  const openCreate = () => {
    setFormErrors({});
    setFormError('');
    setUserForm(EMPTY_FORM);
  };

  const openEdit = (u) => {
    setFormErrors({});
    setFormError('');
    setUserForm({ mode: 'edit', id: u.id, name: u.name, email: u.email, role: u.role });
  };

  const closeForm = () => {
    if (!submitting) setUserForm(null);
  };

  // Shows what happened to the invitation email. Without SMTP (development) the link is
  // shown so the invitation can still be followed.
  const showInvite = (message, devLink) => setInviteInfo({ message, devLink });

  const submitUserForm = async (e) => {
    e.preventDefault();
    const { errors } = validateUserInput(userForm);
    setFormErrors(errors);
    setFormError('');
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    const result =
      userForm.mode === 'create'
        ? await createUser(userForm)
        : await updateUser(userForm.id, userForm);
    setSubmitting(false);

    if (!result.ok) {
      setFormErrors(result.data.fieldErrors ?? {});
      setFormError(result.data.fieldErrors ? '' : result.data.error ?? 'Something went wrong');
      return;
    }

    setUserForm(null);
    const { data } = result;
    if (userForm.mode === 'create') {
      if (data.inviteError) {
        setActionError(data.inviteError);
      } else if (data.invite?.mode === 'smtp') {
        notify(`Invitation sent to ${data.user.email}.`);
      } else {
        showInvite(`${data.user.name} was added. Email isn't configured, so nothing was sent.`, data.invite?.devLink);
      }
    } else if (data.reinvited) {
      if (data.devLink) showInvite(`${data.user.name} was updated. Email isn't configured, so nothing was sent.`, data.devLink);
      else notify(`${data.user.name} was updated and a new invitation was sent to ${data.user.email}.`);
    } else {
      if (data.inviteError) setActionError(data.inviteError);
      else notify(`${data.user.name} was updated.`);
    }
  };

  const toggleDisabled = async (u) => {
    setBusyId(u.id);
    setActionError('');
    const result = await setUserDisabled(u.id, !u.disabled);
    setBusyId(null);
    if (!result.ok) return setActionError(result.data.error ?? 'Could not update the user');
    notify(u.disabled ? `${u.name} was re-enabled.` : `${u.name} was disabled and can no longer sign in.`);
  };

  const sendInvite = async (u) => {
    setBusyId(u.id);
    setActionError('');
    const result = await resendInvite(u.id);
    setBusyId(null);
    if (!result.ok) return setActionError(result.data.error ?? 'Could not send the invitation');
    if (result.data.invite?.devLink) showInvite(`New invitation for ${u.name}. Email isn't configured, so nothing was sent.`, result.data.invite.devLink);
    else notify(`Invitation re-sent to ${u.email}.`);
  };

  const confirmDelete = async () => {
    setBusyId(deleteTarget.id);
    setActionError('');
    const result = await deleteUser(deleteTarget.id);
    setBusyId(null);
    const name = deleteTarget.name;
    setDeleteTarget(null);
    if (!result.ok) return setActionError(result.data.error ?? 'Could not delete the user');
    notify(`${name} was deleted.`);
  };

  const copyLink = async (link) => {
    try {
      await navigator.clipboard.writeText(link);
      notify('Invitation link copied.');
    } catch {
      notify('Select the link and copy it manually.');
    }
  };

  return (
    <>
      <Header
        title="Enterprise Configuration & Security"
        subtitle="Manage Keycloak SSO, LangGraph checkpoints, GitHub connections, and RBAC permissions"
      />

      <div className={styles.content}>
        {saveNotice && (
          <div className={styles.alertSuccess}>
            <Check size={16} />
            <span>{saveNotice}</span>
          </div>
        )}

        <div className={styles.settingsLayout}>
          {/* Navigation Tabs */}
          <div className={styles.tabNav}>
            <button
              className={`${styles.tabBtn} ${activeTab === 'enterprise' ? styles.activeTab : ''}`}
              onClick={() => setActiveTab('enterprise')}
              id="tab-enterprise"
            >
              <Shield size={16} /> Keycloak SSO & Security
            </button>
            <button
              className={`${styles.tabBtn} ${activeTab === 'github' ? styles.activeTab : ''}`}
              onClick={() => setActiveTab('github')}
              id="tab-github"
            >
              <GitBranch size={16} /> GitHub & CI Runners
            </button>
            <button
              className={`${styles.tabBtn} ${activeTab === 'team' ? styles.activeTab : ''}`}
              onClick={() => setActiveTab('team')}
              id="tab-team"
            >
              <Users size={16} /> Team & RBAC Roles
            </button>
          </div>

          {/* Tab Content Panes */}
          <div className={styles.tabContentPane}>
            {/* 1. Keycloak & Enterprise Security */}
            {activeTab === 'enterprise' && (
              <div className={styles.panel}>
                <div className={styles.panelHeader}>
                  <div className={styles.panelTitleGroup}>
                    <Shield size={20} className={styles.panelIconBlue} />
                    <div>
                      <h3 className={styles.panelTitle}>Keycloak Enterprise SSO & Identity Provider</h3>
                      <p className={styles.panelDesc}>Configure OpenID Connect / OAuth 2.0 authentication realm and token validation policies.</p>
                    </div>
                  </div>
                  <span className="badge badge-neutral">Not configured</span>
                </div>

                <div className={styles.formGrid}>
                  <div className={styles.formGroup}>
                    <label className={styles.label}>Auth Server URL</label>
                    <input
                      type="text"
                      className="input"
                      value={keycloakConfig.serverUrl}
                      onChange={(e) => setKeycloakConfig({ ...keycloakConfig, serverUrl: e.target.value })}
                      id="keycloak-server-url"
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.label}>Realm Name</label>
                    <input
                      type="text"
                      className="input"
                      value={keycloakConfig.realm}
                      onChange={(e) => setKeycloakConfig({ ...keycloakConfig, realm: e.target.value })}
                      id="keycloak-realm"
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.label}>Client ID</label>
                    <input
                      type="text"
                      className="input"
                      value={keycloakConfig.clientId}
                      onChange={(e) => setKeycloakConfig({ ...keycloakConfig, clientId: e.target.value })}
                      id="keycloak-client-id"
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.label}>Client Secret</label>
                    <input
                      type="password"
                      className="input"
                      value={keycloakConfig.clientSecret}
                      onChange={(e) => setKeycloakConfig({ ...keycloakConfig, clientSecret: e.target.value })}
                      id="keycloak-secret"
                    />
                  </div>
                </div>

                <div className={styles.toggleRow}>
                  <label className={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={keycloakConfig.enforceMfa}
                      onChange={(e) => setKeycloakConfig({ ...keycloakConfig, enforceMfa: e.target.checked })}
                    />
                    <span>Enforce Multi-Factor Authentication (MFA / WebAuthn)</span>
                  </label>
                </div>

                <div className={styles.panelFooter}>
                  <button className="btn btn-primary" onClick={() => handleSave('Keycloak SSO')} id="btn-save-keycloak">
                    <Save size={15} /> Save Security Configuration
                  </button>
                </div>
              </div>
            )}

            {/* 2. GitHub & CI Runners */}
            {activeTab === 'github' && (
              <div className={styles.panel}>
                <div className={styles.panelHeader}>
                  <div className={styles.panelTitleGroup}>
                    <GitBranch size={20} className={styles.panelIconPurple} />
                    <div>
                      <h3 className={styles.panelTitle}>GitHub & Test Runner Integration</h3>
                      <p className={styles.panelDesc}>Configure GitHub App permissions, PR creation defaults, and CI webhook listeners.</p>
                    </div>
                  </div>
                  <span className="badge badge-neutral">Not connected</span>
                </div>

                <div className={styles.formGrid}>
                  <div className={styles.formGroup}>
                    <label className={styles.label}>GitHub Organization</label>
                    <input
                      type="text"
                      className="input"
                      value={githubConfig.orgName}
                      onChange={(e) => setGithubConfig({ ...githubConfig, orgName: e.target.value })}
                      id="github-org"
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.label}>Default Reviewer Team</label>
                    <input
                      type="text"
                      className="input"
                      value={githubConfig.defaultReviewerTeam}
                      onChange={(e) => setGithubConfig({ ...githubConfig, defaultReviewerTeam: e.target.value })}
                      id="github-reviewer-team"
                    />
                  </div>

                  <div className={`${styles.formGroup} ${styles.colSpan2}`}>
                    <label className={styles.label}>CI Status Webhook Endpoint</label>
                    <input
                      type="text"
                      className="input"
                      value={githubConfig.ciWebhookUrl}
                      readOnly
                      id="github-webhook-url"
                    />
                  </div>
                </div>

                <div className={styles.toggleRow}>
                  <label className={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={githubConfig.requireApprovalBeforePr}
                      onChange={(e) => setGithubConfig({ ...githubConfig, requireApprovalBeforePr: e.target.checked })}
                    />
                    <span>Strict Human-in-the-Loop: Require QA Lead sign-off before publishing Draft PR</span>
                  </label>
                </div>

                <div className={styles.panelFooter}>
                  <button className="btn btn-primary" onClick={() => handleSave('GitHub Integration')} id="btn-save-github">
                    <Save size={15} /> Save GitHub Settings
                  </button>
                </div>
              </div>
            )}

            {/* 4. Team & RBAC Roles */}
            {activeTab === 'team' && (
              <div className={styles.panel}>
                <div className={styles.panelHeader}>
                  <div className={styles.panelTitleGroup}>
                    <Users size={20} className={styles.panelIconBlue} />
                    <div>
                      <h3 className={styles.panelTitle}>Team Members & Role-Based Access Control (RBAC)</h3>
                      <p className={styles.panelDesc}>Assign permissions for initiating AI pipelines, approving test designs, and merging PRs.</p>
                    </div>
                  </div>
                  {isAdmin && (
                    <button className="btn btn-primary" onClick={openCreate} id="btn-add-user">
                      <UserPlus size={15} /> Add user
                    </button>
                  )}
                </div>

                {!isAdmin && me.id && (
                  <p className={styles.panelDesc}>Only administrators can add, edit, disable or delete users.</p>
                )}

                {actionError && (
                  <div className={styles.alertError} role="alert">
                    <span>{actionError}</span>
                    <button className="btn btn-ghost btn-icon" onClick={() => setActionError('')} aria-label="Dismiss">
                      <X size={16} />
                    </button>
                  </div>
                )}

                {inviteInfo && (
                  <div className={styles.inviteBox} id="invite-info">
                    <div className={styles.inviteHead}>
                      <strong>{inviteInfo.message}</strong>
                      <button className="btn btn-ghost btn-icon" onClick={() => setInviteInfo(null)} aria-label="Dismiss">
                        <X size={16} />
                      </button>
                    </div>
                    {inviteInfo.devLink && (
                      <>
                        <p className={styles.panelDesc}>
                          Development mode: the email was saved to <code>.mail-outbox</code>. Share this one-time link with the
                          user (it expires in 48 hours), or set <code>SMTP_HOST</code> in <code>.env</code> to send real emails.
                        </p>
                        <div className={styles.inviteLinkRow}>
                          <input className="input" readOnly value={inviteInfo.devLink} onFocus={(e) => e.target.select()} />
                          <button className="btn btn-secondary" onClick={() => copyLink(inviteInfo.devLink)}>
                            <Copy size={15} /> Copy
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}

                <div className="table-container">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>User</th>
                        <th>Email</th>
                        <th>Assigned Role</th>
                        <th>Permissions</th>
                        <th>Status</th>
                        {isAdmin && <th className={styles.actionsCell}>Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {teamUsers.map((u) => {
                        const isSelf = u.id === me.id;
                        const badge = STATUS_BADGE[u.status] ?? STATUS_BADGE.active;
                        const busy = busyId === u.id;
                        return (
                          <tr key={u.id} id={`team-row-${u.id}`} className={u.disabled ? styles.rowDisabled : ''}>
                            <td>
                              <div className={styles.userCell}>
                                <span className={styles.avatar}>{u.avatar}</span>
                                <span className={styles.userName}>
                                  {u.name}
                                  {isSelf && <span className={styles.youTag}>You</span>}
                                </span>
                              </div>
                            </td>
                            <td>{u.email}</td>
                            <td>
                              <span className={`badge badge-${u.role === 'Admin' ? 'primary' : u.role === 'QA Lead' ? 'success' : 'neutral'}`}>
                                {u.role}
                              </span>
                            </td>
                            <td className={styles.permCell}>{ROLE_PERMISSIONS[u.role]}</td>
                            <td>
                              <span className={`badge ${badge.className}`}>{badge.label}</span>
                            </td>
                            {isAdmin && (
                              <td className={styles.actionsCell}>
                                <div className={styles.rowActions}>
                                  <button
                                    className="btn btn-ghost btn-icon"
                                    onClick={() => openEdit(u)}
                                    title="Edit user"
                                    aria-label={`Edit ${u.name}`}
                                    id={`edit-user-${u.id}`}
                                  >
                                    <Pencil size={16} />
                                  </button>
                                  {u.status === 'invited' && (
                                    <button
                                      className="btn btn-ghost btn-icon"
                                      onClick={() => sendInvite(u)}
                                      disabled={busy}
                                      title="Resend invitation"
                                      aria-label={`Resend invitation to ${u.name}`}
                                      id={`resend-invite-${u.id}`}
                                    >
                                      {busy ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
                                    </button>
                                  )}
                                  <button
                                    className="btn btn-ghost btn-icon"
                                    onClick={() => toggleDisabled(u)}
                                    disabled={isSelf || busy}
                                    title={isSelf ? 'You cannot disable your own account' : u.disabled ? 'Enable user' : 'Disable user'}
                                    aria-label={`${u.disabled ? 'Enable' : 'Disable'} ${u.name}`}
                                    id={`toggle-user-${u.id}`}
                                  >
                                    {u.disabled ? <UserCheck size={16} /> : <UserX size={16} />}
                                  </button>
                                  <button
                                    className={`btn btn-ghost btn-icon ${styles.deleteBtn}`}
                                    onClick={() => setDeleteTarget(u)}
                                    disabled={isSelf || busy}
                                    title={isSelf ? 'You cannot delete your own account' : 'Delete user'}
                                    aria-label={`Delete ${u.name}`}
                                    id={`delete-user-${u.id}`}
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Create / edit user */}
      {userForm && (
        <div className="modal-overlay" onClick={closeForm} onKeyDown={(e) => e.key === 'Escape' && closeForm()}>
          <form
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="user-form-title"
            onClick={(e) => e.stopPropagation()}
            onSubmit={submitUserForm}
            noValidate
          >
            <div className="modal-header">
              <h3 id="user-form-title">{userForm.mode === 'create' ? 'Add user' : 'Edit user'}</h3>
              <button type="button" className="btn btn-ghost btn-icon" onClick={closeForm} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              <div className={styles.modalFields}>
                {userForm.mode === 'create' && (
                  <p className={styles.fieldHint}>
                    We&apos;ll email an invitation with a link to set their password. They can sign in after that.
                  </p>
                )}
                {formError && <div className={styles.alertError} role="alert">{formError}</div>}
                <div className={styles.formGroup}>
                  <label className={styles.label} htmlFor="user-name">
                    Full name <span className={styles.required} aria-hidden="true">*</span>
                  </label>
                  <input
                    id="user-name"
                    className="input"
                    value={userForm.name}
                    onChange={(e) => setUserForm({ ...userForm, name: e.target.value })}
                    aria-required="true"
                    aria-invalid={Boolean(formErrors.name)}
                    maxLength={80}
                    autoFocus
                  />
                  {formErrors.name && <span className={styles.fieldError}>{formErrors.name}</span>}
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.label} htmlFor="user-email">
                    Email address <span className={styles.required} aria-hidden="true">*</span>
                  </label>
                  <input
                    id="user-email"
                    type="email"
                    className="input"
                    placeholder="name@company.com"
                    value={userForm.email}
                    onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                    aria-required="true"
                    aria-invalid={Boolean(formErrors.email)}
                    maxLength={254}
                  />
                  {formErrors.email && <span className={styles.fieldError}>{formErrors.email}</span>}
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.label} htmlFor="user-role">
                    Role <span className={styles.required} aria-hidden="true">*</span>
                  </label>
                  <select
                    id="user-role"
                    className="select"
                    value={userForm.role}
                    onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
                    aria-required="true"
                    aria-invalid={Boolean(formErrors.role)}
                  >
                    <option value="" disabled>Select a role</option>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                  {formErrors.role && <span className={styles.fieldError}>{formErrors.role}</span>}
                  {userForm.role && <span className={styles.fieldHint}>{ROLE_PERMISSIONS[userForm.role]}</span>}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={closeForm} disabled={submitting}>Cancel</button>
              <button type="submit" className="btn btn-primary" id="btn-save-user" disabled={submitting}>
                {submitting && <Loader2 size={15} className="animate-spin" />}
                {userForm.mode === 'create' ? 'Add user & send invite' : 'Save changes'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div
            className="modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-user-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3 id="delete-user-title">Delete {deleteTarget.name}?</h3>
            </div>
            <div className="modal-body">
              <p className={styles.panelDesc}>
                {deleteTarget.name} will lose access immediately and be removed from the team. Their past approvals,
                comments and audit entries are kept under their name.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={confirmDelete} id="btn-confirm-delete">
                <Trash2 size={15} /> Delete user
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
