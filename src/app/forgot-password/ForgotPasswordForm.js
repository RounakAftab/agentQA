'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, Zap } from 'lucide-react';
import styles from '../set-password/page.module.css';

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sentMessage, setSentMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !email.includes('@')) return setError('Enter your email address');

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? 'Could not send the reset link. Try again.');
      } else {
        setSentMessage(data.message);
      }
    } catch {
      setError('Could not reach the server. Check your connection.');
    }
    setSubmitting(false);
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

        {sentMessage ? (
          <div id="reset-sent">
            <h1 className={styles.title}>Check your email</h1>
            <div className={styles.success} role="status">
              <CheckCircle2 size={16} /> {sentMessage}
            </div>
            <p className={styles.muted}>The link works once and expires in 60 minutes. Check your spam folder if it doesn&apos;t arrive.</p>
            <Link href="/" className={`btn btn-primary ${styles.fullWidth}`}>
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} noValidate>
            <h1 className={styles.title}>Forgot your password?</h1>
            <p className={styles.muted}>Enter the email you sign in with and we&apos;ll send you a link to choose a new password.</p>

            {error && (
              <div className={styles.error} role="alert" id="forgot-password-error">
                <AlertCircle size={16} /> {error}
              </div>
            )}

            <label className="label" htmlFor="reset-email">Email address</label>
            <input
              id="reset-email"
              type="email"
              className="input"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              autoFocus
            />

            <button type="submit" className={`btn btn-primary btn-lg ${styles.fullWidth}`} disabled={submitting} id="btn-send-reset">
              {submitting && <Loader2 size={16} className="animate-spin" />}
              Send reset link
            </button>
            <Link href="/" className={`btn btn-ghost ${styles.fullWidth}`}>
              <ArrowLeft size={16} /> Back to sign in
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
