/**
 * PreflightModal
 *
 * Spec 2026-05-06: Library Discovery Integration -- Task Group 7
 *
 * Modal shown after the user picks "Start Discovery Run" on a Service or
 * Library row in the right-click context menu. The modal previews the
 * library-aware BFS scan plan (root + internal libs to scan + external
 * libs to record + warnings) and lets the user toggle external-library
 * inclusion before kicking off the run.
 *
 * Modeled on `StartDiscoveryRunConfirmModal.tsx` for shell parity:
 *   - overlay div, click-outside + Escape close
 *   - header / content / footer layout
 *   - `data-testid` on every interactive element
 *   - CSS module co-location (PreflightModal.module.css)
 *
 * Behaviour:
 *   - Mounts in COMPUTING state (spinner + "Computing scan plan...") while
 *     the preflight call is in flight.
 *   - On success, renders 4 sections:
 *       1. Root summary (entity name, repo location, repo subfolder, ecosystem).
 *       2. Internal libraries to scan -- BFS-ordered, with depth + status
 *          badge per row (`new` / `re-scan` / `skipped-cycle` / `skipped-depth-cap`).
 *       3. External libraries to record -- collapsed-by-default if >10 entries.
 *       4. Warnings -- bullet list (cycle / depth-cap / unresolvable-internal).
 *   - "Include external libraries" toggle defaults ON (modal-session-only state,
 *     no DB persistence). Toggling triggers a full re-fetch of the scan plan.
 *   - Run button calls `onConfirm(includeExternal, selectedFiles, maxLogPathPrefixSegments)`;
 *     Cancel / Escape / click-outside all close the modal.
 *
 * Spec 2026-05-10: Runtime Log Input at Discovery Run Start -- Task Group 4.4
 *   - Renders an "Upload Log Files" section ABOVE Run/Cancel using the shared
 *     `LogFileUploadInput` component.
 *   - The selected files are owned by the modal's existing state and threaded
 *     into the existing `onConfirm` handler as the second argument.
 *   - All previous behaviour (BFS preview + "Include external libraries"
 *     toggle + Run button) is preserved byte-for-byte.
 *   - Run-start orchestration (create-run-first -> upload-after) lives in the
 *     parent (Grid.tsx -> handlePreflightConfirm); this modal only collects
 *     and forwards the selected File[].
 *
 * Spec 2026-05-11: Discovery Run Robustness -- Section 1
 *   - Adds a per-run M control (`maxLogPathPrefixSegments`) visible only
 *     when at least one log file is selected. Default value `1`, clamped
 *     by HTML `min`/`max` to `[0..5]`. The value is forwarded to `onConfirm`
 *     as the third argument so the parent's log-files PATCH call can carry
 *     it through; the run-create POST shape is UNCHANGED.
 *
 * Props:
 *   - isOpen
 *   - onClose
 *   - onConfirm(includeExternal: boolean, selectedFiles: File[], maxLogPathPrefixSegments: number)
 *   - rootEntity { kind: 'service' | 'library', id, name }
 *   - previewFn(includeExternal: boolean) -> Promise<ScanPlan>
 *
 * The parent (Grid.tsx) is responsible for picking the correct previewFn
 * (service-rooted vs library-rooted) based on entityType.
 */

import { useCallback, useEffect, useState } from 'react';
import { LogFileUploadInput } from '../Discovery/LogFileUploadInput';
import styles from './PreflightModal.module.css';

// ============================================================================
// ScanPlan response shape (locked contract per spec)
// ============================================================================

export type InternalLibraryStatus =
  | 'new'
  | 're-scan'
  | 'skipped-cycle'
  | 'skipped-depth-cap';

export type WarningType = 'cycle' | 'depth-cap' | 'unresolvable-internal';

export interface ScanPlanRoot {
  kind: 'service' | 'library';
  id: string;
  name: string;
  repo_location?: string;
  repo_subfolder?: string;
  ecosystem?: string;
}

export interface ScanPlanInternalEntry {
  library_id: string | null;
  name: string;
  repo_subfolder?: string;
  depth: number;
  status: InternalLibraryStatus;
}

export interface ScanPlanExternalEntry {
  library_id?: string | null;
  name: string;
  declared_coordinates: string;
  scope: string;
}

export interface ScanPlanWarning {
  type: WarningType;
  message: string;
  library_name?: string;
}

export interface ScanPlan {
  root: ScanPlanRoot;
  internalLibrariesToScan: ScanPlanInternalEntry[];
  externalLibrariesToRecord: ScanPlanExternalEntry[];
  warnings: ScanPlanWarning[];
}

// ============================================================================
// Props
// ============================================================================

export interface PreflightModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Called with the user's final toggle value AND the selected log files
   * (Spec 2026-05-10 Task Group 4.4) when they click Run. The parent owns
   * the create-run-first -> upload-after orchestration.
   *
   * Spec 2026-05-11 Section 1: a third argument carries the per-run M
   * (max log-path proxy prefix segments) so the parent's log-files PATCH
   * call can forward it to AMS via the multipart `runtimeEvidenceConfig`
   * field. Defaults to 1 when omitted; clamped to [0..5].
   */
  onConfirm: (
    includeExternal: boolean,
    selectedFiles: File[],
    maxLogPathPrefixSegments: number
  ) => void;
  /** The root entity the scan is rooted at (service or library). */
  rootEntity: {
    kind: 'service' | 'library';
    id: string;
    name: string;
  };
  /**
   * Caller-supplied preflight function. The modal calls this with the
   * current `includeExternal` toggle value and renders the result. The
   * caller picks the correct gatewayClient helper based on the root kind
   * (service vs library) so the modal stays kind-agnostic.
   */
  previewFn: (includeExternal: boolean) => Promise<ScanPlan>;
}

// Threshold above which the "External libraries" section collapses by default.
const EXTERNAL_COLLAPSE_THRESHOLD = 10;

// Spec 2026-05-11 Section 1: per-run M control defaults + clamp bounds.
const DEFAULT_MAX_LOG_PATH_PREFIX_SEGMENTS = 1;
const MIN_MAX_LOG_PATH_PREFIX_SEGMENTS = 0;
const MAX_MAX_LOG_PATH_PREFIX_SEGMENTS = 5;

// ============================================================================
// Component
// ============================================================================

export function PreflightModal({
  isOpen,
  onClose,
  onConfirm,
  rootEntity,
  previewFn,
}: PreflightModalProps) {
  const [includeExternal, setIncludeExternal] = useState<boolean>(true);
  const [scanPlan, setScanPlan] = useState<ScanPlan | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [externalsExpanded, setExternalsExpanded] = useState<boolean>(false);
  // Spec 2026-05-10 Task Group 4.4: optional log files attached to the run.
  // The modal owns this state; on Run click we hand it through onConfirm
  // alongside `includeExternal`. The parent then performs the locked
  // create-run-first -> upload-after orchestration.
  const [selectedLogFiles, setSelectedLogFiles] = useState<File[]>([]);
  // Spec 2026-05-11 Section 1: per-run M (max proxy prefix segments). Owned
  // alongside the file selection; forwarded through onConfirm so the
  // parent's log-files PATCH carries it via the multipart rider field.
  const [maxLogPathPrefixSegments, setMaxLogPathPrefixSegments] = useState<number>(
    DEFAULT_MAX_LOG_PATH_PREFIX_SEGMENTS
  );

  // Re-seed defaults whenever the modal opens (per-modal-session state only,
  // no persistence per locked contract).
  useEffect(() => {
    if (isOpen) {
      setIncludeExternal(true);
      setExternalsExpanded(false);
      setScanPlan(null);
      setErrorMsg(null);
      setSelectedLogFiles([]);
      setMaxLogPathPrefixSegments(DEFAULT_MAX_LOG_PATH_PREFIX_SEGMENTS);
    }
  }, [isOpen]);

  // Trigger preflight on open + on toggle change.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setIsLoading(true);
    setErrorMsg(null);
    previewFn(includeExternal)
      .then((plan) => {
        if (cancelled) return;
        setScanPlan(plan);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setScanPlan(null);
        setIsLoading(false);
        setErrorMsg(err instanceof Error ? err.message : 'Failed to compute scan plan');
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, includeExternal, previewFn]);

  // Escape key closes the modal.
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  const handleRunClick = useCallback(() => {
    onConfirm(includeExternal, selectedLogFiles, maxLogPathPrefixSegments);
  }, [includeExternal, selectedLogFiles, maxLogPathPrefixSegments, onConfirm]);

  const handleToggleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setIncludeExternal(e.target.checked);
    },
    []
  );

  const handleToggleExternals = useCallback(() => {
    setExternalsExpanded((prev) => !prev);
  }, []);

  const handleMaxSegmentsChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      if (raw === '') {
        setMaxLogPathPrefixSegments(DEFAULT_MAX_LOG_PATH_PREFIX_SEGMENTS);
        return;
      }
      const parsed = parseInt(raw, 10);
      if (Number.isNaN(parsed)) {
        setMaxLogPathPrefixSegments(DEFAULT_MAX_LOG_PATH_PREFIX_SEGMENTS);
        return;
      }
      const clamped = Math.max(
        MIN_MAX_LOG_PATH_PREFIX_SEGMENTS,
        Math.min(MAX_MAX_LOG_PATH_PREFIX_SEGMENTS, parsed)
      );
      setMaxLogPathPrefixSegments(clamped);
    },
    []
  );

  if (!isOpen) return null;

  const externalCount = scanPlan?.externalLibrariesToRecord.length ?? 0;
  const showExternalsCollapsed =
    externalCount > EXTERNAL_COLLAPSE_THRESHOLD && !externalsExpanded;

  // Spec 2026-05-11 Section 1: M control is irrelevant without logs, so
  // we hide it entirely until at least one file is selected.
  const showMaxSegmentsControl = selectedLogFiles.length > 0;

  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      data-testid="preflight-modal"
    >
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>
            Library Scan Preflight
            <span className={styles.subtitle}>{rootEntity.name}</span>
          </h2>
          <button
            className={styles.closeButton}
            onClick={onClose}
            title="Close"
            data-testid="preflight-modal-close-button"
          >
            &times;
          </button>
        </div>

        <div className={styles.content}>
          {isLoading && (
            <div
              className={styles.computingState}
              data-testid="preflight-modal-computing"
            >
              <div className={styles.spinner} aria-hidden="true" />
              <div className={styles.computingText}>Computing scan plan...</div>
            </div>
          )}

          {!isLoading && errorMsg && (
            <div
              className={styles.errorPanel}
              role="alert"
              data-testid="preflight-modal-error"
            >
              {errorMsg}
            </div>
          )}

          {!isLoading && !errorMsg && scanPlan && (
            <>
              {/* Root summary panel */}
              <section
                className={styles.section}
                data-testid="preflight-modal-root-summary"
              >
                <h3 className={styles.sectionTitle}>Root</h3>
                <div className={styles.rootRow}>
                  <span className={styles.rootKind}>{scanPlan.root.kind}</span>
                  <span className={styles.rootName}>{scanPlan.root.name}</span>
                </div>
                <div className={styles.rootMeta}>
                  {scanPlan.root.repo_location && (
                    <div>
                      <span className={styles.metaLabel}>Repo:</span>{' '}
                      {scanPlan.root.repo_location}
                    </div>
                  )}
                  {scanPlan.root.repo_subfolder && (
                    <div>
                      <span className={styles.metaLabel}>Subfolder:</span>{' '}
                      {scanPlan.root.repo_subfolder}
                    </div>
                  )}
                  {scanPlan.root.ecosystem && (
                    <div>
                      <span className={styles.metaLabel}>Ecosystem:</span>{' '}
                      {scanPlan.root.ecosystem}
                    </div>
                  )}
                </div>
              </section>

              {/* Internal libraries to scan */}
              <section
                className={styles.section}
                data-testid="preflight-modal-internal-libs"
              >
                <h3 className={styles.sectionTitle}>
                  Internal libraries to scan ({scanPlan.internalLibrariesToScan.length})
                </h3>
                {scanPlan.internalLibrariesToScan.length === 0 ? (
                  <div
                    className={styles.emptyMessage}
                    data-testid="preflight-modal-internal-libs-empty"
                  >
                    No internal libraries discovered.
                  </div>
                ) : (
                  <ul className={styles.libList}>
                    {scanPlan.internalLibrariesToScan.map((lib, idx) => (
                      <li
                        key={`${lib.name}-${idx}`}
                        className={styles.libRow}
                        data-testid="preflight-modal-internal-lib-row"
                      >
                        <span className={styles.libName}>{lib.name}</span>
                        {lib.repo_subfolder && (
                          <span className={styles.libSubfolder}>
                            {lib.repo_subfolder}
                          </span>
                        )}
                        <span className={styles.libDepth}>
                          depth {lib.depth}
                        </span>
                        <span
                          className={`${styles.statusBadge} ${getStatusBadgeClass(lib.status)}`}
                          data-testid={`preflight-modal-internal-status-${lib.status}`}
                        >
                          {lib.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* External libraries to record */}
              <section
                className={styles.section}
                data-testid="preflight-modal-external-libs"
              >
                <h3 className={styles.sectionTitle}>
                  External libraries to record ({externalCount})
                </h3>
                {externalCount === 0 ? (
                  <div className={styles.emptyMessage}>
                    No external libraries.
                  </div>
                ) : showExternalsCollapsed ? (
                  <button
                    className={styles.expandButton}
                    onClick={handleToggleExternals}
                    data-testid="preflight-modal-external-expand"
                  >
                    Show {externalCount} external libraries
                  </button>
                ) : (
                  <>
                    {externalCount > EXTERNAL_COLLAPSE_THRESHOLD && (
                      <button
                        className={styles.expandButton}
                        onClick={handleToggleExternals}
                        data-testid="preflight-modal-external-collapse"
                      >
                        Hide external libraries
                      </button>
                    )}
                    <ul className={styles.libList}>
                      {scanPlan.externalLibrariesToRecord.map((lib, idx) => (
                        <li
                          key={`${lib.name}-${idx}`}
                          className={styles.libRow}
                          data-testid="preflight-modal-external-lib-row"
                        >
                          <span className={styles.libName}>{lib.name}</span>
                          <span className={styles.libCoords}>
                            {lib.declared_coordinates}
                          </span>
                          <span className={styles.libScope}>{lib.scope}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>

              {/* Warnings */}
              {scanPlan.warnings.length > 0 && (
                <section
                  className={styles.section}
                  data-testid="preflight-modal-warnings"
                >
                  <h3 className={styles.sectionTitle}>
                    Warnings ({scanPlan.warnings.length})
                  </h3>
                  <ul className={styles.warningList}>
                    {scanPlan.warnings.map((w, idx) => (
                      <li
                        key={idx}
                        className={styles.warningRow}
                        data-testid={`preflight-modal-warning-${w.type}`}
                      >
                        <span className={styles.warningType}>[{w.type}]</span>
                        {w.library_name && (
                          <span className={styles.warningLibName}>
                            {' '}
                            {w.library_name}:
                          </span>
                        )}
                        <span className={styles.warningMessage}>
                          {' '}
                          {w.message}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}

          {/* Toggle is always visible (even during compute) so the user can
              flip it once and let the re-fetch finish. */}
          <div className={styles.toggleRow}>
            <label
              className={styles.toggleLabel}
              data-testid="preflight-modal-toggle-label"
            >
              <input
                type="checkbox"
                checked={includeExternal}
                onChange={handleToggleChange}
                data-testid="preflight-modal-toggle-include-external"
              />
              Include external libraries
            </label>
          </div>

          {/* Spec 2026-05-10 Task Group 4.4: Upload Log Files section.
              Embedded above Run/Cancel; selected files are owned by the
              modal's state and forwarded to onConfirm. */}
          <LogFileUploadInput
            selectedFiles={selectedLogFiles}
            onChange={setSelectedLogFiles}
            data-testid="preflight-modal-log-file-upload-input"
          />

          {/* Spec 2026-05-11 Section 1: per-run M (max proxy prefix
              segments). Visible only when at least one log file is
              selected (the value is irrelevant without logs). */}
          {showMaxSegmentsControl && (
            <div
              className={styles.fieldGroup}
              data-testid="preflight-modal-max-segments-field"
            >
              <label
                className={styles.label}
                htmlFor="preflight-modal-max-segments-input"
              >
                Max proxy prefix segments
              </label>
              <input
                id="preflight-modal-max-segments-input"
                type="number"
                min={MIN_MAX_LOG_PATH_PREFIX_SEGMENTS}
                max={MAX_MAX_LOG_PATH_PREFIX_SEGMENTS}
                step={1}
                className={styles.input}
                value={maxLogPathPrefixSegments}
                onChange={handleMaxSegmentsChange}
                data-testid="preflight-modal-max-segments-input"
              />
              <span
                className={styles.hint}
                data-testid="preflight-modal-max-segments-hint"
              >
                Tolerate up to N proxy prefix segments when matching log paths to endpoints (0-5, default 1)
              </span>
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <button
            className={styles.secondaryButton}
            onClick={onClose}
            data-testid="preflight-modal-cancel-button"
          >
            Cancel
          </button>
          <button
            className={styles.primaryButton}
            onClick={handleRunClick}
            disabled={isLoading || !!errorMsg || !scanPlan}
            data-testid="preflight-modal-run-button"
          >
            Run
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function getStatusBadgeClass(status: InternalLibraryStatus): string {
  switch (status) {
    case 'new':
      return styles.statusNew;
    case 're-scan':
      return styles.statusReScan;
    case 'skipped-cycle':
      return styles.statusSkippedCycle;
    case 'skipped-depth-cap':
      return styles.statusSkippedDepthCap;
    default:
      return '';
  }
}
