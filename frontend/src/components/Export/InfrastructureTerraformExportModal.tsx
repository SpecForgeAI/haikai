/**
 * InfrastructureTerraformExportModal Component
 *
 * Spec 2026-05-08: Infrastructure Terraform Export (GCP)
 * Task Group 7: Frontend Modal + Menu + API Client
 *
 * Modal dialog for exporting the Infrastructure domain of an architecture as a
 * Terraform ZIP archive. Mirrors the layout / styling of ExportProjectNameModal.
 *
 * Fields:
 *   - Environment (required) -- dropdown sourced from metaModel.entities.environments.
 *   - Cloud Account (optional) -- dropdown sourced from metaModel.entities.cloud_accounts;
 *     "(none)" option default.
 *   - Location (optional) -- dropdown sourced from metaModel.entities.locations;
 *     "(none)" option default.
 *   - Provider (required) -- dropdown sourced from `iacSourceProviderOptions` imported
 *     from `frontend/src/config/defaults.ts` line 1321 (do NOT redeclare). V1 enables
 *     only `'GCP'`; other options render as disabled `<option>`s with a "Coming soon"
 *     label suffix.
 *
 * Submit:
 *   - Disabled until both Environment AND Provider are set.
 *   - On submit:
 *       1. Show loading state.
 *       2. Call `exportInfrastructureTerraform(...)`.
 *       3. On 2xx: read response as Blob, parse Content-Disposition for filename
 *          via `parseContentDispositionFilename`, trigger browser download with
 *          `URL.createObjectURL` + dynamic `<a>` click. Show a generic completion
 *          message hinting at `warnings.json` inside the ZIP (no JSZip dependency
 *          on the frontend, so client-side parsing of the ZIP is intentionally
 *          deferred -- users open warnings.json themselves).
 *       4. On non-OK: display inline error message.
 *
 * Empty-state guards:
 *   - If `metaModel.entities.environments.length === 0`, show an inline message
 *     prompting the user to define an environment first; submit is disabled.
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  exportInfrastructureTerraform,
  parseContentDispositionFilename,
} from '../../api/modelApi';
import { iacSourceProviderOptions } from '../../config/defaults';
import type { MetaModel } from '../../types/model';
import styles from './InfrastructureTerraformExportModal.module.css';

/**
 * Props for InfrastructureTerraformExportModal
 */
export interface InfrastructureTerraformExportModalProps {
  /** Whether the modal is visible */
  isOpen: boolean;
  /** Callback when modal is closed (via Cancel, Escape, overlay click, or close button) */
  onClose: () => void;
  /** Project UUID -- required for the export endpoint */
  projectId: string;
  /** Architecture UUID -- required for the export endpoint */
  architectureId: string;
  /** MetaModel that supplies environments / cloud accounts / locations dropdowns */
  metaModel: MetaModel;
  /** Optional data-testid for testing */
  'data-testid'?: string;
}

/** Default provider value -- V1 enables only GCP. */
const DEFAULT_PROVIDER = 'GCP';

/** Set of providers that are currently enabled in V1. */
const ENABLED_PROVIDERS = new Set<string>([DEFAULT_PROVIDER]);

/**
 * InfrastructureTerraformExportModal Component
 */
export function InfrastructureTerraformExportModal({
  isOpen,
  onClose,
  projectId,
  architectureId,
  metaModel,
  'data-testid': dataTestId,
}: InfrastructureTerraformExportModalProps) {
  // Form state
  const [environmentId, setEnvironmentId] = useState<string>('');
  const [cloudAccountId, setCloudAccountId] = useState<string>('');
  const [locationId, setLocationId] = useState<string>('');
  const [provider, setProvider] = useState<string>(DEFAULT_PROVIDER);

  // Async state
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Derived collections
  const environments = metaModel?.entities?.environments ?? [];
  const cloudAccounts = metaModel?.entities?.cloud_accounts ?? [];
  const locations = metaModel?.entities?.locations ?? [];

  const hasEnvironments = environments.length > 0;

  // Reset form state when modal opens
  useEffect(() => {
    if (isOpen) {
      setEnvironmentId('');
      setCloudAccountId('');
      setLocationId('');
      setProvider(DEFAULT_PROVIDER);
      setIsExporting(false);
      setErrorMessage(null);
      setSuccessMessage(null);
    }
  }, [isOpen]);

  // Escape key closes the modal
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

  // Submit gating: Env + Provider must be set, no in-flight request, environments must exist
  const isFormValid = useMemo(() => {
    return (
      hasEnvironments &&
      environmentId.trim().length > 0 &&
      provider.trim().length > 0 &&
      ENABLED_PROVIDERS.has(provider) &&
      !isExporting
    );
  }, [hasEnvironments, environmentId, provider, isExporting]);

  if (!isOpen) {
    return null;
  }

  const handleOverlayClick = () => {
    onClose();
  };

  const handleModalClick = (event: React.MouseEvent) => {
    event.stopPropagation();
  };

  /**
   * Trigger a browser download for the given Blob using the supplied filename.
   * Mirrors the pattern used by `DiagramsView.handleExportAllAsSvg`.
   */
  const triggerDownload = (blob: Blob, downloadFileName: string) => {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const handleExport = async () => {
    if (!isFormValid) return;

    setIsExporting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const response = await exportInfrastructureTerraform(projectId, architectureId, {
        environmentId,
        cloudAccountId: cloudAccountId || undefined,
        locationId: locationId || undefined,
        provider,
      });

      const blob = await response.blob();
      const contentDisposition = response.headers.get('Content-Disposition');
      const downloadFileName = parseContentDispositionFilename(
        contentDisposition,
        'infrastructure_terraform.zip'
      );

      triggerDownload(blob, downloadFileName);

      setSuccessMessage(
        'Download complete -- see warnings.json inside the ZIP for any soft-warn notes.'
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to export Infrastructure as Terraform';
      setErrorMessage(message);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      data-testid={dataTestId}
    >
      <div className={styles.modal} onClick={handleModalClick}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>Export Infrastructure as Terraform</h2>
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
          {!hasEnvironments && (
            <div className={styles.emptyState} data-testid="empty-environments-message">
              No environments defined. Create at least one environment in the Tables UI before exporting.
            </div>
          )}

          {/* Environment (required) */}
          <div className={styles.inputGroup}>
            <label className={styles.inputLabel} htmlFor="terraform-export-environment">
              Environment<span className={styles.required}>*</span>
            </label>
            <select
              id="terraform-export-environment"
              className={styles.select}
              value={environmentId}
              onChange={(e) => setEnvironmentId(e.target.value)}
              disabled={!hasEnvironments || isExporting}
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
            <label className={styles.inputLabel} htmlFor="terraform-export-cloud-account">
              Cloud Account
            </label>
            <select
              id="terraform-export-cloud-account"
              className={styles.select}
              value={cloudAccountId}
              onChange={(e) => setCloudAccountId(e.target.value)}
              disabled={isExporting}
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
            <label className={styles.inputLabel} htmlFor="terraform-export-location">
              Location
            </label>
            <select
              id="terraform-export-location"
              className={styles.select}
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              disabled={isExporting}
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
            <label className={styles.inputLabel} htmlFor="terraform-export-provider">
              Provider<span className={styles.required}>*</span>
            </label>
            <select
              id="terraform-export-provider"
              className={styles.select}
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              disabled={isExporting}
              data-testid="provider-select"
            >
              {iacSourceProviderOptions.map((opt) => {
                const enabled = ENABLED_PROVIDERS.has(opt);
                return (
                  <option key={opt} value={opt} disabled={!enabled}>
                    {enabled ? opt : `${opt} (Coming soon)`}
                  </option>
                );
              })}
            </select>
            <div className={styles.hint}>V1 supports GCP only. Other providers are coming soon.</div>
          </div>

          {/* Error message */}
          {errorMessage && (
            <div className={styles.errorMessage} data-testid="error-message">
              {errorMessage}
            </div>
          )}

          {/* Success message */}
          {successMessage && (
            <div className={styles.successMessage} data-testid="success-message">
              {successMessage}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <button
            className={styles.cancelButton}
            onClick={onClose}
            data-testid="cancel-button"
            disabled={isExporting}
          >
            Cancel
          </button>
          <button
            className={styles.exportButton}
            onClick={handleExport}
            disabled={!isFormValid}
            data-testid="modal-export-button"
          >
            {isExporting ? 'Exporting...' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default InfrastructureTerraformExportModal;
