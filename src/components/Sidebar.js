'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { signOut } from '@/lib/teamStore';
import { useWorkflowStore } from '@/lib/workflowStore';
import {
  LayoutDashboard,
  FolderKanban,
  Workflow,
  CheckSquare,
  Activity,
  ScrollText,
  Settings,
  Zap,
  ChevronLeft,
  LogOut,
  HelpCircle,
  Bot,
} from 'lucide-react';
import styles from './Sidebar.module.css';

const navItems = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', id: 'nav-dashboard' },
  { href: '/dashboard/projects', icon: FolderKanban, label: 'Projects', id: 'nav-projects' },
  { href: '/dashboard/workflow', icon: Workflow, label: 'AI Workflow', id: 'nav-workflow' },
  { href: '/dashboard/qa-agent', icon: Bot, label: 'QA Agent', id: 'nav-qa-agent' },
  { href: '/dashboard/approvals', icon: CheckSquare, label: 'Approvals', id: 'nav-approvals' },
  { href: '/dashboard/ci-results', icon: Activity, label: 'CI Results', id: 'nav-ci' },
  { href: '/dashboard/audit', icon: ScrollText, label: 'Audit Trail', id: 'nav-audit' },
  { href: '/dashboard/settings', icon: Settings, label: 'Settings', id: 'nav-settings' },
];

export default function Sidebar({ collapsed, onToggle }) {
  const pathname = usePathname();
  const { approvals } = useWorkflowStore();
  const pendingApprovals = approvals.filter((a) => a.status === "pending").length;

  const isActive = (href) => {
    if (href === '/dashboard') return pathname === '/dashboard';
    return pathname.startsWith(href);
  };

  return (
    <aside className={`${styles.sidebar} ${collapsed ? styles.collapsed : ''}`}>
      {/* Logo */}
      <div className={styles.logoSection}>
        <Link href="/dashboard" className={styles.logo}>
          <div className={styles.logoIcon}>
            <Zap size={20} />
          </div>
          {!collapsed && <span className={styles.logoText}>AgentQA</span>}
        </Link>
        <button
          className={styles.collapseBtn}
          onClick={onToggle}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          id="sidebar-toggle"
        >
          <ChevronLeft size={16} className={collapsed ? styles.rotated : ''} />
        </button>
      </div>

      {/* Navigation */}
      <nav className={styles.nav}>
        <div className={styles.navSection}>
          {!collapsed && <span className={styles.navLabel}>Main Menu</span>}
          {navItems.map((item) => {
            const badge = item.id === "nav-approvals" && pendingApprovals > 0 ? pendingApprovals : null;
            return (
            <Link
              key={item.href}
              href={item.href}
              id={item.id}
              className={`${styles.navItem} ${isActive(item.href) ? styles.navItemActive : ''}`}
              title={collapsed ? item.label : undefined}
            >
              <item.icon size={19} />
              {!collapsed && (
                <>
                  <span className={styles.navItemLabel}>{item.label}</span>
                  {badge && (
                    <span className={styles.navBadge}>{badge}</span>
                  )}
                </>
              )}
              {collapsed && badge && (
                <span className={styles.navBadgeDot} />
              )}
            </Link>
            );
          })}
        </div>
      </nav>

      {/* Footer */}
      <div className={styles.footer}>
        <Link href="#" className={styles.footerItem} title="Help & Documentation">
          <HelpCircle size={18} />
          {!collapsed && <span>Help</span>}
        </Link>
        <button type="button" className={styles.footerItem} title="Sign Out" id="sign-out" onClick={signOut}>
          <LogOut size={18} />
          {!collapsed && <span>Sign Out</span>}
        </button>
      </div>
    </aside>
  );
}
