/**
 * ProjectConfigModal Component
 *
 * Spec 2026-05-20: Cross-Story Context Injection -- Task Group 9
 * Spec 2026-05-20: Bulk-Resolve OAS/WSDL Parser -- Task Group 7
 *
 * Modal dialog for editing the per-project shape-spec generation config and
 * the contract-upload size cap:
 *  - perStoryContextTokenCap (integer, DB default 24000)
 *  - crossStoryContextTokenCap (integer, DB default 12000)
 *  - autoRunPass2 (boolean, DB default true)
 *  - maxContractUploadFileSizeMb (integer, DB default 10) -- Task Group 7
 *
 * Calls GET /api/projects/{id} on open to seed the form, and PATCH /api/projects/{id}
 * on Save (via updateProjectConfig). The PATCH body sends ONLY fields the user
 * changed -- omitted fields are preserved on the row per the null-guarded
 * service contract (project_primitive_double_dto_overwrite.md).
 *
 * Styling reuses CreateProjectModal.module.css conventions where possible to
 * stay consistent with the rest of the Project component family.
 */

import React, { useState, useEffect } from 'react';
import {
  ProjectDto,
  updateProjectConfig,
} from '../../api/projectsApi';
// Spec 2026-06-12: Implementation-Service Init and Integration Repair --
// the "Repositories" home from project settings is the Edit-project modal
// (the dual-mode CreateProjectModal), NOT a repo section in this modal.
import { CreateProjectModal } from './CreateProjectModal';

/** Default values that mirror the AMS BudgetMetaTracker constants and the DB DEFAULT clauses. */
export const DEFAULT_PER_STORY_CAP = 24000;
export const DEFAULT_CROSS_STORY_CAP = 12000;
export const DEFAULT_AUTO_RUN_PASS_2 = true;
/**
 * Default contract-upload file-size cap in megabytes. Mirrors the
 * `project.max_contract_upload_file_size_mb` DB DEFAULT and the AMS
 * defence-in-depth fallback in the parse-files endpoint (Spec 2026-05-20
 * Bulk-Resolve OAS/WSDL Parser -- Task Group 7).
 */
export const DEFAULT_MAX_CONTRACT_UPLOAD_FILE_SIZE_MB = 10;
/** Client-side validation bounds for the file-size cap. */
export const MIN_MAX_CONTRACT_UPLOAD_FILE_SIZE_MB = 1;
export const MAX_MAX_CONTRACT_UPLOAD_FILE_SIZE_MB = 200;

export interface ProjectConfigModalProps {
  /** Whether the modal is visible */
  isOpen: boolean;
  /** Project whose config we're editing */
  project: ProjectDto | null;
  /** Callback when modal is closed (Save success or Cancel) */
  onClose: () => void;
  /** Callback when Save succeeds, receives the updated ProjectDto */
  onSaveSuccess?: (updated: ProjectDto) => void;
}

/**
 * Renders the per-project shape-spec generation config editor.
 *
 * The form seeds each input with either the project's stored value or the
 * documented default (24000 / 12000 / true / 10). On Save, only fields that
 * have changed from their initial seeded value are sent in the PATCH body.
 */
export function ProjectConfigModal({
  isOpen,
  project,
  onClose,
  onSaveSuccess,
}: ProjectConfigModalProps) {
  // Local form state. Initialised from the project on open.
  const [perStoryCap, setPerStoryCap] = useState<number>(DEFAULT_PER_STORY_CAP);
  const [crossStoryCap, setCrossStoryCap] = useState<number>(
    DEFAULT_CROSS_STORY_CAP
  );
  const [autoRunPass2, setAutoRunPass2] = useState<boolean>(
    DEFAULT_AUTO_RUN_PASS_2
  );
  const [maxContractUploadFileSizeMb, setMaxContractUploadFileSizeMb] =
    useState<number>(DEFAULT_MAX_CONTRACT_UPLOAD_FILE_SIZE_MB);

  // Initial values captured at open time, so we can compute a delta on Save.
  const [initialPerStoryCap, setInitialPerStoryCap] = useState<number>(
    DEFAULT_PER_STORY_CAP
  );
  const [initialCrossStoryCap, setInitialCrossStoryCap] = useState<number>(
    DEFAULT_CROSS_STORY_CAP
  );
  const [initialAutoRunPass2, setInitialAutoRunPass2] = useState<boolean>(
    DEFAULT_AUTO_RUN_PASS_2
  );
  const [
    initialMaxContractUploadFileSizeMb,
    setInitialMaxContractUploadFileSizeMb,
  ] = useState<number>(DEFAULT_MAX_CONTRACT_UPLOAD_FILE_SIZE_MB);

  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Spec 2026-06-12: "Repositories" home -- opens the Edit-project modal.
  const [isEditProjectOpen, setIsEditProjectOpen] = useState(false);

  /**
   * Seed the form when the modal opens with the project's stored values
   * (or the documented defaults if the project's value is null).
   */
  useEffect(() => {
    if (!isOpen || !project) return;

    const seedPerStory =
      project.perStoryContextTokenCap ?? DEFAULT_PER_STORY_CAP;
    const seedCrossStory =
      project.crossStoryContextTokenCap ?? DEFAULT_CROSS_STORY_CAP;
    const seedAutoRun = project.autoRunPass2 ?? DEFAULT_AUTO_RUN_PASS_2;
    const seedMaxContract =
      project.maxContractUploadFileSizeMb ??
      DEFAULT_MAX_CONTRACT_UPLOAD_FILE_SIZE_MB;

    setPerStoryCap(seedPerStory);
    setCrossStoryCap(seedCrossStory);
    setAutoRunPass2(seedAutoRun);
    setMaxContractUploadFileSizeMb(seedMaxContract);

    setInitialPerStoryCap(seedPerStory);
    setInitialCrossStoryCap(seedCrossStory);
    setInitialAutoRunPass2(seedAutoRun);
    setInitialMaxContractUploadFileSizeMb(seedMaxContract);

    setError(null);
    setIsSaving(false);
  }, [isOpen, project]);

  if (!isOpen || !project) return null;

  const handleSave = async () => {
    if (isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      // Send only fields that have actually changed from the seed value.
      // Unchanged fields are omitted entirely so the backend's null-guard
      // preserves the stored value rather than overwriting it.
      const updates: {
        perStoryContextTokenCap?: number;
        crossStoryContextTokenCap?: number;
        autoRunPass2?: boolean;
        maxContractUploadFileSizeMb?: number;
      } = {};
      if (perStoryCap !== initialPerStoryCap) {
        updates.perStoryContextTokenCap = perStoryCap;
      }
      if (crossStoryCap !== initialCrossStoryCap) {
        updates.crossStoryContextTokenCap = crossStoryCap;
      }
      if (autoRunPass2 !== initialAutoRunPass2) {
        updates.autoRunPass2 = autoRunPass2;
      }
      if (
        maxContractUploadFileSizeMb !== initialMaxContractUploadFileSizeMb
      ) {
        updates.maxContractUploadFileSizeMb = maxContractUploadFileSizeMb;
      }
      const updated = await updateProjectConfig(project.id, updates);
      if (onSaveSuccess) onSaveSuccess(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save project config');
      setIsSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-config-modal-title"
      data-testid="project-config-modal"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={() => !isSaving && onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white',
          padding: '24px',
          borderRadius: '8px',
          minWidth: '480px',
          maxWidth: '640px',
        }}
      >
        <h2 id="project-config-modal-title" style={{ marginTop: 0 }}>
          Edit Shape-Spec Generation Config
        </h2>

        <div style={{ marginBottom: '16px' }}>
          <label htmlFor="per-story-cap-input" style={{ display: 'block', fontWeight: 'bold' }}>
            Per-story context token cap
          </label>
          <input
            id="per-story-cap-input"
            data-testid="per-story-cap-input"
            type="number"
            min={0}
            value={perStoryCap}
            disabled={isSaving}
            onChange={(e) => setPerStoryCap(Number.parseInt(e.target.value, 10) || 0)}
            style={{ width: '100%', padding: '6px', marginTop: '4px' }}
          />
          <div style={{ fontSize: '12px', color: '#666' }}>
            Default {DEFAULT_PER_STORY_CAP}. Tokens spent on per-story content
            (focused context, evidence refs, findings).
          </div>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label htmlFor="cross-story-cap-input" style={{ display: 'block', fontWeight: 'bold' }}>
            Cross-story context token cap
          </label>
          <input
            id="cross-story-cap-input"
            data-testid="cross-story-cap-input"
            type="number"
            min={0}
            value={crossStoryCap}
            disabled={isSaving}
            onChange={(e) => setCrossStoryCap(Number.parseInt(e.target.value, 10) || 0)}
            style={{ width: '100%', padding: '6px', marginTop: '4px' }}
          />
          <div style={{ fontSize: '12px', color: '#666' }}>
            Default {DEFAULT_CROSS_STORY_CAP}. Tokens spent on cross-story
            content (sibling summaries, workstream context) on pass 2.
          </div>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              id="auto-run-pass-2-input"
              data-testid="auto-run-pass-2-input"
              type="checkbox"
              checked={autoRunPass2}
              disabled={isSaving}
              onChange={(e) => setAutoRunPass2(e.target.checked)}
            />
            <span style={{ fontWeight: 'bold' }}>
              Automatically run pass 2 after pass 1
            </span>
          </label>
          <div style={{ fontSize: '12px', color: '#666', marginLeft: '24px' }}>
            Default on. Disable to leave a manual "Regenerate with sibling
            context" action on the dashboard.
          </div>
        </div>

        {/*
          Uploads section -- Spec 2026-05-20 Bulk-Resolve OAS/WSDL Parser
          (Task Group 7). The cap drives the AMS-side file-size enforcement
          in the parse-files endpoint; AMS falls back to 10 MB if the column
          is null, so client-side seeding mirrors that default.
        */}
        <h3 style={{ marginTop: '24px', marginBottom: '12px', fontSize: '14px' }}>
          Uploads
        </h3>
        <div style={{ marginBottom: '16px' }}>
          <label
            htmlFor="max-contract-upload-file-size-mb-input"
            style={{ display: 'block', fontWeight: 'bold' }}
          >
            Max contract file size (MB)
          </label>
          <input
            id="max-contract-upload-file-size-mb-input"
            data-testid="max-contract-upload-file-size-mb-input"
            type="number"
            min={MIN_MAX_CONTRACT_UPLOAD_FILE_SIZE_MB}
            max={MAX_MAX_CONTRACT_UPLOAD_FILE_SIZE_MB}
            value={maxContractUploadFileSizeMb}
            disabled={isSaving}
            onChange={(e) =>
              setMaxContractUploadFileSizeMb(
                Number.parseInt(e.target.value, 10) ||
                  DEFAULT_MAX_CONTRACT_UPLOAD_FILE_SIZE_MB,
              )
            }
            style={{ width: '100%', padding: '6px', marginTop: '4px' }}
          />
          <div style={{ fontSize: '12px', color: '#666' }}>
            Default {DEFAULT_MAX_CONTRACT_UPLOAD_FILE_SIZE_MB} MB. Bulk-resolve
            OAS / WSDL uploads larger than this are rejected before parsing.
          </div>
        </div>

        {/* Spec 2026-06-12: Repositories section -- the editing home is the
            Edit-project modal (dual-mode CreateProjectModal): pre-init it
            offers Single/Poly + workspace setup; post-init it is the repo
            CRUD editor synced with the implementation-service workspace. */}
        <h3 style={{ marginTop: '24px', marginBottom: '12px', fontSize: '14px' }}>
          Repositories
        </h3>
        <div style={{ marginBottom: '16px' }}>
          <button
            type="button"
            data-testid="project-config-edit-repositories"
            disabled={isSaving}
            onClick={() => setIsEditProjectOpen(true)}
          >
            Edit repositories...
          </button>
          <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
            {project.implementationInitSuccess === true
              ? 'Workspace registered. Add, re-point or remove repositories.'
              : 'Workspace not set up yet. Register the project repositories with the implementation service.'}
          </div>
        </div>

        {error && (
          <div
            data-testid="project-config-modal-error"
            style={{ color: 'red', marginBottom: '12px' }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button
            data-testid="project-config-modal-cancel"
            disabled={isSaving}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            data-testid="project-config-modal-save"
            disabled={isSaving}
            onClick={handleSave}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>

        {/* Spec 2026-06-12: Edit-project modal (Repositories home).
            Mounted LAZILY: CreateProjectModal reads ProjectContext /
            ArchitectureContext hooks unconditionally, so it must not mount
            until the user actually opens it (keeps provider-less hosts and
            existing ProjectConfigModal tests working). */}
        {isEditProjectOpen && (
          <CreateProjectModal
            isOpen={isEditProjectOpen}
            onClose={() => setIsEditProjectOpen(false)}
            mode="edit"
            project={project}
          />
        )}
      </div>
    </div>
  );
}
