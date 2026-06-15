/**
 * SelectiveCopyMappingReviewStep
 *
 * Spec 2026-05-15 Create Target Baseline from Current State -- Task Group 6
 *
 * Step 4 of the extended SelectiveCopyWizardModal: Review mappings.
 *
 * Renders the cross-architecture element mapping list for the active
 * (source, target) architecture pair, with:
 *   - Filters (source element type, target element type, mapping type,
 *     status, free-text q) above the table.
 *   - One row per mapping with editable mapping_type / status / notes /
 *     confidence + Save / Delete actions.
 *   - A manual-add row at the bottom with pickers constrained to the
 *     source and target architecture inventory (re-fetched fresh from
 *     AMS via getElementsInventory).
 *
 * Behavioural rules locked in by the spec:
 *
 *   - The mapping list is fetched fresh from AMS on mount and after every
 *     successful mutation (no source-side cache layer in v1).
 *   - Manual-add `confidence` defaults to BLANK (NOT 1.0). 1.0 is reserved
 *     for system-asserted equivalence from the auto-map path.
 *   - Closing / cancelling this step (Close button, X, Esc, click-outside)
 *     MUST NOT roll back the copy or the auto-created mappings -- the
 *     copy + auto-map have already been committed in a single AMS
 *     @Transactional boundary by the time this step renders. There is no
 *     rollback API endpoint.
 *   - On 422 `duplicate_mapping` from createArchitectureMapping, surface
 *     an inline error message with the body code.
 *   - Element-name lookup: resolve element ids to display names by joining
 *     against the existing ElementInventoryResponse for each architecture;
 *     fall back to `<type>:<id>` when a name cannot be resolved.
 *
 * Spec 2026-05-26 Mapping-Notes Pretty Rendering -- Task Groups 2 + 3:
 *
 *   - Per-row Notes cell renders in READ mode by default via the
 *     `LinkifiedText` utility (whitespace preserved, `http(s)://` URLs
 *     auto-linkified, optional 4-line truncation with Show more).
 *   - A small pencil icon next to the read content is the SOLE entry
 *     point into edit mode -- read content stays text-selectable for
 *     copy-paste. (NOT click-anywhere on the text.)
 *   - Edit mode swaps in a multi-line `<textarea>` (auto-grow via
 *     native `field-sizing: content` with CSS-only fallback). Existing
 *     per-row Save button is still the commit mechanism.
 *   - A Cancel button (next to Save, visible only while editing) plus
 *     an ESC keypress on the textarea are the only dismissal paths --
 *     NO click-outside dismissal (risky if the user clicks another
 *     cell to scroll/inspect).
 *   - On Cancel: restore ONLY the Notes field from the snapshot taken
 *     at edit-entry; other unsaved row fields (status / mapping-type /
 *     confidence) are preserved.
 *   - On Save success and on `refetchMappings()`, the editing map is
 *     cleared alongside drafts (consistency with the pre-existing
 *     draft-wipe-on-refetch semantics).
 *   - Manual-add row's notes field is a permanent `<textarea>` (no
 *     pencil, no Cancel) -- the row is mid-creation.
 *
 * The component owns its own list state + fetch lifecycle. The parent
 * (SelectiveCopyWizardModal) is responsible for rendering it inside the
 * wizard's content container and providing the Close + Add manual mapping
 * footer buttons (or the parent can call back via `onRequestClose`).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import {
  ArchitectureElementMappingDto,
  ArchitecturesApiError,
  CreateArchitectureElementMappingRequest,
  ElementInventoryResponse,
  MappingStatus,
  MappingType,
  createArchitectureMapping,
  deleteArchitectureMapping,
  getElementsInventory,
  listArchitectureMappings,
  updateArchitectureMapping,
} from '../../api/architecturesApi';
import { LinkifiedText } from '../common/LinkifiedText';
import styles from './SelectiveCopyWizardModal.module.css';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAPPING_TYPES: MappingType[] = [
  'equivalent',
  'renamed',
  'replaced_by',
  'split',
  'merged',
  'manual_review_required',
];

const MAPPING_STATUSES: MappingStatus[] = [
  'confirmed',
  'proposed',
  'needs_review',
  'rejected',
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SelectiveCopyMappingReviewStepProps {
  /** Project the mappings live under. */
  projectId: string;
  /** The source architecture id (the "from" side of the mapping pair). */
  sourceArchitectureId: string;
  /** The target architecture id (the "into" side of the mapping pair). */
  targetArchitectureId: string;
  /**
   * Set to a positive integer to expose an "Add manual mapping" toggle in
   * the parent wizard footer; the parent calls `onAddRequest` to open the
   * inline manual-add row. We default to true (always on) for v1 since the
   * spec asks for it; expose a callback for future variants.
   */
  showAddManualRow?: boolean;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

interface ElementLookupEntry {
  name: string;
  type: string;
}

/**
 * Build a lookup map from element id to {name, type} for an architecture
 * inventory. Used to resolve mapping rows' element ids into human-readable
 * names. Falls back to `<type>:<id>` at render time when an id is not in
 * the lookup (cf. spec: "fall back to raw id with type prefix").
 */
function buildElementLookup(
  inventory: ElementInventoryResponse | null
): Map<string, ElementLookupEntry> {
  const lookup = new Map<string, ElementLookupEntry>();
  if (!inventory) return lookup;
  for (const domain of inventory.domains) {
    for (const type of domain.types) {
      const typeName = type.entityType ?? type.name;
      for (const instance of type.instances) {
        lookup.set(instance.id, { name: instance.name, type: typeName });
      }
    }
  }
  return lookup;
}

/**
 * Flatten an inventory into a flat list of pickable instances. Used by the
 * manual-add row's source/target pickers.
 */
interface FlatInstance {
  id: string;
  name: string;
  entityType: string;
}

function flattenInventory(inventory: ElementInventoryResponse | null): FlatInstance[] {
  const out: FlatInstance[] = [];
  if (!inventory) return out;
  for (const domain of inventory.domains) {
    for (const type of domain.types) {
      const entityType = type.entityType ?? type.name;
      for (const instance of type.instances) {
        out.push({ id: instance.id, name: instance.name, entityType });
      }
    }
  }
  return out;
}

/**
 * Display name for a mapping row's source or target endpoint. Resolves via
 * the lookup, falls back to `<type>:<id>` per the spec's element-name
 * fallback rule.
 */
function describeEndpoint(
  lookup: Map<string, ElementLookupEntry>,
  elementType: string,
  elementId: string
): string {
  const entry = lookup.get(elementId);
  if (entry) return entry.name;
  return `${elementType}:${elementId}`;
}

// ---------------------------------------------------------------------------
// Local types -- per-row edit buffer + manual-add buffer
// ---------------------------------------------------------------------------

interface RowDraft {
  mappingType: MappingType;
  status: MappingStatus;
  notes: string;
  // String form so the user can clear the input back to "" -> null on save.
  confidenceText: string;
}

interface ManualAddDraft {
  sourceElementId: string;
  targetElementId: string;
  mappingType: MappingType;
  status: MappingStatus;
  notes: string;
  confidenceText: string;
}

/**
 * Per-row edit-mode state for the Notes cell.
 *
 * `notesSnapshot` is captured at the moment the user clicks the pencil
 * (entering edit mode). On Cancel / ESC we restore ONLY this field via
 * `handleDraftChange(id, { notes: snapshot })` -- other unsaved row
 * fields (status / mapping-type / confidence) are preserved (spec
 * 2026-05-26 Q8 / Pitfall 3).
 */
interface NotesEditingEntry {
  notesSnapshot: string;
}

const EMPTY_MANUAL_ADD: ManualAddDraft = {
  sourceElementId: '',
  targetElementId: '',
  mappingType: 'equivalent',
  status: 'proposed',
  notes: '',
  // Per spec: manual-add MUST default `confidence` BLANK (NOT 1.0).
  confidenceText: '',
};

function rowDraftFromMapping(m: ArchitectureElementMappingDto): RowDraft {
  return {
    mappingType: m.mappingType,
    status: m.status,
    notes: m.notes ?? '',
    confidenceText: m.confidence === null || m.confidence === undefined
      ? ''
      : String(m.confidence),
  };
}

/** Parse a `confidenceText` input into the wire-shape value (number | null). */
function parseConfidence(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  if (Number.isNaN(parsed)) return null;
  return parsed;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SelectiveCopyMappingReviewStep({
  projectId,
  sourceArchitectureId,
  targetArchitectureId,
  showAddManualRow = true,
}: SelectiveCopyMappingReviewStepProps) {
  // ---- Mapping list state -----------------------------------------------
  const [mappings, setMappings] = useState<ArchitectureElementMappingDto[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // ---- Inventory (for element-name lookup + manual-add pickers) --------
  const [sourceInventory, setSourceInventory] = useState<ElementInventoryResponse | null>(null);
  const [targetInventory, setTargetInventory] = useState<ElementInventoryResponse | null>(null);

  // ---- Filters ----------------------------------------------------------
  const [filterSourceType, setFilterSourceType] = useState<string>('');
  const [filterTargetType, setFilterTargetType] = useState<string>('');
  const [filterMappingType, setFilterMappingType] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterQ, setFilterQ] = useState<string>('');

  // ---- Per-row edit buffers (id -> draft) ------------------------------
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  // Per-row inline error (e.g. duplicate_mapping on save) -- id -> message.
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  // ---- Notes-cell edit-mode state (id -> snapshot of notes at entry).
  //      Absent entry => read mode. Present entry => textarea visible.
  //      Cleared on Save success and inside refetchMappings() so the
  //      cell flips naturally back to read mode (Pitfall 7).
  const [editing, setEditing] = useState<Record<string, NotesEditingEntry | undefined>>({});

  // ---- Per-row in-flight save indicator. Disables the pencil and
  //      Cancel buttons while the PATCH is in flight (Pitfall: in-flight
  //      controls behaviour).
  const [savingRowId, setSavingRowId] = useState<string | null>(null);

  // ---- Manual-add row ---------------------------------------------------
  const [manualAddOpen, setManualAddOpen] = useState(false);
  const [manualAddDraft, setManualAddDraft] = useState<ManualAddDraft>(EMPTY_MANUAL_ADD);
  const [manualAddError, setManualAddError] = useState<string | null>(null);

  // Track in-flight requests so we don't update unmounted state.
  const inFlightRef = useRef<{ token: number }>({ token: 0 });

  // ---- Re-fetch the mapping list (used on mount + after every mutation) ----
  const refetchMappings = useCallback(async () => {
    const myToken = inFlightRef.current.token;
    setListLoading(true);
    setListError(null);
    try {
      const list = await listArchitectureMappings(projectId, {
        sourceArchitectureId,
        targetArchitectureId,
        sourceElementType: filterSourceType || undefined,
        targetElementType: filterTargetType || undefined,
        mappingType: filterMappingType || undefined,
        status: filterStatus || undefined,
        q: filterQ || undefined,
      });
      if (inFlightRef.current.token !== myToken) return;
      setMappings(list);
      // Seed draft buffers so the rendered controls reflect the latest
      // server state (and discard any unsaved-then-deleted-by-refetch
      // drafts).
      const nextDrafts: Record<string, RowDraft> = {};
      for (const m of list) {
        nextDrafts[m.id] = rowDraftFromMapping(m);
      }
      setDrafts(nextDrafts);
      setRowErrors({});
      // Spec 2026-05-26 Pitfall 7: wipe the editing map alongside drafts
      // on every refetch. Semantics stay consistent with the pre-existing
      // draft-wipe-on-refetch -- preserving an open edit mode across a
      // refetch would require draft-survival logic that is explicitly
      // out of scope.
      setEditing({});
    } catch (err) {
      if (inFlightRef.current.token !== myToken) return;
      const msg =
        err instanceof ArchitecturesApiError
          ? err.body.message ?? `Failed to load mappings (status ${err.status})`
          : 'Failed to load mappings.';
      setListError(msg);
    } finally {
      if (inFlightRef.current.token !== myToken) return;
      setListLoading(false);
    }
  }, [
    projectId,
    sourceArchitectureId,
    targetArchitectureId,
    filterSourceType,
    filterTargetType,
    filterMappingType,
    filterStatus,
    filterQ,
  ]);

  // ---- Fetch inventories once on mount (used for element-name lookup +
  //      manual-add pickers). Inventories are not refetched on filter
  //      changes -- they are architecture-level read-only meta.
  useEffect(() => {
    let cancelled = false;
    inFlightRef.current = { token: inFlightRef.current.token + 1 };
    (async () => {
      try {
        const src = await getElementsInventory(projectId, sourceArchitectureId);
        if (!cancelled) setSourceInventory(src);
      } catch {
        if (!cancelled) setSourceInventory(null);
      }
      try {
        const tgt = await getElementsInventory(projectId, targetArchitectureId);
        if (!cancelled) setTargetInventory(tgt);
      } catch {
        if (!cancelled) setTargetInventory(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, sourceArchitectureId, targetArchitectureId]);

  // ---- Fire the initial mapping list fetch + refetch on filter change. -
  useEffect(() => {
    refetchMappings();
  }, [refetchMappings]);

  // ---- Lookups + flat instance lists for manual-add pickers ------------
  const sourceLookup = useMemo(() => buildElementLookup(sourceInventory), [sourceInventory]);
  const targetLookup = useMemo(() => buildElementLookup(targetInventory), [targetInventory]);
  const sourceInstances = useMemo(() => flattenInventory(sourceInventory), [sourceInventory]);
  const targetInstances = useMemo(() => flattenInventory(targetInventory), [targetInventory]);

  // ---- Per-row edit handlers -------------------------------------------
  const handleDraftChange = useCallback(
    (id: string, partial: Partial<RowDraft>) => {
      setDrafts((prev) => ({
        ...prev,
        [id]: { ...prev[id], ...partial },
      }));
    },
    []
  );

  // ---- Notes-cell edit-mode handlers ------------------------------------
  // Pencil click: snapshot the current draft.notes (Pitfall 3) and flip
  // the cell to edit mode. Does NOT touch drafts -- the textarea is
  // wired to the same `draft.notes` value via the existing
  // handleDraftChange plumbing.
  const handleEnterEditMode = useCallback((mappingId: string, currentNotes: string) => {
    setEditing((prev) => ({
      ...prev,
      [mappingId]: { notesSnapshot: currentNotes },
    }));
  }, []);

  // Cancel / ESC: restore ONLY the notes field from the snapshot, then
  // clear the editing entry. Other unsaved row fields are preserved
  // (Pitfall 3).
  const handleCancelEdit = useCallback(
    (mappingId: string) => {
      const snap = editing[mappingId]?.notesSnapshot ?? '';
      handleDraftChange(mappingId, { notes: snap });
      setEditing((prev) => {
        const next = { ...prev };
        delete next[mappingId];
        return next;
      });
    },
    [editing, handleDraftChange]
  );

  const handleSaveRow = useCallback(
    async (mapping: ArchitectureElementMappingDto) => {
      const draft = drafts[mapping.id];
      if (!draft) return;
      setSavingRowId(mapping.id);
      try {
        // PATCH semantics on the backend: null = preserve existing value,
        // empty string on `notes` = clear. Send the draft `notes` verbatim
        // so an emptied input field clears the persisted note.
        // `parseConfidence` returns `null` when the input is blank, which
        // means "preserve" -- v1 has no clear-confidence flow via PATCH.
        await updateArchitectureMapping(projectId, mapping.id, {
          mappingType: draft.mappingType,
          status: draft.status,
          notes: draft.notes,
          confidence: parseConfidence(draft.confidenceText),
        });
        setRowErrors((prev) => {
          const next = { ...prev };
          delete next[mapping.id];
          return next;
        });
        // Clear the editing entry so the cell flips back to read mode
        // on the next render. refetchMappings() will also wipe the
        // editing map, but doing it explicitly here makes the
        // intent crystal clear.
        setEditing((prev) => {
          const next = { ...prev };
          delete next[mapping.id];
          return next;
        });
        await refetchMappings();
      } catch (err) {
        const msg =
          err instanceof ArchitecturesApiError
            ? err.body.code ?? err.body.message ?? `error (status ${err.status})`
            : 'Failed to save mapping.';
        setRowErrors((prev) => ({ ...prev, [mapping.id]: msg }));
      } finally {
        setSavingRowId(null);
      }
    },
    [drafts, projectId, refetchMappings]
  );

  const handleDeleteRow = useCallback(
    async (mapping: ArchitectureElementMappingDto) => {
      try {
        await deleteArchitectureMapping(projectId, mapping.id);
        setRowErrors((prev) => {
          const next = { ...prev };
          delete next[mapping.id];
          return next;
        });
        await refetchMappings();
      } catch (err) {
        const msg =
          err instanceof ArchitecturesApiError
            ? err.body.code ?? err.body.message ?? `error (status ${err.status})`
            : 'Failed to delete mapping.';
        setRowErrors((prev) => ({ ...prev, [mapping.id]: msg }));
      }
    },
    [projectId, refetchMappings]
  );

  // ---- Manual-add handlers ---------------------------------------------
  const handleManualAddOpen = useCallback(() => {
    setManualAddDraft(EMPTY_MANUAL_ADD);
    setManualAddError(null);
    setManualAddOpen(true);
  }, []);

  const handleManualAddCancel = useCallback(() => {
    setManualAddOpen(false);
    setManualAddDraft(EMPTY_MANUAL_ADD);
    setManualAddError(null);
  }, []);

  const handleManualAddSave = useCallback(async () => {
    const sourceInstance = sourceInstances.find((i) => i.id === manualAddDraft.sourceElementId);
    const targetInstance = targetInstances.find((i) => i.id === manualAddDraft.targetElementId);
    if (!sourceInstance || !targetInstance) {
      setManualAddError('Pick both a source and a target element.');
      return;
    }
    const body: CreateArchitectureElementMappingRequest = {
      sourceArchitectureId,
      targetArchitectureId,
      sourceElementType: sourceInstance.entityType,
      sourceElementId: sourceInstance.id,
      targetElementType: targetInstance.entityType,
      targetElementId: targetInstance.id,
      mappingType: manualAddDraft.mappingType,
      status: manualAddDraft.status,
      notes: manualAddDraft.notes === '' ? null : manualAddDraft.notes,
      // BLANK input means null on the wire (per spec: do NOT default to 1.0).
      confidence: parseConfidence(manualAddDraft.confidenceText),
    };
    try {
      await createArchitectureMapping(projectId, body);
      setManualAddOpen(false);
      setManualAddDraft(EMPTY_MANUAL_ADD);
      setManualAddError(null);
      await refetchMappings();
    } catch (err) {
      // Surface the body code (e.g. "duplicate_mapping") inline so the
      // user can adjust the picker without losing their draft.
      const msg =
        err instanceof ArchitecturesApiError
          ? err.body.code ?? err.body.message ?? `error (status ${err.status})`
          : 'Failed to create mapping.';
      setManualAddError(msg);
    }
  }, [
    manualAddDraft,
    sourceInstances,
    targetInstances,
    projectId,
    sourceArchitectureId,
    targetArchitectureId,
    refetchMappings,
  ]);

  // ---- Render -----------------------------------------------------------
  return (
    <div data-testid="selective-copy-wizard-mapping-review">
      {/* Filters row */}
      <div className={styles.mappingReviewFilters} data-testid="mapping-review-filters">
        <select
          value={filterSourceType}
          onChange={(e) => setFilterSourceType(e.target.value)}
          aria-label="Filter by source element type"
          data-testid="mapping-review-filter-source-type"
        >
          <option value="">All source types</option>
          {[...new Set(sourceInstances.map((i) => i.entityType))].sort().map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          value={filterTargetType}
          onChange={(e) => setFilterTargetType(e.target.value)}
          aria-label="Filter by target element type"
          data-testid="mapping-review-filter-target-type"
        >
          <option value="">All target types</option>
          {[...new Set(targetInstances.map((i) => i.entityType))].sort().map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          value={filterMappingType}
          onChange={(e) => setFilterMappingType(e.target.value)}
          aria-label="Filter by mapping type"
          data-testid="mapping-review-filter-mapping-type"
        >
          <option value="">All mapping types</option>
          {MAPPING_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          aria-label="Filter by status"
          data-testid="mapping-review-filter-status"
        >
          <option value="">All statuses</option>
          {MAPPING_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Search ids and notes"
          value={filterQ}
          onChange={(e) => setFilterQ(e.target.value)}
          aria-label="Free-text search across element ids and notes"
          data-testid="mapping-review-filter-q"
        />
        {showAddManualRow && !manualAddOpen && (
          <button
            type="button"
            onClick={handleManualAddOpen}
            data-testid="mapping-review-open-manual-add"
            style={{ marginLeft: 'auto' }}
          >
            Add manual mapping
          </button>
        )}
      </div>

      {/* List + per-row edit table */}
      {listLoading && (
        <div className={styles.mappingReviewLoading} data-testid="mapping-review-loading">
          Loading mappings&hellip;
        </div>
      )}
      {!listLoading && listError && (
        <div className={styles.mappingRowError} data-testid="mapping-review-list-error">
          {listError}
        </div>
      )}
      {!listLoading && !listError && mappings.length === 0 && !manualAddOpen && (
        <div className={styles.mappingReviewEmpty} data-testid="mapping-review-empty">
          No mappings found for this architecture pair.
        </div>
      )}
      {!listLoading && !listError && (mappings.length > 0 || manualAddOpen) && (
        <table className={styles.mappingTable} data-testid="mapping-review-table">
          <thead>
            <tr>
              <th>Source element</th>
              <th>Source type</th>
              <th>Target element</th>
              <th>Target type</th>
              <th>Mapping type</th>
              <th>Status</th>
              <th>Confidence</th>
              <th>Notes</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {mappings.map((m) => {
              const draft = drafts[m.id] ?? rowDraftFromMapping(m);
              const rowError = rowErrors[m.id];
              const isEditingNotes = editing[m.id] !== undefined;
              const isSaving = savingRowId === m.id;
              return (
                <React.Fragment key={m.id}>
                  <tr data-testid={`mapping-review-row-${m.id}`}>
                    <td data-testid={`mapping-review-row-source-name-${m.id}`}>
                      {describeEndpoint(sourceLookup, m.sourceElementType, m.sourceElementId)}
                    </td>
                    <td>{m.sourceElementType}</td>
                    <td data-testid={`mapping-review-row-target-name-${m.id}`}>
                      {describeEndpoint(targetLookup, m.targetElementType, m.targetElementId)}
                    </td>
                    <td>{m.targetElementType}</td>
                    <td>
                      <select
                        value={draft.mappingType}
                        onChange={(e) =>
                          handleDraftChange(m.id, {
                            mappingType: e.target.value as MappingType,
                          })
                        }
                        aria-label={`Mapping type for ${m.id}`}
                        data-testid={`mapping-review-row-mapping-type-${m.id}`}
                      >
                        {MAPPING_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        value={draft.status}
                        onChange={(e) =>
                          handleDraftChange(m.id, {
                            status: e.target.value as MappingStatus,
                          })
                        }
                        aria-label={`Status for ${m.id}`}
                        data-testid={`mapping-review-row-status-${m.id}`}
                      >
                        {MAPPING_STATUSES.map((sVal) => (
                          <option key={sVal} value={sVal}>
                            {sVal}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="text"
                        value={draft.confidenceText}
                        onChange={(e) =>
                          handleDraftChange(m.id, { confidenceText: e.target.value })
                        }
                        aria-label={`Confidence for ${m.id}`}
                        placeholder="—"
                        data-testid={`mapping-review-row-confidence-${m.id}`}
                      />
                    </td>
                    <td>
                      {/* Spec 2026-05-26: read/edit toggle on the Notes
                          cell. Read mode = LinkifiedText + pencil button
                          (the SOLE edit trigger -- preserves text
                          selection for copy-paste). Edit mode = textarea
                          with ESC dismissal. */}
                      {!isEditingNotes ? (
                        <div className={styles.notesReadModeCell}>
                          <LinkifiedText
                            text={draft.notes ?? ''}
                            truncateLines={4}
                          />
                          <button
                            type="button"
                            className={styles.notesPencilButton}
                            onClick={() => handleEnterEditMode(m.id, draft.notes ?? '')}
                            aria-label={`Edit notes for ${m.id}`}
                            data-testid={`mapping-review-row-notes-edit-${m.id}`}
                            disabled={isSaving}
                          >
                            <Pencil size={14} />
                          </button>
                        </div>
                      ) : (
                        <div className={styles.notesEditCellWrapper}>
                          <textarea
                            className={styles.notesEditTextarea}
                            value={draft.notes}
                            onChange={(e) =>
                              handleDraftChange(m.id, { notes: e.target.value })
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') {
                                handleCancelEdit(m.id);
                              }
                            }}
                            rows={3}
                            aria-label={`Notes for ${m.id}`}
                            data-testid={`mapping-review-row-notes-${m.id}`}
                          />
                        </div>
                      )}
                    </td>
                    <td>
                      <div className={styles.mappingActionsCell}>
                        <button
                          type="button"
                          onClick={() => handleSaveRow(m)}
                          data-testid={`mapping-review-row-save-${m.id}`}
                          disabled={isSaving}
                        >
                          Save
                        </button>
                        {isEditingNotes && (
                          <button
                            type="button"
                            onClick={() => handleCancelEdit(m.id)}
                            data-testid={`mapping-review-row-notes-cancel-${m.id}`}
                            disabled={isSaving}
                          >
                            Cancel
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDeleteRow(m)}
                          data-testid={`mapping-review-row-delete-${m.id}`}
                          disabled={isSaving}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                  {rowError && (
                    <tr>
                      <td colSpan={9} className={styles.mappingRowError} data-testid={`mapping-review-row-error-${m.id}`}>
                        {rowError}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {manualAddOpen && (
              <>
                <tr data-testid="mapping-review-manual-add-row">
                  <td colSpan={2}>
                    <select
                      value={manualAddDraft.sourceElementId}
                      onChange={(e) =>
                        setManualAddDraft((prev) => ({
                          ...prev,
                          sourceElementId: e.target.value,
                        }))
                      }
                      aria-label="Manual-add source element"
                      data-testid="mapping-review-manual-add-source"
                    >
                      <option value="">Pick source element…</option>
                      {sourceInstances.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name} ({i.entityType})
                        </option>
                      ))}
                    </select>
                  </td>
                  <td colSpan={2}>
                    <select
                      value={manualAddDraft.targetElementId}
                      onChange={(e) =>
                        setManualAddDraft((prev) => ({
                          ...prev,
                          targetElementId: e.target.value,
                        }))
                      }
                      aria-label="Manual-add target element"
                      data-testid="mapping-review-manual-add-target"
                    >
                      <option value="">Pick target element…</option>
                      {targetInstances.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name} ({i.entityType})
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      value={manualAddDraft.mappingType}
                      onChange={(e) =>
                        setManualAddDraft((prev) => ({
                          ...prev,
                          mappingType: e.target.value as MappingType,
                        }))
                      }
                      aria-label="Manual-add mapping type"
                      data-testid="mapping-review-manual-add-mapping-type"
                    >
                      {MAPPING_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      value={manualAddDraft.status}
                      onChange={(e) =>
                        setManualAddDraft((prev) => ({
                          ...prev,
                          status: e.target.value as MappingStatus,
                        }))
                      }
                      aria-label="Manual-add status"
                      data-testid="mapping-review-manual-add-status"
                    >
                      {MAPPING_STATUSES.map((sVal) => (
                        <option key={sVal} value={sVal}>
                          {sVal}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {/* Per spec: defaults to BLANK, NOT 1.0. The empty
                        string is what reaches the server as `confidence:
                        null`. */}
                    <input
                      type="text"
                      value={manualAddDraft.confidenceText}
                      onChange={(e) =>
                        setManualAddDraft((prev) => ({
                          ...prev,
                          confidenceText: e.target.value,
                        }))
                      }
                      aria-label="Manual-add confidence"
                      placeholder="—"
                      data-testid="mapping-review-manual-add-confidence"
                    />
                  </td>
                  <td>
                    {/* Spec 2026-05-26 Task Group 3: manual-add notes is a
                        permanent <textarea> reusing the same auto-grow
                        class as the per-row edit-mode textarea. No
                        pencil, no Cancel -- the row is mid-creation. */}
                    <textarea
                      className={styles.notesEditTextarea}
                      value={manualAddDraft.notes}
                      onChange={(e) =>
                        setManualAddDraft((prev) => ({
                          ...prev,
                          notes: e.target.value,
                        }))
                      }
                      rows={3}
                      aria-label="Manual-add notes"
                      data-testid="mapping-review-manual-add-notes"
                    />
                  </td>
                  <td>
                    <div className={styles.mappingActionsCell}>
                      <button
                        type="button"
                        onClick={handleManualAddSave}
                        data-testid="mapping-review-manual-add-save"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={handleManualAddCancel}
                        data-testid="mapping-review-manual-add-cancel"
                      >
                        Cancel
                      </button>
                    </div>
                  </td>
                </tr>
                {manualAddError && (
                  <tr>
                    <td colSpan={9} className={styles.mappingRowError} data-testid="mapping-review-manual-add-error">
                      {manualAddError}
                    </td>
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default SelectiveCopyMappingReviewStep;
