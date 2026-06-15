/**
 * InfrastructureTerraformImportModal Component
 *
 * Spec 2026-05-08: Infrastructure Terraform Import (GCP)
 * Task Group 7: Frontend Modal + Menu + API Client
 *
 * Two-step modal:
 *
 * Step 1 -- Upload + form:
 *   - File picker accepting `.tf` (multi-select) OR a single `.zip`.
 *   - Environment (required) -- dropdown sourced from `metaModel.entities.environments`.
 *   - Cloud Account (optional) -- dropdown sourced from `metaModel.entities.cloud_accounts`.
 *   - Location (optional) -- dropdown sourced from `metaModel.entities.locations`.
 *   - Provider (required) -- dropdown sourced from `iacSourceProviderOptions`
 *     imported from `frontend/src/config/defaults.ts` (do NOT redeclare). V1
 *     enables only `'GCP'`; other options render as disabled `<option>`s with a
 *     "(Coming soon)" label suffix.
 *   - Optional IaC Source metadata fields (collapsible "Advanced" section):
 *     `repositoryUrl`, `branch`, `commitSha`, `path`, `workspace`.
 *   - "Parse and review" submit button -- disabled until at least one file is
 *     selected AND Environment + Provider (= GCP) are set.
 *
 * Step 2 -- Read-only review:
 *   - Warnings panel at top (collapsible, expanded by default).
 *   - Three category sections "Will create" / "Will update" / "Unsupported / TODO"
 *     each rendering a table with: entity type, name, source `file:line`,
 *     confidence-bucket badge, warnings count, evidence-row expander.
 *   - Footer:
 *       - "Approve all" -- TODO follow-up wiring (see comment in handler).
 *       - "Discard all" -- clears modal state and closes the modal. No server call.
 *
 * Locked contracts:
 *   - REUSE `iacSourceProviderOptions` -- do NOT redeclare.
 *   - V1 read-only summary (Q11=b) -- single Approve all / Discard all, NO
 *     per-row controls.
 *   - snake_case JSON from backend; carried verbatim through `ImportReviewResult`.
 *   - `candidate_id` + `ignored` plumbed through even though V1 UI does not
 *     expose them (per-row UI is a follow-up spec).
 *   - No model mutation in the import path itself -- mutation flows through the
 *     existing model-save endpoint on Approve all.
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  importInfrastructureTerraform,
  type ImportReviewResult,
  type ImportCandidate,
} from '../../api/modelApi';
import { iacSourceProviderOptions } from '../../config/defaults';
import type { MetaModel } from '../../types/model';
import styles from './InfrastructureTerraformImportModal.module.css';

/**
 * Props for InfrastructureTerraformImportModal
 */
export interface InfrastructureTerraformImportModalProps {
  /** Whether the modal is visible */
  isOpen: boolean;
  /** Callback when modal is closed (via Cancel, Escape, overlay click, or close button) */
  onClose: () => void;
  /** Project UUID -- required for the import endpoint */
  projectId: string;
  /** Architecture UUID -- required for the import endpoint */
  architectureId: string;
  /** MetaModel that supplies environments / cloud accounts / locations dropdowns */
  metaModel: MetaModel;
  /**
   * Optional callback invoked when the user clicks "Approve all". V1 wiring is
   * deferred (Q11=b permits this) -- see TODO note in `handleApproveAll`. The
   * follow-up spec wires this to the existing model-save flow.
   */
  onApproveAll?: (result: ImportReviewResult) => void;
  /** Optional data-testid for testing */
  'data-testid'?: string;
}

/** Default provider value -- V1 enables only GCP. */
const DEFAULT_PROVIDER = 'GCP';

/** Set of providers that are currently enabled in V1. */
const ENABLED_PROVIDERS = new Set<string>([DEFAULT_PROVIDER]);

/** Confidence bucket thresholds (locked: HIGH 0.900 / MEDIUM 0.600 / LOW 0.300). */
const HIGH_CONFIDENCE_THRESHOLD = 0.85;
const MEDIUM_CONFIDENCE_THRESHOLD = 0.45;

type Step = 'upload' | 'review';

/**
 * Renders a colour-coded confidence badge for the given numeric confidence.
 * Buckets follow the locked spec: HIGH 0.900 / MEDIUM 0.600 / LOW 0.300.
 */
function ConfidenceBadge({ confidence }: { confidence: number }) {
  let label = 'LOW';
  let cls = styles.confidenceLow;
  if (confidence >= HIGH_CONFIDENCE_THRESHOLD) {
    label = 'HIGH';
    cls = styles.confidenceHigh;
  } else if (confidence >= MEDIUM_CONFIDENCE_THRESHOLD) {
    label = 'MEDIUM';
    cls = styles.confidenceMedium;
  }
  return (
    <span className={`${styles.confidenceBadge} ${cls}`} data-testid={`confidence-badge-${label.toLowerCase()}`}>
      {label} {confidence.toFixed(3)}
    </span>
  );
}

/**
 * Reads the `name` field off the candidate's proposed entity payload, falling
 * back to the binding's `iac_resource_name` or the `iac_address`.
 */
function getCandidateName(candidate: ImportCandidate): string {
  const fields = candidate.proposed_entity_fields ?? {};
  const binding = candidate.proposed_binding ?? {};
  const fromFields = (fields as Record<string, unknown>).name;
  if (typeof fromFields === 'string' && fromFields.length > 0) return fromFields;
  const resourceName = (binding as Record<string, unknown>).iac_resource_name;
  if (typeof resourceName === 'string' && resourceName.length > 0) return resourceName;
  const iacAddress = (binding as Record<string, unknown>).iac_address;
  if (typeof iacAddress === 'string' && iacAddress.length > 0) return iacAddress;
  return '(unnamed)';
}

/**
 * Single candidate row + its evidence drill-down row.
 */
function CandidateRow({
  candidate,
  rowKey,
}: {
  candidate: ImportCandidate;
  rowKey: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const evidence = candidate.evidence;
  const sourceLabel = `${evidence.file_path}:${evidence.start_line}-${evidence.end_line}`;
  const warningsCount = candidate.per_candidate_warnings.length;

  return (
    <>
      <tr data-testid={`candidate-row-${rowKey}`}>
        <td>{candidate.target_entity_type}</td>
        <td>{getCandidateName(candidate)}</td>
        <td>{sourceLabel}</td>
        <td>
          <ConfidenceBadge confidence={candidate.confidence} />
        </td>
        <td>{warningsCount}</td>
        <td>
          <button
            type="button"
            className={styles.expandButton}
            onClick={() => setExpanded((v) => !v)}
            data-testid={`evidence-toggle-${rowKey}`}
            aria-expanded={expanded}
          >
            {expanded ? 'Hide' : 'View'}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className={styles.evidenceRow} data-testid={`evidence-row-${rowKey}`}>
          <td colSpan={6}>
            <div className={styles.evidenceSnippet}>{evidence.raw_snippet}</div>
            {evidence.unresolved_expression_text && (
              <div className={styles.hint}>
                Unresolved expression: <code>{evidence.unresolved_expression_text}</code>
              </div>
            )}
            {warningsCount > 0 && (
              <ul>
                {candidate.per_candidate_warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Renders one of the three category sections in step 2 (Will create / Will
 * update / Unsupported).
 */
function CategorySection({
  title,
  candidates,
  testId,
}: {
  title: string;
  candidates: ImportCandidate[];
  testId: string;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className={styles.section} data-testid={testId}>
      <div
        className={styles.sectionHeader}
        onClick={() => setExpanded((v) => !v)}
        data-testid={`${testId}-header`}
      >
        <span>{expanded ? '▼' : '▶'} {title}</span>
        <span className={styles.sectionCount} data-testid={`${testId}-count`}>
          {candidates.length}
        </span>
      </div>
      {expanded && (
        candidates.length === 0 ? (
          <div className={styles.emptyCategoryMessage} data-testid={`${testId}-empty`}>
            No candidates in this category.
          </div>
        ) : (
          <table className={styles.candidateTable}>
            <thead>
              <tr>
                <th>Entity Type</th>
                <th>Name</th>
                <th>Source</th>
                <th>Confidence</th>
                <th>Warnings</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c, i) => (
                <CandidateRow key={c.candidate_id ?? `${testId}-${i}`} candidate={c} rowKey={`${testId}-${i}`} />
              ))}
            </tbody>
          </table>
        )
      )}
    </div>
  );
}

/**
 * InfrastructureTerraformImportModal Component
 */
export function InfrastructureTerraformImportModal({
  isOpen,
  onClose,
  projectId,
  architectureId,
  metaModel,
  onApproveAll,
  'data-testid': dataTestId,
}: InfrastructureTerraformImportModalProps) {
  // ----- Step state -----
  const [step, setStep] = useState<Step>('upload');

  // ----- Step 1 form state -----
  const [files, setFiles] = useState<File[]>([]);
  const [environmentId, setEnvironmentId] = useState<string>('');
  const [cloudAccountId, setCloudAccountId] = useState<string>('');
  const [locationId, setLocationId] = useState<string>('');
  const [provider, setProvider] = useState<string>(DEFAULT_PROVIDER);
  const [repositoryUrl, setRepositoryUrl] = useState<string>('');
  const [branch, setBranch] = useState<string>('');
  const [commitSha, setCommitSha] = useState<string>('');
  const [pathField, setPathField] = useState<string>('');
  const [workspace, setWorkspace] = useState<string>('');
  const [advancedExpanded, setAdvancedExpanded] = useState<boolean>(false);

  // ----- Async state -----
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // ----- Step 2 review payload -----
  const [reviewResult, setReviewResult] = useState<ImportReviewResult | null>(null);
  const [warningsExpanded, setWarningsExpanded] = useState<boolean>(true);

  // Derived collections
  const environments = metaModel?.entities?.environments ?? [];
  const cloudAccounts = metaModel?.entities?.cloud_accounts ?? [];
  const locations = metaModel?.entities?.locations ?? [];

  const hasEnvironments = environments.length > 0;

  // Reset all state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStep('upload');
      setFiles([]);
      setEnvironmentId('');
      setCloudAccountId('');
      setLocationId('');
      setProvider(DEFAULT_PROVIDER);
      setRepositoryUrl('');
      setBranch('');
      setCommitSha('');
      setPathField('');
      setWorkspace('');
      setAdvancedExpanded(false);
      setIsImporting(false);
      setErrorMessage(null);
      setReviewResult(null);
      setWarningsExpanded(true);
    }
  }, [isOpen]);

  // Escape closes the modal
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Submit gating: file(s) AND Environment AND Provider=GCP, no in-flight request, environments exist
  const isFormValid = useMemo(() => {
    return (
      hasEnvironments &&
      files.length > 0 &&
      environmentId.trim().length > 0 &&
      provider.trim().length > 0 &&
      ENABLED_PROVIDERS.has(provider) &&
      !isImporting
    );
  }, [hasEnvironments, files, environmentId, provider, isImporting]);

  if (!isOpen) {
    return null;
  }

  const handleOverlayClick = () => {
    onClose();
  };

  const handleModalClick = (event: React.MouseEvent) => {
    event.stopPropagation();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const list = event.target.files;
    if (!list) {
      setFiles([]);
      return;
    }
    setFiles(Array.from(list));
  };

  const handleParseAndReview = async () => {
    if (!isFormValid) return;

    // Validate the .zip-or-many-.tf rule before submitting.
    const zipFiles = files.filter((f) => f.name.toLowerCase().endsWith('.zip'));
    if (zipFiles.length > 1 || (zipFiles.length === 1 && files.length > 1)) {
      setErrorMessage(
        'Either upload a single .zip OR multiple .tf files; do not mix the two.'
      );
      return;
    }

    setIsImporting(true);
    setErrorMessage(null);

    try {
      const formData = new FormData();
      for (const f of files) {
        formData.append('files', f, f.name);
      }
      formData.append('environmentId', environmentId);
      if (cloudAccountId) formData.append('cloudAccountId', cloudAccountId);
      if (locationId) formData.append('locationId', locationId);
      formData.append('provider', provider);
      if (repositoryUrl) formData.append('repositoryUrl', repositoryUrl);
      if (branch) formData.append('branch', branch);
      if (commitSha) formData.append('commitSha', commitSha);
      if (pathField) formData.append('path', pathField);
      if (workspace) formData.append('workspace', workspace);

      const result = await importInfrastructureTerraform(projectId, architectureId, formData);
      setReviewResult(result);
      setStep('review');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to import Terraform';
      setErrorMessage(message);
    } finally {
      setIsImporting(false);
    }
  };

  const handleDiscardAll = () => {
    // Pure client-side state clear -- no server call.
    setReviewResult(null);
    setStep('upload');
    onClose();
  };

  const handleApproveAll = () => {
    if (!reviewResult) return;
    if (onApproveAll) {
      onApproveAll(reviewResult);
      onClose();
      return;
    }
    // TODO (follow-up spec): wire "Approve all" through the existing model-save
    // flow at `PUT /api/model/projects/{p}/architectures/{a}`. V1 deliberately
    // ships the read-only review summary (Q11=b in the spec) and defers the
    // approval merge to a follow-up UI spec. For now, surface a placeholder so
    // a developer running V1 sees clear feedback and a code-anchor to find the
    // wiring point.
    // eslint-disable-next-line no-alert
    window.alert(
      'Approve all is wired in a follow-up spec. See TODO in InfrastructureTerraformImportModal.handleApproveAll.'
    );
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      data-testid={dataTestId}
    >
      <div
        className={`${styles.modal} ${step === 'review' ? styles.modalReview : ''}`}
        onClick={handleModalClick}
      >
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>
            {step === 'upload'
              ? 'Import Infrastructure from Terraform'
              : 'Review Imported Candidates'}
          </h2>
          <button
            className={styles.closeButton}
            onClick={onClose}
            data-testid="close-button"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className={styles.content}>
          {step === 'upload' && (
            <>
              {!hasEnvironments && (
                <div className={styles.emptyState} data-testid="empty-environments-message">
                  No environments defined. Create at least one environment in the Tables UI before importing.
                </div>
              )}

              {/* File picker */}
              <div className={styles.inputGroup}>
                <label className={styles.inputLabel} htmlFor="terraform-import-files">
                  Terraform files<span className={styles.required}>*</span>
                </label>
                <input
                  id="terraform-import-files"
                  className={styles.fileInput}
                  type="file"
                  multiple
                  accept=".tf,.zip"
                  onChange={handleFileChange}
                  disabled={isImporting}
                  data-testid="files-input"
                />
                <div className={styles.hint}>
                  Upload one or more <code>.tf</code> files OR a single <code>.zip</code> archive.
                </div>
              </div>

              {/* Environment (required) */}
              <div className={styles.inputGroup}>
                <label className={styles.inputLabel} htmlFor="terraform-import-environment">
                  Environment<span className={styles.required}>*</span>
                </label>
                <select
                  id="terraform-import-environment"
                  className={styles.select}
                  value={environmentId}
                  onChange={(e) => setEnvironmentId(e.target.value)}
                  disabled={!hasEnvironments || isImporting}
                  data-testid="environment-select"
                >
                  <option value="">-- Select environment --</option>
                  {environments.map((env) => (
                    <option key={env.id} value={env.id}>
                      {env.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Cloud Account (optional) */}
              <div className={styles.inputGroup}>
                <label className={styles.inputLabel} htmlFor="terraform-import-cloud-account">
                  Cloud Account
                </label>
                <select
                  id="terraform-import-cloud-account"
                  className={styles.select}
                  value={cloudAccountId}
                  onChange={(e) => setCloudAccountId(e.target.value)}
                  disabled={isImporting}
                  data-testid="cloud-account-select"
                >
                  <option value="">(none)</option>
                  {cloudAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Location (optional) */}
              <div className={styles.inputGroup}>
                <label className={styles.inputLabel} htmlFor="terraform-import-location">
                  Location
                </label>
                <select
                  id="terraform-import-location"
                  className={styles.select}
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                  disabled={isImporting}
                  data-testid="location-select"
                >
                  <option value="">(none)</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Provider (required) */}
              <div className={styles.inputGroup}>
                <label className={styles.inputLabel} htmlFor="terraform-import-provider">
                  Provider<span className={styles.required}>*</span>
                </label>
                <select
                  id="terraform-import-provider"
                  className={styles.select}
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  disabled={isImporting}
                  data-testid="provider-select"
                >
                  {iacSourceProviderOptions.map((opt) => {
                    const enabled = ENABLED_PROVIDERS.has(opt);
                    return (
                      <option
                        key={opt}
                        value={opt}
                        disabled={!enabled}
                        title={enabled ? undefined : 'Coming soon'}
                      >
                        {enabled ? opt : `${opt} (Coming soon)`}
                      </option>
                    );
                  })}
                </select>
                <div className={styles.hint}>V1 supports GCP only. Other providers are coming soon.</div>
              </div>

              {/* Advanced (collapsible) IaC source metadata */}
              <button
                type="button"
                className={styles.advancedToggle}
                onClick={() => setAdvancedExpanded((v) => !v)}
                data-testid="advanced-toggle"
                aria-expanded={advancedExpanded}
              >
                {advancedExpanded ? '▼' : '▶'} Advanced -- IaC source metadata (optional)
              </button>

              {advancedExpanded && (
                <div className={styles.advancedSection} data-testid="advanced-section">
                  <div className={styles.inputGroup}>
                    <label className={styles.inputLabel} htmlFor="terraform-import-repository-url">
                      Repository URL
                    </label>
                    <input
                      id="terraform-import-repository-url"
                      className={styles.textInput}
                      type="text"
                      value={repositoryUrl}
                      onChange={(e) => setRepositoryUrl(e.target.value)}
                      disabled={isImporting}
                      data-testid="repository-url-input"
                      placeholder="https://github.com/owner/repo"
                    />
                  </div>
                  <div className={styles.inputGroup}>
                    <label className={styles.inputLabel} htmlFor="terraform-import-branch">
                      Branch
                    </label>
                    <input
                      id="terraform-import-branch"
                      className={styles.textInput}
                      type="text"
                      value={branch}
                      onChange={(e) => setBranch(e.target.value)}
                      disabled={isImporting}
                      data-testid="branch-input"
                      placeholder="main"
                    />
                  </div>
                  <div className={styles.inputGroup}>
                    <label className={styles.inputLabel} htmlFor="terraform-import-commit-sha">
                      Commit SHA
                    </label>
                    <input
                      id="terraform-import-commit-sha"
                      className={styles.textInput}
                      type="text"
                      value={commitSha}
                      onChange={(e) => setCommitSha(e.target.value)}
                      disabled={isImporting}
                      data-testid="commit-sha-input"
                    />
                  </div>
                  <div className={styles.inputGroup}>
                    <label className={styles.inputLabel} htmlFor="terraform-import-path">
                      Path
                    </label>
                    <input
                      id="terraform-import-path"
                      className={styles.textInput}
                      type="text"
                      value={pathField}
                      onChange={(e) => setPathField(e.target.value)}
                      disabled={isImporting}
                      data-testid="path-input"
                      placeholder="infra/"
                    />
                  </div>
                  <div className={styles.inputGroup}>
                    <label className={styles.inputLabel} htmlFor="terraform-import-workspace">
                      Workspace
                    </label>
                    <input
                      id="terraform-import-workspace"
                      className={styles.textInput}
                      type="text"
                      value={workspace}
                      onChange={(e) => setWorkspace(e.target.value)}
                      disabled={isImporting}
                      data-testid="workspace-input"
                    />
                  </div>
                </div>
              )}

              {errorMessage && (
                <div className={styles.errorMessage} data-testid="error-message">
                  {errorMessage}
                </div>
              )}
            </>
          )}

          {step === 'review' && reviewResult && (
            <div data-testid="review-step">
              {/* Warnings panel */}
              <div className={styles.warningsPanel} data-testid="warnings-panel">
                <div
                  className={styles.warningsHeader}
                  onClick={() => setWarningsExpanded((v) => !v)}
                  data-testid="warnings-header"
                >
                  <span>{warningsExpanded ? '▼' : '▶'} Warnings</span>
                  <span className={styles.warningsCount} data-testid="warnings-count">
                    {reviewResult.warnings.length}
                  </span>
                </div>
                {warningsExpanded && (
                  reviewResult.warnings.length === 0 ? (
                    <div className={styles.emptyCategoryMessage} data-testid="warnings-empty">
                      No warnings.
                    </div>
                  ) : (
                    <ul className={styles.warningsList} data-testid="warnings-list">
                      {reviewResult.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  )
                )}
              </div>

              {/* Three category sections */}
              <CategorySection
                title="Will create"
                candidates={reviewResult.will_create}
                testId="section-will-create"
              />
              <CategorySection
                title="Will update"
                candidates={reviewResult.will_update}
                testId="section-will-update"
              />
              <CategorySection
                title="Unsupported / TODO"
                candidates={reviewResult.unsupported}
                testId="section-unsupported"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          {step === 'upload' && (
            <>
              <button
                className={styles.cancelButton}
                onClick={onClose}
                data-testid="cancel-button"
                disabled={isImporting}
              >
                Cancel
              </button>
              <button
                className={styles.submitButton}
                onClick={handleParseAndReview}
                disabled={!isFormValid}
                data-testid="parse-review-button"
              >
                {isImporting ? 'Parsing...' : 'Parse and review'}
              </button>
            </>
          )}
          {step === 'review' && (
            <>
              <button
                className={styles.discardButton}
                onClick={handleDiscardAll}
                data-testid="discard-all-button"
              >
                Discard all
              </button>
              <button
                className={styles.submitButton}
                onClick={handleApproveAll}
                data-testid="approve-all-button"
              >
                Approve all
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default InfrastructureTerraformImportModal;
