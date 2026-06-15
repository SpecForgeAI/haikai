/**
 * TechHintsCell Component
 *
 * Spec 2026-04-20: Tech Hints LLM Resolution (Task Group 5.3)
 *
 * Custom grid cell for the services `core_tech` column. Modelled on
 * `PackageSetCell.tsx` / `PackageSetPreview.tsx`:
 *  - Editable free-text input (double-click to edit, blur to confirm).
 *  - Inline preview rendering chips + confirmation sentence below the input.
 *  - Pending spinner while a resolve is in-flight.
 *  - Warning strip beneath the chips driven by `repoCrossCheck.status`
 *    (amber for `partial`, red for `conflict`).
 *  - Amber unresolved badge (row-indicator cell analogue) when
 *    `core_tech_resolved` is NULL or `confidence === 'none'`.
 *
 * Resolve pipeline:
 *  - On blur, wait 250 ms then call `resolveTechHints` via the gateway client.
 *  - Each call is wired through an `AbortController` so a rapid re-edit can
 *    cancel the in-flight request (per spec #5 "at most one resolve per row").
 *  - The in-flight promise is registered in `pendingResolutionsStore` so the
 *    Save button can await `Promise.allSettled(pending)` before firing the
 *    whole-model PUT.
 *
 * Chip removal:
 *  - Removing the language chip nulls `core_tech_language_pack`.
 *  - Removing a framework chip drops it from `core_tech_framework_packs`.
 *  - Either action flips the row into `confidence: 'manual-override'` and
 *    suppresses the next blur-triggered resolve unless the raw text changes.
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { TechHintResolution } from '../../types/techHints';
import { resolveTechHints } from '../../services/gatewayClient';
import { pendingResolutionsStore } from '../../stores/pendingResolutionsStore';
import { checkPersistenceCoreTech } from './coreTechPersistenceCheck';
import styles from './TechHintsCell.module.css';

export const TECH_HINTS_DEBOUNCE_MS = 250;

/**
 * TechHintsRow - structural row interface covering only the 9 fields the
 * TechHintsCell touches. Equivalent to Pick<Service, ...>; both `Service`
 * and `Library` (Spec 2026-05-06) satisfy this structurally so the cell
 * works for both entity types without runtime casts at call sites.
 *
 * Spec 2026-05-06: Library Frontend Types & Tables (Q4 minimal fix - Option a)
 */
export interface TechHintsRow {
  id: string;
  core_tech?: string;
  repo_location?: string;
  repo_subfolder?: string;
  core_tech_resolved?: Record<string, unknown> | null;
  core_tech_language_pack?: string | null;
  core_tech_framework_packs?: string[] | null;
  core_tech_resolution_confidence?: 'high' | 'low' | 'none' | 'tech-only' | 'manual-override' | null;
  core_tech_resolved_at?: string | null;
}

export interface TechHintsCellProps {
  /**
   * The full row. Carries both raw `core_tech` and resolved columns.
   * Typed as the structural `TechHintsRow` so both `Service` and `Library`
   * (Spec 2026-05-06) satisfy it without explicit casts at call sites.
   */
  service: TechHintsRow;
  /** Patch-style update of row fields. The parent reducer merges this in. */
  onChange: (patch: Partial<TechHintsRow>) => void;
  /**
   * Fired when a resolve completes successfully. The parent is expected to
   * merge the 5 resolved fields into the row so they participate in the next
   * whole-model PUT.
   */
  onResolved?: (rowId: string, resolution: TechHintResolution) => void;
  /**
   * Spec 2026-06-06: true when the service's parent application component is
   * set to "Persistence Tier". When set, the Core Tech field is validated
   * against the available database scan packs (PostgreSQL / Sybase) and shows
   * an inline note. Derived by the parent (GridCell) via `deriveServiceTier`;
   * only `service` rows carry a parent component tier, so the `library`
   * tech-hint row leaves this undefined (no check).
   */
  persistenceTierParent?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolved-column view over the row. */
function readResolvedView(service: TechHintsRow): {
  languagePack: string | null;
  frameworkPacks: string[];
  confidence: TechHintsRow['core_tech_resolution_confidence'] | null;
  resolvedAt: string | null;
  hasResolvedEnvelope: boolean;
  confirmationSentence: string | null;
  repoCrossCheck: { status: 'confirmed' | 'conflict' | 'partial'; note: string } | null;
} {
  const envelope = service.core_tech_resolved ?? null;
  const cs = typeof envelope === 'object' && envelope !== null
    ? (envelope as Record<string, unknown>).confirmationSentence
    : null;
  const rcc =
    typeof envelope === 'object' && envelope !== null
      ? ((envelope as Record<string, unknown>).repoCrossCheck as
          | { status: 'confirmed' | 'conflict' | 'partial'; note: string }
          | null
          | undefined) ?? null
      : null;
  return {
    languagePack: service.core_tech_language_pack ?? null,
    frameworkPacks: service.core_tech_framework_packs ?? [],
    confidence: service.core_tech_resolution_confidence ?? null,
    resolvedAt: service.core_tech_resolved_at ?? null,
    hasResolvedEnvelope: envelope !== null && envelope !== undefined,
    confirmationSentence: typeof cs === 'string' ? cs : null,
    repoCrossCheck: rcc,
  };
}

/** Row is "unresolved" per the badge definition (spec UX §Unresolved-row badge). */
function isUnresolved(service: TechHintsRow): boolean {
  if (service.core_tech_resolved == null) {
    return true;
  }
  return service.core_tech_resolution_confidence === 'none';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TechHintsCell({
  service,
  onChange,
  onResolved,
  persistenceTierParent,
}: TechHintsCellProps) {
  const rowId = service.id;
  const rawText = service.core_tech ?? '';

  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(rawText);
  const [pending, setPending] = useState(false);
  /**
   * Local copy of the most-recent resolution. Serves two purposes:
   *  - Immediate render-after-resolve before the parent reducer merges the
   *    patch into the canonical row (important for grid cells whose parent
   *    uses whole-model state updates that propagate on the next render).
   *  - Source of truth for the warning strip and confirmation sentence when
   *    the row's persisted jsonb envelope is not yet hydrated from the DB.
   */
  const [localResolution, setLocalResolution] = useState<TechHintResolution | null>(null);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeAbortRef = useRef<AbortController | null>(null);
  /**
   * Raw text at the point of the last resolve call. Used to suppress
   * re-resolve after a chip removal — the next blur must not fire unless the
   * raw text has actually changed.
   */
  const lastResolvedRawTextRef = useRef<string | null>(null);

  // Keep the suppression baseline in sync with the server-side resolution:
  // whenever a fresh resolution lands we capture the current raw text so
  // subsequent blurs with unchanged text skip the resolve.
  useEffect(() => {
    if (service.core_tech_resolved_at) {
      lastResolvedRawTextRef.current = rawText;
    }
  }, [service.core_tech_resolved_at, rawText]);

  // Cleanup: abort any in-flight request on unmount.
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (activeAbortRef.current) {
        try {
          activeAbortRef.current.abort();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  const view = useMemo(() => {
    const fromService = readResolvedView(service);
    if (!localResolution) {
      return fromService;
    }
    // Prefer the local (fresher) resolution when the parent has not yet
    // propagated the patch back into .
    return {
      languagePack: localResolution.languagePack ?? fromService.languagePack,
      frameworkPacks: localResolution.frameworkPacks ?? fromService.frameworkPacks,
      confidence: localResolution.confidence ?? fromService.confidence,
      resolvedAt: fromService.resolvedAt,
      hasResolvedEnvelope: true,
      confirmationSentence: localResolution.confirmationSentence ?? fromService.confirmationSentence,
      repoCrossCheck: localResolution.repoCrossCheck ?? fromService.repoCrossCheck,
    };
  }, [service, localResolution]);
  const unresolved = isUnresolved(service);

  // Stale indicator: chips are greyed if the raw text or repo fields have
  // been edited since the last resolve. Compared against the editValue when
  // editing and the persisted core_tech otherwise.
  const stale = useMemo(() => {
    if (!view.resolvedAt) {
      return false;
    }
    if (lastResolvedRawTextRef.current !== null && rawText !== lastResolvedRawTextRef.current) {
      return true;
    }
    return false;
  }, [view.resolvedAt, rawText]);

  // Spec 2026-06-06: Persistence-Tier Core Tech validation. Only evaluated when
  // the parent application component is Persistence Tier (gated by the parent,
  // GridCell). Classifies the Core Tech text against the available database scan
  // packs; `hasCodePack` comes from the same resolved `view` the chips use, so a
  // code tech is only flagged once it has actually resolved to a pack.
  const persistenceCheck = useMemo(() => {
    if (!persistenceTierParent) {
      return { status: 'none' as const, message: null };
    }
    const hasCodePack = !!view.languagePack || view.frameworkPacks.length > 0;
    return checkPersistenceCoreTech(rawText, hasCodePack);
  }, [persistenceTierParent, view.languagePack, view.frameworkPacks, rawText]);

  // Spec 2026-06-07: when the parent is Persistence Tier AND the Core Tech names
  // a recognised DATABASE (the green "available" or amber "no pack" cases), the
  // code-pack LLM resolution is the WRONG check — its async "could not map … to
  // any registered language or framework pack" confirmation + the Unresolved
  // badge land a few seconds after the (synchronous) database note and make it
  // look like the pack "went away". Suppress ALL code-pack resolution display so
  // the database note stands alone. The 'code-pack' case (a code tech mis-placed
  // on a persistence service) is deliberately NOT suppressed — there the chips
  // reinforce the "this is a code related pack — please change" warning.
  const suppressCodePackResolution =
    persistenceCheck.status === 'ok' || persistenceCheck.status === 'unsupported-db';

  // -------------------------------------------------------------------------
  // Resolve pipeline
  // -------------------------------------------------------------------------

  const fireResolve = useCallback(
    (freeText: string) => {
      // Abort any prior in-flight request for this row.
      if (activeAbortRef.current) {
        try {
          activeAbortRef.current.abort();
        } catch {
          // ignore
        }
      }
      const controller = new AbortController();
      activeAbortRef.current = controller;
      setPending(true);

      const promise = resolveTechHints(
        {
          freeText,
          repoLocation: service.repo_location,
          repoSubfolder: service.repo_subfolder,
        },
        controller.signal
      );

      // Register the in-flight promise with the store so Save can await it.
      pendingResolutionsStore.start(rowId, promise, controller);

      promise
        .then((resolution) => {
          // Ignore stale responses (a newer controller superseded us).
          if (activeAbortRef.current !== controller) {
            return;
          }
          // Capture raw text for suppress-on-unchanged logic.
          lastResolvedRawTextRef.current = freeText;

          // Local copy so the cell renders the confirmation sentence + warning
          // strip immediately, without waiting for the parent reducer to merge
          // the patch back into the persisted row.
          setLocalResolution(resolution);

          // Mark conflict on the store for Save gating.
          pendingResolutionsStore.setConflict(
            rowId,
            resolution.repoCrossCheck?.status === 'conflict'
          );

          // Patch the row with the 5 resolved fields + notify parent.
          onChange({
            core_tech_resolved: resolution as unknown as Record<string, unknown>,
            core_tech_language_pack: resolution.languagePack,
            core_tech_framework_packs: resolution.frameworkPacks,
            core_tech_resolution_confidence: resolution.confidence,
            core_tech_resolved_at: new Date().toISOString(),
          });
          onResolved?.(rowId, resolution);
        })
        .catch((err) => {
          if ((err as { name?: string }).name === 'AbortError') {
            return; // swallow — caller aborted
          }
          // On failure the row saves with NULL resolved fields (spec failure
          // table). The parent toast path is handled by the Save button.
          if (activeAbortRef.current !== controller) {
            return;
          }
          // Clear any conflict flag that might have been left over.
          pendingResolutionsStore.setConflict(rowId, false);
        })
        .finally(() => {
          if (activeAbortRef.current === controller) {
            activeAbortRef.current = null;
            setPending(false);
          }
          pendingResolutionsStore.settle(rowId);
        });
    },
    [onChange, onResolved, rowId, service.repo_location, service.repo_subfolder]
  );

  const scheduleResolve = useCallback(
    (freeText: string) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        fireResolve(freeText);
      }, TECH_HINTS_DEBOUNCE_MS);
    },
    [fireResolve]
  );

  // -------------------------------------------------------------------------
  // Input edit flow
  // -------------------------------------------------------------------------

  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleDoubleClick = () => {
    setEditValue(rawText);
    setIsEditing(true);
  };

  const handleBlur = () => {
    const newValue = editValue;
    const textChanged = newValue !== rawText;
    if (textChanged) {
      onChange({ core_tech: newValue });
    }
    setIsEditing(false);

    // Spec #5: 250 ms debounce from blur to resolve.
    // Spec §Chip removal: suppress re-resolve unless raw text changed.
    const isManualOverride = service.core_tech_resolution_confidence === 'manual-override';
    const unchangedSinceResolve =
      lastResolvedRawTextRef.current !== null && newValue === lastResolvedRawTextRef.current;
    if (isManualOverride && unchangedSinceResolve) {
      return;
    }
    // Don't resolve empty input.
    if (!newValue.trim()) {
      return;
    }
    // Spec 2026-06-07: a Persistence-Tier service whose Core Tech names a
    // recognised database does NOT need the code-pack resolution (it's a DB, not
    // a language/framework). Skip the LLM call entirely — the database note is
    // authoritative, and the render suppresses any stale code-pack display. (A
    // non-DB tech on a persistence service still resolves, so the mis-tiered
    // code-pack "please change" warning can fire.)
    if (persistenceTierParent) {
      const dbClassification = checkPersistenceCoreTech(newValue, false);
      if (
        dbClassification.status === 'ok' ||
        dbClassification.status === 'unsupported-db'
      ) {
        return;
      }
    }
    scheduleResolve(newValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setEditValue(rawText);
      setIsEditing(false);
    }
  };

  // -------------------------------------------------------------------------
  // Chip removal
  // -------------------------------------------------------------------------

  const handleRemoveLanguage = () => {
    onChange({
      core_tech_language_pack: null,
      core_tech_resolution_confidence: 'manual-override',
    });
    // Keep suppression baseline locked to the current raw text so blur does not
    // re-fire the resolve until the raw text actually changes.
    lastResolvedRawTextRef.current = rawText;
    // Conflicts don't logically persist after a manual override.
    pendingResolutionsStore.setConflict(rowId, false);
  };

  const handleRemoveFramework = (pack: string) => {
    const next = view.frameworkPacks.filter((p) => p !== pack);
    onChange({
      core_tech_framework_packs: next,
      core_tech_resolution_confidence: 'manual-override',
    });
    lastResolvedRawTextRef.current = rawText;
    pendingResolutionsStore.setConflict(rowId, false);
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className={styles.techHintsContainer} data-testid="tech-hints-cell">
      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className={styles.input}
          data-testid="tech-hints-cell-input"
        />
      ) : (
        <div
          className={styles.techHintsValue}
          onDoubleClick={handleDoubleClick}
          data-testid="tech-hints-cell-display"
          tabIndex={0}
        >
          <span
            className={`${styles.rawText} ${!rawText ? styles.rawTextPlaceholder : ''}`}
            data-testid="tech-hints-cell-raw"
          >
            {rawText || '(double-click to edit)'}
          </span>
        </div>
      )}

      {/* Unresolved-row badge (also surfaces in the row-indicator cell via
          the data-testid; the Grid can mirror it upstream if desired). */}
      {unresolved && !suppressCodePackResolution && (
        <span
          className={styles.unresolvedBadge}
          title="Tech hints not resolved - edit core_tech to retry."
          data-testid="tech-hints-unresolved-badge"
        >
          <span aria-hidden>!</span>
          <span>Unresolved</span>
        </span>
      )}

      {/* Pending spinner. */}
      {pending && !suppressCodePackResolution && (
        <span
          className={styles.pendingSpinner}
          data-testid="tech-hints-cell-spinner"
          aria-label="Resolving tech hints..."
        />
      )}

      {/* Chips */}
      {(view.languagePack || view.frameworkPacks.length > 0) && !suppressCodePackResolution && (
        <div className={styles.chipsRow} data-testid="tech-hints-chips-row">
          {view.languagePack && (
            <span
              className={`${styles.chip} ${styles.chipLanguage} ${stale ? styles.chipStale : ''}`}
              data-testid="tech-hints-chip-language"
            >
              <span>{view.languagePack}</span>
              <button
                type="button"
                className={styles.chipRemove}
                aria-label={`Remove language pack ${view.languagePack}`}
                data-testid="tech-hints-chip-remove-language"
                onClick={handleRemoveLanguage}
              >
                x
              </button>
            </span>
          )}
          {view.frameworkPacks.map((pack) => (
            <span
              key={pack}
              className={`${styles.chip} ${styles.chipFramework} ${stale ? styles.chipStale : ''}`}
              data-testid={`tech-hints-chip-framework-${pack}`}
            >
              <span>{pack}</span>
              <button
                type="button"
                className={styles.chipRemove}
                aria-label={`Remove framework pack ${pack}`}
                data-testid={`tech-hints-chip-remove-framework-${pack}`}
                onClick={() => handleRemoveFramework(pack)}
              >
                x
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Confirmation sentence */}
      {view.confirmationSentence && !suppressCodePackResolution && (
        <span
          className={styles.confirmationSentence}
          data-testid="tech-hints-confirmation"
        >
          {view.confirmationSentence}
        </span>
      )}

      {/* Warning strip (partial or conflict) */}
      {view.repoCrossCheck && view.repoCrossCheck.status !== 'confirmed' && !suppressCodePackResolution && (
        <div
          className={`${styles.warningStrip} ${
            view.repoCrossCheck.status === 'conflict'
              ? styles.warningStripConflict
              : styles.warningStripPartial
          }`}
          data-testid="tech-hints-warning-strip"
          data-status={view.repoCrossCheck.status}
          role="alert"
        >
          <span>{view.repoCrossCheck.note}</span>
        </div>
      )}

      {/* Spec 2026-06-06: Persistence-Tier Core Tech note. Shown only when the
          parent application component is "Persistence Tier": a supported DB
          (PostgreSQL / Sybase) reads as available (green), an unsupported DB or
          a mis-tiered code pack reads as a warning (amber / red). */}
      {persistenceCheck.status !== 'none' && persistenceCheck.message && (
        <div
          className={`${styles.warningStrip} ${
            persistenceCheck.status === 'code-pack'
              ? styles.warningStripConflict
              : persistenceCheck.status === 'unsupported-db'
                ? styles.warningStripPartial
                : styles.warningStripOk
          }`}
          data-testid="tech-hints-persistence-note"
          data-status={persistenceCheck.status}
          role={persistenceCheck.status === 'ok' ? 'status' : 'alert'}
        >
          <span>{persistenceCheck.message}</span>
        </div>
      )}
    </div>
  );
}

export default TechHintsCell;
