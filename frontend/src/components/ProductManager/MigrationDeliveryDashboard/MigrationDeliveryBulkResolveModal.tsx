/**
 * MigrationDeliveryBulkResolveModal
 *
 * Spec: 2026-05-20 Missing Input Resolver Flow -- Task Group 7.5 + 7.6.
 * Extended by: 2026-05-20 Bulk-Resolve OAS/WSDL Parser -- Task Group 6.
 *
 * Two-step bulk-resolve flow that supports BOTH manual entries and a real
 * multi-file OAS / WSDL upload path.
 *
 *   1. PREVIEW (`commit=false`): the user supplies either manual entries
 *      (service+operation, source+target id, or logical name) OR uploads one
 *      or more contract files. Clicking "Preview" calls the appropriate
 *      backend (the bulk endpoint for manual rows, parse-files for uploads)
 *      with `commit=false` and renders a preview surface. NO writes occur.
 *   2. COMMIT (`commit=true`): the same items are POSTed with
 *      `commit=true`; on success the modal closes and the parent dashboard
 *      refreshes both the ready-to-retry count and needs-attention list.
 *
 * Always show the preview before any write, even for a single key.
 *
 * Upload modality (Task Group 6)
 * ------------------------------
 * The greyed-out v1 placeholder is replaced by a real multi-file uploader:
 *
 *   - `<input type="file" multiple accept=".json,.yaml,.yml,.wsdl,.xml">`
 *   - Per-file panel after selection (filename + size; format chip +
 *     status chip populated after preview returns; editable service-name
 *     override).
 *   - Per-operation rows under each file panel (identifier, truncated
 *     missing-input-key, status chip, matched-spec count).
 *   - "view existing resolution" inline link on `already_resolved` rows
 *     opens a read-only side panel (`MigrationDeliveryExistingResolutionSidePanel`).
 *   - Summary banner before commit ("This will create N new resolutions
 *     across M stories") driven by `ContractIngestResponse.summary`.
 *   - Per-file inline error for too-large / unsupported / parse-failed files.
 *
 * The modal does NOT persist files across the preview/commit boundary -- the
 * user re-confirms intent by clicking Apply, which RE-SENDS the same selected
 * files with `commit=true` (per spec line 60).
 *
 * Boundary -- the modal speaks the camelCase contract from
 * `missingInputResolutionsApi.ts`; the API client wraps the snake_case
 * encoding so this component stays idiomatic.
 */

import React, { useCallback, useState } from 'react';
import {
  bulkResolve as defaultBulkResolve,
  parseFiles as defaultParseFiles,
  type BulkResolveItem,
  type BulkResolveResponse,
  type ContractIngestFile,
  type ContractIngestResponse,
} from '../../../api/missingInputResolutionsApi';
import { listResolutions as defaultListResolutions } from '../../../api/missingInputResolutionsApi';
import {
  MigrationDeliveryExistingResolutionSidePanel,
  type ExistingResolutionViewData,
} from './MigrationDeliveryExistingResolutionSidePanel';
import styles from './MigrationDeliveryDashboard.module.css';

// ============================================================================
// Local item state -- one row in the manual entries table.
// ============================================================================

type ItemDraft = {
  id: string;
  type: 'api_contract' | 'mapping' | 'target_element';
  serviceName: string;
  operationName: string;
  sourceElementId: string;
  targetElementId: string;
  targetElementLogicalName: string;
};

function makeEmptyDraft(seed: number): ItemDraft {
  return {
    id: `draft-${seed}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'api_contract',
    serviceName: '',
    operationName: '',
    sourceElementId: '',
    targetElementId: '',
    targetElementLogicalName: '',
  };
}

function draftToBulkItem(d: ItemDraft): BulkResolveItem {
  return {
    type: d.type,
    serviceName: d.type === 'api_contract' ? d.serviceName.trim() : null,
    operationName: d.type === 'api_contract' ? d.operationName.trim() : null,
    sourceElementId: d.type === 'mapping' ? d.sourceElementId.trim() : null,
    targetElementId: d.type === 'mapping' ? d.targetElementId.trim() : null,
    targetElementLogicalName:
      d.type === 'target_element'
        ? d.targetElementLogicalName.trim()
        : null,
    payload: null,
  };
}

function draftIsValid(d: ItemDraft): boolean {
  if (d.type === 'api_contract') {
    return d.serviceName.trim().length > 0 && d.operationName.trim().length > 0;
  }
  if (d.type === 'mapping') {
    return (
      d.sourceElementId.trim().length > 0 &&
      d.targetElementId.trim().length > 0
    );
  }
  // target_element
  return d.targetElementLogicalName.trim().length > 0;
}

// ============================================================================
// Local upload state -- one entry per selected File. Service-name overrides
// are tracked separately because the original File objects are immutable.
// ============================================================================

interface SelectedFile {
  /** Stable local id so React keys survive reorderings. */
  localId: string;
  /** The actual File object from the input element. */
  file: File;
  /** User-supplied service-name override, blank means "use suggested". */
  serviceNameOverride: string;
}

function makeSelectedFile(file: File): SelectedFile {
  return {
    localId: `uf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    file,
    serviceNameOverride: '',
  };
}

function humaniseBytes(n: number | null): string {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function truncateKey(key: string | null): string {
  if (!key) return '';
  return key.length > 8 ? key.slice(0, 8) : key;
}

// Format chip label (e.g. "OAS 3.0", "WSDL 1.1"). Falls back to the raw value.
function prettyFormat(raw: string | null): string {
  if (!raw) return '';
  const map: Record<string, string> = {
    OAS_2_0: 'OAS 2.0',
    OAS_3_0: 'OAS 3.0',
    OAS_3_1: 'OAS 3.1',
    WSDL_1_1: 'WSDL 1.1',
    WSDL_2_0: 'WSDL 2.0',
    UNKNOWN: 'Unknown',
  };
  return map[raw.toUpperCase()] ?? raw;
}

// Normalise the per-operation status (AMS may emit MATCHED or matched).
function normaliseOpStatus(s: string): string {
  return (s || '').toLowerCase();
}

function operationStatusBadge(status: string): React.ReactNode {
  const norm = normaliseOpStatus(status);
  const colour =
    norm === 'matched'
      ? '#388e3c'
      : norm === 'already_resolved'
        ? '#7e57c2'
        : norm === 'no_match'
          ? '#90a4ae'
          : '#b0bec5';
  return (
    <span
      style={{
        background: colour,
        color: 'white',
        fontSize: 10,
        padding: '2px 6px',
        borderRadius: 3,
        textTransform: 'uppercase',
      }}
    >
      {norm.replace('_', ' ')}
    </span>
  );
}

function fileStatusBadge(status: string): React.ReactNode {
  const norm = (status || '').toLowerCase();
  const colour =
    norm === 'parsed'
      ? '#388e3c'
      : norm === 'failed'
        ? '#d32f2f'
        : norm === 'parsing'
          ? '#1976d2'
          : '#90a4ae';
  return (
    <span
      style={{
        background: colour,
        color: 'white',
        fontSize: 10,
        padding: '2px 6px',
        borderRadius: 3,
        textTransform: 'uppercase',
      }}
    >
      {norm || 'queued'}
    </span>
  );
}

// ============================================================================
// Props
// ============================================================================

export interface MigrationDeliveryBulkResolveModalProps {
  projectId: string;
  resolvedBy: string;
  onClose: () => void;
  /**
   * Invoked after a successful COMMIT (either bulk-resolve or parse-files).
   * The parent dashboard refreshes the ready-to-retry count + needs-attention
   * list.
   */
  onCommitted: (response: BulkResolveResponse | ContractIngestResponse) => void;
  /** Test seam: override the bulk endpoint call. */
  bulkResolveFn?: typeof defaultBulkResolve;
  /** Test seam: override the parse-files endpoint call. */
  parseFilesFn?: typeof defaultParseFiles;
  /** Test seam: override the resolutions list fetch used for the side panel. */
  listResolutionsFn?: typeof defaultListResolutions;
}

// ============================================================================
// Component
// ============================================================================

export const MigrationDeliveryBulkResolveModal: React.FC<
  MigrationDeliveryBulkResolveModalProps
> = ({
  projectId,
  resolvedBy,
  onClose,
  onCommitted,
  bulkResolveFn = defaultBulkResolve,
  parseFilesFn = defaultParseFiles,
  listResolutionsFn = defaultListResolutions,
}) => {
  // Manual entry state (existing v1 path)
  const [drafts, setDrafts] = useState<ItemDraft[]>([makeEmptyDraft(0)]);
  const [previewResult, setPreviewResult] = useState<BulkResolveResponse | null>(
    null,
  );

  // Upload state (Task Group 6)
  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([]);
  const [ingestResult, setIngestResult] = useState<ContractIngestResponse | null>(
    null,
  );

  // Shared
  const [inFlight, setInFlight] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Side panel state
  const [sidePanelResolution, setSidePanelResolution] =
    useState<ExistingResolutionViewData | null>(null);

  const updateDraft = useCallback(
    (id: string, patch: Partial<ItemDraft>) => {
      setDrafts((prev) =>
        prev.map((d) => (d.id === id ? { ...d, ...patch } : d)),
      );
      // Any edit invalidates the staged preview -- the user must re-preview.
      setPreviewResult(null);
    },
    [],
  );

  const addDraft = useCallback(() => {
    setDrafts((prev) => [...prev, makeEmptyDraft(prev.length)]);
    setPreviewResult(null);
  }, []);

  const removeDraft = useCallback((id: string) => {
    setDrafts((prev) =>
      prev.length <= 1 ? prev : prev.filter((d) => d.id !== id),
    );
    setPreviewResult(null);
  }, []);

  // Multi-file selection. Each call REPLACES the current selection (matches
  // <input type=file multiple> semantics) so re-picking files re-stages.
  const handleFilesSelected = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const fl = e.target.files;
      const next: SelectedFile[] = [];
      if (fl) {
        // FileList in browsers exposes both  and bracket access.
        // We use bracket access because jsdom mocks (where tests pass plain
        // arrays via fireEvent) do not always implement .
        const list = fl as unknown as ArrayLike<File>;
        for (let i = 0; i < list.length; i++) {
          const f = list[i];
          if (f) next.push(makeSelectedFile(f));
        }
      }
      setSelectedFiles(next);
      // Re-selecting files invalidates any prior preview.
      setIngestResult(null);
    },
    [],
  );

  const updateServiceNameOverride = useCallback(
    (localId: string, value: string) => {
      setSelectedFiles((prev) =>
        prev.map((s) =>
          s.localId === localId ? { ...s, serviceNameOverride: value } : s,
        ),
      );
      // Editing the override invalidates the preview so the user must
      // re-preview to see the updated classification.
      setIngestResult(null);
    },
    [],
  );

  const validDrafts = drafts.filter(draftIsValid);
  const hasFiles = selectedFiles.length > 0;
  const hasManualItems = validDrafts.length > 0;

  // Preview enabled if there is at least one valid manual draft OR any
  // selected file. Commit enabled only after a corresponding preview run.
  const canPreview = (hasManualItems || hasFiles) && !inFlight;
  const canCommitManual = previewResult != null && !inFlight;
  const canCommitFiles =
    ingestResult != null &&
    !inFlight &&
    (ingestResult.summary.willCreateResolutions ?? 0) > 0;

  // Run preview against whichever modality the user has populated. If both
  // are populated we run BOTH in sequence so the user sees a single coherent
  // preview surface; failures abort the second call to avoid half-completed
  // state.
  const handlePreview = useCallback(async () => {
    if (!canPreview) return;
    setError(null);
    setInFlight(true);
    try {
      if (hasManualItems) {
        const items = validDrafts.map(draftToBulkItem);
        const result = await bulkResolveFn(projectId, {
          items,
          commit: false,
          resolvedBy,
        });
        setPreviewResult(result);
      } else {
        setPreviewResult(null);
      }
      if (hasFiles) {
        const result = await parseFilesFn(
          projectId,
          selectedFiles.map((s) => s.file),
          selectedFiles.map((s) =>
            s.serviceNameOverride.trim().length > 0
              ? s.serviceNameOverride.trim()
              : null,
          ),
          false,
          resolvedBy,
        );
        setIngestResult(result);
      } else {
        setIngestResult(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
      setPreviewResult(null);
      setIngestResult(null);
    } finally {
      setInFlight(false);
    }
  }, [
    canPreview,
    hasManualItems,
    hasFiles,
    validDrafts,
    bulkResolveFn,
    parseFilesFn,
    projectId,
    resolvedBy,
    selectedFiles,
  ]);

  const handleCommit = useCallback(async () => {
    if (!canCommitManual && !canCommitFiles) return;
    setError(null);
    setInFlight(true);
    try {
      // Manual commit path: re-send the staged drafts with commit=true.
      if (canCommitManual && hasManualItems) {
        const items = validDrafts.map(draftToBulkItem);
        const result = await bulkResolveFn(projectId, {
          items,
          commit: true,
          resolvedBy,
        });
        onCommitted(result);
        return;
      }
      // File-upload commit path: RE-SEND the same selected files with
      // commit=true (modal does not persist files across the preview boundary).
      if (canCommitFiles && hasFiles) {
        const result = await parseFilesFn(
          projectId,
          selectedFiles.map((s) => s.file),
          selectedFiles.map((s) =>
            s.serviceNameOverride.trim().length > 0
              ? s.serviceNameOverride.trim()
              : null,
          ),
          true,
          resolvedBy,
        );
        onCommitted(result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Commit failed');
    } finally {
      setInFlight(false);
    }
  }, [
    canCommitManual,
    canCommitFiles,
    hasManualItems,
    hasFiles,
    validDrafts,
    bulkResolveFn,
    parseFilesFn,
    projectId,
    resolvedBy,
    selectedFiles,
    onCommitted,
  ]);

  // "view existing resolution" link handler. We have only the resolution id
  // from the per-operation row, so we fetch the full resolution row via the
  // listResolutions filter and surface it in the side panel. The side panel
  // closes automatically on click-outside / X.
  const handleViewExistingResolution = useCallback(
    async (
      existingResolutionId: string,
      operationIdentifier: string,
      finalServiceName: string | null,
      missingInputKey: string | null,
    ) => {
      try {
        // List the project's active resolutions filtered to the missing-input
        // key (when available) so we get exactly the matching row. Falls back
        // to scanning the unfiltered list otherwise.
        const opts = missingInputKey ? { missingInputKey } : undefined;
        const rows = await listResolutionsFn(projectId, opts);
        const match = rows.find((r) => r.id === existingResolutionId);
        if (!match) {
          setSidePanelResolution({
            id: existingResolutionId,
            missingInputKey: missingInputKey ?? '',
            missingInputType: 'api_contract',
            descriptor:
              finalServiceName != null
                ? `${finalServiceName}::${operationIdentifier}`
                : operationIdentifier,
            resolvedAt: null,
            resolvedBy: null,
            resolutionSource: null,
            projectArtifactId: null,
            projectArtifactFilename: null,
          });
          return;
        }
        const payload = match.resolutionPayloadJson ?? {};
        const sourceFromPayload =
          typeof (payload as Record<string, unknown>)['resolution_source'] === 'string'
            ? ((payload as Record<string, unknown>)['resolution_source'] as string)
            : typeof (payload as Record<string, unknown>)['resolutionSource'] === 'string'
              ? ((payload as Record<string, unknown>)['resolutionSource'] as string)
              : null;
        const artifactIdFromPayload =
          typeof (payload as Record<string, unknown>)['project_artifact_id'] === 'string'
            ? ((payload as Record<string, unknown>)['project_artifact_id'] as string)
            : typeof (payload as Record<string, unknown>)['projectArtifactId'] === 'string'
              ? ((payload as Record<string, unknown>)['projectArtifactId'] as string)
              : null;
        setSidePanelResolution({
          id: match.id,
          missingInputKey: match.missingInputKey,
          missingInputType: match.missingInputType,
          descriptor:
            finalServiceName != null
              ? `${finalServiceName}::${operationIdentifier}`
              : operationIdentifier,
          resolvedAt: match.resolvedAt,
          resolvedBy: match.resolvedBy,
          resolutionSource: sourceFromPayload,
          projectArtifactId: artifactIdFromPayload,
          projectArtifactFilename: null,
        });
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Failed to fetch existing resolution',
        );
      }
    },
    [listResolutionsFn, projectId],
  );

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Bulk resolve missing inputs"
      data-testid="mdd-bulk-resolve-modal"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 998,
      }}
    >
      <div
        style={{
          background: '#fff',
          padding: 24,
          borderRadius: 8,
          width: 780,
          maxWidth: '95vw',
          maxHeight: '90vh',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <h3 style={{ margin: 0 }}>Bulk resolve missing inputs</h3>
          <button
            type="button"
            className={styles.headerNavLink}
            onClick={onClose}
            data-testid="mdd-bulk-resolve-close"
            disabled={inFlight}
          >
            Close
          </button>
        </div>

        {/* --- Multi-file upload (Task Group 6) --- */}
        <fieldset
          style={{
            border: '1px solid #cfd8dc',
            borderRadius: 6,
            padding: 12,
          }}
          data-testid="mdd-bulk-resolve-file-fieldset"
        >
          <legend style={{ fontSize: 12, color: '#455a64' }}>
            Upload OAS / WSDL contract files
          </legend>
          <input
            type="file"
            multiple
            data-testid="mdd-bulk-resolve-file-input"
            onChange={handleFilesSelected}
            accept=".json,.yaml,.yml,.wsdl,.xml"
            disabled={inFlight}
          />
          <div
            style={{
              fontSize: 11,
              color: '#90a4ae',
              marginTop: 4,
            }}
          >
            Supported formats: OpenAPI 2.0/3.0/3.1 (JSON or YAML) and WSDL 1.1/2.0.
          </div>

          {selectedFiles.length > 0 && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                marginTop: 10,
              }}
              data-testid="mdd-bulk-resolve-selected-files"
            >
              {selectedFiles.map((sf, idx) => {
                // When a preview has run, locate the matching file block by
                // filename (the upload order is preserved by AMS).
                const ingestFile: ContractIngestFile | undefined =
                  ingestResult?.files.find(
                    (f) => f.fileName === sf.file.name,
                  );
                return (
                  <div
                    key={sf.localId}
                    data-testid={`mdd-bulk-resolve-file-panel-${idx}`}
                    style={{
                      border: '1px solid #eceff1',
                      borderRadius: 6,
                      padding: 10,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        data-testid={`mdd-bulk-resolve-file-name-${idx}`}
                        // Keep the legacy single-file test id alive for the
                        // first selected file so existing dashboard tests
                        // (test 7 in the dashboard suite) keep working.
                        title={sf.file.name}
                      >
                        {idx === 0 ? (
                          <span data-testid="mdd-bulk-resolve-file-name">
                            {sf.file.name}
                          </span>
                        ) : (
                          sf.file.name
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: '#90a4ae' }}>
                        {humaniseBytes(
                          ingestFile?.fileSize ?? sf.file.size ?? null,
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        gap: 8,
                        alignItems: 'center',
                      }}
                    >
                      {ingestFile && ingestFile.format && (
                        <span
                          style={{
                            background: '#eceff1',
                            fontSize: 10,
                            padding: '2px 6px',
                            borderRadius: 3,
                          }}
                          data-testid={`mdd-bulk-resolve-file-format-${idx}`}
                        >
                          {prettyFormat(ingestFile.format)}
                        </span>
                      )}
                      {ingestFile && (
                        <span
                          data-testid={`mdd-bulk-resolve-file-status-${idx}`}
                        >
                          {fileStatusBadge(ingestFile.status)}
                        </span>
                      )}
                      {ingestFile && (
                        <span
                          style={{ fontSize: 11, color: '#607d8b' }}
                          data-testid={`mdd-bulk-resolve-file-op-count-${idx}`}
                        >
                          {(ingestFile.operations || []).length} operation
                          {(ingestFile.operations || []).length === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <label
                        style={{ fontSize: 12, color: '#607d8b' }}
                        htmlFor={`mdd-bulk-resolve-file-service-${idx}`}
                      >
                        Service name
                      </label>
                      <input
                        id={`mdd-bulk-resolve-file-service-${idx}`}
                        data-testid={`mdd-bulk-resolve-file-service-${idx}`}
                        type="text"
                        placeholder={
                          ingestFile?.suggestedServiceName ?? '(auto-suggested after preview)'
                        }
                        value={sf.serviceNameOverride}
                        onChange={(e) =>
                          updateServiceNameOverride(sf.localId, e.target.value)
                        }
                        disabled={inFlight}
                        style={{ flex: 1, padding: '4px 6px' }}
                      />
                    </div>

                    {ingestFile?.failureReason && (
                      <div
                        role="alert"
                        data-testid={`mdd-bulk-resolve-file-error-${idx}`}
                        style={{
                          background: '#ffebee',
                          color: '#b71c1c',
                          fontSize: 12,
                          padding: 6,
                          borderRadius: 4,
                        }}
                      >
                        {ingestFile.failureReason}
                      </div>
                    )}

                    {/* Empty-file yellow info row -- file parsed OK with no ops. */}
                    {ingestFile &&
                      ingestFile.status.toLowerCase() === 'parsed' &&
                      (ingestFile.operations || []).length === 0 && (
                        <div
                          data-testid={`mdd-bulk-resolve-file-empty-${idx}`}
                          style={{
                            background: '#fff8e1',
                            color: '#795548',
                            fontSize: 12,
                            padding: 6,
                            borderRadius: 4,
                          }}
                        >
                          No operations found in this file -- nothing to resolve
                        </div>
                      )}

                    {ingestFile && (ingestFile.operations || []).length > 0 && (
                      <table
                        style={{
                          width: '100%',
                          borderCollapse: 'collapse',
                          fontSize: 12,
                        }}
                        data-testid={`mdd-bulk-resolve-file-operations-${idx}`}
                      >
                        <thead>
                          <tr>
                            <th
                              style={{
                                textAlign: 'left',
                                padding: '4px 6px',
                                borderBottom: '1px solid #eceff1',
                              }}
                            >
                              Identifier
                            </th>
                            <th
                              style={{
                                textAlign: 'left',
                                padding: '4px 6px',
                                borderBottom: '1px solid #eceff1',
                              }}
                            >
                              Key
                            </th>
                            <th
                              style={{
                                textAlign: 'left',
                                padding: '4px 6px',
                                borderBottom: '1px solid #eceff1',
                              }}
                            >
                              Status
                            </th>
                            <th
                              style={{
                                textAlign: 'right',
                                padding: '4px 6px',
                                borderBottom: '1px solid #eceff1',
                              }}
                            >
                              Matched specs
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {ingestFile.operations.map((op, opIdx) => {
                            const norm = normaliseOpStatus(op.status);
                            return (
                              <tr
                                key={`${idx}-${opIdx}-${op.identifier}`}
                                data-testid={`mdd-bulk-resolve-op-row-${idx}-${opIdx}`}
                              >
                                <td style={{ padding: '4px 6px' }}>
                                  {op.identifier}
                                </td>
                                <td
                                  style={{
                                    padding: '4px 6px',
                                    fontFamily: 'monospace',
                                  }}
                                  title={op.missingInputKey ?? ''}
                                >
                                  {truncateKey(op.missingInputKey)}
                                </td>
                                <td style={{ padding: '4px 6px' }}>
                                  {operationStatusBadge(op.status)}
                                  {norm === 'already_resolved' &&
                                    op.existingResolutionId && (
                                      <button
                                        type="button"
                                        className={styles.headerNavLink}
                                        data-testid={`mdd-bulk-resolve-op-view-existing-${idx}-${opIdx}`}
                                        style={{
                                          marginLeft: 6,
                                          fontSize: 11,
                                          padding: 0,
                                          background: 'transparent',
                                          border: 'none',
                                          textDecoration: 'underline',
                                          cursor: 'pointer',
                                        }}
                                        onClick={() =>
                                          void handleViewExistingResolution(
                                            op.existingResolutionId as string,
                                            op.identifier,
                                            ingestFile.finalServiceName,
                                            op.missingInputKey,
                                          )
                                        }
                                      >
                                        view existing resolution
                                      </button>
                                    )}
                                </td>
                                <td
                                  style={{
                                    padding: '4px 6px',
                                    textAlign: 'right',
                                  }}
                                >
                                  {(op.matchedSpecIds || []).length}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {ingestResult && (
            <div
              data-testid="mdd-bulk-resolve-ingest-summary"
              style={{
                marginTop: 10,
                padding: 10,
                background: '#e3f2fd',
                borderRadius: 4,
                fontSize: 13,
              }}
            >
              This will create{' '}
              <strong data-testid="mdd-bulk-resolve-ingest-summary-create">
                {ingestResult.summary.willCreateResolutions}
              </strong>{' '}
              new resolutions across{' '}
              <strong data-testid="mdd-bulk-resolve-ingest-summary-stories">
                {ingestResult.summary.affectedSpecCount}
              </strong>{' '}
              {ingestResult.summary.affectedSpecCount === 1
                ? 'story'
                : 'stories'}
              .
            </div>
          )}
        </fieldset>

        {/* --- Manual entries (existing v1 path) --- */}
        <div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 8,
            }}
          >
            <h4 style={{ margin: 0, fontSize: 14 }}>Manual entries</h4>
            <button
              type="button"
              className={styles.headerNavLink}
              onClick={addDraft}
              data-testid="mdd-bulk-resolve-add-row"
              disabled={inFlight}
            >
              + Add row
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {drafts.map((d, idx) => (
              <div
                key={d.id}
                data-testid={`mdd-bulk-resolve-draft-${idx}`}
                style={{
                  border: '1px solid #eceff1',
                  borderRadius: 6,
                  padding: 10,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <label style={{ fontSize: 12, color: '#607d8b' }}>
                    Type
                  </label>
                  <select
                    value={d.type}
                    data-testid={`mdd-bulk-resolve-draft-type-${idx}`}
                    onChange={(e) =>
                      updateDraft(d.id, {
                        type: e.target.value as ItemDraft['type'],
                      })
                    }
                    disabled={inFlight}
                  >
                    <option value="api_contract">api_contract</option>
                    <option value="mapping">mapping</option>
                    <option value="target_element">target_element</option>
                  </select>
                  {drafts.length > 1 && (
                    <button
                      type="button"
                      className={styles.headerNavLink}
                      onClick={() => removeDraft(d.id)}
                      data-testid={`mdd-bulk-resolve-draft-remove-${idx}`}
                      disabled={inFlight}
                      style={{ marginLeft: 'auto' }}
                    >
                      Remove
                    </button>
                  )}
                </div>

                {d.type === 'api_contract' && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <input
                      placeholder="service_name"
                      value={d.serviceName}
                      data-testid={`mdd-bulk-resolve-draft-service-${idx}`}
                      onChange={(e) =>
                        updateDraft(d.id, { serviceName: e.target.value })
                      }
                      disabled={inFlight}
                    />
                    <input
                      placeholder="operation_name"
                      value={d.operationName}
                      data-testid={`mdd-bulk-resolve-draft-operation-${idx}`}
                      onChange={(e) =>
                        updateDraft(d.id, { operationName: e.target.value })
                      }
                      disabled={inFlight}
                    />
                  </div>
                )}
                {d.type === 'mapping' && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <input
                      placeholder="source_element_id"
                      value={d.sourceElementId}
                      data-testid={`mdd-bulk-resolve-draft-source-${idx}`}
                      onChange={(e) =>
                        updateDraft(d.id, { sourceElementId: e.target.value })
                      }
                      disabled={inFlight}
                    />
                    <input
                      placeholder="target_element_id"
                      value={d.targetElementId}
                      data-testid={`mdd-bulk-resolve-draft-target-${idx}`}
                      onChange={(e) =>
                        updateDraft(d.id, { targetElementId: e.target.value })
                      }
                      disabled={inFlight}
                    />
                  </div>
                )}
                {d.type === 'target_element' && (
                  <input
                    placeholder="target_element_logical_name"
                    value={d.targetElementLogicalName}
                    data-testid={`mdd-bulk-resolve-draft-logical-${idx}`}
                    onChange={(e) =>
                      updateDraft(d.id, {
                        targetElementLogicalName: e.target.value,
                      })
                    }
                    disabled={inFlight}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* --- Manual-entry preview table --- */}
        {previewResult && (
          <div data-testid="mdd-bulk-resolve-preview-section">
            <h4 style={{ margin: 0, fontSize: 14 }}>Preview</h4>
            <p style={{ margin: '4px 0', fontSize: 12, color: '#607d8b' }}>
              Total specs affected:{' '}
              <strong>{previewResult.totalSpecsAffected ?? 0}</strong>. Review
              and then click Commit to write these resolutions.
            </p>
            {previewResult.resolutions.length === 0 ? (
              <div
                style={{ fontSize: 13, color: '#607d8b' }}
                data-testid="mdd-bulk-resolve-preview-empty"
              >
                No matching missing-input keys found in this project.
              </div>
            ) : (
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 12,
                }}
                data-testid="mdd-bulk-resolve-preview-table"
              >
                <thead>
                  <tr>
                    <th
                      style={{
                        textAlign: 'left',
                        padding: '4px 6px',
                        borderBottom: '1px solid #eceff1',
                      }}
                    >
                      Type
                    </th>
                    <th
                      style={{
                        textAlign: 'left',
                        padding: '4px 6px',
                        borderBottom: '1px solid #eceff1',
                      }}
                    >
                      Descriptor
                    </th>
                    <th
                      style={{
                        textAlign: 'left',
                        padding: '4px 6px',
                        borderBottom: '1px solid #eceff1',
                      }}
                    >
                      Key
                    </th>
                    <th
                      style={{
                        textAlign: 'right',
                        padding: '4px 6px',
                        borderBottom: '1px solid #eceff1',
                      }}
                    >
                      Affected specs
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {previewResult.resolutions.map((r) => (
                    <tr
                      key={r.key}
                      data-testid={`mdd-bulk-resolve-preview-row-${r.key}`}
                    >
                      <td style={{ padding: '4px 6px' }}>
                        {r.missingInputType}
                      </td>
                      <td style={{ padding: '4px 6px' }}>
                        {r.descriptor ?? ''}
                      </td>
                      <td
                        style={{
                          padding: '4px 6px',
                          fontFamily: 'monospace',
                        }}
                      >
                        {r.key}
                      </td>
                      <td
                        style={{ padding: '4px 6px', textAlign: 'right' }}
                      >
                        {r.affectedSpecIds.length}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {error && (
          <div
            className={styles.errorBanner}
            role="alert"
            data-testid="mdd-bulk-resolve-error"
          >
            {error}
          </div>
        )}

        {/* --- Actions --- */}
        <div
          style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}
        >
          <button
            type="button"
            className={styles.headerNavLink}
            onClick={onClose}
            disabled={inFlight}
            data-testid="mdd-bulk-resolve-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.bulkButton}
            onClick={() => void handlePreview()}
            disabled={!canPreview}
            data-testid="mdd-bulk-resolve-preview"
          >
            {inFlight && !previewResult && !ingestResult
              ? 'Loading\u2026'
              : 'Preview'}
          </button>
          <button
            type="button"
            className={styles.bulkButton}
            onClick={() => void handleCommit()}
            disabled={!canCommitManual && !canCommitFiles}
            data-testid="mdd-bulk-resolve-commit"
          >
            {inFlight && (previewResult || ingestResult)
              ? 'Applying\u2026'
              : ingestResult
                ? 'Apply'
                : 'Commit'}
          </button>
        </div>
      </div>
      <MigrationDeliveryExistingResolutionSidePanel
        resolution={sidePanelResolution}
        onClose={() => setSidePanelResolution(null)}
      />
    </div>
  );
};

export default MigrationDeliveryBulkResolveModal;
