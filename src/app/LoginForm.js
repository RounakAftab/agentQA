'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { refreshTeam } from '@/lib/teamStore';
import styles from './LoginPage.module.css';
import {
  Shield,
  Bot,
  GitBranch,
  CheckCircle2,
  BarChart3,
  Users,
  ArrowRight,
  Zap,
  Lock,
  Eye,
  EyeOff,
} from 'lucide-react';

const features = [
  { icon: Bot, label: 'AI-Driven QA Workflow' },
  { icon: GitBranch, label: 'GitHub Integration' },
  { icon: CheckCircle2, label: 'Human-in-the-Loop' },
  { icon: BarChart3, label: 'CI-Validated Results' },
  { icon: Users, label: 'Multi-Project Dashboard' },
  { icon: Lock, label: 'Enterprise Security' },
];

export default function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  const searchParams = useSearchParams();
  const passwordWasSet = searchParams.get('set') === '1';

  // Only follow ?next= to pages inside the dashboard.
  const next = searchParams.get('next');
  const destination = next && next.startsWith('/dashboard') ? next : '/dashboard';

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) {
      setError('Enter your email and password');
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? 'Could not sign in. Try again.');
        setIsLoading(false);
        return;
      }
      await refreshTeam();
      router.push(destination);
    } catch {
      setError('Could not reach the server. Check your connection.');
      setIsLoading(false);
    }
  };

  const handleSSOLogin = () => {
    setError('Keycloak SSO is not configured in this environment. Sign in with your email and password.');
  };

  return (
    <div className={styles.container}>
      {/* Left Panel - Branding */}
      <div className={styles.brandPanel}>
        <div className={styles.brandContent}>
          <div className={styles.logo}>
            <div className={styles.logoIcon}>
              <Zap size={28} />
            </div>
            <span className={styles.logoText}>AgentQA</span>
          </div>

          <div className={styles.heroSection}>
            <h1 className={styles.heroTitle}>
              Agentic QA
              <br />
              <span className={styles.heroHighlight}>Operations Platform</span>
            </h1>
            <p className={styles.heroSubtitle}>
              AI-powered quality engineering that connects requirements analysis, test automation,
              approvals, and CI-backed results into a single intelligent dashboard.
            </p>
          </div>

          <div className={styles.featureGrid}>
            {features.map((feature, index) => (
              <div
                key={feature.label}
                className={`${styles.featureItem} animate-fade-in stagger-${index + 1}`}
              >
                <feature.icon size={18} />
                <span>{feature.label}</span>
              </div>
            ))}
          </div>

          <div className={styles.brandFooter}>
            <p>Enterprise-grade quality engineering for modern teams</p>
          </div>
        </div>

        {/* Decorative elements */}
        <div className={styles.decorCircle1} />
        <div className={styles.decorCircle2} />
        <div className={styles.decorGrid} />
      </div>

      {/* Right Panel - Login Form */}
      <div className={styles.formPanel}>
        <div className={styles.formContainer}>
          <div className={styles.formHeader}>
            <h2>Sign in to your account</h2>
            <p className="text-muted">Enter your credentials or use SSO to continue</p>
          </div>

          {passwordWasSet && !error && (
            <div className={styles.noticeSuccess} role="status">
              Your password is set. Sign in with your email and new password.
            </div>
          )}
          {error && (
            <div className={styles.noticeError} role="alert" id="login-error">
              {error}
            </div>
          )}

          {/* SSO Button */}
          <button
            className={styles.ssoButton}
            onClick={handleSSOLogin}
            disabled={isLoading}
          >
            <Shield size={18} />
            Sign in with Keycloak SSO
          </button>

          <div className={styles.divider}>
            <span>or continue with email</span>
          </div>

          {/* Login Form */}
          <form onSubmit={handleLogin} className={styles.form} noValidate>
            <div className={styles.formGroup}>
              <label htmlFor="email" className="label">Email address</label>
              <input
                id="email"
                type="email"
                className="input"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="password" className="label">Password</label>
              <div className={styles.passwordWrapper}>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  className={`input ${styles.passwordInput}`}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className={styles.passwordToggle}
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className={`btn btn-primary btn-lg ${styles.submitBtn}`}
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <span className={styles.spinner} />
                  Signing in...
                </>
              ) : (
                <>
                  Sign in
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>

          <p className={styles.footer}>
            Protected by enterprise-grade security. Keycloak integration ready.
          </p>
        </div>
      </div>
    </div>
  );
}
