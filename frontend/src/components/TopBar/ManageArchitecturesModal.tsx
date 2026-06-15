/**
 * ManageArchitecturesModal
 *
 * Spec 2026-05-02 Multi-Architecture CRUD UI + Tag Management -- Task Group 5
 * (Group 6 backfill: replaced the `onArchiveStub` placeholder with the real
 * ArchiveArchitectureConfirmModal wiring.)
 *
 * Spec 2026-05-01 Multi-Architecture Full Clone (Spec #6) -- Task Group 7
 * adds the per-row Clone action alongside Edit + Archive. Clicking Clone
 * opens the dedicated `CloneArchitectureModal` from Group 6 against the
 * row's architecture as `source`. No selector dropdown footer entry --
 * Clone lives only in the Manage modal (locked decision #1).
 *
 * Spec 2026-05-01 Multi-Architecture Selective Cross-Architecture Copy
 * (Spec #7) -- Task Group 10 adds the per-row `Copy from...` action as a
 * fourth button alongside Edit + Clone + Archive. The clicked row IS the
 * source; the currently-active architecture is the target. The button is
 * disabled-with-tooltip on the row that IS the active architecture
 * (safety property (h)) -- you cannot copy into yourself. Clicking on a
 * non-active row opens `SelectiveCopyWizardModal` (Group 9) wired with
 * `source={row}` and `target={activeArchitecture}`. No selector dropdown
 * footer entry -- the wizard lives ONLY in the Manage modal (locked
 * decision, mirrors the Clone discoverability rule).
 *
 * Spec 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 7
 * adds the per-row `Capture API Behaviour Baseline` action. Clicking it
 * opens `StartCaptureSessionWizard` pre-bound to the row's
 * `projectId` + `architectureId`. Mirrors the Copy from / Clone
 * discoverability rule -- the launcher lives ONLY here, no selector
 * footer entry.
 *
 * Lists every non-archived architecture for the active project and exposes
 * per-row Edit + Clone + Archive + Copy from + Capture API Behaviour
 * Baseline actions:
 *
 *   - Edit       -> opens the Group 4 EditArchitectureModal in `mode='edit'`
 *                   pre-populated with that row's {name, description, tags}.
 *   - Clone      -> opens the Group 6 CloneArchitectureModal seeded from the
 *                   row's architecture (Name pre-populated as `Copy of <name>`,
 *                   description copied, tags empty).
 *   - Archive    -> opens the Group 6 ArchiveArchitectureConfirmModal for
 *                   the row.
 *   - Copy from  -> (Spec #7 Group 10) opens SelectiveCopyWizardModal with
 *                   source=row and target=activeArchitecture. Disabled with
 *                   tooltip when row IS the active architecture.
 *   - Capture API Behaviour Baseline -> (Spec 2026-05-15 Group 7) opens the
 *                   StartCaptureSessionWizard pre-bound to the row's
 *                   projectId + architectureId.
 *
 * Behavioural rules locked in by the spec / requirements doc:
 *
 *   - Rows ordered oldest-first by `createdAt` (matches spec #2's selector
 *     ordering and spec #1's "Default = oldest non-archived" rule). The
 *     backend already returns the list ordered ASC by created_at; we sort
 *     defensively here in case a future caller mutates the array.
 *
 *   - Archived architectures are NEVER rendered (requirements decision #2 --
 *     unarchive UI is out of scope, surfacing archived rows would confuse
 *     the user with rows they cannot act on). This also satisfies safety
 *     property (g) of spec #6: the Clone button is inherently unreachable
 *     for archived rows because the row itself does not render. The same
 *     filter inherently locks out Copy from on archived rows -- the spec
 *     #7 backend would refuse with 422 archived_source anyway, but the row
 *     never renders so the button never exists.
 *
 *   - Safety property (b) client-side: when only one non-archived
 *     architecture exists, its Archive button is disabled with a tooltip
 *     ("Cannot archive -- every project must have at least one
 *     architecture."). The server also rejects with 422 as the source of
 *     truth -- this is defence in depth.
 *
 *   - Safety property (h) client-side (spec #7): the Copy from button on
 *     the row that IS the active architecture is disabled with a tooltip
 *     ("Cannot copy into itself -- switch to a different architecture
 *     first."). The server also refuses with 422 same_architecture as the
 *     source of truth -- this is defence in depth.
 *
 *   - All mutations happen in the child modals (EditArchitectureModal,
 *     CloneArchitectureModal, ArchiveArchitectureConfirmModal,
 *     SelectiveCopyWizardModal, and StartCaptureSessionWizard each call
 *     refreshArchitectures() / their own success handling themselves). This
 *     modal is read-only over the architectures list and re-renders
 *     automatically when ArchitectureContext updates.
 *
 * Modal shell (overlay + header + content + footer with single Close button)
 * mirrors the EditArchitectureModal pattern from Task Group 4.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Architecture } from '../../api/architecturesApi';
import { ApiBehaviourCaptureSessionDto } from '../../api/apiBehaviourClient';
import { useArchitectureContext } from '../../contexts/ArchitectureContext';
import { EditArchitectureModal } from './EditArchitectureModal';
import { ArchiveArchitectureConfirmModal } from './ArchiveArchitectureConfirmModal';
import { CloneArchitectureModal } from './CloneArchitectureModal';
import { SelectiveCopyWizardModal } from './SelectiveCopyWizardModal';
import { StartCaptureSessionWizard } from '../ApiBehaviour/StartCaptureSessionWizard';
import styles from './ManageArchitecturesModal.module.css';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Tooltip surfaced on the Archive button when only one non-archived
 * architecture remains. Matches the spec verbatim so the test assertion
 * and the visible tooltip stay in sync.
 */
const LAST_ARCH_TOOLTIP =
  'Cannot archive — every project must have at least one architecture.';

/**
 * Tooltip surfaced on the Copy from button when the row IS the currently
 * active architecture (safety property (h) of spec #7). Matches the spec
 * verbatim so the test assertion and the visible tooltip stay in sync.
 */
const COPY_FROM_SELF_TOOLTIP =
  'Cannot copy into itself — switch to a different architecture first.';

/**
 * Spec 2026-05-15 Create Target Baseline from Current State -- Task Group 6
 *
 * Tooltip surfaced on the new `Create Target Baseline` button when the row
 * IS the currently active architecture. Same wording as the Copy from
 * tooltip per the spec ("Disabled with same tooltip as Copy from… when
 * row is active arch").
 */
const CREATE_TARGET_BASELINE_SELF_TOOLTIP = COPY_FROM_SELF_TOOLTIP;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ManageArchitecturesModalProps {
  /** Whether the modal is rendered. */
  open: boolean;
  /** Called when the modal should close (Cancel, Escape, click-outside). */
  onClose: () => void;
  /** Project the architectures belong to. */
  projectId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sort architectures oldest-first by `createdAt`. Falls back to `id`
 * lexicographic order when timestamps are equal so the ordering is
 * deterministic. Pure helper for testability.
 */
function sortOldestFirst(architectures: Architecture[]): Architecture[] {
  return [...architectures].sort((a, b) => {
    const timeA = Date.parse(a.createdAt);
    const timeB = Date.parse(b.createdAt);
    if (Number.isFinite(timeA) && Number.isFinite(timeB) && timeA !== timeB) {
      return timeA - timeB;
    }
    return a.id.localeCompare(b.id);
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ManageArchitecturesModal({
  open,
  onClose,
  projectId,
}: ManageArchitecturesModalProps) {
  const { architectures, activeArchitectureId } = useArchitectureContext();
  const navigate = useNavigate();

  // Local state: the architecture being edited (if any). When non-null the
  // child EditArchitectureModal is rendered on top of the manage modal in
  // edit mode. Closing the child clears this back to null and the parent
  // remains visible so the user can continue managing the list.
  const [editingArchitecture, setEditingArchitecture] = useState<Architecture | null>(null);

  // Local state: the architecture being cloned (if any). When non-null the
  // child CloneArchitectureModal renders on top of the manage modal seeded
  // from this architecture. Closing the clone modal (Cancel, Escape, click
  // outside, success) clears this back to null and the manage modal regains
  // focus -- mirrors the editingArchitecture / archivingArchitecture
  // state pattern (locked decision: same shape as Edit + Archive).
  const [cloningArchitecture, setCloningArchitecture] = useState<Architecture | null>(null);

  // Local state: the architecture queued for archive confirmation. When
  // non-null, ArchiveArchitectureConfirmModal renders on top of the manage
  // modal. Closing the confirm modal (Cancel, X, success) clears this back
  // to null so the manage modal regains focus.
  const [archivingArchitecture, setArchivingArchitecture] = useState<Architecture | null>(null);

  // Local state (Spec #7 Group 10 + Spec 2026-05-15 Group 6): the
  // architecture the user has chosen as the SOURCE of a selective copy,
  // plus the `initialAutoMap` flag derived from which button opened the
  // wizard. When non-null, SelectiveCopyWizardModal renders on top of the
  // manage modal with this architecture as `source`, the active
  // architecture as `target`, and the autoMap checkbox pre-set per the
  // launch button:
  //   - `Copy from…` (existing button)            -> initialAutoMap=false
  //   - `Create Target Baseline` (new spec button) -> initialAutoMap=true
  // Closing the wizard (Cancel, Esc, click outside, commit success) clears
  // this back to null and the manage modal regains focus.
  const [copyingFromState, setCopyingFromState] = useState<{
    architecture: Architecture;
    initialAutoMap: boolean;
  } | null>(null);

  // Spec 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 7
  // The architecture the user is launching the capture-session wizard
  // against. When non-null, StartCaptureSessionWizard renders on top of the
  // manage modal pre-bound to this architecture's projectId + id.
  const [capturingArchitecture, setCapturingArchitecture] = useState<Architecture | null>(null);

  // ---- Derived list ------------------------------------------------------
  // Non-archived only (requirements decision #2), oldest-first (spec #2's
  // selector ordering rule). useMemo keeps the sort stable across re-renders
  // when nothing relevant changes.
  const nonArchived = useMemo(
    () => sortOldestFirst((architectures ?? []).filter(a => !a.archived)),
    [architectures]
  );

  // Safety property (b) client-side: Archive disabled when only one
  // non-archived architecture exists.
  const isOnlyArchitecture = nonArchived.length === 1;

  // Resolve the currently-active architecture object out of the
  // architectures list. Used as `target` for the selective-copy wizard
  // (spec #7 Group 10). May be null briefly during a refresh race -- in
  // that case we don't render the wizard even if `copyingFromArchitecture`
  // is set, because we have no valid target to pass through.
  const activeArchitecture = useMemo(
    () => (architectures ?? []).find(a => a.id === activeArchitectureId) ?? null,
    [architectures, activeArchitectureId]
  );

  // ---- Escape-to-close ---------------------------------------------------
  // Skip the listener while a child modal is open -- that modal owns the
  // Escape key while it's mounted. Edit, Clone, Archive, the spec #7
  // Selective Copy wizard, and the spec 2026-05-15 capture wizard all need
  // to suppress the parent's Escape handler so pressing Escape dismisses
  // the topmost modal first (standard nested-modal behaviour).
  useEffect(() => {
    if (!open) return;
    if (editingArchitecture) return;
    if (cloningArchitecture) return;
    if (archivingArchitecture) return;
    if (copyingFromState) return;
    if (capturingArchitecture) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [
    open,
    editingArchitecture,
    cloningArchitecture,
    archivingArchitecture,
    copyingFromState,
    capturingArchitecture,
    onClose,
  ]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      // Only close on a click directly on the overlay backdrop.
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  // ---- Per-row handlers --------------------------------------------------
  const handleEditClick = useCallback((arch: Architecture) => {
    setEditingArchitecture(arch);
  }, []);

  const handleEditClose = useCallback(() => {
    setEditingArchitecture(null);
  }, []);

  const handleCloneClick = useCallback((arch: Architecture) => {
    setCloningArchitecture(arch);
  }, []);

  const handleCloneClose = useCallback(() => {
    setCloningArchitecture(null);
  }, []);

  const handleArchiveClick = useCallback(
    (arch: Architecture) => {
      if (isOnlyArchitecture) return; // Defensive guard -- button is disabled.
      setArchivingArchitecture(arch);
    },
    [isOnlyArchitecture]
  );

  const handleArchiveClose = useCallback(() => {
    setArchivingArchitecture(null);
  }, []);

  // Spec #7 Group 10: open the Selective Copy wizard with the row as
  // `source` and the active architecture as `target`. Defensive guard:
  // never set state when the row IS the active architecture (the button
  // is also disabled, so this is a defence-in-depth no-op).
  //
  // Spec 2026-05-15 Group 6: existing `Copy from…` button continues to
  // launch the wizard with `initialAutoMap=false` so plain selective-copy
  // users see no behavioural change.
  const handleCopyFromClick = useCallback(
    (arch: Architecture) => {
      if (arch.id === activeArchitectureId) return;
      setCopyingFromState({ architecture: arch, initialAutoMap: false });
    },
    [activeArchitectureId]
  );

  // Spec 2026-05-15 Group 6: new `Create Target Baseline` button. Opens the
  // same SelectiveCopyWizardModal as the Copy from… button but with
  // `initialAutoMap=true` so the autoMap checkbox is pre-checked, the
  // wizard transitions into the Mapping Review step on commit, and the
  // success toast announces the created mapping count.
  const handleCreateTargetBaselineClick = useCallback(
    (arch: Architecture) => {
      if (arch.id === activeArchitectureId) return;
      setCopyingFromState({ architecture: arch, initialAutoMap: true });
    },
    [activeArchitectureId]
  );

  const handleCopyFromClose = useCallback(() => {
    setCopyingFromState(null);
  }, []);

  // Spec 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 7
  // Opens the per-row capture wizard pre-bound to the clicked row's
  // projectId + architectureId.
  const handleCaptureBaselineClick = useCallback((arch: Architecture) => {
    setCapturingArchitecture(arch);
  }, []);

  const handleCaptureBaselineClose = useCallback(() => {
    setCapturingArchitecture(null);
  }, []);

  // 2026-06-02 navigate-on-start fix: the capture wizard previously
  // closed with NO feedback on a successful /start, stranding the user.
  // On a real start the wizard hands back the running session via
  // `onStarted`; we capture the row's architecture id + the session id
  // into locals BEFORE clearing `capturingArchitecture` (so nothing is
  // null by navigation time), close the Manage modal, then navigate to
  // the architecture-scoped capture-session detail page where the user
  // can watch progress poll. Cancel/Escape stay on `handleCaptureBaselineClose`
  // (no navigation) -- only a genuine start routes anywhere.
  const handleCaptureBaselineStarted = useCallback(
    (session: ApiBehaviourCaptureSessionDto) => {
      const startedArchitectureId = capturingArchitecture?.id ?? session.architecture_id;
      const startedSessionId = session.id;
      setCapturingArchitecture(null);
      // Close the Manage Architectures modal so the detail page is
      // unobscured, then route the user to the polling capture-session view.
      onClose();
      if (startedArchitectureId && startedSessionId) {
        navigate(
          `/projects/${projectId}/architectures/${startedArchitectureId}` +
            `/api-behaviour/sessions/${startedSessionId}`,
        );
      }
    },
    [capturingArchitecture, projectId, navigate, onClose],
  );

  // ---- Render ------------------------------------------------------------
  if (!open) return null;

  return (
    <>
      <div
        className={styles.overlay}
        onClick={handleOverlayClick}
        data-testid="manage-architectures-modal"
      >
        <div
          className={styles.modal}
          role="dialog"
          aria-modal="true"
          aria-labelledby="manage-architectures-modal-title"
        >
          {/* Header */}
          <div className={styles.header}>
            <h2 className={styles.title} id="manage-architectures-modal-title">
              Manage architectures
            </h2>
            <button
              className={styles.closeButton}
              onClick={onClose}
              title="Close"
              data-testid="manage-architectures-modal-close"
            >
              &times;
            </button>
          </div>

          {/* Content */}
          <div className={styles.content}>
            {nonArchived.length === 0 ? (
              <div
                className={styles.emptyState}
                data-testid="manage-architectures-empty"
              >
                No architectures.
              </div>
            ) : (
              <ul
                className={styles.list}
                data-testid="manage-architectures-list"
              >
                {nonArchived.map(arch => {
                  // Spec #7 Group 10: per-row Copy from disabled-on-self
                  // (safety property (h)). Computed once per row so the
                  // disabled flag and tooltip stay in sync.
                  const isSelfForCopy = arch.id === activeArchitectureId;
                  return (
                    <li
                      key={arch.id}
                      className={styles.row}
                      data-testid={`manage-architectures-row-${arch.id}`}
                    >
                      <div className={styles.rowMeta}>
                        <div
                          className={styles.rowName}
                          data-testid={`manage-architectures-row-name-${arch.id}`}
                        >
                          {arch.name}
                        </div>
                        {arch.description && (
                          <div
                            className={styles.rowDescription}
                            title={arch.description}
                            data-testid={`manage-architectures-row-description-${arch.id}`}
                          >
                            {arch.description}
                          </div>
                        )}
                        {arch.tags.length > 0 && (
                          <div
                            className={styles.rowTags}
                            data-testid={`manage-architectures-row-tags-${arch.id}`}
                          >
                            {arch.tags.map(tag => (
                              <span
                                key={tag}
                                className={styles.tagChip}
                                data-testid={`manage-architectures-row-tag-${arch.id}-${tag}`}
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className={styles.rowActions}>
                        <button
                          type="button"
                          className={styles.editButton}
                          onClick={() => handleEditClick(arch)}
                          data-testid={`manage-architectures-edit-${arch.id}`}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className={styles.cloneButton}
                          onClick={() => handleCloneClick(arch)}
                          data-testid={`manage-architectures-clone-${arch.id}`}
                        >
                          Clone
                        </button>
                        {/* Spec #7 Group 10: per-row Copy from button.
                            Slots in as the fourth action; disabled with
                            spec'd tooltip when the row IS the active
                            architecture (safety property (h)). */}
                        <button
                          type="button"
                          className={styles.copyFromButton}
                          onClick={() => handleCopyFromClick(arch)}
                          disabled={isSelfForCopy}
                          // Tooltip via the native HTML `title` attribute --
                          // simplest mechanism that works for keyboard +
                          // mouse + screen readers without pulling in a
                          // tooltip primitive that does not yet exist in
                          // this codebase. Mirrors the Archive button
                          // pattern above.
                          title={isSelfForCopy ? COPY_FROM_SELF_TOOLTIP : undefined}
                          data-testid={`manage-architectures-copy-from-${arch.id}`}
                        >
                          Copy from…
                        </button>
                        {/* Spec 2026-05-15 Create Target Baseline from
                            Current State -- Task Group 6: new per-row
                            entry-point button. Slots in next to Copy
                            from…; opens the same wizard with
                            `initialAutoMap=true` so the autoMap checkbox
                            is pre-checked. Disabled with the same tooltip
                            as Copy from… when the row is the active
                            architecture. */}
                        <button
                          type="button"
                          className={styles.copyFromButton}
                          onClick={() => handleCreateTargetBaselineClick(arch)}
                          disabled={isSelfForCopy}
                          title={isSelfForCopy ? CREATE_TARGET_BASELINE_SELF_TOOLTIP : undefined}
                          data-testid={`manage-architectures-create-target-baseline-${arch.id}`}
                        >
                          Create Target Baseline
                        </button>
                        {/* Spec 2026-05-15 API Behaviour Baseline Capture
                            Service -- Task Group 7: per-row capture
                            launcher. Pre-binds the wizard to the row's
                            projectId + architectureId. Always enabled --
                            capture is independent of the active
                            architecture (the user is explicitly choosing
                            which architecture to capture against). */}
                        <button
                          type="button"
                          className={styles.copyFromButton}
                          onClick={() => handleCaptureBaselineClick(arch)}
                          data-testid={`manage-architectures-capture-baseline-${arch.id}`}
                        >
                          Capture API Behaviour Baseline
                        </button>
                        <button
                          type="button"
                          className={styles.archiveButton}
                          onClick={() => handleArchiveClick(arch)}
                          disabled={isOnlyArchitecture}
                          // Tooltip via the native HTML `title` attribute --
                          // simplest mechanism that works for keyboard +
                          // mouse + screen readers without pulling in a
                          // tooltip primitive that does not yet exist in
                          // this codebase.
                          title={isOnlyArchitecture ? LAST_ARCH_TOOLTIP : undefined}
                          data-testid={`manage-architectures-archive-${arch.id}`}
                        >
                          Archive
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Footer */}
          <div className={styles.footer}>
            <button
              className={styles.closeFooterButton}
              onClick={onClose}
              data-testid="manage-architectures-close-button"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      {/* Nested Edit modal -- rendered on top of the manage modal when a
          row's Edit button is clicked. The child handles its own
          refreshArchitectures() and onClose; we just clear our local
          editing state on close. */}
      {editingArchitecture && (
        <EditArchitectureModal
          mode="edit"
          open={true}
          onClose={handleEditClose}
          projectId={projectId}
          architecture={editingArchitecture}
        />
      )}

      {/* Nested Clone modal -- rendered on top of the manage modal when a
          row's Clone button is clicked. The child seeds itself from
          `source`, calls refreshArchitectures() + setActiveArchitecture()
          on success (safety property (h)), and then invokes onClose.
          Mounted only when cloningArchitecture is non-null so the modal's
          `open` is always true while it is in the DOM (mirrors the Edit
          guard pattern above). */}
      {cloningArchitecture && (
        <CloneArchitectureModal
          open={true}
          onClose={handleCloneClose}
          projectId={projectId}
          source={cloningArchitecture}
        />
      )}

      {/* Nested Archive confirm modal -- mounted on top of the manage modal
          when a row's Archive button is clicked. The child handles its own
          archiveArchitecture() + refreshArchitectures() + (if active)
          setActiveArchitecture(nextId), and calls onClose on success or
          Cancel. We just clear our local state. */}
      <ArchiveArchitectureConfirmModal
        architecture={archivingArchitecture}
        projectId={projectId}
        onClose={handleArchiveClose}
      />

      {/* Nested Selective Copy wizard (Spec #7 Group 10) -- mounted on top
          of the manage modal when a row's Copy from button is clicked.
          Source is the clicked row; target is the currently-active
          architecture. Mounted only when BOTH copyingFromArchitecture is
          set AND we have a resolved active architecture (defensive guard
          against the rare refresh race where activeArchitectureId points
          at an architecture not yet in the list). The wizard handles its
          own refreshArchitectures() + post-copy toast and invokes onClose
          on success or cancel; we just clear our local state. Mirrors the
          Clone guard pattern above. */}
      {copyingFromState && activeArchitecture && (
        <SelectiveCopyWizardModal
          open={true}
          onClose={handleCopyFromClose}
          projectId={projectId}
          source={copyingFromState.architecture}
          target={activeArchitecture}
          initialAutoMap={copyingFromState.initialAutoMap}
        />
      )}

      {/* Spec 2026-05-15 API Behaviour Baseline Capture Service -- Task
          Group 7: nested capture wizard. Mounted only when
          `capturingArchitecture` is non-null. The wizard owns the full
          create-session -> submit-secrets -> parse-oas -> configure ->
          start sequence and calls `onClose` on success or cancel; we just
          clear our local state. Mirrors the Clone / Selective-Copy guard
          pattern above. */}
      {capturingArchitecture && (
        <StartCaptureSessionWizard
          open={true}
          onClose={handleCaptureBaselineClose}
          onStarted={handleCaptureBaselineStarted}
          projectId={projectId}
          architectureId={capturingArchitecture.id}
          architectureName={capturingArchitecture.name}
        />
      )}
    </>
  );
}

export default ManageArchitecturesModal;
