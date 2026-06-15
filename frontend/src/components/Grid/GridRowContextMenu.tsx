/**
 * GridRowContextMenu Component
 *
 * Task Group 7 (original): Context menu for grid row right-click actions
 * on Interface entities, enabling "Add endpoints and entities/attributes".
 *
 * 2026-04-22: Extended to render a "Start Discovery Run" action on
 * Service rows as well. The menu is entity-type-aware -- only one of the
 * action sets is visible at a time, driven by the `entityType` prop.
 *
 * Spec 2026-05-06 (Library Discovery Integration -- Task Group 7):
 *   - Service rows now expose TWO discovery actions:
 *       1. "Start Discovery Run" -- opens the new PreflightModal (default).
 *       2. "Start Discovery Run (No Libraries)" -- bypasses preflight,
 *          kicks off the existing single-entity scan flow.
 *   - Library rows are a NEW branch with the same two actions; the only
 *     difference vs. the Service branch is the rootKind passed to the
 *     handler so the parent picks the correct preflight + run helper
 *     (service-rooted vs library-rooted).
 *   - Two new handler props:
 *       * onStartLibraryScan(): default flow -> preflight modal.
 *       * onStartScanNoLibraries(): bypass preflight -> existing flow.
 *   - The existing onStartDiscoveryRun prop is retained as an alias for
 *     `onStartScanNoLibraries` to preserve backwards compatibility for
 *     any caller that has not yet wired the new pair.
 */

import { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { EntityType } from '../../types/model';
import styles from './GridRowContextMenu.module.css';

export interface GridRowContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  entityType: EntityType;
  entityId: string;
  entityName: string;
  onClose: () => void;
  /** Interface action -- pass-through from Grid when entityType === 'interfaces'. */
  onAddEndpointsAndEntities: () => void;
  /**
   * Service action -- legacy "Start Discovery Run" handler. Retained as
   * an alias for `onStartScanNoLibraries` so callers that have not yet
   * wired the new pair continue to work. When both `onStartScanNoLibraries`
   * and `onStartDiscoveryRun` are supplied, `onStartScanNoLibraries`
   * wins (the new prop is canonical).
   */
  onStartDiscoveryRun?: () => void;
  /**
   * Spec 2026-05-06: Default "Start Discovery Run" flow -- opens the
   * PreflightModal. Available on Service AND Library rows. The handler
   * receives no arguments; the parent already knows which row it is from
   * the open context-menu state.
   */
  onStartLibraryScan?: () => void;
  /**
   * Spec 2026-05-06: "Start Discovery Run (No Libraries)" flow -- bypasses
   * preflight, kicks off the existing single-entity scan. Available on
   * Service AND Library rows.
   */
  onStartScanNoLibraries?: () => void;
  /**
   * Spec 2026-06-06: "Start Discovery Run (Database)" flow -- opens the
   * StartDiscoveryRunModal locked to the Database source (no Code/Database
   * toggle). Only meaningful for Service rows.
   */
  onStartDatabaseScan?: () => void;
  /**
   * Spec 2026-06-06: true when the row is a Service whose parent application
   * component is "Persistence Tier" AND whose Core Tech resolves to a supported
   * database pack (PostgreSQL / Sybase) -- i.e. the Core Tech cell is showing
   * the green "database scan pack available" note. Drives mutual exclusivity of
   * the three discovery items: when true the two code items are disabled and
   * the Database item is enabled; when false (the default, and always for
   * libraries) the two code items are enabled and the Database item is disabled.
   */
  isDatabaseService?: boolean;
}

export function GridRowContextMenu({
  isOpen,
  position,
  entityType,
  entityId,
  entityName,
  onClose,
  onAddEndpointsAndEntities,
  onStartDiscoveryRun,
  onStartLibraryScan,
  onStartScanNoLibraries,
  onStartDatabaseScan,
  isDatabaseService,
}: GridRowContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside OR on Escape.
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  // Only render for the entity types that have at least one action.
  const isInterfaces = entityType === 'interfaces';
  const isServices = entityType === 'services';
  const isLibraries = entityType === 'libraries';
  if (!isOpen || (!isInterfaces && !isServices && !isLibraries)) {
    return null;
  }

  const handleAddEndpointsAndEntities = () => {
    onAddEndpointsAndEntities();
    onClose();
  };

  const handleStartLibraryScan = () => {
    if (onStartLibraryScan) onStartLibraryScan();
    onClose();
  };

  // Canonical "no libraries" handler: prefer the new prop; fall back to
  // the legacy `onStartDiscoveryRun` so callers that have not yet wired
  // the new pair continue to work.
  const handleStartScanNoLibraries = () => {
    if (onStartScanNoLibraries) onStartScanNoLibraries();
    else if (onStartDiscoveryRun) onStartDiscoveryRun();
    onClose();
  };

  // Spec 2026-06-06: database-locked discovery run (Persistence-Tier services).
  const handleStartDatabaseScan = () => {
    if (onStartDatabaseScan) onStartDatabaseScan();
    onClose();
  };

  // Calculate position to ensure menu stays within viewport
  const adjustedPosition = {
    x: Math.min(position.x, window.innerWidth - 280),
    y: Math.min(position.y, window.innerHeight - 100),
  };

  let titleFallback = 'Item';
  if (isInterfaces) titleFallback = 'Interface';
  else if (isServices) titleFallback = 'Service';
  else if (isLibraries) titleFallback = 'Library';

  return ReactDOM.createPortal(
    <div
      ref={menuRef}
      className={styles.contextMenu}
      style={{
        left: adjustedPosition.x,
        top: adjustedPosition.y,
      }}
      data-testid="grid-row-context-menu"
    >
      <div className={styles.menuHeader}>
        <span className={styles.menuTitle}>{entityName || titleFallback}</span>
        <span className={styles.menuSubtitle}>{entityId}</span>
      </div>
      <div className={styles.menuDivider} />
      {isInterfaces && (
        <button
          className={styles.menuItem}
          onClick={handleAddEndpointsAndEntities}
          data-testid="grid-row-context-menu-add-endpoints"
        >
          <span className={styles.menuItemIcon}>+</span>
          Add endpoints and entities/attributes
        </button>
      )}
      {(isServices || isLibraries) && (
        <>
          {/* Spec 2026-06-06: the two code items and the Database item are
              mutually exclusive. A Service "showing a database pack" disables
              the code items and enables Database; otherwise the reverse. */}
          <button
            className={styles.menuItem}
            onClick={handleStartLibraryScan}
            disabled={isDatabaseService}
            data-testid="grid-row-context-menu-start-discovery-run"
          >
            <span className={styles.menuItemIcon}>▶</span>
            Start Discovery Run
          </button>
          <button
            className={styles.menuItem}
            onClick={handleStartScanNoLibraries}
            disabled={isDatabaseService}
            data-testid="grid-row-context-menu-start-discovery-run-no-libraries"
          >
            <span className={styles.menuItemIcon}>▷</span>
            Start Discovery Run (No Libraries)
          </button>
          <button
            className={styles.menuItem}
            onClick={handleStartDatabaseScan}
            disabled={!isDatabaseService}
            data-testid="grid-row-context-menu-start-discovery-run-database"
          >
            <span className={styles.menuItemIcon}>▤</span>
            Start Discovery Run (Database)
          </button>
        </>
      )}
    </div>,
    document.body
  );
}
