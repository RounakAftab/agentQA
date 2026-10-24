'use client';

import { useState } from 'react';
import { Bell, Search, Menu, ChevronDown, User } from 'lucide-react';
import Link from 'next/link';
import { useCurrentUser, signOut } from '@/lib/teamStore';
import { useApprovals } from '@/lib/dataStores';
import { getRelativeTime } from '@/lib/format';
import styles from './Header.module.css';

export default function Header({ title, subtitle, onMenuToggle }) {
  const currentUser = useCurrentUser();
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Notifications are approvals that are still waiting for a decision.
  const { approvals } = useApprovals();
  const notifications = approvals
    .filter((a) => a.status === 'pending')
    .map((a) => ({ id: a.id, message: `Review requested: ${a.title}`, time: getRelativeTime(a.createdAt), unread: true }));

  const unreadCount = notifications.length;

  return (
    <header className={styles.header}>
      <div className={styles.left}>
        <button className={styles.menuBtn} onClick={onMenuToggle} id="menu-toggle">
          <Menu size={20} />
        </button>
        <div className={styles.titleGroup}>
          <h1 className={styles.title}>{title}</h1>
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        </div>
      </div>

      <div className={styles.right}>
        {/* Search */}
        <div className={styles.searchContainer}>
          <Search size={16} className={styles.searchIcon} />
          <input
            type="text"
            placeholder="Search projects, tests, workflows..."
            className={styles.searchInput}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            id="global-search"
          />
          <kbd className={styles.searchKbd}>⌘K</kbd>
        </div>

        {/* Notifications */}
        <div className={styles.notifWrapper}>
          <button
            className={styles.iconBtn}
            onClick={() => { setShowNotifications(!showNotifications); setShowProfile(false); }}
            id="notifications-btn"
          >
            <Bell size={19} />
            {unreadCount > 0 && <span className={styles.notifDot}>{unreadCount}</span>}
          </button>

          {showNotifications && (
            <div className={styles.dropdown}>
              <div className={styles.dropdownHeader}>
                <span className={styles.dropdownTitle}>Notifications</span>
              </div>
              {notifications.length === 0 && (
                <div className={styles.notifItem}>
                  <div className={styles.notifContent}>
                    <p className={styles.notifMessage}>You&apos;re all caught up.</p>
                  </div>
                </div>
              )}
              {notifications.map(n => (
                <div key={n.id} className={`${styles.notifItem} ${n.unread ? styles.unread : ''}`}>
                  <div className={styles.notifContent}>
                    <p className={styles.notifMessage}>{n.message}</p>
                    <span className={styles.notifTime}>{n.time}</span>
                  </div>
                  {n.unread && <span className={styles.unreadDot} />}
                </div>
              ))}
              <div className={styles.dropdownFooter}>
                <Link href="/dashboard/approvals" className={styles.viewAll} onClick={() => setShowNotifications(false)}>
                  Open approvals
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* Profile */}
        <div className={styles.profileWrapper}>
          <button
            className={styles.profileBtn}
            onClick={() => { setShowProfile(!showProfile); setShowNotifications(false); }}
            id="profile-btn"
          >
            <div className={styles.avatar}>{currentUser.avatar}</div>
            <div className={styles.profileInfo}>
              <span className={styles.profileName}>{currentUser.name}</span>
              <span className={styles.profileRole}>{currentUser.role}</span>
            </div>
            <ChevronDown size={14} className={styles.profileChevron} />
          </button>

          {showProfile && (
            <div className={styles.dropdown}>
              <div className={styles.profileCard}>
                <div className={styles.avatarLg}>{currentUser.avatar}</div>
                <div>
                  <p className={styles.profileCardName}>{currentUser.name}</p>
                  <p className={styles.profileCardEmail}>{currentUser.email}</p>
                </div>
              </div>
              <div className={styles.dropdownDivider} />
              <a href="/dashboard/settings" className={styles.dropdownItem}>
                <User size={16} /> Profile Settings
              </a>
              <div className={styles.dropdownDivider} />
              <button
                type="button"
                className={styles.dropdownItem}
                style={{ color: 'var(--danger-600)' }}
                onClick={signOut}
                id="header-sign-out"
              >
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
