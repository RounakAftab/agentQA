'use client';

import { useState } from 'react';
import { Loader2, X } from 'lucide-react';
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
  jiraProjectKey: '',
  appBaseUrl: '',
  memberIds: [],
};

// Create (no `project`) or edit (with `project`). Calls onSaved(project) after the API accepts it.
export default function ProjectFormModal({ project, onClose, onSaved }) {
  const editing = Boolean(project);
  const [form, setForm] = useState(() =>
    editing
      ? { ...blank, ...project, jiraProjectKey: project.jiraProjectKey ?? '', appBaseUrl: project.appBaseUrl ?? '', memberIds: project.memberIds }
      : blank
  );
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const team = useTeamUsers().filter((u) => u.status !== 'disabled');

  const set = (key) => (e) => {
    setForm({ ...form, [key]: e.target.value });
    if (errors[key]) setErrors({ ...errors, [key]: undefined }); // clear a field's error once it is edited
  };

  const toggleMember = (id) =>
    setForm({
      ...form,
      memberIds: form.memberIds.includes(id) ? form.memberIds.filter((m) => m !== id) : [...form.memberIds, id],
    });

  const close = () => {
    if (!submitting) onClose();
  };

  const submit = async (e) => {
    e.preventDefault();
    const { errors: clientErrors } = validateProjectInput(form);
    setErrors(clientErrors);
    setFormError('');
    if (Object.keys(clientErrors).length > 0) return;

    setSubmitting(true);
    const result = editing ? await updateProject(project.id, form) : await createProject(form);
    setSubmitting(false);

    if (!result.ok) {
      setErrors(result.data.fieldErrors ?? {});
      setFormError(result.data.fieldErrors ? '' : result.data.error ?? 'Something went wrong');
      return;
    }
    onSaved(result.data.project);
  };

  const field = (key, label, { required, placeholder, maxLength, type = 'text' } = {}) => (
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
        aria-required={required ? 'true' : undefined}
        aria-invalid={Boolean(errors[key])}
      />
      {errors[key] && <span className={styles.error}>{errors[key]}</span>}
    </div>
  );

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
          <h3 id="project-form-title">{editing ? 'Edit project' : 'New project'}</h3>
          <button type="button" className="btn btn-ghost btn-icon" onClick={close} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className={styles.fields}>
            {formError && <div className={styles.alert} role="alert">{formError}</div>}

            {field('name', 'Project name', { required: true, maxLength: 100, placeholder: 'e.g. Customer Portal' })}

            <div className={styles.group}>
              <label className={styles.label} htmlFor="project-description">Description</label>
              <textarea
                id="project-description"
                className="input"
                rows={3}
                value={form.description}
                onChange={set('description')}
                maxLength={500}
                aria-invalid={Boolean(errors.description)}
              />
              {errors.description && <span className={styles.error}>{errors.description}</span>}
            </div>

            {field('repoUrl', 'Source repository link', { required: true, placeholder: 'https://github.com/your-org/your-app', maxLength: 300 })}
            {field('automationRepoUrl', 'Test repository link', { placeholder: 'https://github.com/your-org/your-app-tests', maxLength: 300 })}

            <div className={styles.row}>
              {field('language', 'Language', { placeholder: 'e.g. TypeScript', maxLength: 60 })}
              {field('framework', 'Framework', { placeholder: 'e.g. Next.js', maxLength: 60 })}
              {field('defaultBranch', 'Default branch', { placeholder: 'main', maxLength: 100 })}
            </div>

            <div className={styles.row}>
              {field('jiraProjectKey', 'Jira project key', { placeholder: 'e.g. SCRUM', maxLength: 10 })}
              {field('appBaseUrl', 'App link for tests', { placeholder: 'https://staging.your-app.com', maxLength: 300 })}
            </div>

            <fieldset className={styles.members}>
              <legend className={styles.label}>Team members</legend>
              {team.length === 0 ? (
                <span className={styles.hint}>No users yet. Add users in Settings first.</span>
              ) : (
                <div className={styles.memberGrid}>
                  {team.map((u) => (
                    <label key={u.id} className={styles.member}>
                      <input
                        type="checkbox"
                        checked={form.memberIds.includes(u.id)}
                        onChange={() => toggleMember(u.id)}
                      />
                      <span className={styles.avatar}>{u.avatar}</span>
                      <span>{u.name}</span>
                      <span className={styles.hint}>{u.role}</span>
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={close} disabled={submitting}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={submitting} id="btn-save-project">
            {submitting && <Loader2 size={15} className="animate-spin" />}
            {editing ? 'Save changes' : 'Create project'}
          </button>
        </div>
      </form>
    </div>
  );
}
