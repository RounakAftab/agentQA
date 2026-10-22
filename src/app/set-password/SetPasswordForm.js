'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, Check, Circle, Eye, EyeOff, Loader2, Zap } from 'lucide-react';
import { PASSWORD_RULES, validatePassword } from '@/lib/validation';
import styles from './page.module.css';

export default function SetPasswordForm() {
  const token = useSearchParams().get('token') ?? '';
  const router = useRouter();

  const [invite, setInvite] = useState({ state: token ? 'checking' : 'invalid' });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Check the link first so an expired one never shows a form.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch(`/api/auth/set-password?token=${encodeURIComponent(token)}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setInvite(data.valid ? { state: 'valid', name: data.name, email: data.email } : { state: 'invalid' });
      })
      .catch(() => !cancelled && setInvite({ state: 'invalid' }));
    return () => {
      cancelled = true;
    };
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');

    const check = validatePassword(password);
    if (check.error) return setError(check.error);
    if (password !== confirm) return setError('The two passwords do not match');

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? 'Could not set your password. Try again.');
        setSubmitting(false);
        return;
      }
      router.push('/?set=1');
    } catch {
      setError('Could not reach the server. Check your connection.');
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <span className={styles.logoIcon}>
            <Zap size={22} />
          </span>
          <span className={styles.logoText}>AgentQA</span>
        </div>

        {invite.state === 'checking' && (
          <p className={`${styles.muted} ${styles.row}`}>
            <Loader2 size={16} className="animate-spin" /> Checking your invitation...
          </p>
        )}

        {invite.state === 'invalid' && (
          <div id="invite-invalid">
            <h1 className={styles.title}>This link can&apos;t be used</h1>
            <p className={styles.muted}>
              The invitation link is invalid, has expired, or was already used. Ask an administrator to resend your
              invitation. If you have already set a password, you can sign in.
            </p>
            <Link href="/" className={`btn btn-primary ${styles.fullWidth}`}>
              Go to sign in
            </Link>
          </div>
        )}

        {invite.state === 'valid' && (
          <form onSubmit={submit} noValidate>
            <h1 className={styles.title}>Set your password</h1>
            <p className={styles.muted}>
              Welcome, {invite.name}. Choose a password for <strong>{invite.email}</strong>.
            </p>

            {error && (
              <div className={styles.error} role="alert" id="set-password-error">
                <AlertCircle size={16} /> {error}
              </div>
            )}

            <label className="label" htmlFor="new-password">New password</label>
            <div className={styles.passwordWrapper}>
              <input
                id="new-password"
                type={showPassword ? 'text' : 'password'}
                className={`input ${styles.passwordInput}`}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                autoFocus
              />
              <button
                type="button"
                className={styles.toggle}
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            <ul className={styles.rules}>
              {PASSWORD_RULES.map((rule) => {
                const ok = rule.test(password);
                return (
                  <li key={rule.id} className={ok ? styles.ruleOk : ''}>
                    {ok ? <Check size={14} /> : <Circle size={14} />} {rule.label}
                  </li>
                );
              })}
            </ul>

            <label className="label" htmlFor="confirm-password">Confirm password</label>
            <input
              id="confirm-password"
              type={showPassword ? 'text' : 'password'}
              className="input"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />

            <button type="submit" className={`btn btn-primary btn-lg ${styles.fullWidth}`} disabled={submitting} id="btn-set-password">
              {submitting && <Loader2 size={16} className="animate-spin" />}
              Set password
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
