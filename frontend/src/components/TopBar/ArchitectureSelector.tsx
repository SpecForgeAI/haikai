/**
 * ArchitectureSelector
 *
 * Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 3
 * Spec 2026-05-02 Multi-Architecture CRUD UI + Tag Management -- Task Group 7
 *
 * Pill/chip + dropdown control mounted in the top bar next to the project
 * name. Shows the active architecture's name in the closed state; clicking
 * opens a dropdown listing every non-archived architecture for the active
 * project (oldest-first, matching spec #1's Default-resolution rule).
 * Selecting a row calls `setActiveArchitecture(id)` which navigates to the
 * canonical URL with the new `:architectureId` segment swapped in -- the
 * URL change re-renders the current view against the new architecture's
 * data.
 *
 * Spec #3 (Task Group 7) extension:
 *   Below the existing list of architectures we render a separator and two
 *   footer entries that act as actions (NOT selectable architectures):
 *     - `+ Create architecture...` -> opens EditArchitectureModal in
 *        `mode='create'`.
 *     - `Manage architectures...`  -> opens ManageArchitecturesModal.
 *   Both footer entries are always visible (even when only one Default
 *   architecture exists) so the selector remains a discoverable management
 *   surface from day one. Both modals self-manage their own
 *   `refreshArchitectures()` calls on success, so the selector simply
 *   re-renders against the refreshed context after the modal closes.
 *
 * Visual:
 *   - Closed state: pill/chip with subtle border so the affordance reads
 *     as interactive even when only the migrated `Default` architecture
 *     exists (the spec #1 reality for every project today).
 *   - Both the closed control and dropdown rows show **just the name** --
 *     no tags, no icons, no archived count. Tags exist in the schema but
 *     are managed inside the new modals (spec #3) rather than surfaced
 *     in the dropdown.
 *
 * Behaviour reused from FileMenu.tsx:
 *   - Portal-rendered dropdown for clean z-index stacking.
 *   - Click-outside-to-close listener.
 *   - Escape key closes.
 *   - Dropdown position clamped against the viewport edges.
 *
 * Empty / loading state:
 *   - Until the architectures list resolves, the closed trigger shows a
 *     placeholder ("..." for unresolved id, "-" when no id at all). The
 *     architecture rows are absent in this state but the footer entries
 *     stay visible so a user can still launch the Create/Manage modals.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useArchitectureContext, useActiveArchitectureId } from '../../contexts/ArchitectureContext';
import { useProject } from '../../contexts/ProjectContext';
import { EditArchitectureModal } from './EditArchitectureModal';
import { ManageArchitecturesModal } from './ManageArchitecturesModal';
import styles from './ArchitectureSelector.module.css';

/**
 * Clamp the dropdown menu position to keep it inside the viewport.
 * Mirrors the same helper in FileMenu.tsx with selector-specific dimensions.
 */
function getClampedPosition(
  x: number,
  y: number,
  menuWidth = 200,
  menuHeight = 240
): { posX: number; posY: number } {
  const padding = 5;

  let posX = x;
  let posY = y;

  if (posX + menuWidth > window.innerWidth - padding) {
    posX = window.innerWidth - menuWidth - padding;
  }
  if (posY + menuHeight > window.innerHeight - padding) {
    posY = window.innerHeight - menuHeight - padding;
  }
  if (posX < padding) posX = padding;
  if (posY < padding) posY = padding;

  return { posX, posY };
}

/**
 * Resolve the label rendered in the closed trigger.
 *
 * Decision tree:
 *   1. If the active architecture id resolves against the architectures
 *      list, show its name.
 *   2. If the list has not yet loaded but we have an id, show a short
 *      placeholder ("...") so the control still reads as a pill/chip
 *      rather than collapsing to nothing.
 *   3. If there is no id at all (e.g. routing has not yet redirected),
 *      show a hyphen placeholder.
 */
function resolveTriggerLabel(
  activeId: string | null,
  architectures: { id: string; name: string }[]
): string {
  if (activeId) {
    const match = architectures.find(a => a.id === activeId);
    if (match) return match.name;
    // We have an id from the URL but the list has not arrived yet.
    return '...';
  }
  return '-';
}

export function ArchitectureSelector() {
  const ctx = useArchitectureContext();
  const activeArchitectureId = useActiveArchitectureId();
  const navigate = useNavigate();
  // The selector lives inside ProjectProvider (mounted alongside
  // ArchitectureProvider in App.tsx) so useProject() is always safe to
  // call here. We need the project id to forward into the Create / Manage
  // modals so they can target the right project's architectures.
  const activeProject = useProject();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Spec #3 Task Group 7 -- modal open state. The selector itself owns the
  // open/close state for both modals: the dropdown closes immediately when
  // either footer entry is clicked, then the relevant modal mounts. Closing
  // the modal clears the state and the modal unmounts; the dropdown does
  // NOT auto-reopen (consistent with how FileMenu's modal entries behave).
  const [createOpen, setCreateOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  // Non-archived architectures, oldest-first. The backend already returns the
  // list ordered by created_at ascending (per Architecture API contract), so
  // we only need to filter out archived rows here.
  const nonArchived = (ctx.architectures ?? []).filter(a => !a.archived);

  const triggerLabel = resolveTriggerLabel(activeArchitectureId, nonArchived);

  // ---------------------------------------------------------------------------
  // Open / close handlers
  // ---------------------------------------------------------------------------
  const handleTriggerClick = useCallback(() => {
    if (!triggerRef.current) return;
    if (open) {
      setOpen(false);
      return;
    }
    const rect = triggerRef.current.getBoundingClientRect();
    setPosition({ x: rect.left, y: rect.bottom + 2 });
    setOpen(true);
  }, [open]);

  const close = useCallback(() => setOpen(false), []);

  // ---------------------------------------------------------------------------
  // Click-outside-to-close (mirrors FileMenu pattern)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      // Ignore clicks on the trigger itself -- the trigger's onClick already
      // toggles. Without this guard, clicking the open trigger would fire
      // both close (here) and toggle (onClick) and the menu would re-open.
      if (triggerRef.current && triggerRef.current.contains(target)) {
        return;
      }
      if (menuRef.current && !menuRef.current.contains(target)) {
        close();
      }
    };

    // Slight delay so the same click that opened the menu does not
    // immediately dismiss it.
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open, close]);

  // ---------------------------------------------------------------------------
  // Escape-to-close (mirrors FileMenu pattern)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, close]);

  // ---------------------------------------------------------------------------
  // Row click -- swap the active architecture via context (which navigates).
  // ---------------------------------------------------------------------------
  const handleRowClick = useCallback(
    (id: string) => {
      // No-op on selecting the already-active row -- saves a redundant
      // navigation that would otherwise just push a duplicate history entry.
      if (id !== activeArchitectureId) {
        ctx.setActiveArchitecture(id);
      }
      close();
    },
    [activeArchitectureId, ctx, close]
  );

  // ---------------------------------------------------------------------------
  // Footer entry handlers (spec #3 Task Group 7).
  //
  // Both handlers close the dropdown FIRST and then open the modal. The
  // close-first ordering matters: the dropdown's click-outside listener
  // would otherwise fight the modal overlay for the next click, leading
  // to a confusing flash where both surfaces are momentarily visible.
  // ---------------------------------------------------------------------------
  const handleCreateClick = useCallback(() => {
    close();
    setCreateOpen(true);
  }, [close]);

  const handleManageClick = useCallback(() => {
    close();
    setManageOpen(true);
  }, [close]);

  const handleCreateClose = useCallback(() => setCreateOpen(false), []);
  const handleManageClose = useCallback(() => setManageOpen(false), []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  // Project id is required to mount either modal -- both target a specific
  // project's architectures. If we don't have it (e.g. project still
  // loading), the modals stay closed.
  const projectId = activeProject?.id ?? null;

  // 2026-06-02 discoverability fix: the API Behaviour baselines list page
  // (capture sessions + saved baselines) was deep-link-only -- no nav
  // affordance pointed at it. Add a sibling dropdown action that routes
  // to the active architecture's `/api-behaviour` list page. Mirrors the
  // Create / Manage close-first ordering so the dropdown's click-outside
  // listener does not fight the navigation. Guarded on having both ids --
  // the entry only renders when the project + active architecture resolve.
  const handleApiBehaviourClick = useCallback(() => {
    close();
    if (!projectId || !activeArchitectureId) return;
    navigate(
      `/projects/${projectId}/architectures/${activeArchitectureId}/api-behaviour`,
    );
  }, [close, navigate, projectId, activeArchitectureId]);

  const menuContent = open
    ? (() => {
        const { posX, posY } = getClampedPosition(position.x, position.y);
        return (
          <div
            ref={menuRef}
            className={styles.menu}
            style={{ left: posX, top: posY }}
            data-testid="architecture-selector-menu"
            role="listbox"
          >
            {nonArchived.length === 0 && (
              <div
                className={styles.empty}
                data-testid="architecture-selector-empty"
              >
                No architectures available
              </div>
            )}
            {nonArchived.map(arch => {
              const isActive = arch.id === activeArchitectureId;
              return (
                <div
                  key={arch.id}
                  className={`${styles.menuItem} ${isActive ? styles.menuItemActive : ''}`}
                  onClick={() => handleRowClick(arch.id)}
                  data-testid={`architecture-selector-row-${arch.id}`}
                  role="option"
                  aria-selected={isActive}
                >
                  {/* Just the name -- no tags rendered in the dropdown. Tag
                      management lives in EditArchitectureModal (spec #3). */}
                  {arch.name}
                </div>
              );
            })}

            {/* Spec #3 Task Group 7 -- separator + footer action entries.
                Always rendered, even when the architecture list is empty,
                so a user can launch the Create modal from a fresh project
                or recover from an empty list state.

                The two footer rows use a dedicated `footerItem` class so
                they read visually as actions rather than selectable
                architectures (italicised / muted color, see
                ArchitectureSelector.module.css). They use role="menuitem"
                instead of role="option" so screen readers announce them
                as actions, not selectable list options. */}
            <div className={styles.separator} data-testid="architecture-selector-separator" />
            <div
              className={styles.footerItem}
              onClick={handleCreateClick}
              data-testid="architecture-selector-create"
              role="menuitem"
              tabIndex={0}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleCreateClick();
                }
              }}
            >
              + Create architecture&hellip;
            </div>
            <div
              className={styles.footerItem}
              onClick={handleManageClick}
              data-testid="architecture-selector-manage"
              role="menuitem"
              tabIndex={0}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleManageClick();
                }
              }}
            >
              Manage architectures&hellip;
            </div>
            {/* 2026-06-02 discoverability fix -- entry point to the
                otherwise deep-link-only API Behaviour baselines list
                page for the active architecture. Only rendered when the
                project + active architecture ids are both known so the
                navigation target is always well-formed. */}
            {projectId && activeArchitectureId && (
              <div
                className={styles.footerItem}
                onClick={handleApiBehaviourClick}
                data-testid="architecture-selector-api-behaviour"
                role="menuitem"
                tabIndex={0}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleApiBehaviourClick();
                  }
                }}
              >
                API Behaviour baselines&hellip;
              </div>
            )}
          </div>
        );
      })()
    : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.trigger} ${open ? styles.open : ''}`}
        onClick={handleTriggerClick}
        data-testid="architecture-selector-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={styles.triggerLabel}>{triggerLabel}</span>
        <span className={styles.chevron} aria-hidden="true">&#9662;</span>
      </button>
      {menuContent && ReactDOM.createPortal(menuContent, document.body)}

      {/* Spec #3 Task Group 7 -- Create / Manage modals.
          We always render them but pass `open={createOpen|manageOpen}` so
          they handle their own mount/unmount lifecycle internally (matches
          the modal pattern in EditArchitectureModal/ManageArchitecturesModal).
          The modals call refreshArchitectures() themselves on success so
          the dropdown re-renders against fresh data without selector
          intervention. */}
      {projectId && (
        <>
          <EditArchitectureModal
            mode="create"
            open={createOpen}
            onClose={handleCreateClose}
            projectId={projectId}
          />
          <ManageArchitecturesModal
            open={manageOpen}
            onClose={handleManageClose}
            projectId={projectId}
          />
        </>
      )}
    </>
  );
}

export default ArchitectureSelector;
