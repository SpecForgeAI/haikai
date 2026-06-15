/**
 * MigrationDeliveryStoryDrawerResolverPanel
 *
 * Spec: 2026-05-20 Missing Input Resolver Flow -- Task Group 6.3-6.8
 *
 * Replaces the read-only "Missing inputs" subsection on the
 * MigrationDeliveryStoryDrawer with a structured resolver panel. Per-row
 * affordances let the user resolve the gap from the drawer itself; bulk
 * cross-story resolution lives on the dashboard surface (Task Group 7).
 *
 * Sections (top -> bottom):
 *   1. "What to do next" banner -- visual emphasis element, sources
 *      `recommendedNextAction` from the spec-generation DTO.
 *   2. Grouped collapsible rows by missingInputType:
 *        api_contract -> mapping -> target_element -> out_of_v1
 *      Group default-expanded when it contains any unresolved row;
 *      default-collapsed once fully resolved.
 *   3. "X of Y resolved" badge in the panel header (denominator counts ONLY
 *      v1-type entries; out_of_v1 never contributes to either side).
 *   4. Retry generation button -- disabled with a tooltip until X equals Y.
 *
 * Per-type resolvers:
 *   - api_contract: inline file-upload widget (OAS / WSDL) + paste-text
 *     fallback. On submit posts to `createResolution` with
 *     `missingInputType='api_contract'`.
 *   - mapping: inline source/target picker + optional field-level mapping
 *     JSON; on submit posts `createResolution` with
 *     `missingInputType='mapping'`. After save, calls
 *     `onResolutionPersisted({type: 'mapping'})` so the route can dispatch
 *     `LOAD_MODEL` per `project_appshell_model_cache.md`.
 *   - target_element: deep-link button to the target-architecture authoring
 *     workspace (route from Spec 2026-05-20-target-architecture-authoring-flow).
 *     After the element is created there the user explicitly creates the
 *     `target_element` resolution from the drawer -- the deep-link does NOT
 *     auto-resolve.
 *   - out_of_v1: read-only label "Resolution UI not available in v1".
 *
 * Reset action:
 *   Small "Reset" affordance on resolved rows. Clicks soft-delete the
 *   resolution and flip the row back to unresolved; the response carries the
 *   cascade list so callers can refresh adjacent surfaces.
 *
 * Loosely typed `MissingInputEntry` (from migrationDeliveryDashboardApi):
 *   The drawer already receives `missingInputs[]` with `{ kind, id, reason }`
 *   shape. We extend that conceptually here: the `kind` field maps to our
 *   `missingInputType` discriminator (api_contract / mapping / target_element
 *   / anything-else -> out_of_v1). The stable hashed key per entry is sourced
 *   from the parent spec's `missingInputKeysJson` (passed in as a prop) and
 *   matched by position when present; entries without a hashed key are
 *   treated as out_of_v1.
 */

import React, { useCallback, useMemo, useState } from 'react';
import type { MissingInputEntry } from '../../../api/migrationDeliveryDashboardApi';
import {
  createResolution,
  retryBatch,
  softDeleteResolution,
  type MissingInputResolutionDto,
  type MissingInputType,
} from '../../../api/missingInputResolutionsApi';
import styles from './MigrationDeliveryDashboard.module.css';

// ============================================================================
// Public types
// ============================================================================

/**
 * Per-row context the panel needs to render and resolve a missing input.
 * Composed by the drawer's container from the raw missing-inputs list, the
 * spec's `missingInputKeysJson`, and the project's active resolutions.
 */
export interface ResolverPanelRow {
  /** Stable 16-hex hashed key. `null` for out-of-v1 rows. */
  missingInputKey: string | null;
  /** Discriminator -- drives which resolver UI renders. */
  missingInputType: MissingInputType;
  /** Human-readable descriptor. */
  descriptor: string;
  /** Reason / context surfaced by the AMS persisted row. */
  reason: string;
  /** The active resolution row for this key, when one exists. */
  resolution: MissingInputResolutionDto | null;
  /** Optional pre-computed canonical-descriptor fields for createResolution. */
  serviceName?: string | null;
  operationName?: string | null;
  sourceElementId?: string | null;
  targetElementId?: string | null;
  targetElementLogicalName?: string | null;
}

export interface MigrationDeliveryStoryDrawerResolverPanelProps {
  /** Project the spec lives under. */
  projectId: string;
  /** Owning book-of-work id (required for retry-batch). */
  bookOfWorkId: string;
  /** Owning architecture id (used to build the target-element deep-link). */
  architectureId: string;
  /** Work-item id of the story being resolved (sent to retry-batch). */
  workItemId: string;
  /** Mid-banner text sourced from the spec's `recommendedNextAction`. */
  recommendedNextAction: string | null;
  /** Per-row resolver context. */
  rows: ResolverPanelRow[];
  /**
   * Optional raw "Missing inputs" fallback rows. When `rows` is empty but
   * `missingInputs` has entries the panel renders read-only summaries under
   * the appropriate groups so the legacy data flow still surfaces.
   */
  missingInputs?: MissingInputEntry[];
  /**
   * Current user id / display name stamped on the resolution audit fields.
   * Optional -- defaults to "current-user".
   */
  resolvedBy?: string;
  /**
   * Navigate to the target-architecture workspace with the missing element's
   * logical name pre-filled. Implementations typically use react-router's
   * `useNavigate` to push to
   * `/projects/{projectId}/architectures/{architectureId}/target-architecture
   *  ?missingTargetElementLogicalName=<encoded>`.
   */
  onOpenTargetArchitecture?: (logicalName: string | null) => void;
  /**
   * Called after every successful resolver write so the route can refresh
   * adjacent state (badges, hierarchy, model cache). `type='mapping'` writes
   * MUST trigger a `LOAD_MODEL` dispatch per
   * `project_appshell_model_cache.md`.
   */
  onResolutionPersisted?: (input: {
    type: MissingInputType;
    resolution: MissingInputResolutionDto | null;
    affectedSpecIds: string[];
  }) => void;
  /** Called after a successful retry-batch so the parent can re-fetch. */
  onRetryComplete?: (result: unknown) => void;
  /** Called when retry-batch is gated by the cost-preview threshold. */
  onRetryRequiresConfirmation?: (input: {
    costPreview: unknown;
    threshold: string | undefined;
  }) => void;
}

// ============================================================================
// Helpers
// ============================================================================

const GROUP_ORDER: ReadonlyArray<MissingInputType> = [
  'api_contract',
  'mapping',
  'target_element',
  'out_of_v1',
];

const GROUP_LABEL: Record<MissingInputType, string> = {
  api_contract: 'API contracts',
  mapping: 'Mappings',
  target_element: 'Target elements',
  out_of_v1: 'Out of v1 scope',
};

const TYPE_ICON: Record<MissingInputType, string> = {
  api_contract: '[API]',
  mapping: '[MAP]',
  target_element: '[TGT]',
  out_of_v1: '[--]',
};

/** Compare descriptors alphabetically (case-insensitive). */
function compareDescriptor(a: ResolverPanelRow, b: ResolverPanelRow): number {
  return a.descriptor
    .toLocaleLowerCase()
    .localeCompare(b.descriptor.toLocaleLowerCase());
}

/** Sort within a group: unresolved first, then descriptor alpha. */
function sortRowsWithinGroup(rows: ResolverPanelRow[]): ResolverPanelRow[] {
  return [...rows].sort((a, b) => {
    const aResolved = a.resolution != null && a.resolution.softDeleted !== true;
    const bResolved = b.resolution != null && b.resolution.softDeleted !== true;
    if (aResolved !== bResolved) return aResolved ? 1 : -1;
    return compareDescriptor(a, b);
  });
}

/** Group rows by `missingInputType`. */
function groupRows(
  rows: ResolverPanelRow[],
): Array<{ type: MissingInputType; rows: ResolverPanelRow[] }> {
  const buckets = new Map<MissingInputType, ResolverPanelRow[]>();
  for (const t of GROUP_ORDER) buckets.set(t, []);
  for (const row of rows) {
    const t: MissingInputType = GROUP_ORDER.includes(row.missingInputType)
      ? row.missingInputType
      : 'out_of_v1';
    buckets.get(t)!.push(row);
  }
  return GROUP_ORDER.map((type) => ({
    type,
    rows: sortRowsWithinGroup(buckets.get(type) ?? []),
  })).filter((g) => g.rows.length > 0);
}

/** Resolved iff non-null AND not soft-deleted. */
function isResolved(row: ResolverPanelRow): boolean {
  return row.resolution != null && row.resolution.softDeleted !== true;
}

/** Compute X of Y -- denominator counts only v1-type rows. */
function computeBadge(rows: ResolverPanelRow[]): { x: number; y: number } {
  const v1 = rows.filter((r) => r.missingInputType !== 'out_of_v1');
  const y = v1.length;
  const x = v1.filter(isResolved).length;
  return { x, y };
}

// ============================================================================
// Per-type resolver row sub-components
// ============================================================================

interface PerRowProps {
  row: ResolverPanelRow;
  projectId: string;
  architectureId: string;
  resolvedBy: string;
  onResolved: (
    type: MissingInputType,
    resolution: MissingInputResolutionDto | null,
    affectedSpecIds: string[],
  ) => void;
  onReset: (resolutionId: string) => void;
  onOpenTargetArchitecture?: (logicalName: string | null) => void;
}

/** Shared "resolved" footer: resolved-at / by + Reset link. */
function ResolvedFooter({
  resolution,
  onReset,
  rowKey,
}: {
  resolution: MissingInputResolutionDto;
  onReset: (resolutionId: string) => void;
  rowKey: string;
}) {
  return (
    <div
      className={styles.drawerSubtle}
      data-testid={`mdr-row-${rowKey}-resolved-footer`}
    >
      Resolved at {resolution.resolvedAt} by {resolution.resolvedBy}
      {' -- '}
      <button
        type="button"
        data-testid={`mdr-row-${rowKey}-reset-button`}
        onClick={() => onReset(resolution.id)}
        style={{
          background: 'none',
          border: 0,
          padding: 0,
          color: '#1976d2',
          cursor: 'pointer',
          textDecoration: 'underline',
        }}
      >
        Reset
      </button>
    </div>
  );
}

function ApiContractResolverRow({
  row,
  projectId,
  resolvedBy,
  onResolved,
  onReset,
}: PerRowProps) {
  const [filename, setFilename] = useState<string>('');
  const [format, setFormat] = useState<'oas' | 'wsdl'>('oas');
  const [pasted, setPasted] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const rowKey = row.missingInputKey ?? `apicontract-${row.descriptor}`;
  const resolved = isResolved(row);

  const handleSubmit = useCallback(async () => {
    if (!pasted && !filename) {
      setError('Provide a filename or paste contract text');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await createResolution(projectId, {
        missingInputKey: row.missingInputKey ?? undefined,
        missingInputType: 'api_contract',
        serviceName: row.serviceName ?? null,
        operationName: row.operationName ?? null,
        resolutionPayload: {
          filename: filename || null,
          format,
          inlineText: pasted || null,
        },
        resolvedBy,
      });
      onResolved('api_contract', result.resolution, result.affectedSpecIds);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create resolution');
    } finally {
      setSubmitting(false);
    }
  }, [
    pasted,
    filename,
    format,
    projectId,
    row.missingInputKey,
    row.serviceName,
    row.operationName,
    resolvedBy,
    onResolved,
  ]);

  if (resolved && row.resolution) {
    return (
      <div
        className={styles.drawerMissingEntry}
        data-testid={`mdr-row-${rowKey}`}
      >
        <span className={styles.drawerMissingEntryId}>
          {TYPE_ICON.api_contract} API contract -- {row.descriptor} -- resolved
        </span>
        <span className={styles.drawerMissingEntryReason}>{row.reason}</span>
        <ResolvedFooter
          resolution={row.resolution}
          onReset={onReset}
          rowKey={rowKey}
        />
      </div>
    );
  }

  return (
    <div
      className={styles.drawerMissingEntry}
      data-testid={`mdr-row-${rowKey}`}
    >
      <span className={styles.drawerMissingEntryId}>
        {TYPE_ICON.api_contract} API contract -- {row.descriptor}
      </span>
      <span className={styles.drawerMissingEntryReason}>{row.reason}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label>
          <input
            type="file"
            data-testid={`mdr-row-${rowKey}-file-input`}
            accept=".yaml,.yml,.json,.wsdl,.xml"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                setFilename(f.name);
                setFormat(
                  f.name.toLowerCase().endsWith('.wsdl') ? 'wsdl' : 'oas',
                );
              }
            }}
          />
        </label>
        <textarea
          data-testid={`mdr-row-${rowKey}-paste-text`}
          placeholder="Or paste OAS / WSDL contract text"
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          rows={2}
          style={{ fontFamily: 'monospace', fontSize: 11 }}
        />
        {error && (
          <span
            data-testid={`mdr-row-${rowKey}-error`}
            style={{ color: '#b71c1c', fontSize: 11 }}
          >
            {error}
          </span>
        )}
        <button
          type="button"
          data-testid={`mdr-row-${rowKey}-submit`}
          onClick={() => void handleSubmit()}
          disabled={submitting}
        >
          {submitting ? 'Saving...' : 'Save contract resolution'}
        </button>
      </div>
    </div>
  );
}

function MappingResolverRow({
  row,
  projectId,
  resolvedBy,
  onResolved,
  onReset,
}: PerRowProps) {
  const [sourceId, setSourceId] = useState<string>(row.sourceElementId ?? '');
  const [targetId, setTargetId] = useState<string>(row.targetElementId ?? '');
  const [fieldMappingJson, setFieldMappingJson] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const rowKey = row.missingInputKey ?? `mapping-${row.descriptor}`;
  const resolved = isResolved(row);

  const handleSubmit = useCallback(async () => {
    if (!sourceId || !targetId) {
      setError('Both source and target elements are required');
      return;
    }
    let fieldMapping: Record<string, unknown> | null = null;
    if (fieldMappingJson.trim().length > 0) {
      try {
        fieldMapping = JSON.parse(fieldMappingJson) as Record<string, unknown>;
      } catch {
        setError('Field-level mapping must be valid JSON');
        return;
      }
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await createResolution(projectId, {
        missingInputKey: row.missingInputKey ?? undefined,
        missingInputType: 'mapping',
        sourceElementId: sourceId,
        targetElementId: targetId,
        resolutionPayload: {
          sourceElementId: sourceId,
          targetElementId: targetId,
          fieldMapping,
        },
        resolvedBy,
      });
      onResolved('mapping', result.resolution, result.affectedSpecIds);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create resolution');
    } finally {
      setSubmitting(false);
    }
  }, [
    sourceId,
    targetId,
    fieldMappingJson,
    projectId,
    row.missingInputKey,
    resolvedBy,
    onResolved,
  ]);

  if (resolved && row.resolution) {
    return (
      <div
        className={styles.drawerMissingEntry}
        data-testid={`mdr-row-${rowKey}`}
      >
        <span className={styles.drawerMissingEntryId}>
          {TYPE_ICON.mapping} Mapping -- {row.descriptor} -- resolved
        </span>
        <span className={styles.drawerMissingEntryReason}>{row.reason}</span>
        <ResolvedFooter
          resolution={row.resolution}
          onReset={onReset}
          rowKey={rowKey}
        />
      </div>
    );
  }

  return (
    <div
      className={styles.drawerMissingEntry}
      data-testid={`mdr-row-${rowKey}`}
    >
      <span className={styles.drawerMissingEntryId}>
        {TYPE_ICON.mapping} Mapping -- {row.descriptor}
      </span>
      <span className={styles.drawerMissingEntryReason}>{row.reason}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label>
          Source
          <input
            type="text"
            data-testid={`mdr-row-${rowKey}-source-input`}
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
          />
        </label>
        <label>
          Target
          <input
            type="text"
            data-testid={`mdr-row-${rowKey}-target-input`}
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
          />
        </label>
        <label>
          Field mapping (JSON, optional)
          <textarea
            data-testid={`mdr-row-${rowKey}-field-mapping`}
            value={fieldMappingJson}
            onChange={(e) => setFieldMappingJson(e.target.value)}
            rows={2}
            style={{ fontFamily: 'monospace', fontSize: 11 }}
          />
        </label>
        {error && (
          <span
            data-testid={`mdr-row-${rowKey}-error`}
            style={{ color: '#b71c1c', fontSize: 11 }}
          >
            {error}
          </span>
        )}
        <button
          type="button"
          data-testid={`mdr-row-${rowKey}-submit`}
          onClick={() => void handleSubmit()}
          disabled={submitting}
        >
          {submitting ? 'Saving...' : 'Save mapping resolution'}
        </button>
      </div>
    </div>
  );
}

function TargetElementResolverRow({
  row,
  projectId,
  resolvedBy,
  onResolved,
  onReset,
  onOpenTargetArchitecture,
}: PerRowProps) {
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const rowKey = row.missingInputKey ?? `target-${row.descriptor}`;
  const resolved = isResolved(row);

  const handleMarkResolved = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await createResolution(projectId, {
        missingInputKey: row.missingInputKey ?? undefined,
        missingInputType: 'target_element',
        targetElementLogicalName: row.targetElementLogicalName ?? row.descriptor,
        resolutionPayload: {
          targetElementLogicalName:
            row.targetElementLogicalName ?? row.descriptor,
        },
        resolvedBy,
      });
      onResolved('target_element', result.resolution, result.affectedSpecIds);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create resolution');
    } finally {
      setSubmitting(false);
    }
  }, [
    projectId,
    row.missingInputKey,
    row.targetElementLogicalName,
    row.descriptor,
    resolvedBy,
    onResolved,
  ]);

  if (resolved && row.resolution) {
    return (
      <div
        className={styles.drawerMissingEntry}
        data-testid={`mdr-row-${rowKey}`}
      >
        <span className={styles.drawerMissingEntryId}>
          {TYPE_ICON.target_element} Target element -- {row.descriptor} -- resolved
        </span>
        <span className={styles.drawerMissingEntryReason}>{row.reason}</span>
        <ResolvedFooter
          resolution={row.resolution}
          onReset={onReset}
          rowKey={rowKey}
        />
      </div>
    );
  }

  return (
    <div
      className={styles.drawerMissingEntry}
      data-testid={`mdr-row-${rowKey}`}
    >
      <span className={styles.drawerMissingEntryId}>
        {TYPE_ICON.target_element} Target element -- {row.descriptor}
      </span>
      <span className={styles.drawerMissingEntryReason}>{row.reason}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <button
          type="button"
          data-testid={`mdr-row-${rowKey}-deep-link`}
          onClick={() =>
            onOpenTargetArchitecture?.(
              row.targetElementLogicalName ?? row.descriptor,
            )
          }
        >
          Open target architecture workspace
        </button>
        {error && (
          <span
            data-testid={`mdr-row-${rowKey}-error`}
            style={{ color: '#b71c1c', fontSize: 11 }}
          >
            {error}
          </span>
        )}
        <button
          type="button"
          data-testid={`mdr-row-${rowKey}-mark-resolved`}
          onClick={() => void handleMarkResolved()}
          disabled={submitting}
        >
          {submitting ? 'Saving...' : 'Mark resolved'}
        </button>
      </div>
    </div>
  );
}

function OutOfV1Row({ row }: { row: ResolverPanelRow }) {
  const rowKey = row.missingInputKey ?? `outofv1-${row.descriptor}`;
  return (
    <div
      className={styles.drawerMissingEntry}
      data-testid={`mdr-row-${rowKey}`}
    >
      <span className={styles.drawerMissingEntryId}>
        {TYPE_ICON.out_of_v1} {row.descriptor}
      </span>
      <span className={styles.drawerMissingEntryReason}>{row.reason}</span>
      <span
        className={styles.drawerSubtle}
        data-testid={`mdr-row-${rowKey}-out-of-v1-label`}
      >
        Resolution UI not available in v1; track manually.
      </span>
    </div>
  );
}

// ============================================================================
// Group container with collapse / expand toggle
// ============================================================================

interface GroupContainerProps {
  type: MissingInputType;
  rows: ResolverPanelRow[];
  defaultExpanded: boolean;
  perRowProps: Omit<PerRowProps, 'row'>;
}

const GroupContainer: React.FC<GroupContainerProps> = ({
  type,
  rows,
  defaultExpanded,
  perRowProps,
}) => {
  const [expanded, setExpanded] = useState<boolean>(defaultExpanded);
  const unresolvedCount = rows.filter((r) => !isResolved(r)).length;
  const total =
    type === 'out_of_v1'
      ? rows.length
      : rows.filter((r) => r.missingInputType !== 'out_of_v1').length;
  const resolvedCount = total - unresolvedCount;

  return (
    <div
      className={styles.drawerMissingGroup}
      data-testid={`mdr-group-${type}`}
    >
      <button
        type="button"
        className={styles.drawerMissingGroupTitle}
        data-testid={`mdr-group-${type}-toggle`}
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        style={{
          background: 'none',
          border: 0,
          textAlign: 'left',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        {expanded ? '[-]' : '[+]'} {GROUP_LABEL[type]} ({resolvedCount}/{total}{' '}
        resolved)
      </button>
      {expanded && (
        <div data-testid={`mdr-group-${type}-rows`}>
          {rows.map((row, idx) => {
            const key = row.missingInputKey ?? `${type}-${idx}`;
            if (type === 'api_contract') {
              return (
                <ApiContractResolverRow
                  key={key}
                  row={row}
                  {...perRowProps}
                />
              );
            }
            if (type === 'mapping') {
              return (
                <MappingResolverRow key={key} row={row} {...perRowProps} />
              );
            }
            if (type === 'target_element') {
              return (
                <TargetElementResolverRow
                  key={key}
                  row={row}
                  {...perRowProps}
                />
              );
            }
            return <OutOfV1Row key={key} row={row} />;
          })}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Main panel
// ============================================================================

export const MigrationDeliveryStoryDrawerResolverPanel: React.FC<
  MigrationDeliveryStoryDrawerResolverPanelProps
> = ({
  projectId,
  bookOfWorkId,
  architectureId,
  workItemId,
  recommendedNextAction,
  rows,
  resolvedBy = 'current-user',
  onOpenTargetArchitecture,
  onResolutionPersisted,
  onRetryComplete,
  onRetryRequiresConfirmation,
}) => {
  const [rowState, setRowState] = useState<ResolverPanelRow[]>(rows);
  const [retryPending, setRetryPending] = useState<boolean>(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  // Sync external row changes when the parent re-supplies the list.
  React.useEffect(() => {
    setRowState(rows);
  }, [rows]);

  const groups = useMemo(() => groupRows(rowState), [rowState]);
  const badge = useMemo(() => computeBadge(rowState), [rowState]);
  const allResolved = badge.y > 0 && badge.x === badge.y;

  const handleResolved = useCallback(
    (
      type: MissingInputType,
      resolution: MissingInputResolutionDto | null,
      affectedSpecIds: string[],
    ) => {
      setRowState((prev) =>
        prev.map((r) =>
          resolution &&
          r.missingInputKey != null &&
          r.missingInputKey === resolution.missingInputKey
            ? { ...r, resolution }
            : r,
        ),
      );
      onResolutionPersisted?.({ type, resolution, affectedSpecIds });
    },
    [onResolutionPersisted],
  );

  const handleReset = useCallback(
    async (resolutionId: string) => {
      try {
        const result = await softDeleteResolution(
          projectId,
          resolutionId,
          resolvedBy,
        );
        // Flip the matching row's resolution to null.
        setRowState((prev) =>
          prev.map((r) =>
            r.resolution && r.resolution.id === resolutionId
              ? { ...r, resolution: null }
              : r,
          ),
        );
        // Notify the parent so it can refresh adjacent state (cascade may have
        // flipped other specs back to insufficient_context).
        onResolutionPersisted?.({
          type:
            (result.deletedResolution
              .missingInputType as MissingInputType) ?? 'out_of_v1',
          resolution: null,
          affectedSpecIds: result.affectedSpecIds,
        });
      } catch {
        // Best-effort: leave the row resolved in the UI on failure so the
        // user can try again; the next dashboard fetch will reconcile.
      }
    },
    [projectId, resolvedBy, onResolutionPersisted],
  );

  const handleRetry = useCallback(async () => {
    setRetryPending(true);
    setRetryError(null);
    try {
      const result = await retryBatch(projectId, {
        workItemIds: [workItemId],
        bookOfWorkId,
        confirmed: false,
      });
      if (result.requiresConfirmation) {
        onRetryRequiresConfirmation?.({
          costPreview: result.costPreview,
          threshold: result.threshold,
        });
      } else {
        onRetryComplete?.(result);
      }
    } catch (e) {
      setRetryError(e instanceof Error ? e.message : 'Failed to retry');
    } finally {
      setRetryPending(false);
    }
  }, [
    projectId,
    workItemId,
    bookOfWorkId,
    onRetryRequiresConfirmation,
    onRetryComplete,
  ]);

  void architectureId; // reserved for future header chip linking

  return (
    <section
      className={styles.drawerSection}
      data-testid="mdr-resolver-panel"
    >
      {/* --- Header with X/Y badge --- */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
        }}
      >
        <h3 className={styles.drawerSectionTitle}>Missing inputs</h3>
        <span
          data-testid="mdr-resolved-badge"
          className={styles.drawerSubtle}
        >
          {badge.x} of {badge.y} resolved
        </span>
      </div>

      {/* --- "What to do next" banner --- */}
      {recommendedNextAction && (
        <div
          data-testid="mdr-recommended-banner"
          style={{
            padding: '8px 10px',
            background: '#e3f2fd',
            border: '1px solid #90caf9',
            borderRadius: 4,
            color: '#0d47a1',
            fontWeight: 600,
          }}
        >
          What to do next: {recommendedNextAction}
        </div>
      )}

      {/* --- Grouped collapsible rows --- */}
      <div data-testid="mdr-groups">
        {groups.map((g) => {
          const groupUnresolvedCount = g.rows.filter((r) => !isResolved(r))
            .length;
          // Default expanded if any unresolved; collapsed if fully resolved.
          // Out-of-v1 always defaults collapsed (no resolver actions).
          const defaultExpanded =
            g.type === 'out_of_v1' ? false : groupUnresolvedCount > 0;
          return (
            <GroupContainer
              key={g.type}
              type={g.type}
              rows={g.rows}
              defaultExpanded={defaultExpanded}
              perRowProps={{
                projectId,
                architectureId,
                resolvedBy,
                onResolved: handleResolved,
                onReset: (id) => void handleReset(id),
                onOpenTargetArchitecture,
              }}
            />
          );
        })}
      </div>

      {/* --- Retry generation button --- */}
      <div
        style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}
      >
        <button
          type="button"
          data-testid="mdr-retry-button"
          onClick={() => void handleRetry()}
          disabled={!allResolved || retryPending}
          title={
            !allResolved
              ? 'All inputs must be resolved before retrying'
              : undefined
          }
        >
          {retryPending ? 'Retrying...' : 'Retry generation'}
        </button>
        {retryError && (
          <span
            data-testid="mdr-retry-error"
            style={{ color: '#b71c1c', fontSize: 11 }}
          >
            {retryError}
          </span>
        )}
      </div>
    </section>
  );
};

export default MigrationDeliveryStoryDrawerResolverPanel;
