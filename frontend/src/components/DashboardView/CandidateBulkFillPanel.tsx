/**
 * CandidateBulkFillPanel
 *
 * Spec: Skipped-candidate visibility + grouped bulk-fill (C1) for discovery
 * save-back (2026-06-20) -- Task Group 7.
 *
 * A drawer/panel (opened from a breakdown-chip token, scoped to the clicked
 * reason CLASS) that GROUPS the affected candidates -- Blocked + Quality-gap,
 * plus a `business_logics` name-collision fallback group -- by the SPECIFIC
 * missing/blocking field, and bulk-fixes them.
 *
 * Flow mirrors `MigrationDeliveryBulkResolveModal` (drafts -> validate ->
 * `commit=false` PREVIEW -> commit):
 *   1. Per group, set ONE value with the right control (typeahead for
 *      reference/FK fields resolving against committed entities +
 *      already-approved candidates; dropdown for enums; free-text otherwise).
 *      Per-row OVERRIDE + per-row "skip this one" operate on the GROUPED scope
 *      (NOT per-row checkboxes on the main candidate table).
 *   2. SERVER dry-run PREVIEW via `previewSaveApprovedCandidates` (`commit=false`)
 *      -- shows would-commit / would-still-block straight from the real
 *      save-back path (cannot drift from the eventual commit).
 *   3. COMMIT the field edits via `bulkCandidateEdit` in ONE transaction.
 *      "Fix & Save" applies the edits then immediately re-runs the REAL save for
 *      those rows; the plain "Save Remaining Approved" path on the page stays
 *      intact (this panel never disables it).
 *
 * Reuses the Grid `FreeTextTypeaheadSingleToken` CELL (not the Grid container)
 * for both the reference-typeahead (fed model + approved-candidate name
 * suggestions) and the free-text controls.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  DiscoveryCandidateDto,
  SaveApprovedResult,
  BulkCandidateEditPatch,
  previewSaveApprovedCandidates as PreviewFn,
  bulkCandidateEdit as BulkEditFn,
  saveApprovedCandidates as SaveFn,
} from '../../api/discoveryApi';
import {
  previewSaveApprovedCandidates as defaultPreviewFn,
  bulkCandidateEdit as defaultBulkEditFn,
  saveApprovedCandidates as defaultSaveFn,
} from '../../api/discoveryApi';
import { FreeTextTypeaheadSingleToken } from '../Grid/FreeTextTypeaheadSingleToken';
import {
  groupAffectedCandidates,
  buildPatch,
  qualifiedBusinessLogicName,
  ENUM_FIELD_OPTIONS,
  typedOptionsForField,
  type BulkFillGroup,
  type TypedOption,
  type TypedReferenceSources,
} from './candidateBulkFillSupport';
import styles from './DiscoveryRunDetailView.module.css';

export interface CandidateBulkFillPanelProps {
  open: boolean;
  /** The reason CLASS the panel is scoped to (the clicked chip token). */
  scopeClass?: string | null;
  /** The save-back outcome carrying the reason arm. */
  result: SaveApprovedResult | null;
  /** The run's full candidate rows (for resolving ids -> current data). */
  candidates: DiscoveryCandidateDto[];
  /**
   * Reference-field typeahead suggestions: names of committed model entities +
   * already-approved candidates the panel can resolve FK/reference fields to.
   * FALLBACK pool for reference fields with no typed target registered.
   */
  referenceSuggestions: string[];
  /**
   * Typed option sources (2026-08-25 — Grid fkTarget parity): per-collection
   * committed entity names + this run's approved candidates, from which each
   * registered blocking field derives its EXACT valid choices. Optional so
   * existing callers/tests keep the flat-pool behaviour.
   */
  typedReferenceSources?: TypedReferenceSources;
  projectId: string;
  architectureId: string;
  runId: string;
  onClose: () => void;
  /** Invoked after a successful commit / fix-and-save so the page can refresh. */
  onApplied?: () => void;
  // Test seams -- override the API clients.
  previewFn?: typeof PreviewFn;
  bulkEditFn?: typeof BulkEditFn;
  saveFn?: typeof SaveFn;
}

type RowState = {
  /** Per-row override value (blank -> use the group bulk value). */
  override: string;
  /** Per-row "skip this one" toggle. */
  skipped: boolean;
};

export const CandidateBulkFillPanel: React.FC<CandidateBulkFillPanelProps> = ({
  open,
  scopeClass,
  result,
  candidates,
  referenceSuggestions,
  typedReferenceSources,
  projectId,
  architectureId,
  runId,
  onClose,
  onApplied,
  previewFn,
  bulkEditFn,
  saveFn,
}) => {
  // Resolve the API clients lazily (so the test seams can override them but the
  // real module imports stay tree-shakeable).
  const [groupValues, setGroupValues] = useState<Record<string, string>>({});
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [preview, setPreview] = useState<SaveApprovedResult | null>(null);
  const [inFlight, setInFlight] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo<BulkFillGroup[]>(
    () => (result?.reasons ? groupAffectedCandidates(result.reasons, scopeClass) : []),
    [result?.reasons, scopeClass],
  );

  // Reset drafts whenever the panel (re)opens or the scope changes so a prior
  // session's state never leaks across opens.
  useEffect(() => {
    if (open) {
      setGroupValues({});
      setRowState({});
      setPreview(null);
      setError(null);
    }
  }, [open, scopeClass]);

  const candidateById = useMemo(() => {
    const m = new Map<string, DiscoveryCandidateDto>();
    for (const c of candidates) m.set(c.id, c);
    return m;
  }, [candidates]);

  const setGroupValue = useCallback((key: string, value: string) => {
    setGroupValues((prev) => ({ ...prev, [key]: value }));
    setPreview(null); // any edit invalidates the staged preview
  }, []);

  const setRow = useCallback((candidateId: string, patch: Partial<RowState>) => {
    setRowState((prev) => {
      const base: RowState = prev[candidateId] ?? { override: '', skipped: false };
      return { ...prev, [candidateId]: { ...base, ...patch } };
    });
    setPreview(null);
  }, []);

  /**
   * Resolve the effective value for one row: the per-row override wins, else the
   * group bulk value. For the collision fallback group the "value" is the
   * qualified `<class>.<method>` name derived from the row (override = class).
   */
  const resolveRowValue = useCallback(
    (group: BulkFillGroup, entryIndex: number): string | null => {
      const entry = group.entries[entryIndex];
      const rs = rowState[entry.candidateId];
      if (rs?.skipped) return null;
      if (group.isCollisionFallback) {
        // override (if any) is the class to qualify with; else use the row class.
        const qualified = qualifiedBusinessLogicName(
          entry,
          rs?.override?.trim() ? rs.override.trim() : undefined,
        );
        return qualified;
      }
      const override = rs?.override?.trim();
      if (override) return override;
      const bulk = groupValues[group.key]?.trim();
      return bulk ? bulk : null;
    },
    [groupValues, rowState],
  );

  /** Build the curated patch set across all groups (skipping skipped rows). */
  const buildPatches = useCallback((): BulkCandidateEditPatch[] => {
    const patches: BulkCandidateEditPatch[] = [];
    for (const group of groups) {
      for (let i = 0; i < group.entries.length; i++) {
        const entry = group.entries[i];
        const value = resolveRowValue(group, i);
        if (value === null || value === '') continue;
        patches.push(buildPatch(entry.candidateId, group.field, value));
      }
    }
    return patches;
  }, [groups, resolveRowValue]);

  const stagedPatchCount = useMemo(() => buildPatches().length, [buildPatches]);

  // --------------------------------------------------------------------------
  // Server dry-run PREVIEW (commit=false). Runs the REAL save-back path so the
  // would-commit / would-still-block projection cannot drift from the commit.
  // NOTE v1: the preview reflects the run's current persisted state. Clicking
  // "Fix & Save" applies the staged edits FIRST, then re-runs the real save, so
  // the committed outcome reflects the edits even though this preview is the
  // pre-edit projection (an honest "what still blocks today" baseline).
  // --------------------------------------------------------------------------
  const handlePreview = useCallback(async () => {
    setError(null);
    setInFlight(true);
    try {
      const fn = previewFn ?? defaultPreviewFn;
      if (!fn) throw new Error('preview client unavailable');
      const projection = await fn(projectId, architectureId, runId);
      setPreview(projection);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
      setPreview(null);
    } finally {
      setInFlight(false);
    }
  }, [previewFn, projectId, architectureId, runId]);

  const handleApplyEdits = useCallback(async () => {
    const patches = buildPatches();
    if (patches.length === 0) {
      setError('No values to apply -- set a value for at least one group or row.');
      return false;
    }
    setError(null);
    setInFlight(true);
    try {
      const fn = bulkEditFn ?? defaultBulkEditFn;
      if (!fn) throw new Error('bulk-edit client unavailable');
      await fn(projectId, architectureId, runId, patches);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Apply edits failed');
      return false;
    } finally {
      setInFlight(false);
    }
  }, [buildPatches, bulkEditFn, projectId, architectureId, runId]);

  // Apply edits only (the manual path: user then re-runs "Save Remaining
  // Approved" on the page).
  const handleApplyOnly = useCallback(async () => {
    const ok = await handleApplyEdits();
    if (ok) onApplied?.();
  }, [handleApplyEdits, onApplied]);

  // Fix & Save: apply edits THEN immediately re-run the real save for the rows.
  const handleFixAndSave = useCallback(async () => {
    const patches = buildPatches();
    if (patches.length === 0) {
      setError('No values to apply -- set a value for at least one group or row.');
      return;
    }
    setError(null);
    setInFlight(true);
    try {
      const editFn = bulkEditFn ?? defaultBulkEditFn;
      const realSave = saveFn ?? defaultSaveFn;
      if (!editFn || !realSave) throw new Error('client unavailable');
      await editFn(projectId, architectureId, runId, patches);
      await realSave(projectId, architectureId, runId);
      onApplied?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fix & Save failed');
    } finally {
      setInFlight(false);
    }
  }, [buildPatches, bulkEditFn, saveFn, projectId, architectureId, runId, onApplied, onClose]);

  if (!open) return null;

  const totalAffected = groups.reduce((n, g) => n + g.entries.length, 0);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Bulk fill missing candidate fields"
      data-testid="candidate-bulk-fill-panel"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        justifyContent: 'flex-end',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: '#fff',
          width: 640,
          maxWidth: '95vw',
          height: '100%',
          overflowY: 'auto',
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          boxShadow: '-8px 0 24px rgba(0,0,0,0.2)',
        }}
      >
        <div
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <h3 style={{ margin: 0 }} data-testid="candidate-bulk-fill-title">
            Fix missing fields
            {scopeClass ? ` -- ${scopeClass}` : ''}
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={inFlight}
            data-testid="candidate-bulk-fill-close"
          >
            Close
          </button>
        </div>

        <p style={{ margin: 0, fontSize: 12, color: '#607d8b' }}>
          {totalAffected} affected candidate{totalAffected === 1 ? '' : 's'} grouped
          by the specific missing / blocking field. Set one value per group (or
          override / skip individual rows), preview against the real save-back,
          then apply.
        </p>

        {totalAffected === 0 && (
          <div
            data-testid="candidate-bulk-fill-empty"
            style={{ fontSize: 13, color: '#607d8b' }}
          >
            No remediable candidates in this scope.
          </div>
        )}

        {groups.map((group) => {
          const typedOptions =
            group.widget === 'typed_select'
              ? typedOptionsForField(group.field, typedReferenceSources)
              : null;
          return (
          <fieldset
            key={group.key}
            data-testid={`candidate-bulk-fill-group-${group.key}`}
            data-group-field={group.field}
            data-group-widget={group.widget}
            style={{ border: '1px solid #cfd8dc', borderRadius: 6, padding: 12 }}
          >
            <legend style={{ fontSize: 13, fontWeight: 600, color: '#455a64' }}>
              {group.label}{' '}
              <span style={{ fontWeight: 400, color: '#90a4ae' }}>
                ({group.entries.length})
              </span>
            </legend>

            {/* Per-group single value control (skipped for the collision
                fallback group, whose value is derived per-row as
                <class>.<method>). */}
            {!group.isCollisionFallback && (
              <div
                style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}
                data-testid={`candidate-bulk-fill-group-control-${group.key}`}
              >
                <label style={{ fontSize: 12, color: '#607d8b', minWidth: 90 }}>
                  Set all to
                </label>
                {group.widget === 'dropdown' ? (
                  <select
                    data-testid={`candidate-bulk-fill-dropdown-${group.key}`}
                    value={groupValues[group.key] ?? ''}
                    onChange={(e) => setGroupValue(group.key, e.target.value)}
                    disabled={inFlight}
                    style={{ flex: 1, padding: '4px 6px' }}
                  >
                    <option value="">(choose {group.field})</option>
                    {(ENUM_FIELD_OPTIONS[group.field] ?? []).map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : group.widget === 'typed_select' && typedOptions && typedOptions.length > 0 ? (
                  // Grid fkTarget parity (2026-08-25): registered reference
                  // fields resolve against EXISTING records only, so the
                  // control is a pick-from-valid-targets select — free text
                  // could only ever produce another blocked row.
                  <select
                    data-testid={`candidate-bulk-fill-typed-select-${group.key}`}
                    value={groupValues[group.key] ?? ''}
                    onChange={(e) => setGroupValue(group.key, e.target.value)}
                    disabled={inFlight}
                    style={{ flex: 1, padding: '4px 6px' }}
                  >
                    <option value="">(choose {group.field})</option>
                    {typedOptions.map((opt: TypedOption) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                ) : group.widget === 'typed_select' ? (
                  <div style={{ flex: 1 }}>
                    <FreeTextTypeaheadSingleToken
                      value={groupValues[group.key] ?? ''}
                      suggestions={referenceSuggestions}
                      onChange={(v) => setGroupValue(group.key, v)}
                    />
                    <div
                      style={{ fontSize: 11, color: '#b26a00', marginTop: 2 }}
                      data-testid={`candidate-bulk-fill-no-targets-${group.key}`}
                    >
                      No valid targets exist yet in the model or this run for {group.field} — the
                      save preview will confirm whether a typed value resolves.
                    </div>
                  </div>
                ) : (
                  <div
                    style={{ flex: 1 }}
                    data-testid={`candidate-bulk-fill-typeahead-${group.key}`}
                  >
                    <FreeTextTypeaheadSingleToken
                      value={groupValues[group.key] ?? ''}
                      suggestions={group.widget === 'typeahead' ? referenceSuggestions : []}
                      onChange={(v) => setGroupValue(group.key, v)}
                    />
                  </div>
                )}
              </div>
            )}

            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {group.entries.map((entry, i) => {
                const rs = rowState[entry.candidateId] ?? { override: '', skipped: false };
                const cand = candidateById.get(entry.candidateId);
                const resolved = resolveRowValue(group, i);
                return (
                  <li
                    key={entry.candidateId}
                    data-testid={`candidate-bulk-fill-row-${entry.candidateId}`}
                    style={{
                      border: '1px solid #eceff1',
                      borderRadius: 4,
                      padding: 8,
                      opacity: rs.skipped ? 0.5 : 1,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>
                        {cand?.name ?? entry.name}
                        {entry.class ? (
                          <span style={{ fontWeight: 400, color: '#90a4ae' }}> ({entry.class})</span>
                        ) : null}
                      </span>
                      <label style={{ fontSize: 11, color: '#607d8b', display: 'flex', gap: 4, alignItems: 'center' }}>
                        <input
                          type="checkbox"
                          checked={rs.skipped}
                          disabled={inFlight}
                          onChange={(e) => setRow(entry.candidateId, { skipped: e.target.checked })}
                          data-testid={`candidate-bulk-fill-skip-${entry.candidateId}`}
                        />
                        skip this one
                      </label>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                      <label style={{ fontSize: 11, color: '#90a4ae', minWidth: 90 }}>
                        {group.isCollisionFallback ? 'Class override' : 'Override'}
                      </label>
                      {!group.isCollisionFallback &&
                      group.widget === 'typed_select' &&
                      typedOptions &&
                      typedOptions.length > 0 ? (
                        <select
                          value={rs.override}
                          disabled={inFlight || rs.skipped}
                          onChange={(e) => setRow(entry.candidateId, { override: e.target.value })}
                          data-testid={`candidate-bulk-fill-override-${entry.candidateId}`}
                          style={{ flex: 1, padding: '3px 6px' }}
                        >
                          <option value="">(use group value)</option>
                          {typedOptions.map((opt: TypedOption) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      ) : !group.isCollisionFallback && group.widget === 'dropdown' ? (
                        <select
                          value={rs.override}
                          disabled={inFlight || rs.skipped}
                          onChange={(e) => setRow(entry.candidateId, { override: e.target.value })}
                          data-testid={`candidate-bulk-fill-override-${entry.candidateId}`}
                          style={{ flex: 1, padding: '3px 6px' }}
                        >
                          <option value="">(use group value)</option>
                          {(ENUM_FIELD_OPTIONS[group.field] ?? []).map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={rs.override}
                          disabled={inFlight || rs.skipped}
                          placeholder={
                            group.isCollisionFallback
                              ? entry.class || '(class name)'
                              : '(use group value)'
                          }
                          onChange={(e) => setRow(entry.candidateId, { override: e.target.value })}
                          data-testid={`candidate-bulk-fill-override-${entry.candidateId}`}
                          style={{ flex: 1, padding: '3px 6px' }}
                        />
                      )}
                    </div>
                    <div
                      style={{ fontSize: 11, color: resolved ? '#2e7d32' : '#c62828', marginTop: 4 }}
                      data-testid={`candidate-bulk-fill-resolved-${entry.candidateId}`}
                    >
                      {rs.skipped
                        ? 'skipped'
                        : resolved
                          ? `will set ${group.field} = ${resolved}`
                          : 'no value yet -- still blocking'}
                    </div>
                  </li>
                );
              })}
            </ul>
          </fieldset>
          );
        })}

        {preview && (
          <div
            data-testid="candidate-bulk-fill-preview"
            style={{ background: '#e3f2fd', borderRadius: 4, padding: 10, fontSize: 13 }}
          >
            Dry-run preview (real save-back, nothing written):{' '}
            <strong data-testid="candidate-bulk-fill-preview-commit">
              {preview.candidatesCommitted}
            </strong>{' '}
            would commit,{' '}
            <strong data-testid="candidate-bulk-fill-preview-block">
              {preview.entitiesSkipped}
            </strong>{' '}
            would still block.
          </div>
        )}

        {error && (
          <div
            role="alert"
            data-testid="candidate-bulk-fill-error"
            className={styles.errorMessage}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 'auto' }}>
          <button
            type="button"
            onClick={onClose}
            disabled={inFlight}
            data-testid="candidate-bulk-fill-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handlePreview()}
            disabled={inFlight}
            data-testid="candidate-bulk-fill-preview-button"
          >
            {inFlight && !preview ? 'Loading...' : 'Preview'}
          </button>
          <button
            type="button"
            onClick={() => void handleApplyOnly()}
            disabled={inFlight || stagedPatchCount === 0}
            data-testid="candidate-bulk-fill-apply-button"
            title="Apply edits; then use Save Remaining Approved on the page"
          >
            Apply edits
          </button>
          <button
            type="button"
            onClick={() => void handleFixAndSave()}
            disabled={inFlight || stagedPatchCount === 0}
            data-testid="candidate-bulk-fill-fix-and-save-button"
            className={styles.saveApprovedButton}
          >
            {inFlight ? 'Working...' : 'Fix & Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CandidateBulkFillPanel;
