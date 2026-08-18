/**
 * PostmanImportWizardStep
 *
 * Spec: 2026-06-23 Import a Postman Collection into Capture, R4 / R5 / A5
 * (Task Group 8). The Mode 1 wizard sub-section: the 3-way RUN MODE selector
 * (LLM only / Postman + LLM delta / Postman only) + the Postman collection
 * upload, the Group 3 staging table, and the Group 4 arch-match step.
 *
 * This component is PRESENTATIONAL + state-light: it owns the run-mode + the
 * parsed-file local state and renders the staging / arch-match children, but the
 * SEND orchestration (firing `manual-capture` after `/start`, the delta top-up,
 * the coverage-override on `/start`) lives in the wizard's start handler, which
 * the parent drives off the props this component lifts up:
 *   - `mode`                 the selected run mode (the parent gates `/start`).
 *   - `importedRequests`     the parsed items (the parent fires them post-`/start`).
 *   - the arch-match resolution state from `usePostmanImportRun` (so an unmatched
 *     item is resolved -- staged / kept / deleted -- before the run).
 *
 * The parent passes the live operation rows + reconciliation in so the staging
 * table maps + classifies items; "Keep & run" creates the operation row via
 * add-operation through the hook before the parent's post-`/start` send.
 */

import React, { useCallback } from 'react';
import {
  type ApiBehaviourOperationDto,
  type InventoryReconciliationResponse,
} from '../../api/apiBehaviourClient';
import { stageImportedDiscoveryCandidate } from '../../api/discoveryApi';
import {
  parsePostmanCollection,
  type ImportedRequest,
} from '../../utils/postmanImport';
import { PostmanImportStaging } from './PostmanImportStaging';
import { PostmanImportArchMatchStep } from './PostmanImportArchMatchStep';
import type { StagedImportItem } from './postmanImportStagingSupport';
import type { ArchMatchResolution } from './postmanImportArchMatchSupport';
import type { PostmanRunMode } from './postmanImportRunSupport';
import { modeUsesPostman } from './postmanImportRunSupport';
import styles from './PostmanImportWizardStep.module.css';

export interface PostmanImportWizardStepProps {
  projectId: string;
  architectureId: string;
  /**
   * The draft session id. Null until the wizard has created the draft (the
   * arch-match add-operation + the discovery-candidate staging both need it);
   * the upload + selector still render so the user can choose a mode early.
   */
  sessionId: string | null;
  mode: PostmanRunMode;
  onModeChange: (mode: PostmanRunMode) => void;
  importedRequests: ImportedRequest[];
  onImportedRequestsChange: (requests: ImportedRequest[]) => void;
  operations: ApiBehaviourOperationDto[];
  reconciliation: InventoryReconciliationResponse | null;
  reconciliationLoading?: boolean;
  /** Arch-match resolution state (lifted from `usePostmanImportRun`). */
  flagged: StagedImportItem[];
  resolutions: Record<number, ArchMatchResolution>;
  onResolutionChange: (index: number, resolution: ArchMatchResolution) => void;
  onOperationAdded: (operation: ApiBehaviourOperationDto) => void;
  onDeleteItem: (item: StagedImportItem) => void;
  /**
   * Application-log capture source (CSD Spec 6, 2026-08-18). The old 3-way
   * radio was a two-source multi-select wearing an enum costume — the
   * selector is now genuine checkboxes {LLM, Postman, Application log}. The
   * LLM/Postman pair still derives the EXISTING PostmanRunMode; the log
   * source is independent state lifted to the wizard, and its sub-section
   * (upload + staging + funnel + include-in-initial) renders via
   * `logSectionSlot` when selected.
   */
  logSelected: boolean;
  onLogSelectedChange: (selected: boolean) => void;
  logSectionSlot?: React.ReactNode;
}

export function PostmanImportWizardStep({
  projectId,
  architectureId,
  sessionId,
  mode,
  onModeChange,
  importedRequests,
  onImportedRequestsChange,
  operations,
  reconciliation,
  reconciliationLoading,
  flagged,
  resolutions,
  onResolutionChange,
  onOperationAdded,
  onDeleteItem,
  logSelected,
  onLogSelectedChange,
  logSectionSlot,
}: PostmanImportWizardStepProps): React.ReactElement {
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [parseError, setParseError] = React.useState<string | null>(null);

  const handleFile = useCallback(
    async (file: File | null) => {
      setParseError(null);
      if (!file) {
        onImportedRequestsChange([]);
        setFileName(null);
        return;
      }
      setFileName(file.name);
      try {
        const text = await file.text();
        const json = JSON.parse(text) as Record<string, unknown>;
        const parsed = parsePostmanCollection(json);
        onImportedRequestsChange(parsed);
        if (parsed.length === 0) {
          setParseError('No importable requests were found in this collection.');
        }
      } catch {
        onImportedRequestsChange([]);
        setParseError('Could not parse this file as a Postman collection (JSON).');
      }
    },
    [onImportedRequestsChange],
  );

  const handleStageCandidate = useCallback(
    async (item: StagedImportItem) => {
      // STAGE A DISCOVERY CANDIDATE -- never a committed-architecture write (A4).
      await stageImportedDiscoveryCandidate(projectId, architectureId, {
        method: item.request.method,
        path: item.request.path,
        sourceItemName: item.request.sourceItemName,
      });
    },
    [projectId, architectureId],
  );

  const showImportUi = modeUsesPostman(mode);

  // Source checkboxes derive the existing run mode: {LLM} = llm,
  // {LLM, Postman} = postman-delta, {Postman} = postman-only. Unticking the
  // last of the pair leaves the OTHER one's solo mode; unticking both is a
  // legal selection state (the wizard's start gate blocks it unless the log
  // corpus carries the initial run).
  const llmChecked = mode === 'llm' || mode === 'postman-delta';
  const postmanChecked = mode === 'postman-delta' || mode === 'postman-only';
  const applySources = (llm: boolean, postman: boolean) => {
    if (llm && postman) onModeChange('postman-delta');
    else if (postman) onModeChange('postman-only');
    else onModeChange('llm');
  };

  return (
    <div data-testid="postman-import-wizard-step">
      <p className={styles.helperText}>
        Choose the capture sources for this run — pick one or several.
      </p>

      <div
        className={styles.modeList}
        role="group"
        aria-label="Capture sources"
        data-testid="capture-sources"
      >
        <label
          className={`${styles.modeItem} ${llmChecked ? styles.modeItemActive : ''}`}
          data-testid="capture-source-llm"
        >
          <input
            type="checkbox"
            checked={llmChecked}
            onChange={(e) => applySources(e.target.checked, postmanChecked)}
          />
          <span>
            <span className={styles.modeLabel}>LLM generated</span>
            <span className={styles.modeHint}>
              The planner generates scenarios; with other sources selected it tops up
              only the uncovered delta.
            </span>
          </span>
        </label>
        <label
          className={`${styles.modeItem} ${postmanChecked ? styles.modeItemActive : ''}`}
          data-testid="capture-source-postman"
        >
          <input
            type="checkbox"
            checked={postmanChecked}
            onChange={(e) => applySources(llmChecked, e.target.checked)}
          />
          <span>
            <span className={styles.modeLabel}>Postman collection</span>
            <span className={styles.modeHint}>
              Fire imported requests as captures. Without the LLM source, coverage is
              intentionally partial (override required).
            </span>
          </span>
        </label>
        <label
          className={`${styles.modeItem} ${logSelected ? styles.modeItemActive : ''}`}
          data-testid="capture-source-log"
        >
          <input
            type="checkbox"
            checked={logSelected}
            onChange={(e) => onLogSelectedChange(e.target.checked)}
          />
          <span>
            <span className={styles.modeLabel}>Application log generated</span>
            <span className={styles.modeHint}>
              Mine real requests from an application log into a replay corpus —
              merged into this run or staged for reconciliation round 2.
            </span>
          </span>
        </label>
      </div>

      {logSelected && logSectionSlot}

      {showImportUi && (
        <>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Postman collection (.json)</label>
            <p className={styles.helperText}>
              Tip: save the exact working request on each Postman request as an
              example (send it, then &ldquo;Save as example&rdquo;). The import
              reads concrete IDs and values from saved examples, so
              parameterised URLs resolve without re-entering values here.
            </p>
            <input
              type="file"
              accept=".json,application/json"
              onChange={(e) =>
                void handleFile(e.target.files ? e.target.files[0] : null)
              }
              data-testid="postman-import-wizard-file"
            />
            {fileName && <span className={styles.helperText}>{fileName}</span>}
          </div>

          {parseError && (
            <div
              className={styles.errorBanner}
              role="alert"
              data-testid="postman-import-wizard-parse-error"
            >
              {parseError}
            </div>
          )}

          {importedRequests.length > 0 && (
            <>
              <PostmanImportStaging
                importedRequests={importedRequests}
                operations={operations}
                reconciliation={reconciliation}
                loading={reconciliationLoading}
                onUpdateRequest={(index, request) =>
                  onImportedRequestsChange(
                    importedRequests.map((r, i) => (i === index ? request : r)),
                  )
                }
              />

              {flagged.length > 0 && sessionId !== null && (
                <PostmanImportArchMatchStep
                  projectId={projectId}
                  architectureId={architectureId}
                  sessionId={sessionId}
                  flagged={flagged}
                  resolutions={resolutions}
                  onResolutionChange={onResolutionChange}
                  onStageDiscoveryCandidate={handleStageCandidate}
                  onDeleteItem={onDeleteItem}
                  onOperationAdded={onOperationAdded}
                />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

export default PostmanImportWizardStep;
