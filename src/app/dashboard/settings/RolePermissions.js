'use client';

import { Check, Minus, Info } from 'lucide-react';
import { ROLES, ROLE_CAPABILITIES, ROLE_DESCRIPTIONS, ROLE_RULES } from '@/lib/roles';
import styles from './page.module.css';

const ROLE_BADGE = { Admin: 'badge-primary', 'QA Lead': 'badge-success' };
const TOTAL = ROLE_CAPABILITIES.reduce((n, group) => n + group.items.length, 0);
const countFor = (role) =>
  ROLE_CAPABILITIES.reduce((n, group) => n + group.items.filter((item) => item.roles.includes(role)).length, 0);

// Every role and exactly what it may do, from the same lists the API guards follow.
export default function RolePermissions({ users, myRole }) {
  const activeMembers = (role) => users.filter((u) => u.role === role && !u.disabled).length;

  return (
    <section className={styles.rolesSection} aria-labelledby="roles-title" id="roles-permissions">
      <div>
        <h4 className={styles.sectionTitle} id="roles-title">Roles &amp; permissions</h4>
        <p className={styles.panelDesc}>
          What each role can do. Every role can see everything; the roles differ in what they can change.
        </p>
      </div>

      <div className={styles.roleCards}>
        {ROLES.map((role) => {
          const members = activeMembers(role);
          return (
            <div key={role} className={`${styles.roleCard} ${role === myRole ? styles.roleCardMine : ''}`} id={`role-card-${role.replace(/\s+/g, '-').toLowerCase()}`}>
              <div className={styles.roleCardHead}>
                <span className={`badge ${ROLE_BADGE[role] ?? 'badge-neutral'}`}>{role}</span>
                {role === myRole && <span className={styles.youTag}>Your role</span>}
              </div>
              <p className={styles.roleCardDesc}>{ROLE_DESCRIPTIONS[role]}</p>
              <div className={styles.roleCardMeta}>
                <span>{countFor(role)} of {TOTAL} permissions</span>
                <span>{members} active {members === 1 ? 'member' : 'members'}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="table-container">
        <table className={`table ${styles.matrix}`}>
          <thead>
            <tr>
              <th>Permission</th>
              {ROLES.map((role) => (
                <th key={role} className={`${styles.matrixRole} ${role === myRole ? styles.matrixMine : ''}`} scope="col">
                  {role}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROLE_CAPABILITIES.map((group) => [
              <tr key={group.area} className={styles.matrixGroup}>
                <th colSpan={ROLES.length + 1} scope="colgroup">{group.area}</th>
              </tr>,
              ...group.items.map((item) => (
                <tr key={item.label}>
                  <td className={styles.matrixLabel}>{item.label}</td>
                  {ROLES.map((role) => {
                    const allowed = item.roles.includes(role);
                    return (
                      <td key={role} className={`${styles.matrixCell} ${role === myRole ? styles.matrixMine : ''}`}>
                        {allowed ? (
                          <Check size={16} className={styles.allowed} aria-label={`${role}: allowed`} />
                        ) : (
                          <Minus size={16} className={styles.denied} aria-label={`${role}: not allowed`} />
                        )}
                      </td>
                    );
                  })}
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>

      <div className={styles.roleRules}>
        <Info size={16} className={styles.panelIconBlue} />
        <ul>
          {ROLE_RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
