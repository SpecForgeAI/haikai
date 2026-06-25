/**
 * ManifestUploadPanel
 *
 * Spec: 2026-06-24-target-dependency-manifest-auto-answer (Spec 3) — Task Group 5.
 *
 * The target-state manifest-upload surface, a peer of the Architect Conversation
 * surfaces (lives alongside `ArchitectConversationTab.tsx`). It:
 *
 *   5.2 — accepts `pom.xml` / `package.json` (+ an optional `package-lock.json`
 *         paired with a `package.json`) and REQUIRES a target module/service tag
 *         per manifest before submit (submit is disabled until every selected
 *         manifest is tagged). Server-reported dropped/unparsed files are
 *         surfaced (never hidden).
 *   5.3 — lists each uploaded manifest with its module/service tag + parse status
 *         (parsed / dropped-with-reason).
 *   5.4 — surfaces each manifest-derived answer with its SOURCE PROVENANCE (which
 *         manifest file + resolved coordinate, vs. manually entered — modelled on
 *         the `TechStackPrefillBanner` provenance precedent). Every value is
 *         EDITABLE inline; a manual edit is written as a MANUAL answer (the
 *         deterministic capture path), which Group 4 precedence preserves on the
 *         next upload. `version-unknown` renders as a first-class, editable
 *         affordance (the user can supply the exact version manually).
 *   5.5 — wires to the Group 1 upload route and reflects the Group 3 auto-answers
 *         + Group 4 precedence/recompute outcomes, INCLUDING partial-success from
 *         a first-POST failure (`autoAnswer.aborted`).
 *
 * This component computes NO CVE delta and renders NO steering UI (Spec 4) and
 * writes NO codebase artifact (Spec 5). It only uploads + surfaces.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  allManifestsTagged,
  resolvedTargetVersionChip,
  shortenManifestPath,
  uploadTargetManifests,
  type ResolvedTargetVersion,
  type SelectedManifest,
  type TargetManifestUploadResponse,
  type UnparsedManifest,
} from '../../../api/targetManifestApi';
import {
  captureAnswer as defaultCaptureAnswer,
  isVersionSentinel,
  VERSION_UNKNOWN,
  type FrameworkVersion,
} from '../../../api/architectConversationApi';
import styles from './ManifestUploadPanel.module.css';
import { buildFrameworkVersionCaptureValue } from './versionControlConfig';

// ---------------------------------------------------------------------------
// Injectable deps (test seam) — mirrors the conversation tab's API-call shape.
// ---------------------------------------------------------------------------

export interface ManifestUploadPanelDeps {
  uploadTargetManifests: typeof uploadTargetManifests;
  /**
   * The deterministic capture path used when the user inline-edits an
   * auto-answered value. Writing through `captureAnswer` produces a MANUAL row
   * (`createdByTask = 'architect-persona-conversation'`) which Group 4 precedence
   * then preserves — so a manual edit ALWAYS wins over a re-upload.
   */
  captureAnswer: typeof defaultCaptureAnswer;
}

export const defaultManifestUploadPanelDeps: ManifestUploadPanelDeps = {
  // Delegate at CALL time (not module-eval time) so a consumer test that
  // partially mocks `architectConversationApi` without re-exporting
  // `captureAnswer` does not break at import — the binding is only dereferenced
  // when an inline edit is actually submitted.
  uploadTargetManifests: (projectId, targetArchitectureId, selected, options) =>
    uploadTargetManifests(projectId, targetArchitectureId, selected, options),
  captureAnswer: (projectId, targetArchitectureId, body, options) =>
    defaultCaptureAnswer(projectId, targetArchitectureId, body, options),
};

export interface ManifestUploadPanelProps {
  projectId: string;
  targetArchitectureId: string;
  /** Thread id stamped on auto-answered + inline-edited rows (may be null). */
  conversationThreadId?: string | null;
  /** Session id required by the deterministic capture path for inline edits. */
  sessionId?: string | null;
  /** Called after a successful upload so the parent can refresh its decisions. */
  onUploaded?: (response: TargetManifestUploadResponse) => void;
  /** Called after an inline manual edit is captured so the parent can refresh. */
  onManualEdit?: (decisionCode: string, value: FrameworkVersion) => void;
  deps?: ManifestUploadPanelDeps;
}

// ---------------------------------------------------------------------------
// Filename classification (mirrors the gateway detection so the picker can
// pair a package-lock.json with its package.json before upload).
// ---------------------------------------------------------------------------

function basenameOf(name: string): string {
  const norm = name.replace(/\\/g, '/');
  const i = norm.lastIndexOf('/');
  return i === -1 ? norm : norm.slice(i + 1);
}

function isSupportedManifest(name: string): boolean {
  const b = basenameOf(name).toLowerCase();
  return b === 'pom.xml' || b === 'package.json';
}

function isPackageJson(name: string): boolean {
  return basenameOf(name).toLowerCase() === 'package.json';
}

function isPackageLockFile(name: string): boolean {
  return basenameOf(name).toLowerCase() === 'package-lock.json';
}

function kindLabel(name: string): string {
  return isPackageJson(name) ? 'package.json' : 'pom.xml';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ManifestUploadPanel({
  projectId,
  targetArchitectureId,
  conversationThreadId = null,
  sessionId = null,
  onUploaded,
  onManualEdit,
  deps = defaultManifestUploadPanelDeps,
}: ManifestUploadPanelProps) {
  const [selected, setSelected] = useState<SelectedManifest[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [response, setResponse] = useState<TargetManifestUploadResponse | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Local overrides for inline-edited decisions, keyed by decisionCode. A
  // successful manual edit replaces the rendered value + flips provenance to
  // 'manual' immediately (optimistic), independent of a re-upload.
  const [manualOverrides, setManualOverrides] = useState<
    Record<string, ResolvedTargetVersion>
  >({});

  // -----------------------------------------------------------------------
  // File selection — split supported manifests from accompanying lockfiles,
  // pairing each lockfile with a package.json in the same directory.
  // -----------------------------------------------------------------------
  const handleFilesChosen = useCallback((fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const incoming = Array.from(fileList);
    const lockfiles = incoming.filter((f) => isPackageLockFile(f.name));
    const manifests = incoming.filter((f) => isSupportedManifest(f.name));
    const unsupported = incoming.filter(
      (f) => !isSupportedManifest(f.name) && !isPackageLockFile(f.name),
    );

    setSelected((prev) => {
      const next = [...prev];
      for (const file of manifests) {
        // Pair a same-directory lockfile (npm only).
        let packageLock: File | null = null;
        if (isPackageJson(file.name)) {
          const dir = file.name.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
          packageLock =
            lockfiles.find((lf) => {
              const lfDir = lf.name.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
              return lfDir === dir;
            }) ?? null;
        }
        next.push({ file, tag: '', packageLock });
      }
      return next;
    });

    if (unsupported.length > 0) {
      setUploadError(
        `Ignored unsupported file(s): ${unsupported
          .map((f) => f.name)
          .join(', ')}. Only pom.xml / package.json (+ optional package-lock.json) are accepted.`,
      );
    }
    // Reset the native input so re-selecting the same file fires `onChange`.
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const updateTag = useCallback((index: number, tag: string) => {
    setSelected((prev) => prev.map((s, i) => (i === index ? { ...s, tag } : s)));
  }, []);

  const removeSelected = useCallback((index: number) => {
    setSelected((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const canSubmit = allManifestsTagged(selected) && !busy;

  const handleUpload = useCallback(async () => {
    if (!allManifestsTagged(selected)) return;
    setBusy(true);
    setUploadError(null);
    try {
      const result = await deps.uploadTargetManifests(
        projectId,
        targetArchitectureId,
        selected,
        { conversationThreadId },
      );
      setResponse(result);
      setManualOverrides({}); // a fresh upload recomputes everything
      setSelected([]); // clear the picker on success
      onUploaded?.(result);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to upload manifests');
    } finally {
      setBusy(false);
    }
  }, [
    selected,
    deps,
    projectId,
    targetArchitectureId,
    conversationThreadId,
    onUploaded,
  ]);

  // The auto-answered decisions to render — the recomputed structured target
  // versions, with any optimistic manual override applied.
  const decisions: ResolvedTargetVersion[] = useMemo(() => {
    const base = response?.autoAnswer?.resolvedTargetVersions ?? [];
    return base.map((d) => manualOverrides[d.decisionCode] ?? d);
  }, [response, manualOverrides]);

  return (
    <section
      className={styles.panel}
      data-testid="manifest-upload-panel"
      aria-label="Target dependency manifests"
    >
      <h3 className={styles.heading}>Target dependency manifests</h3>
      <p className={styles.subheading}>
        Upload the target <code>pom.xml</code> / <code>package.json</code> for a
        module to auto-answer its framework, library, build-tool and driver
        decisions. Tag each manifest with its target module/service. An optional{' '}
        <code>package-lock.json</code> pins exact npm versions.
      </p>

      {/* --- file picker --- */}
      <div className={styles.dropRow}>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".xml,.json,application/json,text/xml"
          onChange={(e) => handleFilesChosen(e.target.files)}
          data-testid="manifest-file-input"
          aria-label="Choose manifest files"
        />
      </div>

      {/* --- selected files awaiting a tag + submit --- */}
      {selected.length > 0 && (
        <>
          <p className={styles.sectionLabel}>Selected manifests</p>
          <ul className={styles.selectionList} data-testid="manifest-selection-list">
            {selected.map((s, index) => {
              const missingTag = s.tag.trim().length === 0;
              return (
                <li
                  key={`${s.file.name}-${index}`}
                  className={styles.selectionItem}
                  data-testid="manifest-selection-item"
                >
                  <span className={styles.fileName}>{s.file.name}</span>
                  <span className={styles.kindBadge}>{kindLabel(s.file.name)}</span>
                  <input
                    type="text"
                    className={
                      missingTag
                        ? `${styles.tagInput} ${styles.tagInputMissing}`
                        : styles.tagInput
                    }
                    placeholder="Target module / service tag (required)"
                    value={s.tag}
                    onChange={(e) => updateTag(index, e.target.value)}
                    data-testid={`manifest-tag-input-${index}`}
                    aria-label={`Module or service tag for ${s.file.name}`}
                    aria-invalid={missingTag}
                  />
                  {s.packageLock && (
                    <span className={styles.lockNote} data-testid="manifest-lock-note">
                      + {s.packageLock.name}
                    </span>
                  )}
                  <button
                    type="button"
                    className={styles.removeButton}
                    onClick={() => removeSelected(index)}
                    data-testid={`manifest-remove-${index}`}
                    aria-label={`Remove ${s.file.name}`}
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>

          {!allManifestsTagged(selected) && (
            <p className={styles.tagWarning} data-testid="manifest-tag-warning">
              Every manifest needs a target module/service tag before you can
              upload.
            </p>
          )}

          <div>
            <button
              type="button"
              className={styles.primaryButton}
              disabled={!canSubmit}
              onClick={() => void handleUpload()}
              data-testid="manifest-upload-submit"
            >
              {busy ? 'Uploading…' : 'Upload + auto-answer'}
            </button>
          </div>
        </>
      )}

      {uploadError && (
        <div
          className={`${styles.banner} ${styles.bannerError}`}
          role="alert"
          data-testid="manifest-upload-error"
        >
          {uploadError}
        </div>
      )}

      {/* --- partial-success banner (Group 3 first-POST-failure abort) --- */}
      {response?.autoAnswer?.aborted && (
        <div
          className={`${styles.banner} ${styles.bannerWarn}`}
          role="status"
          data-testid="manifest-partial-success"
        >
          <span>
            Wrote {response.autoAnswer.rowsWritten} answer(s), then a write failed
            and the rest were not attempted ({response.autoAnswer.partialFailureCodes.length}{' '}
            remaining). {response.autoAnswer.failureReason}
          </span>
        </div>
      )}

      {/* --- uploaded manifest status list (5.3) --- */}
      {response && (
        <UploadedManifestStatusList response={response} />
      )}

      {/* --- auto-answered decisions w/ provenance + inline edit (5.4) --- */}
      {decisions.length > 0 && (
        <>
          <p className={styles.sectionLabel} data-testid="manifest-decisions-heading">
            Auto-answered decisions
          </p>
          <ul className={styles.decisionList} data-testid="manifest-decision-list">
            {decisions.map((d) => (
              <AutoAnsweredDecision
                key={d.decisionCode}
                decision={d}
                projectId={projectId}
                targetArchitectureId={targetArchitectureId}
                sessionId={sessionId}
                deps={deps}
                onEdited={(value, updated) => {
                  setManualOverrides((prev) => ({
                    ...prev,
                    [d.decisionCode]: updated,
                  }));
                  onManualEdit?.(d.decisionCode, value);
                }}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

// ===========================================================================
// Uploaded-manifest status list (5.3)
// ===========================================================================

function UploadedManifestStatusList({
  response,
}: {
  response: TargetManifestUploadResponse;
}) {
  const { parsedManifests, droppedManifests } = response;
  if (parsedManifests.length === 0 && droppedManifests.length === 0) return null;
  return (
    <div data-testid="manifest-status-section">
      <p className={styles.sectionLabel}>Uploaded manifests</p>
      <ul className={styles.statusList} data-testid="manifest-status-list">
        {parsedManifests.map((m) => (
          <li
            key={`parsed-${m.manifestPath}`}
            className={`${styles.statusItem} ${styles.statusParsed}`}
            data-testid="manifest-status-parsed"
          >
            <span className={styles.fileName}>{shortenManifestPath(m.manifestPath)}</span>
            <span className={styles.kindBadge}>{m.tag}</span>
            <span className={`${styles.statusBadge} ${styles.statusBadgeParsed}`}>
              parsed
            </span>
            <span className={styles.statusReason}>
              {m.declaredDependencies.length} dependencies
            </span>
          </li>
        ))}
        {droppedManifests.map((m: UnparsedManifest, i) => (
          <li
            key={`dropped-${m.manifestPath}-${i}`}
            className={`${styles.statusItem} ${styles.statusDropped}`}
            data-testid="manifest-status-dropped"
          >
            <span className={styles.fileName}>{shortenManifestPath(m.manifestPath)}</span>
            {m.tag && <span className={styles.kindBadge}>{m.tag}</span>}
            <span className={`${styles.statusBadge} ${styles.statusBadgeDropped}`}>
              dropped
            </span>
            <span className={styles.statusReason}>{m.reason}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ===========================================================================
// One auto-answered decision row w/ provenance + inline edit (5.4)
// ===========================================================================

function AutoAnsweredDecision({
  decision,
  projectId,
  targetArchitectureId,
  sessionId,
  deps,
  onEdited,
}: {
  decision: ResolvedTargetVersion;
  projectId: string;
  targetArchitectureId: string;
  sessionId: string | null;
  deps: ManifestUploadPanelDeps;
  onEdited: (value: FrameworkVersion, updated: ResolvedTargetVersion) => void;
}) {
  const [editing, setEditing] = useState(false);
  // Seed the edit field empty when the version is unknown (so the user supplies
  // an exact version), else with the current concrete version.
  const [draftVersion, setDraftVersion] = useState(
    decision.versionUnknown ? '' : decision.version,
  );
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const isUnknown = decision.versionUnknown || isVersionSentinel(decision.version);
  const chip = resolvedTargetVersionChip(decision);

  const beginEdit = () => {
    setDraftVersion(isUnknown ? '' : decision.version);
    setEditError(null);
    setEditing(true);
  };

  const submitEdit = async () => {
    const trimmed = draftVersion.trim();
    if (trimmed.length === 0) {
      setEditError('Enter an exact version.');
      return;
    }
    if (!sessionId) {
      setEditError('Open the conversation before editing answers.');
      return;
    }
    setSaving(true);
    setEditError(null);
    const value: FrameworkVersion = {
      framework: decision.framework,
      version: trimmed,
    };
    try {
      // Write a MANUAL answer (deterministic capture). The captured value rides
      // the structured { framework, version } envelope; Group 4 precedence then
      // preserves this manual row on the next manifest upload (manual wins).
      await deps.captureAnswer(projectId, targetArchitectureId, {
        sessionId,
        decisionCode: decision.decisionCode,
        // Reuse the EXACT capture-value envelope the conversation uses for a
        // versioned answer ({ value: { framework, version }, sourceQuote,
        // sourceFile }) so the manual edit persists in the same shape the
        // gateway /capture endpoint expects; sourceFile is null (manual entry).
        value: buildFrameworkVersionCaptureValue({
          framework: value.framework,
          version: value.version,
        }),
        answerText: `${value.framework} ${value.version}`,
      });
      onEdited(value, {
        ...decision,
        version: trimmed,
        versionUnknown: isVersionSentinel(trimmed),
        provenance: 'manual',
      });
      setEditing(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to save edit');
    } finally {
      setSaving(false);
    }
  };

  const markVersionUnknown = () => {
    // Allow the user to explicitly keep/confirm a version-unknown answer.
    setDraftVersion(VERSION_UNKNOWN);
  };

  return (
    <li
      className={styles.decisionItem}
      data-testid={`manifest-decision-${decision.decisionCode}`}
      data-provenance={decision.provenance}
      data-version-unknown={isUnknown ? 'true' : 'false'}
    >
      <div className={styles.decisionHeaderRow}>
        <span className={styles.decisionCode}>{decision.decisionCode}</span>
        <span
          className={
            isUnknown
              ? `${styles.resolvedChip} ${styles.resolvedChipUnknown}`
              : styles.resolvedChip
          }
          data-testid="manifest-decision-chip"
        >
          {chip}
        </span>
        <span
          className={
            decision.provenance === 'manual'
              ? `${styles.provenanceBadge} ${styles.provenanceManual}`
              : styles.provenanceBadge
          }
          data-testid="manifest-decision-provenance"
        >
          {decision.provenance === 'manual' ? 'manually entered' : 'from manifest'}
        </span>
        {!editing && (
          <button
            type="button"
            className={styles.linkButton}
            onClick={beginEdit}
            data-testid="manifest-decision-edit"
          >
            Edit
          </button>
        )}
      </div>

      {/* Provenance line — which manifest file the value came from. */}
      {decision.provenance === 'manifest' && decision.sourceFile && (
        <div className={styles.provenanceLine} data-testid="manifest-decision-source">
          from{' '}
          <code className={styles.sourceQuote}>
            {shortenManifestPath(decision.sourceFile)}
          </code>
        </div>
      )}

      {/* version-unknown first-class affordance. */}
      {isUnknown && !editing && (
        <div className={styles.versionUnknownNote} data-testid="manifest-version-unknown-note">
          Version could not be resolved from the manifest. Edit to supply the
          exact version.
        </div>
      )}

      {editing && (
        <div className={styles.editRow} data-testid="manifest-decision-edit-row">
          <input
            type="text"
            className={styles.editInput}
            value={draftVersion}
            placeholder="e.g. 3.4.1"
            onChange={(e) => setDraftVersion(e.target.value)}
            data-testid="manifest-decision-edit-input"
            aria-label={`Exact version for ${decision.framework}`}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void submitEdit();
              }
            }}
          />
          <button
            type="button"
            className={styles.primaryButton}
            disabled={saving}
            onClick={() => void submitEdit()}
            data-testid="manifest-decision-edit-save"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={saving}
            onClick={markVersionUnknown}
            data-testid="manifest-decision-edit-unknown"
          >
            Mark version unknown
          </button>
          <button
            type="button"
            className={styles.linkButton}
            onClick={() => {
              setEditing(false);
              setEditError(null);
            }}
            data-testid="manifest-decision-edit-cancel"
          >
            Cancel
          </button>
          {editError && (
            <span className={styles.editError} data-testid="manifest-decision-edit-error">
              {editError}
            </span>
          )}
        </div>
      )}
    </li>
  );
}
