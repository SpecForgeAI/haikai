/**
 * Security area layout (Security health dashboard, 2026-07-19, Spec 3 of 3).
 *
 * The Security tab is now a small tabbed area:
 *   - Overview          -- the department health dashboard (landing tab)
 *   - Findings Register -- the flattened detail screen
 *   - Current-State Scan -- the pre-existing migration-workflow screen
 *     (SecurityView, untouched; re-homed from /security to /security/scan)
 *
 * Rendered as the `security` route's layout element; tabs are NavLinks so the
 * URL remains the single source of truth.
 */

import { NavLink, Outlet } from 'react-router-dom';
import styles from './SecurityLayout.module.css';

export function SecurityLayout() {
  const tabClass = ({ isActive }: { isActive: boolean }) =>
    `${styles.tab} ${isActive ? styles.tabActive : ''}`;

  return (
    <div className={styles.container}>
      <nav className={styles.tabBar} aria-label="Security area">
        <NavLink to="overview" className={tabClass}>
          Overview
        </NavLink>
        <NavLink to="register" className={tabClass}>
          Findings Register
        </NavLink>
        <NavLink to="scan" className={tabClass}>
          Current-State Scan
        </NavLink>
      </nav>
      <div className={styles.content}>
        <Outlet />
      </div>
    </div>
  );
}
