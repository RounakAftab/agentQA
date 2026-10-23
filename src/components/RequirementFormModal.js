'use client';

import { useRef, useState } from 'react';
import { Loader2, X, Upload, Wand2 } from 'lucide-react';
import { createRequirement, updateRequirement } from '@/lib/qaAgentClient';
import { validateRequirementInput, REQUIREMENT_PRIORITIES } from '@/lib/validation';
import styles from './RequirementFormModal.module.css';

const TEMPLATE = `As a <type of user>, I want to <goal> so that <reason>.

Steps:
1. Open <page>
2. <action>
3. <action>

Acceptance criteria:
- <what the user should see or what should happen>
- <another expected result>`;

const MAX_FILE_BYTES = 200_000;

// Create (no `requirement`) or edit a requirement written in AgentQA.
export default function RequirementFormModal({ projectId, requirement, onClose, onSaved }) {
  const editing = Boolean(requirement);
  const [form, setForm] = useState(() => ({
    title: requirement?.title ?? '',
    description: requirement?.description ?? '',
    priority: requirement?.priority ?? 'medium',
  }));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef(null);

  const set = (key) => (e) => {
    setForm({ ...form, [key]: e.target.value });
    if (errors[key]) setErrors({ ...errors, [key]: undefined });
  };

  const close = () => {
    if (!submitting) onClose();
  };

  // Plain-text files only; the content goes into the editor so it can be reviewed first.
  const loadFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setErrors({ ...errors, description: 'That file is larger than 200 KB. Paste the relevant part instead.' });
      return;
    }
    const text = (await file.text()).trim();
    const title = form.title || file.name.replace(/\.(txt|md|markdown)$/i, '').replace(/[-_]+/g, ' ');
    setForm({ ...form, title, description: text });
    setErrors({});
  };

  const submit = async (e) => {
    e.preventDefault();
    const { errors: clientErrors } = validateRequirementInput(form);
    setErrors(clientErrors);
    setFormError('');
    if (Object.keys(clientErrors).length > 0) return;
    setSubmitting(true);
    const result = editing ? await updateRequirement(requirement.id, form) : await createRequirement(projectId, form);
    setSubmitting(false);
    if (!result.ok) {
      setErrors(result.data.fieldErrors ?? {});
      setFormError(result.data.fieldErrors ? '' : result.data.error ?? 'Something went wrong');
      return;
    }
    onSaved(result.data.requirement);
  };

  return (
    <div className="modal-overlay" onClick={close} onKeyDown={(e) => e.key === 'Escape' && close()}>
      <form
        className={`modal ${styles.modal}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="requirement-form-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        noValidate
      >
        <div className="modal-header">
          <div>
            <h3 id="requirement-form-title">{editing ? `Edit ${requirement.key}` : 'New requirement'}</h3>
            <p className={styles.subtitle}>Describe what to test. The QA Agent extracts the steps and acceptance criteria from this text.</p>
          </div>
          <button type="button" className="btn btn-ghost btn-icon" onClick={close} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className={styles.fields}>
            {formError && <div className={styles.alert} role="alert">{formError}</div>}

            <div className={styles.row}>
              <div className={styles.group}>
                <label className={styles.label} htmlFor="requirement-title">
                  Title <span className={styles.required} aria-hidden="true">*</span>
                </label>
                <input
                  id="requirement-title"
                  className="input"
                  value={form.title}
                  onChange={set('title')}
                  maxLength={200}
                  placeholder="e.g. Visitor books a demo from the pricing page"
                  aria-invalid={Boolean(errors.title)}
                />
                {errors.title && <span className={styles.error}>{errors.title}</span>}
              </div>
              <div className={styles.group}>
                <label className={styles.label} htmlFor="requirement-priority">Priority</label>
                <select id="requirement-priority" className="select" value={form.priority} onChange={set('priority')}>
                  {REQUIREMENT_PRIORITIES.map((p) => (
                    <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className={styles.group}>
              <div className={styles.labelRow}>
                <label className={styles.label} htmlFor="requirement-description">
                  Requirement <span className={styles.required} aria-hidden="true">*</span>
                </label>
                <div className={styles.tools}>
                  {!form.description.trim() && (
                    <button type="button" className={styles.tool} onClick={() => setForm({ ...form, description: TEMPLATE })}>
                      <Wand2 size={13} /> Use template
                    </button>
                  )}
                  <button type="button" className={styles.tool} onClick={() => fileRef.current?.click()}>
                    <Upload size={13} /> Load .txt or .md
                  </button>
                  <input ref={fileRef} type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" hidden onChange={loadFile} />
                </div>
              </div>
              <textarea
                id="requirement-description"
                className={`input ${styles.editor}`}
                value={form.description}
                onChange={set('description')}
                rows={14}
                maxLength={20000}
                placeholder="Paste a user story, a spec section or acceptance criteria. Numbered steps and a list of expected results work best."
                aria-invalid={Boolean(errors.description)}
                spellCheck
              />
              <div className={styles.labelRow}>
                {errors.description ? (
                  <span className={styles.error}>{errors.description}</span>
                ) : (
                  <span className={styles.hint}>Include the page or URL path to start from, the user actions in order, and what should happen.</span>
                )}
                <span className={styles.hint}>{form.description.length.toLocaleString()}/20,000</span>
              </div>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={close} disabled={submitting}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={submitting} id="btn-save-requirement">
            {submitting && <Loader2 size={15} className="animate-spin" />}
            {editing ? 'Save changes' : 'Add requirement'}
          </button>
        </div>
      </form>
    </div>
  );
}
