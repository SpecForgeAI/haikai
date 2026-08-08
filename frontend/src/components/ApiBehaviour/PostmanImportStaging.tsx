/**
 * PostmanImportStaging
 *
 * Spec: 2026-06-23 Import a Postman Collection into Capture -- Task Group 3
 * (R3 / D6). The SHARED, reviewable import staging table used by BOTH the
 * Mode 1 wizard step and the Mode 2 detail-view modal (the wizard / modal
 * wiring lands in Task Group 8).
 *
 * Per imported item this renders:
 *   - the resolved `method` + `path` (the parser's `ImportedRequest`),
 *   - the mapped session operation row (or an explicit "no match"),
 *   - the architecture-match status pill (matched / needs-architecture /
 *     no-operation),
 *   - an unsupported-body flag when the parser could not send the item
 *     (non-`application/json`).
 *
 * Mapping is by `(method, path)` against the session's operation rows (the pure
 * `stageImportItems` seam). The reconciled coverage panel renders the
 * `InventoryReconciliationResponse` VERBATIM -- this component NEVER re-derives
 * coverage; the AMS calculator's payload is the single source of truth, and the
 * architecture status is read straight off `operations_without_model_endpoint`.
 *
 * UNMATCHED / NO-OPERATION items are SURFACED here (status pill + flagged via
 * `onFlaggedChange`) and routed to the Group 4 architecture-match warning step;
 * they are NEVER silently runnable. This component owns NO fetch and NO send --
 * the parent fetches the reconciliation, passes the operation rows + parsed
 * items in, and drives `manual-capture` after the Group 4 step clears the
 * flagged items.
 */

import React, { useEffect, useMemo, useState } from 'react';
import type {
  ApiBehaviourOperationDto,
  InventoryReconciliationResponse,
} from '../../api/apiBehaviourClient';
import type { ImportedRequest } from '../../utils/postmanImport';
import {
  applyParamValues,
  flaggedForArchMatch,
  stageImportItems,
  type ArchMatchStatus,
  type StagedImportItem,
} from './postmanImportStagingSupport';
import defaultStyles from './PostmanImportStaging.module.css';

export interface PostmanImportStagingProps {
  /** Parsed import items (from `parsePostmanCollection`). */
  importedRequests: ImportedRequest[];
  /** The session's operation rows (mapping target for `(method, path)`). */
  operations: ApiBehaviourOperationDto[];
  /**
   * The VERBATIM reconciliation payload from `reconcileInventory(...)`. `null`
   * while the parent is still fetching it (the coverage panel hides).
   */
  reconciliation: InventoryReconciliationResponse | null;
  /** True while the parent is (re)fetching the reconciliation. */
  loading?: boolean;
  /**
   * Emits the staged items routed to the Group 4 warning step (anything NOT
   * cleanly `matched`). The parent forwards these to the arch-match step.
   */
  onFlaggedChange?: (flagged: StagedImportItem[]) => void;
  /**
   * Replace one imported request (by its stable index) — used by the
   * path-parameter editor to fold operator-supplied values into the item via
   * `applyParamValues` (2026-08-02). When omitted the editor is hidden.
   */
  onUpdateRequest?: (index: number, request: ImportedRequest) => void;
  /**
   * Optional CSS-module override (CSS modules are file-scoped; tests proxy the
   * import). Defaults to this component's own module.
   */
  styles?: Record<string, string>;
}

const STATUS_LABEL: Record<ArchMatchStatus, string> = {
  matched: 'Architecture matched',
  unmatched: 'Needs architecture',
  'no-operation': 'No matching operation',
};

const STATUS_CLASS: Record<ArchMatchStatus, string> = {
  matched: 'statusMatched',
  unmatched: 'statusUnmatched',
  'no-operation': 'statusNoOperation',
};

/** Render a coverage percentage (boxed-Integer nullable) as a string. */
function pct(value: number | null): string {
  return value === null || value === undefined ? '—' : `${value}%`;
}

function CoveragePanel({
  reconciliation,
  styles,
}: {
  reconciliation: InventoryReconciliationResponse;
  styles: Record<string, string>;
}): React.ReactElement {
  return (
    <div
      className={styles.coveragePanel}
      data-testid="postman-import-staging-coverage"
    >
      <div className={styles.coverageFigure}>
        <span className={styles.coverageLabel}>Selected scope coverage</span>
        <span
          className={styles.coverageValue}
          data-testid="postman-import-staging-coverage-scope"
        >
          {pct(reconciliation.in_scope_coverage_pct)}
        </span>
        <span className={styles.coverageSub}>
          {reconciliation.in_scope_accounted_count ?? 0} /{' '}
          {reconciliation.in_scope_total_count ?? 0} accounted
        </span>
      </div>
      <div className={styles.coverageFigure}>
        <span className={styles.coverageLabel}>Architecture coverage</span>
        <span
          className={styles.coverageValue}
          data-testid="postman-import-staging-coverage-architecture"
        >
          {pct(reconciliation.architecture_coverage_pct)}
        </span>
        <span className={styles.coverageSub}>
          {reconciliation.architecture_accounted_count ?? 0} /{' '}
          {reconciliation.architecture_total_count ?? 0} accounted
        </span>
      </div>
      <div className={styles.coverageFigure}>
        <span className={styles.coverageLabel}>Discovery gaps</span>
        <span
          className={styles.coverageValue}
          data-testid="postman-import-staging-coverage-gaps"
        >
          {reconciliation.operations_without_model_endpoint.length}
        </span>
        <span className={styles.coverageSub}>
          operations without a committed endpoint
        </span>
      </div>
    </div>
  );
}

function ParamValueEditor({
  item,
  onUpdateRequest,
  styles,
}: {
  item: StagedImportItem;
  onUpdateRequest: (index: number, request: ImportedRequest) => void;
  styles: Record<string, string>;
}): React.ReactElement {
  const params = item.request.unresolvedParams ?? [];
  const [values, setValues] = useState<Record<string, string>>({});
  const applyDisabled = params.some((p) => !(values[p] ?? '').trim());

  return (
    <div
      className={styles.paramEditor}
      data-testid={`postman-import-staging-item-${item.index}-params`}
    >
      <span className={styles.unsupported}>
        Path parameter{params.length > 1 ? 's need values' : ' needs a value'}{' '}
        before this item can run:
      </span>
      {params.map((name) => (
        <label key={name} className={styles.paramField}>
          <span>{`{${name}}`}</span>
          <input
            type="text"
            value={values[name] ?? ''}
            placeholder="concrete value"
            onChange={(e) =>
              setValues((prev) => ({ ...prev, [name]: e.target.value }))
            }
            data-testid={`postman-import-staging-item-${item.index}-param-${name}`}
          />
        </label>
      ))}
      <button
        type="button"
        disabled={applyDisabled}
        onClick={() =>
          onUpdateRequest(item.index, applyParamValues(item.request, values))
        }
        data-testid={`postman-import-staging-item-${item.index}-apply-params`}
      >
        Apply values
      </button>
    </div>
  );
}

function StagedItemRow({
  item,
  onUpdateRequest,
  styles,
}: {
  item: StagedImportItem;
  onUpdateRequest?: (index: number, request: ImportedRequest) => void;
  styles: Record<string, string>;
}): React.ReactElement {
  const { request, operation, archStatus } = item;
  const operationLabel =
    operation === null
      ? null
      : `${(operation.method ?? '').toUpperCase()} ${operation.path ?? ''}`.trim();

  return (
    <div
      className={styles.item}
      data-testid={`postman-import-staging-item-${item.index}`}
      data-arch-status={archStatus}
      data-runnable={item.runnable ? 'true' : 'false'}
    >
      <div className={styles.itemRequest}>
        <div className={styles.methodPath}>
          <span className={styles.method}>{request.method}</span>
          <span className={styles.path}>{request.path}</span>
        </div>
        <span className={styles.sourceName}>{request.sourceItemName}</span>
        {request.exampleProvenance && (
          <span
            className={styles.sourceName}
            data-testid={`postman-import-staging-item-${item.index}-example-provenance`}
          >
            {`Resolved ${request.exampleProvenance.resolvedNames
              .map((n) => (n === 'body' ? 'body' : `{${n}}`))
              .join(', ')} from saved example "${request.exampleProvenance.exampleName}"`}
          </span>
        )}
        {request.unsupportedReason !== undefined && (
          <span
            className={styles.unsupported}
            data-testid={`postman-import-staging-item-${item.index}-unsupported`}
          >
            {request.unsupportedReason}
          </span>
        )}
        {(request.unresolvedParams ?? []).length > 0 && onUpdateRequest && (
          <ParamValueEditor
            item={item}
            onUpdateRequest={onUpdateRequest}
            styles={styles}
          />
        )}
      </div>

      <div>
        {operationLabel !== null ? (
          <span
            className={styles.mappedOperation}
            data-testid={`postman-import-staging-item-${item.index}-operation`}
          >
            {operationLabel}
          </span>
        ) : (
          <span
            className={styles.noMatch}
            data-testid={`postman-import-staging-item-${item.index}-no-match`}
          >
            no match
          </span>
        )}
      </div>

      <span
        className={`${styles.statusPill} ${styles[STATUS_CLASS[archStatus]]}`}
        data-testid={`postman-import-staging-item-${item.index}-status`}
      >
        {STATUS_LABEL[archStatus]}
      </span>
    </div>
  );
}

export function PostmanImportStaging({
  importedRequests,
  operations,
  reconciliation,
  loading,
  onFlaggedChange,
  onUpdateRequest,
  styles = defaultStyles,
}: PostmanImportStagingProps): React.ReactElement {
  // The single shared mapping + classification seam (pure). Recomputed only
  // when the inputs change.
  const staged = useMemo(
    () => stageImportItems(importedRequests, operations, reconciliation),
    [importedRequests, operations, reconciliation],
  );

  const flagged = useMemo(() => flaggedForArchMatch(staged), [staged]);

  // Surface the flagged set to the parent so the Group 4 arch-match step can
  // pick it up (unmatched / no-operation items are routed there, never run).
  useEffect(() => {
    onFlaggedChange?.(flagged);
  }, [flagged, onFlaggedChange]);

  return (
    <div
      className={styles.container}
      data-testid="postman-import-staging"
    >
      <p className={styles.intro}>
        Review the imported requests below before the run. Each item is mapped to
        a capture operation by method + path; items that do not match a committed
        architecture endpoint (or any known operation) are flagged for the
        architecture-match step and will not run until resolved.
      </p>

      {loading ? (
        <p
          className={styles.intro}
          data-testid="postman-import-staging-loading"
        >
          Reconciling coverage…
        </p>
      ) : (
        reconciliation !== null && (
          <CoveragePanel reconciliation={reconciliation} styles={styles} />
        )
      )}

      {staged.length === 0 ? (
        <p
          className={styles.emptyState}
          data-testid="postman-import-staging-empty"
        >
          No importable requests were found in this collection.
        </p>
      ) : (
        <div
          className={styles.itemList}
          data-testid="postman-import-staging-list"
        >
          <div className={styles.itemHeader}>
            <div>Imported request</div>
            <div>Mapped operation</div>
            <div>Architecture</div>
          </div>
          {staged.map((item) => (
            <StagedItemRow
              key={item.index}
              item={item}
              onUpdateRequest={onUpdateRequest}
              styles={styles}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default PostmanImportStaging;
