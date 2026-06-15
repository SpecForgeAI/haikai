/**
 * SelectiveCopyWizardModal
 *
 * Spec 2026-05-01 Multi-Architecture Selective Cross-Architecture Copy
 * (Spec #7) -- Task Group 9
 *
 * Multi-step modal that orchestrates the entire selective-copy workflow.
 * Owns the cross-step state (selection, preflight result, resolution map,
 * in-flight + error flags) and delegates the per-step UI to two pure
 * presentational children:
 *   - `SelectiveCopyElementPicker` (Group 7) -- picker tree.
 *   - `SelectiveCopyConflictResolution` (Group 8) -- conflict + auto-include
 *     resolution table.
 *
 * The wizard is opened from `ManageArchitecturesModal` (Group 10) via the
 * per-row `Copy from...` button. The clicked row is the source; the
 * currently-active architecture is the target -- the parent passes the
 * target through props (it already knows it).
 *
 * Spec 2026-05-15 Create Target Baseline from Current State -- Task Group 6
 *   The wizard grows from 3 steps to 4 steps:
 *     1. Pick elements
 *     2. Review & resolve  (now hosts an `autoMap` checkbox)
 *     3. Commit
 *     4. Review mappings   (only entered when the commit succeeded with
 *                           autoMap=true; the user can also re-enter from
 *                           the entry point in `ManageArchitecturesModal`)
 *
 *   The wizard now accepts an `initialAutoMap` prop. The new
 *   `Create Target Baseline` button in `ManageArchitecturesModal` opens the
 *   wizard with `initialAutoMap=true`; the existing `Copy from\u2026` button
 *   continues to default it to `false` so plain selective-copy users see no
 *   behavioural change.
 *
 *   On commit success, the wizard ALWAYS invalidates the target architecture
 *   model cache (per `project_appshell_model_cache.md`):
 *     - same-arch case: `loadModelByProjectId` + dispatch LOAD_MODEL
 *     - cross-arch case: `invalidateArchitectureModelCache(targetId)` from
 *       the architecture context
 *   This branch runs regardless of `autoMap` because the copy alone also
 *   bypasses the dispatch path.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Architecture,
  ArchitectureElementMappingDto,
  ArchitecturesApiError,
  ElementInventoryResponse,
  SelectiveCopyAutoIncluded,
  SelectiveCopyCommitResponse,
  SelectiveCopyPreflightResponse,
  getElementsInventory,
  listArchitectureMappings,
  selectiveCopyCommit,
  selectiveCopyPreflight,
} from '../../api/architecturesApi';
import { useArchitectureContext, useArchitectureDispatch } from '../../contexts/ArchitectureContext';
import { useToast } from '../../contexts/ToastContext';
import { loadModelByProjectId } from '../../api/modelApi';
import {
  ResolutionAction,
  SelectiveCopyConflictResolution,
} from './SelectiveCopyConflictResolution';
import { SelectiveCopyElementPicker } from './SelectiveCopyElementPicker';
import { SelectiveCopyMappingReviewStep } from './SelectiveCopyMappingReviewStep';
import styles from './SelectiveCopyWizardModal.module.css';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SelectiveCopyWizardModalProps {
  /** Whether the modal is rendered. Internal state resets when this flips to true. */
  open: boolean;
  /** Called when the modal should close (Cancel, Escape, click-outside, success). */
  onClose: () => void;
  /** Project the source + target both live in (cross-project copy is out of scope per spec). */
  projectId: string;
  /** The architecture being copied FROM. Drives the inventory fetch + header copy. */
  source: Architecture;
  /** The architecture being copied INTO -- the active one. Drives the header copy. */
  target: Architecture;
  /**
   * Spec 2026-05-15 Create Target Baseline from Current State -- Task Group 6
   *
   * Initial value of the `autoMap` checkbox on step 2. Defaults to `false`
   * for backward compatibility with the existing `Copy from\u2026` button.
   * The new `Create Target Baseline` button in `ManageArchitecturesModal`
   * passes `true`.
   */
  initialAutoMap?: boolean;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type WizardStep = 'pick' | 'resolve' | 'committing' | 'mapping-review';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Map an `ArchitecturesApiError` to the footer banner copy. Branches the
 * documented 422 codes; falls back to a generic message.
 */
function describeApiError(err: unknown): string {
  if (err instanceof ArchitecturesApiError) {
    if (err.status === 422 && err.body?.code === 'archived_source') {
      return 'Source architecture is archived; cannot copy.';
    }
    if (err.status === 422 && err.body?.code === 'same_architecture') {
      return 'Cannot copy into the same architecture.';
    }
    if (err.status === 422 && err.body?.code === 'missing_reference') {
      return (
        err.body.message ??
        'A required reference is missing -- you may have un-ticked an auto-included element. Re-run preflight and review.'
      );
    }
    if (err.status === 400) {
      return err.body?.message ?? 'Could not copy -- please check your input.';
    }
    return err.body?.message ?? 'Could not copy -- please try again.';
  }
  return 'Could not copy -- please try again.';
}

/**
 * Seed the `resolutions` map with `skip` for every conflict in the preflight
 * response (safety property (i)). The wizard owns this initialisation per
 * the contract documented in `SelectiveCopyConflictResolution`.
 */
function initialResolutionsFromPreflight(
  preflight: SelectiveCopyPreflightResponse,
): Record<string, ResolutionAction> {
  const seed: Record<string, ResolutionAction> = {};
  for (const c of preflight.conflicts) {
    seed[c.elementId] = 'skip';
  }
  return seed;
}

/** Merge auto-included elements into a working selection set. */
function mergeAutoIncluded(
  selection: Set<string>,
  autoIncluded: SelectiveCopyAutoIncluded[],
): Set<string> {
  const next = new Set(selection);
  for (const a of autoIncluded) next.add(a.elementId);
  return next;
}

/**
 * Build the post-copy toast message (safety property (k)).
 *
 * Spec 2026-05-15 Create Target Baseline from Current State -- Task Group 6
 *   Appends `, N mappings created` when `createdMappingCount > 0`. The
 *   leading "Copied N elements ... (skipped/overwrote/duplicated)" segment
 *   is preserved verbatim so the existing toast assertion regression-tests
 *   keep passing.
 */
function buildSuccessToast(
  sourceName: string,
  result: SelectiveCopyCommitResponse,
): string {
  const base = `Copied ${result.copied} elements from ${sourceName} (skipped: ${result.skipped}, overwrote: ${result.overwritten}, duplicated: ${result.duplicated})`;
  if (result.createdMappingCount > 0) {
    return `${base}, ${result.createdMappingCount} mappings created`;
  }
  return base;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SelectiveCopyWizardModal({
  open,
  onClose,
  projectId,
  source,
  target,
  initialAutoMap = false,
}: SelectiveCopyWizardModalProps) {
  const {
    refreshArchitectures,
    activeArchitectureId,
    invalidateArchitectureModelCache,
  } = useArchitectureContext();
  const dispatch = useArchitectureDispatch();
  const { showToast } = useToast();

  // ---- Wizard step ------------------------------------------------------
  const [step, setStep] = useState<WizardStep>('pick');

  // ---- Inventory --------------------------------------------------------
  const [inventory, setInventory] = useState<ElementInventoryResponse | null>(null);
  const [inventoryLoading, setInventoryLoading] = useState(false);

  // ---- Selection --------------------------------------------------------
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ---- Preflight result -------------------------------------------------
  const [preflight, setPreflight] = useState<SelectiveCopyPreflightResponse | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);

  // ---- Resolutions (per-row) -------------------------------------------
  const [resolutions, setResolutions] = useState<Record<string, ResolutionAction>>({});

  // ---- autoMap (Spec 2026-05-15 Group 6) -------------------------------
  const [autoMap, setAutoMap] = useState<boolean>(initialAutoMap);

  // ---- Initial mapping seed for the Mapping Review step ----------------
  // We pre-fetch the freshly-created mapping list once when transitioning
  // into step 4 so the user sees the rows immediately. The Mapping Review
  // step then re-fetches itself on every mutation; the seed is a perf
  // nicety, not the source of truth.
  const [mappingSeed, setMappingSeed] = useState<ArchitectureElementMappingDto[] | null>(null);

  // ---- Commit + error ---------------------------------------------------
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Track in-flight requests so we can guard against state updates after
  // the modal unmounts / re-opens (covers the rare close-during-fetch case).
  const inFlightRef = useRef<{ token: number }>({ token: 0 });

  // ---- Reset state on open ---------------------------------------------
  useEffect(() => {
    if (!open) return;
    inFlightRef.current = { token: inFlightRef.current.token + 1 };
    setStep('pick');
    setInventory(null);
    setInventoryLoading(false);
    setSelectedIds(new Set());
    setPreflight(null);
    setPreflightLoading(false);
    setResolutions({});
    setAutoMap(initialAutoMap);
    setMappingSeed(null);
    setSubmitError(null);
  }, [open, initialAutoMap]);

  // ---- Fetch inventory on open / when source changes -------------------
  useEffect(() => {
    if (!open) return;
    const myToken = inFlightRef.current.token;
    setInventoryLoading(true);
    setSubmitError(null);
    let cancelled = false;
    (async () => {
      try {
        const inv = await getElementsInventory(projectId, source.id);
        if (cancelled || inFlightRef.current.token !== myToken) return;
        setInventory(inv);
      } catch (err) {
        if (cancelled || inFlightRef.current.token !== myToken) return;
        setSubmitError(describeApiError(err));
      } finally {
        if (cancelled || inFlightRef.current.token !== myToken) return;
        setInventoryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, projectId, source.id]);

  // ---- Esc-to-close ----------------------------------------------------
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && step !== 'committing') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose, step]);

  // ---- Click-outside ---------------------------------------------------
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && step !== 'committing') onClose();
    },
    [onClose, step],
  );

  // ---- Step transitions ------------------------------------------------

  const handleNextFromPick = useCallback(async () => {
    setSubmitError(null);
    setPreflightLoading(true);
    const myToken = inFlightRef.current.token;
    try {
      const result = await selectiveCopyPreflight(projectId, target.id, {
        sourceArchitectureId: source.id,
        elementIds: Array.from(selectedIds),
      });
      if (inFlightRef.current.token !== myToken) return;
      // Merge auto-included ids into the working selection so a subsequent
      // back-navigation shows the picker with the right ticks. The conflict
      // resolution component shows them in their own labelled group, so
      // there is no visual duplication.
      setSelectedIds((prev) => mergeAutoIncluded(prev, result.autoIncluded));
      setPreflight(result);
      setResolutions(initialResolutionsFromPreflight(result));
      setStep('resolve');
    } catch (err) {
      if (inFlightRef.current.token !== myToken) return;
      setSubmitError(describeApiError(err));
    } finally {
      if (inFlightRef.current.token !== myToken) return;
      setPreflightLoading(false);
    }
  }, [projectId, target.id, source.id, selectedIds]);

  const handleBackToPick = useCallback(() => {
    if (step === 'committing') return;
    setSubmitError(null);
    setStep('pick');
  }, [step]);

  // Spec 2026-05-15 Group 7: refresh / invalidate the target architecture's
  // model cache after every successful copy. Backend writes bypass the
  // frontend dispatch path, so the cached model is stale unless we
  // explicitly refresh (active-arch) or invalidate (cross-arch). This
  // branch runs regardless of `autoMap` because the copy alone also writes
  // new target rows.
  const refreshTargetCache = useCallback(async () => {
    if (target.id === activeArchitectureId) {
      // Same-arch: dispatch LOAD_MODEL with a fresh fetch so the user sees
      // the new entities in their current view.
      try {
        const model = await loadModelByProjectId(projectId, target.id);
        dispatch({ type: 'LOAD_MODEL', payload: model, fileName: target.name });
      } catch (err) {
        // Loading failures are non-fatal for the wizard's success path; we
        // log and let the user trigger a manual refresh later.
        console.warn(
          '[SelectiveCopyWizardModal] Could not reload target architecture model:',
          err,
        );
      }
    } else {
      // Cross-arch: drop the cached entry so the next activation refetches
      // from AMS.
      invalidateArchitectureModelCache(target.id);
    }
  }, [
    target.id,
    target.name,
    activeArchitectureId,
    projectId,
    dispatch,
    invalidateArchitectureModelCache,
  ]);

  const handleCommit = useCallback(async () => {
    if (!preflight) return;
    setSubmitError(null);
    setStep('committing');
    const myToken = inFlightRef.current.token;
    try {
      const result = await selectiveCopyCommit(projectId, target.id, {
        sourceArchitectureId: source.id,
        elementIds: Array.from(selectedIds),
        resolutions: Object.entries(resolutions).map(([elementId, action]) => ({
          elementId,
          action,
        })),
        autoMap,
      });
      if (inFlightRef.current.token !== myToken) return;
      // Refresh first so the dropdown / Manage modal repaint against the
      // updated architecture state before any further navigation.
      await refreshArchitectures();
      if (inFlightRef.current.token !== myToken) return;

      // Spec 2026-05-15 Group 7: refresh / invalidate the target arch
      // model cache. Runs regardless of `autoMap` because copy alone also
      // bypasses the dispatch path.
      await refreshTargetCache();
      if (inFlightRef.current.token !== myToken) return;

      // Toast first so the user always sees the success copy whether or
      // not we transition into the Mapping Review step.
      showToast(buildSuccessToast(source.name, result), 'success');

      if (autoMap) {
        // Step 4: Mapping Review. Seed from a fresh listArchitectureMappings
        // call so the table renders rows immediately; the inner step also
        // re-fetches on every filter change + mutation. Failures here are
        // non-fatal -- the inner step will refetch on mount.
        try {
          const seed = await listArchitectureMappings(projectId, {
            sourceArchitectureId: source.id,
            targetArchitectureId: target.id,
          });
          if (inFlightRef.current.token !== myToken) return;
          setMappingSeed(seed);
        } catch (err) {
          console.warn(
            '[SelectiveCopyWizardModal] Could not seed mapping review list:',
            err,
          );
          setMappingSeed([]);
        }
        setStep('mapping-review');
      } else {
        // Existing close-and-toast behaviour (autoMap=false).
        onClose();
      }
    } catch (err) {
      if (inFlightRef.current.token !== myToken) return;
      setSubmitError(describeApiError(err));
      // Drop back to the resolution step so the user can try again.
      setStep('resolve');
    }
  }, [
    preflight,
    projectId,
    target.id,
    source.id,
    source.name,
    selectedIds,
    resolutions,
    autoMap,
    refreshArchitectures,
    refreshTargetCache,
    showToast,
    onClose,
  ]);

  // ---- Render guard ----------------------------------------------------
  if (!open) return null;

  // ---- Derived render state -------------------------------------------
  const headerTitle = `Copy from ${source.name} into ${target.name}`;
  const isCommitting = step === 'committing';
  const isMappingReview = step === 'mapping-review';

  // Step 1 primary button is disabled until we have at least one selected
  // element (and the inventory has loaded).
  const isPickPrimaryDisabled =
    inventoryLoading || preflightLoading || selectedIds.size === 0;

  // ---- Render -----------------------------------------------------------
  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      data-testid="selective-copy-wizard-modal"
    >
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="selective-copy-wizard-modal-title"
      >
        {/* ---- Header ---- */}
        <div className={styles.header}>
          <h2
            className={styles.title}
            id="selective-copy-wizard-modal-title"
            title={headerTitle}
            data-testid="selective-copy-wizard-modal-title"
          >
            {headerTitle}
          </h2>
          <button
            className={styles.closeButton}
            onClick={onClose}
            title="Close"
            data-testid="selective-copy-wizard-modal-close"
            disabled={isCommitting}
          >
            &times;
          </button>
        </div>

        {/* ---- Stepper ---- */}
        <div
          className={styles.stepper}
          role="navigation"
          aria-label="Selective copy steps"
          data-testid="selective-copy-wizard-stepper"
        >
          <span
            className={`${styles.step} ${step === 'pick' ? styles.stepActive : styles.stepDone}`}
            data-testid="selective-copy-wizard-step-pick"
          >
            1. Pick elements
          </span>
          <span className={styles.stepSeparator} aria-hidden="true">
            &rsaquo;
          </span>
          <span
            className={`${styles.step} ${step === 'resolve' ? styles.stepActive : ''} ${
              step === 'committing' || isMappingReview ? styles.stepDone : ''
            }`}
            data-testid="selective-copy-wizard-step-resolve"
          >
            2. Review &amp; resolve
          </span>
          <span className={styles.stepSeparator} aria-hidden="true">
            &rsaquo;
          </span>
          <span
            className={`${styles.step} ${step === 'committing' ? styles.stepActive : ''} ${
              isMappingReview ? styles.stepDone : ''
            }`}
            data-testid="selective-copy-wizard-step-commit"
          >
            3. Commit
          </span>
          <span className={styles.stepSeparator} aria-hidden="true">
            &rsaquo;
          </span>
          <span
            className={`${styles.step} ${isMappingReview ? styles.stepActive : ''}`}
            data-testid="selective-copy-wizard-step-mapping-review"
          >
            4. Review mappings
          </span>
        </div>

        {/* ---- Content ---- */}
        <div className={styles.content} data-testid="selective-copy-wizard-content">
          {step === 'pick' && (
            <>
              <p className={styles.helperText}>
                Select the elements you want to copy from <strong>{source.name}</strong>{' '}
                into <strong>{target.name}</strong>. References to elements already in the
                target are reused; missing references are auto-included on review.
              </p>
              {inventoryLoading && (
                <div
                  className={styles.loadingState}
                  data-testid="selective-copy-wizard-inventory-loading"
                >
                  Loading elements&hellip;
                </div>
              )}
              {!inventoryLoading && inventory && (
                <SelectiveCopyElementPicker
                  inventory={inventory}
                  selectedIds={selectedIds}
                  autoIncluded={preflight?.autoIncluded ?? []}
                  onSelectionChange={setSelectedIds}
                />
              )}
              {preflightLoading && (
                <div
                  className={styles.loadingState}
                  data-testid="selective-copy-wizard-preflight-loading"
                >
                  Running preflight&hellip;
                </div>
              )}
            </>
          )}

          {(step === 'resolve' || step === 'committing') && preflight && (
            <>
              {/* Spec 2026-05-15 Group 6: autoMap checkbox + helper text. */}
              <div className={styles.autoMapBlock}>
                <label className={styles.autoMapLabel}>
                  <input
                    type="checkbox"
                    checked={autoMap}
                    onChange={(e) => setAutoMap(e.target.checked)}
                    disabled={isCommitting}
                    data-testid="selective-copy-wizard-auto-map-checkbox"
                  />
                  Automatically map copied elements as equivalent (recommended)
                </label>
                <p className={styles.autoMapHelper} data-testid="selective-copy-wizard-auto-map-helper">
                  This is append-only. We will create new target elements and
                  mapping rows; existing target elements are never overwritten.
                </p>
              </div>
              {isCommitting && (
                <div
                  className={styles.loadingState}
                  data-testid="selective-copy-wizard-committing"
                >
                  Copying&hellip;
                </div>
              )}
              <SelectiveCopyConflictResolution
                conflicts={preflight.conflicts}
                autoIncluded={preflight.autoIncluded}
                summary={preflight.summary}
                resolutions={resolutions}
                onResolutionsChange={setResolutions}
              />
            </>
          )}

          {isMappingReview && (
            <>
              <p className={styles.helperText}>
                Review the cross-architecture mappings created by the copy.
                Edit, delete, or add mappings as needed. Closing this view
                does not roll back the copy or the auto-created mappings.
                {mappingSeed !== null && (
                  <span data-testid="selective-copy-wizard-mapping-seed-count">
                    {' '}({mappingSeed.length} initial)
                  </span>
                )}
              </p>
              <SelectiveCopyMappingReviewStep
                projectId={projectId}
                sourceArchitectureId={source.id}
                targetArchitectureId={target.id}
              />
            </>
          )}
        </div>

        {/* ---- Footer ---- */}
        <div className={styles.footer}>
          {submitError && (
            <div
              className={styles.footerError}
              role="alert"
              data-testid="selective-copy-wizard-error"
            >
              {submitError}
            </div>
          )}

          {step === 'pick' && (
            <>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={onClose}
                data-testid="selective-copy-wizard-cancel"
                disabled={preflightLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={handleNextFromPick}
                data-testid="selective-copy-wizard-next"
                disabled={isPickPrimaryDisabled}
              >
                {preflightLoading ? 'Running preflight...' : 'Next: Review'}
              </button>
            </>
          )}

          {(step === 'resolve' || step === 'committing') && (
            <>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={handleBackToPick}
                data-testid="selective-copy-wizard-back"
                disabled={isCommitting}
              >
                Back
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={onClose}
                data-testid="selective-copy-wizard-cancel"
                disabled={isCommitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={handleCommit}
                data-testid="selective-copy-wizard-commit"
                disabled={isCommitting}
              >
                {isCommitting ? 'Copying...' : 'Commit copy'}
              </button>
            </>
          )}

          {isMappingReview && (
            <button
              type="button"
              className={styles.primaryButton}
              onClick={onClose}
              data-testid="selective-copy-wizard-mapping-review-close"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default SelectiveCopyWizardModal;
