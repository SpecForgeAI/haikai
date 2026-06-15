/**
 * ArchitectureDesignSubTabs
 *
 * Spec 2026-05-24 Target State Sub-tab + Deterministic Suggest -- Task Group 3.1
 *
 * Sub-tab navigation strip rendered at the top of the Architecture & Design
 * page surface. Two peers: "Current State" (default; existing metamodel
 * domain view) and "Target State" (the new sub-route mounting
 * <TargetArchitectureWorkspace />).
 *
 * The active sub-tab is driven by the `active` prop the parent supplies based
 * on its own route position -- the URL is the source of truth, not local
 * component state. This lets deep-linking and browser back/forward survive a
 * remount of either parent.
 *
 * Click handlers navigate via react-router's `useNavigate` to the canonical
 * architecture-scoped URLs:
 *   - Current State -> `/projects/:p/architectures/:a/metamodel` (existing
 *     route; MetaModelView in turn redirects to its default domain sub-route).
 *   - Target State  -> `/projects/:p/architectures/:a/architecture-design/target-state`.
 *
 * The project + architecture ids are read from the existing contexts (per the
 * codebase convention used by TopBar.handleViewChange et al.) so the strip
 * remains decoupled from the route params.
 */

import { useNavigate } from 'react-router-dom';
import { useProject } from '../../contexts/ProjectContext';
import { useActiveArchitectureId } from '../../contexts/ArchitectureContext';
import styles from './ArchitectureDesignSubTabs.module.css';

export type ArchitectureDesignSubTab = 'current-state' | 'target-state';

export interface ArchitectureDesignSubTabsProps {
  /** Which sub-tab the parent is currently rendering (URL-derived). */
  active: ArchitectureDesignSubTab;
}

export function ArchitectureDesignSubTabs({ active }: ArchitectureDesignSubTabsProps) {
  const navigate = useNavigate();
  const activeProject = useProject();
  const activeArchitectureId = useActiveArchitectureId();

  const handleNavigate = (target: ArchitectureDesignSubTab) => {
    if (!activeProject?.id || !activeArchitectureId) return;
    if (target === active) return;
    const base = `/projects/${activeProject.id}/architectures/${activeArchitectureId}`;
    if (target === 'current-state') {
      navigate(`${base}/metamodel`);
    } else {
      navigate(`${base}/architecture-design/target-state`);
    }
  };

  return (
    <div
      className={styles.subTabsRow}
      role="tablist"
      aria-label="Architecture & Design sub-tabs"
      data-testid="architecture-design-sub-tabs"
    >
      <button
        type="button"
        role="tab"
        aria-selected={active === 'current-state'}
        className={`${styles.subTab} ${active === 'current-state' ? styles.activeSubTab : ''}`}
        onClick={() => handleNavigate('current-state')}
        data-testid="architecture-design-current-state-tab"
      >
        Current State
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={active === 'target-state'}
        className={`${styles.subTab} ${active === 'target-state' ? styles.activeSubTab : ''}`}
        onClick={() => handleNavigate('target-state')}
        data-testid="architecture-design-target-state-tab"
      >
        Target State
      </button>
    </div>
  );
}
