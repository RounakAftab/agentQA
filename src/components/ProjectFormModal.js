'use client';

import { useState } from 'react';
import {
  Loader2,
  X,
  FileText,
  GitBranch,
  Ticket,
  MonitorPlay,
  Users,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  ExternalLink,
  PlugZap,
  ChevronDown,
  KeyRound,
  Unplug,
} from 'lucide-react';
import { useTeamUsers } from '@/lib/teamStore';
import { createProject, updateProject } from '@/lib/dataStores';
import { validateProjectInput } from '@/lib/validation';
import styles from './ProjectFormModal.module.css';

const blank = {
  name: '',
  description: '',
  repoUrl: '',
  automationRepoUrl: '',
  defaultBranch: 'main',
  language: '',
  framework: '',
  jiraBaseUrl: '',
  jiraEmail: '',
  jiraApiToken: '',
  clearJiraApiToken: false,
  jiraTokenSet: false,
  jiraProjectKey: '',
  jiraStatusInProgress: '',
  jiraStatusDone: '',
  appBaseUrl: '',
  e2eUsername: '',
  e2ePassword: '',
  clearE2ePassword: false,
  e2ePasswordSet: false,
  memberIds: [],
};

const SECTIONS = [
  { id: 'general', label: 'General', icon: FileText, fields: ['name', 'description'] },
  { id: 'repos', label: 'Repositories', icon: GitBranch, fields: ['repoUrl', 'automationRepoUrl', 'language', 'framework', 'defaultBranch'] },
  { id: 'jira', label: 'Jira', icon: Ticket, fields: ['jiraBaseUrl', 'jiraEmail', 'jiraApiToken', 'jiraProjectKey', 'jiraStatusInProgress', 'jiraStatusDone'] },
  { id: 'testing', label: 'Test environment', icon: MonitorPlay, fields: ['appBaseUrl', 'e2eUsername', 'e2ePassword'] },
  { id: 'team', label: 'Team', icon: Users, fields: [] },
];

const JIRA_FIELDS = SECTIONS.find((s) => s.id === 'jira').fields;
const TOKEN_URL = 'https://id.atlassian.com/manage-profile/security/api-tokens';

function fromProject(project) {
  const form = { ...blank };
  for (const key of Object.keys(blank)) {
    if (project[key] !== undefined && project[key] !== null) form[key] = project[key];
  }
  return { ...form, jiraApiToken: '', e2ePassword: '', memberIds: project.memberIds ?? [] };
}

// Create (no `project`) or edit (with `project`). Calls onSaved(project) after the API accepts it.
export default function ProjectFormModal({ project, onClose, onSaved, initialSection = 'general' }) {
  const editing = Boolean(project);
  const [form, setForm] = useState(() => (editing ? fromProject(project) : blank));
  const [section, setSection] = useState(initialSection);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [jiraTest, setJiraTest] = useState({ state: editing && project.jiraConnected ? 'saved' : 'idle' });
  const [showAdvanced, setShowAdvanced] = useState(Boolean(project?.jiraStatusInProgress || project?.jiraStatusDone));
  const team = useTeamUsers().filter((u) => u.status !== 'disabled');

  const update = (patch) => {
    setForm((f) => ({ ...f, ...patch }));
    const touched = Object.keys(patch);
    if (touched.some((k) => errors[k])) setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !touched.includes(k))));
    // Any change to the connection makes an earlier test result stale.
    if (touched.some((k) => JIRA_FIELDS.includes(k) && k !== 'jiraStatusInProgress' && k !== 'jiraStatusDone')) setJiraTest({ state: 'idle' });
  };
  const set = (key) => (e) => update({ [key]: e.target.value });

  const toggleMember = (id) =>
    update({ memberIds: form.memberIds.includes(id) ? form.memberIds.filter((m) => m !== id) : [...form.memberIds, id] });

  const close = () => {
    if (!submitting) onClose();
  };

  const sectionHasError = (s) => s.fields.some((f) => errors[f]);

  const showErrors = (fieldErrors) => {
    setErrors(fieldErrors);
    const first = SECTIONS.find((s) => s.fields.some((f) => fieldErrors[f]));
    if (first) setSection(first.id);
  };

  const submit = async (e) => {
    e.preventDefault();
    const { errors: clientErrors } = validateProjectInput(form);
    setFormError('');
    if (Object.keys(clientErrors).length > 0) {
      showErrors(clientErrors);
      return;
    }
    setErrors({});
    setSubmitting(true);
    const result = editing ? await updateProject(project.id, form) : await createProject(form);
    setSubmitting(false);

    if (!result.ok) {
      if (result.data.fieldErrors) showErrors(result.data.fieldErrors);
      else setFormError(result.data.error ?? 'Something went wrong');
      return;
    }
    onSaved(result.data.project);
  };

  const testJira = async () => {
    setJiraTest({ state: 'testing' });
    try {
      const res = await fetch('/api/jira/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project?.id,
          jiraBaseUrl: form.jiraBaseUrl,
          jiraEmail: form.jiraEmail,
          jiraApiToken: form.jiraApiToken,
          jiraProjectKey: form.jiraProjectKey,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.fieldErrors) setErrors((e) => ({ ...e, ...data.fieldErrors }));
      setJiraTest(data.ok ? { state: 'ok', ...data } : { state: 'error', error: data.error ?? 'Connection test failed' });
    } catch {
      setJiraTest({ state: 'error', error: 'Could not reach the server. Check your connection.' });
    }
  };

  // ---- Field helpers ----

  const field = (key, label, { required, placeholder, maxLength, type = 'text', hint, autoComplete, inputMode } = {}) => (
    <div className={styles.group}>
      <label className={styles.label} htmlFor={`project-${key}`}>
        {label} {required && <span className={styles.required} aria-hidden="true">*</span>}
      </label>
      <input
        id={`project-${key}`}
        type={type}
        className="input"
        value={form[key]}
        onChange={set(key)}
        placeholder={placeholder}
        maxLength={maxLength}
        autoComplete={autoComplete}
        inputMode={inputMode}
        aria-required={required ? 'true' : undefined}
        aria-invalid={Boolean(errors[key])}
        aria-describedby={hint ? `project-${key}-hint` : undefined}
      />
      {errors[key] ? (
        <span className={styles.error}>{errors[key]}</span>
      ) : (
        hint && <span id={`project-${key}-hint`} className={styles.hint}>{hint}</span>
      )}
    </div>
  );

  const secretField = (key, label, { savedFlag, clearFlag, placeholder, hint }) => (
    <SecretInput
      id={`project-${key}`}
      label={label}
      value={form[key]}
      onChange={(v) => update({ [key]: v })}
      saved={form[savedFlag] && !form[clearFlag]}
      onRemove={() => update({ [clearFlag]: true, [key]: '' })}
      onUndoRemove={() => update({ [clearFlag]: false })}
      removed={form[savedFlag] && form[clearFlag]}
      placeholder={placeholder}
      error={errors[key]}
      hint={hint}
    />
  );

  const jiraFilled = Boolean(form.jiraBaseUrl && form.jiraEmail && (form.jiraApiToken || (form.jiraTokenSet && !form.clearJiraApiToken)) && form.jiraProjectKey);
  const sectionStatus = {
    jira: jiraTest.state === 'ok' || jiraTest.state === 'saved' ? 'ok' : jiraFilled ? 'pending' : null,
    testing: form.appBaseUrl ? 'ok' : null,
  };

  return (
    <div className="modal-overlay" onClick={close} onKeyDown={(e) => e.key === 'Escape' && close()}>
      <form
        className={`modal ${styles.modal}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-form-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        noValidate
      >
        <div className="modal-header">
          <div>
            <h3 id="project-form-title">{editing ? `Edit ${project.name}` : 'New project'}</h3>
            <p className={styles.subtitle}>Only a name is required. Add Jira, a test environment or GitHub when you need them.</p>
          </div>
          <button type="button" className="btn btn-ghost btn-icon" onClick={close} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className={styles.layout}>
          <nav className={styles.nav} aria-label="Project settings sections">
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              const hasError = sectionHasError(s);
              const status = sectionStatus[s.id];
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`${styles.navItem} ${section === s.id ? styles.navActive : ''}`}
                  onClick={() => setSection(s.id)}
                  aria-current={section === s.id ? 'step' : undefined}
                  id={`project-section-${s.id}`}
                >
                  <Icon size={16} />
                  <span className={styles.navLabel}>{s.label}</span>
                  {hasError ? (
                    <span className={`${styles.navDot} ${styles.dotError}`} aria-label="Has errors" />
                  ) : status === 'ok' ? (
                    <CheckCircle2 size={14} className={styles.navOk} aria-label="Configured" />
                  ) : status === 'pending' ? (
                    <span className={`${styles.navDot} ${styles.dotPending}`} aria-label="Not tested yet" />
                  ) : null}
                </button>
              );
            })}
          </nav>

          <div className={styles.panel}>
            {formError && <div className={styles.alert} role="alert">{formError}</div>}

            {section === 'general' && (
              <Section title="General" description="How the project appears across AgentQA.">
                {field('name', 'Project name', { required: true, maxLength: 100, placeholder: 'e.g. Customer Portal' })}
                <div className={styles.group}>
                  <label className={styles.label} htmlFor="project-description">Description</label>
                  <textarea
                    id="project-description"
                    className="input"
                    rows={4}
                    value={form.description}
                    onChange={set('description')}
                    maxLength={500}
                    placeholder="What the application does and who uses it"
                    aria-invalid={Boolean(errors.description)}
                  />
                  {errors.description ? (
                    <span className={styles.error}>{errors.description}</span>
                  ) : (
                    <span className={styles.hint}>{form.description.length}/500</span>
                  )}
                </div>
              </Section>
            )}

            {section === 'repos' && (
              <Section title="Repositories" description="Optional. Connect GitHub if you want generated tests delivered as pull requests.">
                {field('repoUrl', 'Source repository', {
                  placeholder: 'https://github.com/your-org/your-app',
                  maxLength: 300,
                  inputMode: 'url',
                  hint: 'Optional. A link to the application code, for reference.',
                })}
                {field('automationRepoUrl', 'Test repository', {
                  placeholder: 'https://github.com/your-org/your-app-tests',
                  maxLength: 300,
                  inputMode: 'url',
                  hint: 'Optional. With a test repository, specs open as pull requests (it needs @playwright/test installed). Without one, specs are saved in AgentQA for download.',
                })}
                <div className={styles.row3}>
                  {field('language', 'Language', { placeholder: 'e.g. TypeScript', maxLength: 60 })}
                  {field('framework', 'Framework', { placeholder: 'e.g. Next.js', maxLength: 60 })}
                  {field('defaultBranch', 'Default branch', { placeholder: 'main', maxLength: 100 })}
                </div>
              </Section>
            )}

            {section === 'jira' && (
              <Section title="Jira" description="Optional. Connect a Jira Cloud project so the QA Agent can pick up tickets, update their status and add notes. Without Jira, write requirements in AgentQA.">
                <JiraStatusCard test={jiraTest} filled={jiraFilled} />

                {field('jiraBaseUrl', 'Jira site', {
                  placeholder: 'https://your-team.atlassian.net',
                  maxLength: 300,
                  inputMode: 'url',
                  hint: 'The address in your browser when Jira is open.',
                })}
                <div className={styles.row2}>
                  {field('jiraEmail', 'Account email', {
                    placeholder: 'you@company.com',
                    maxLength: 254,
                    type: 'email',
                    autoComplete: 'off',
                    hint: 'Status changes and comments appear as this user.',
                  })}
                  {field('jiraProjectKey', 'Project key', {
                    placeholder: 'e.g. SCRUM',
                    maxLength: 10,
                    hint: 'The prefix of ticket numbers: SCRUM-12 → SCRUM.',
                  })}
                </div>
                {secretField('jiraApiToken', 'API token', {
                  savedFlag: 'jiraTokenSet',
                  clearFlag: 'clearJiraApiToken',
                  placeholder: 'Paste your Atlassian API token',
                  hint: (
                    <>
                      Stored encrypted and never shown again.{' '}
                      <a href={TOKEN_URL} target="_blank" rel="noopener" className={styles.link}>
                        Create a token <ExternalLink size={11} />
                      </a>
                    </>
                  ),
                })}

                <div className={styles.testRow}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={testJira}
                    disabled={jiraTest.state === 'testing' || !form.jiraBaseUrl || !form.jiraEmail}
                    id="btn-test-jira"
                  >
                    {jiraTest.state === 'testing' ? <Loader2 size={15} className="animate-spin" /> : <PlugZap size={15} />}
                    Test connection
                  </button>
                  <span className={styles.hint}>Checks the account and project. Nothing is saved until you save the project.</span>
                  {editing && project.jiraConnected && (
                    <button
                      type="button"
                      className={`btn btn-ghost btn-sm ${styles.disconnect}`}
                      onClick={() =>
                        update({ jiraBaseUrl: '', jiraEmail: '', jiraApiToken: '', clearJiraApiToken: true, jiraProjectKey: '', jiraStatusInProgress: '', jiraStatusDone: '' })
                      }
                    >
                      <Unplug size={14} /> Disconnect Jira
                    </button>
                  )}
                </div>

                <div className={styles.advanced}>
                  <button type="button" className={styles.advancedToggle} onClick={() => setShowAdvanced((v) => !v)} aria-expanded={showAdvanced}>
                    <ChevronDown size={15} className={showAdvanced ? styles.rotated : ''} /> Workflow statuses
                  </button>
                  {showAdvanced && (
                    <>
                      <p className={styles.hint}>
                        The statuses the QA Agent moves tickets to. Leave them blank for &quot;In Progress&quot; and &quot;Done&quot;.
                        {jiraTest.statuses?.length > 0 && ' Suggestions come from your Jira workflow.'}
                      </p>
                      <div className={styles.row2}>
                        <StatusField id="jiraStatusInProgress" label="Before work starts" placeholder="In Progress" form={form} set={set} errors={errors} statuses={jiraTest.statuses} />
                        <StatusField id="jiraStatusDone" label="After the test passes" placeholder="Done" form={form} set={set} errors={errors} statuses={jiraTest.statuses} />
                      </div>
                    </>
                  )}
                </div>

                <details className={styles.help}>
                  <summary>Where do I find these?</summary>
                  <ol>
                    <li>Open Jira. The site is the start of the address, such as <code>https://your-team.atlassian.net</code>.</li>
                    <li>
                      Go to{' '}
                      <a href={TOKEN_URL} target="_blank" rel="noopener" className={styles.link}>
                        Atlassian account → Security → API tokens <ExternalLink size={11} />
                      </a>
                      , choose <strong>Create API token</strong>, give it a name such as &quot;AgentQA&quot; and copy it.
                    </li>
                    <li>Use the email of that same Atlassian account.</li>
                    <li>The project key is the prefix on ticket numbers, shown in the project&apos;s settings and board.</li>
                    <li>The account needs permission to browse, edit and transition issues and to add comments in the project.</li>
                  </ol>
                </details>
              </Section>
            )}

            {section === 'testing' && (
              <Section title="Test environment" description="The site the generated Playwright tests run against, and the account they sign in with. Needed to automate tests.">
                {field('appBaseUrl', 'App link', {
                  placeholder: 'https://staging.your-app.com',
                  maxLength: 300,
                  inputMode: 'url',
                  hint: 'Use a staging or test environment, not production.',
                })}
                <div className={styles.row2}>
                  {field('e2eUsername', 'Test account username', { placeholder: 'qa-bot@your-app.com', maxLength: 200, autoComplete: 'off' })}
                  {secretField('e2ePassword', 'Test account password', {
                    savedFlag: 'e2ePasswordSet',
                    clearFlag: 'clearE2ePassword',
                    placeholder: 'Password for the test account',
                  })}
                </div>
                <div className={styles.note}>
                  <KeyRound size={15} />
                  <span>
                    Tests read these as <code>process.env.E2E_USERNAME</code> and <code>process.env.E2E_PASSWORD</code>. They are never written into
                    test files, and a spec that contains them is rejected.
                  </span>
                </div>
              </Section>
            )}

            {section === 'team' && (
              <Section title="Team" description="People who work on this project.">
                {team.length === 0 ? (
                  <span className={styles.hint}>No users yet. Add users in Settings first.</span>
                ) : (
                  <fieldset className={styles.members}>
                    <legend className="sr-only">Team members</legend>
                    <div className={styles.memberGrid}>
                      {team.map((u) => (
                        <label key={u.id} className={`${styles.member} ${form.memberIds.includes(u.id) ? styles.memberOn : ''}`}>
                          <input type="checkbox" checked={form.memberIds.includes(u.id)} onChange={() => toggleMember(u.id)} />
                          <span className={styles.avatar}>{u.avatar}</span>
                          <span className={styles.memberName}>{u.name}</span>
                          <span className={styles.hint}>{u.role}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}
              </Section>
            )}
          </div>
        </div>

        <div className={`modal-footer ${styles.footer}`}>
          <span className={styles.footerHint}>
            {Object.keys(errors).length > 0 ? (
              <span className={styles.error}>
                <AlertCircle size={13} /> Fix the highlighted fields
              </span>
            ) : (
              <>Fields marked <span className={styles.required}>*</span> are required</>
            )}
          </span>
          <div className={styles.footerActions}>
            <button type="button" className="btn btn-secondary" onClick={close} disabled={submitting}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting} id="btn-save-project">
              {submitting && <Loader2 size={15} className="animate-spin" />}
              {editing ? 'Save changes' : 'Create project'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function Section({ title, description, children }) {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHeader}>
        <h4 className={styles.sectionTitle}>{title}</h4>
        <p className={styles.sectionDescription}>{description}</p>
      </header>
      <div className={styles.fields}>{children}</div>
    </section>
  );
}

function JiraStatusCard({ test, filled }) {
  if (test.state === 'ok') {
    return (
      <div className={`${styles.statusCard} ${styles.statusOk}`} role="status">
        <CheckCircle2 size={18} />
        <div>
          <strong>Connected as {test.account}</strong>
          <span>
            {test.project ? `Project ${test.project.key} · ${test.project.name}` : 'Add a project key to check the project too.'}
          </span>
        </div>
      </div>
    );
  }
  if (test.state === 'error') {
    return (
      <div className={`${styles.statusCard} ${styles.statusError}`} role="alert">
        <AlertCircle size={18} />
        <div>
          <strong>Connection failed</strong>
          <span>{test.error}</span>
        </div>
      </div>
    );
  }
  if (test.state === 'saved') {
    return (
      <div className={`${styles.statusCard} ${styles.statusOk}`} role="status">
        <CheckCircle2 size={18} />
        <div>
          <strong>Jira is connected</strong>
          <span>Run a test to check that the saved token still works.</span>
        </div>
      </div>
    );
  }
  return (
    <div className={`${styles.statusCard} ${styles.statusIdle}`}>
      <Ticket size={18} />
      <div>
        <strong>{filled ? 'Ready to test' : 'Not connected'}</strong>
        <span>{filled ? 'Test the connection before saving.' : 'Fill in all four fields to connect a Jira project.'}</span>
      </div>
    </div>
  );
}

function StatusField({ id, label, placeholder, form, set, errors, statuses }) {
  return (
    <div className={styles.group}>
      <label className={styles.label} htmlFor={`project-${id}`}>{label}</label>
      <input
        id={`project-${id}`}
        className="input"
        value={form[id]}
        onChange={set(id)}
        placeholder={placeholder}
        maxLength={60}
        list={statuses?.length ? `${id}-options` : undefined}
        aria-invalid={Boolean(errors[id])}
      />
      {statuses?.length > 0 && (
        <datalist id={`${id}-options`}>
          {statuses.map((s) => <option key={s} value={s} />)}
        </datalist>
      )}
      {errors[id] && <span className={styles.error}>{errors[id]}</span>}
    </div>
  );
}

// A password-style input for a stored secret: shows "saved" instead of the value, with
// options to replace or remove it.
function SecretInput({ id, label, value, onChange, saved, removed, onRemove, onUndoRemove, placeholder, error, hint }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className={styles.group}>
      <div className={styles.labelRow}>
        <label className={styles.label} htmlFor={id}>{label}</label>
        {saved && !value && (
          <span className={styles.savedBadge}>
            <CheckCircle2 size={12} /> Saved
            <button type="button" className={styles.linkButton} onClick={onRemove}>Remove</button>
          </span>
        )}
        {removed && (
          <span className={styles.removedBadge}>
            Will be removed
            <button type="button" className={styles.linkButton} onClick={onUndoRemove}>Undo</button>
          </span>
        )}
      </div>
      <div className={styles.secretWrap}>
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          className="input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={saved ? '•••••••• Saved · type to replace' : placeholder}
          autoComplete="new-password"
          spellCheck={false}
          aria-invalid={Boolean(error)}
        />
        <button
          type="button"
          className={styles.reveal}
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide value' : 'Show value'}
          disabled={!value}
        >
          {visible ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
      {error ? <span className={styles.error}>{error}</span> : hint && <span className={styles.hint}>{hint}</span>}
    </div>
  );
}
