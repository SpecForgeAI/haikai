/**
 * PostmanImportArchMatchStep
 *
 * Spec: 2026-06-23 Import a Postman Collection into Capture -- Task Group 4
 * (R5 / D5 / A2 / A4 / A5). The architecture-match WARNING step. Items the
 * Group 3 staging table flagged -- those NOT matching a committed architecture
 * endpoint (`unmatched`, per `operations_without_model_endpoint`) AND any item
 * mapping to NO known operation (`no-operation`) -- are routed HERE before any
 * run. A flagged item is NEVER silently run.
 *
 * Each flagged item offers three resolutions:
 *   - "Add to architecture" -> STAGES A DISCOVERY CANDIDATE via the injected
 *     `onStageDiscoveryCandidate` seam (the existing discovery review/approve
 *     path). It MUST NOT write a committed architecture endpoint directly -- this
 *     component owns no architecture write and only invokes the candidate-staging
 *     callback (A4).
 *   - "Keep & run"         -> the user accepts the unknown operation; the
 *     operation row is CREATED FIRST via the `addOperation` client (Group 2)
 *     BEFORE any `manual-capture` send (A2), so the send clears the route's
 *     OPERATION_NOT_FOUND / OPERATION_NOT_INCLUDED guards. The created row is
 *     surfaced to the parent via `onOperationAdded`.
 *   - "Delete the item"    -> drops the item from the staged import set (the
 *     parent removes it via `onDeleteItem`).
 *
 * NOTE ON THE DISCOVERY-CANDIDATE SEAM: the existing
 * `frontend/src/api/discoveryReviewApi.ts` is the conversation-based REVIEW
 * client (it has no single-candidate "stage" call), and the AMS-side
 * candidate-staging endpoint is Task Group 5 (only if a gap is found). So the
 * actual wiring of "Add to architecture" to the discovery candidate path is
 * injected as the `onStageDiscoveryCandidate` callback and bound by Task Group 8
 * (the wizard / detail-view integration). What is load-bearing HERE -- and what
 * the tests assert -- is that this step routes "Add to architecture" through
 * that staging seam and never performs a committed-architecture write.
 */

import React, { useState } from 'react';
import {
  addOperation,
  ApiBehaviourApiError,
  type ApiBehaviourOperationDto,
} from '../../api/apiBehaviourClient';
import type { StagedImportItem } from './postmanImportStagingSupport';
import {
  buildAddOperationRequest,
  type ArchMatchResolution,
} from './postmanImportArchMatchSupport';
import defaultStyles from './PostmanImportArchMatchStep.module.css';

export interface PostmanImportArchMatchStepProps {
  projectId: string;
  architectureId: string;
  sessionId: string;
  /** The flagged staged items (from `flaggedForArchMatch`). */
  flagged: StagedImportItem[];
  /** Per-item resolution map (keyed by `StagedImportItem.index`). */
  resolutions: Record<number, ArchMatchResolution>;
  /** Record a resolution for a flagged item (the parent owns the map). */
  onResolutionChange: (index: number, resolution: ArchMatchResolution) => void;
  /**
   * The discovery-candidate STAGING seam for "Add to architecture". MUST stage a
   * discovery candidate through the existing review/approve path -- it MUST NOT
   * write a committed architecture endpoint. Bound by Task Group 8.
   */
  onStageDiscoveryCandidate: (item: StagedImportItem) => void | Promise<void>;
  /** Drop the item from the staged import set ("Delete the item"). */
  onDeleteItem: (item: StagedImportItem) => void;
  /**
   * Surfaces the operation row created by a "Keep & run" add-operation call so
   * the parent can add it to the operation rows before the send.
   */
  onOperationAdded?: (operation: ApiBehaviourOperationDto) => void;
  /** Optional CSS-module override (tests proxy the import). */
  styles?: Record<string, string>;
}

function reasonFor(item: StagedImportItem): string {
  return item.archStatus === 'no-operation'
    ? 'This request does not map to any known operation in the session.'
    : 'This operation does not match a committed architecture endpoint.';
}

const RESOLUTION_TAG: Partial<Record<ArchMatchResolution, string>> = {
  staged: 'Staged as discovery candidate',
  kept: 'Kept — operation added',
  deleted: 'Deleted',
};

const RESOLUTION_CLASS: Partial<Record<ArchMatchResolution, string>> = {
  staged: 'resolutionStaged',
  kept: 'resolutionKept',
  deleted: 'resolutionDeleted',
};

function FlaggedItemRow({
  projectId,
  architectureId,
  sessionId,
  item,
  resolution,
  onResolutionChange,
  onStageDiscoveryCandidate,
  onDeleteItem,
  onOperationAdded,
  styles,
}: {
  projectId: string;
  architectureId: string;
  sessionId: string;
  item: StagedImportItem;
  resolution: ArchMatchResolution;
  onResolutionChange: (index: number, resolution: ArchMatchResolution) => void;
  onStageDiscoveryCandidate: (item: StagedImportItem) => void | Promise<void>;
  onDeleteItem: (item: StagedImportItem) => void;
  onOperationAdded?: (operation: ApiBehaviourOperationDto) => void;
  styles: Record<string, string>;
}): React.ReactElement {
  const [busy, setBusy] = useState<null | 'stage' | 'keep'>(null);
  const [error, setError] = useState<string | null>(null);
  const resolved = resolution !== 'pending';

  const handleStage = async (): Promise<void> => {
    setError(null);
    setBusy('stage');
    try {
      // STAGE A DISCOVERY CANDIDATE -- never a committed-architecture write.
      await onStageDiscoveryCandidate(item);
      onResolutionChange(item.index, 'staged');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to stage discovery candidate',
      );
    } finally {
      setBusy(null);
    }
  };

  const handleKeep = async (): Promise<void> => {
    setError(null);
    setBusy('keep');
    try {
      // Create the operation row FIRST (included=true) so the later
      // manual-capture send passes the OPERATION_NOT_FOUND / NOT_INCLUDED guards.
      const res = await addOperation(
        projectId,
        architectureId,
        sessionId,
        buildAddOperationRequest(item),
      );
      onOperationAdded?.(res.operation);
      onResolutionChange(item.index, 'kept');
    } catch (err) {
      const detail =
        err instanceof ApiBehaviourApiError
          ? err.body?.message ?? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to add operation';
      setError(detail);
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = (): void => {
    setError(null);
    onDeleteItem(item);
    onResolutionChange(item.index, 'deleted');
  };

  const tag = RESOLUTION_TAG[resolution];
  const tagClass = RESOLUTION_CLASS[resolution];

  return (
    <div
      className={`${styles.item} ${resolved ? styles.itemResolved : ''}`}
      data-testid={`postman-import-arch-item-${item.index}`}
      data-resolution={resolution}
    >
      <div className={styles.itemMeta}>
        <span className={styles.method}>{item.request.method}</span>
        <span className={styles.path}>{item.request.path}</span>
      </div>
      <span className={styles.sourceName}>{item.request.sourceItemName}</span>
      <span className={styles.reason}>{reasonFor(item)}</span>

      {error !== null && (
        <p
          className={styles.errorBanner}
          data-testid={`postman-import-arch-item-${item.index}-error`}
        >
          {error}
        </p>
      )}

      {resolved && tag ? (
        <span
          className={`${styles.resolutionTag} ${tagClass ? styles[tagClass] : ''}`}
          data-testid={`postman-import-arch-item-${item.index}-resolution`}
        >
          {tag}
        </span>
      ) : (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.actionButton}
            disabled={busy !== null}
            onClick={handleStage}
            data-testid={`postman-import-arch-item-${item.index}-add-to-architecture`}
          >
            Add to architecture
            {busy === 'stage' && <span className={styles.spinner} />}
          </button>
          <button
            type="button"
            className={styles.actionButton}
            disabled={busy !== null}
            onClick={handleKeep}
            data-testid={`postman-import-arch-item-${item.index}-keep-and-run`}
          >
            Keep &amp; run
            {busy === 'keep' && <span className={styles.spinner} />}
          </button>
          <button
            type="button"
            className={`${styles.actionButton} ${styles.deleteButton}`}
            disabled={busy !== null}
            onClick={handleDelete}
            data-testid={`postman-import-arch-item-${item.index}-delete`}
          >
            Delete the item
          </button>
        </div>
      )}
    </div>
  );
}

export function PostmanImportArchMatchStep({
  projectId,
  architectureId,
  sessionId,
  flagged,
  resolutions,
  onResolutionChange,
  onStageDiscoveryCandidate,
  onDeleteItem,
  onOperationAdded,
  styles = defaultStyles,
}: PostmanImportArchMatchStepProps): React.ReactElement {
  if (flagged.length === 0) {
    return (
      <div className={styles.container} data-testid="postman-import-arch-match">
        <p className={styles.emptyState} data-testid="postman-import-arch-empty">
          All imported requests match a committed architecture endpoint — nothing
          to resolve.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.container} data-testid="postman-import-arch-match">
      <p
        className={styles.warningBanner}
        data-testid="postman-import-arch-warning"
      >
        {flagged.length} imported request{flagged.length === 1 ? '' : 's'} do not
        match a committed architecture endpoint. Resolve each before the run: add
        it to the architecture (stages a discovery candidate for review), keep and
        run it as-is, or delete it.
      </p>

      <div className={styles.itemList} data-testid="postman-import-arch-list">
        {flagged.map((item) => (
          <FlaggedItemRow
            key={item.index}
            projectId={projectId}
            architectureId={architectureId}
            sessionId={sessionId}
            item={item}
            resolution={resolutions[item.index] ?? 'pending'}
            onResolutionChange={onResolutionChange}
            onStageDiscoveryCandidate={onStageDiscoveryCandidate}
            onDeleteItem={onDeleteItem}
            onOperationAdded={onOperationAdded}
            styles={styles}
          />
        ))}
      </div>
    </div>
  );
}

export default PostmanImportArchMatchStep;
