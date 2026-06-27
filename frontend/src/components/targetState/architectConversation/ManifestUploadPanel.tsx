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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  allManifestsHaveService,
  deriveServiceModuleDir,
  resolvedTargetVersionChip,
  shortenManifestPath,
  uploadTargetManifests,
  type ManifestServiceOption,
  type PendingVersionConfirmationEntry,
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
  /**
   * The draft target architecture's Services — the option list for the required
   * per-manifest Service picker (FR1). Sourced from
   * `model.metaModel.entities.services` (or the `elements-inventory` `services`)
   * at the mount site. Each option carries `repoSubfolder` so the panel can
   * derive the persisted moduleDir `tag` (FR5).
   */
  services: ManifestServiceOption[];
  /** Thread id stamped on auto-answered + inline-edited rows (may be null). */
  conversationThreadId?: string | null;
  /** Session id required by the deterministic capture path for inline edits. */
  sessionId?: string | null;
  /** Called after a successful upload so the parent can refresh its decisions. */
  onUploaded?: (response: TargetManifestUploadResponse) => void;
  /** Called after an inline manual edit is captured so the parent can refresh. */
  onManualEdit?: (decisionCode: string, value: FrameworkVersion) => void;
  /**
   * When set, the upload is DISABLED (the sibling "Manually Answer Target State"
   * decisions-file input is active) and the reason is shown + used as a tooltip.
   * Mutual exclusivity: only one bulk target-state input may be used at a time.
   */
  disabledReason?: string | null;
  /** Reports active state (a manifest is staged) so the parent can disable the other box. */
  onActiveChange?: (active: boolean) => void;
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
  services = [],
  conversationThreadId = null,
  sessionId = null,
  onUploaded,
  onManualEdit,
  disabledReason = null,
  onActiveChange,
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

  // Tier-2 "free facts" (Spec 2026-06-26 Task Group 9): LLM-named manifest tech
  // OUTSIDE the 51 questions, surfaced as an INFORMATIONAL, editable/removable
  // list (NEVER questions). Seeded from each upload's `autoAnswer.freeFacts`;
  // edit/remove are local-only (the gateway already persisted them). Reset on a
  // fresh upload alongside the manual overrides.
  const [freeFacts, setFreeFacts] = useState<string[]>([]);

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
        next.push({ file, tag: '', targetServiceElementId: '', packageLock });
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

  const onServiceChange = useCallback(
    (index: number, serviceId: string) => {
      setSelected((prev) =>
        prev.map((s, i) => {
          if (i !== index) return s;
          const svc = services.find((o) => o.id === serviceId);
          // Derive the persisted moduleDir tag from the chosen Service (FR5);
          // an empty/unknown selection clears both the FK and the derived tag.
          const tag = svc ? deriveServiceModuleDir(svc) : '';
          return { ...s, targetServiceElementId: serviceId, tag };
        }),
      );
    },
    [services],
  );

  const removeSelected = useCallback((index: number) => {
    setSelected((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const canSubmit = allManifestsHaveService(selected) && !busy && !disabledReason;

  // Mutual exclusivity (Spec 2026-06-26): report whether a manifest is staged so
  // the parent can disable the sibling "Manually Answer Target State" input.
  useEffect(() => {
    onActiveChange?.(selected.length > 0);
  }, [selected.length, onActiveChange]);

  const handleUpload = useCallback(async () => {
    if (!allManifestsHaveService(selected)) return;
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
      setFreeFacts(result.autoAnswer?.freeFacts ?? []); // re-seed the Tier-2 list
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

  // Spec 2026-06-27: version-unknown coordinates arrive as a SEPARATE pending
  // set (NOT captured decisions). They are surfaced informationally as
  // "Pending version confirmation (N)" -- confirmed in the conversation
  // (framework pre-chosen), never edited/captured here.
  const pendingVersionConfirmations: PendingVersionConfirmationEntry[] = useMemo(
    () => response?.autoAnswer?.pendingVersionConfirmations ?? [],
    [response],
  );

  // Tier-2 free-fact edit/remove (local-only; informational list -- never a
  // question or a captured-decision write).
  const removeFreeFact = useCallback((index: number) => {
    setFreeFacts((prev) => prev.filter((_, i) => i !== index));
  }, []);
  const editFreeFact = useCallback((index: number, nextLabel: string) => {
    setFreeFacts((prev) => prev.map((f, i) => (i === index ? nextLabel : f)));
  }, []);

  return (
    <section
      className={styles.panel}
      data-testid="manifest-upload-panel"
      aria-label="Target dependency manifests"
    >
      <h3 className={styles.heading}>Target Dependency Manifests</h3>

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

      {disabledReason && (
        <p
          className={styles.subheading}
          data-testid="manifest-disabled-note"
          title={disabledReason}
        >
          {disabledReason}
        </p>
      )}

      {/* --- selected files awaiting a tag + submit --- */}
      {selected.length > 0 && (
        <>
          <p className={styles.sectionLabel}>Selected manifests</p>
          <ul className={styles.selectionList} data-testid="manifest-selection-list">
            {selected.map((s, index) => {
              const missingService = s.targetServiceElementId.trim().length === 0;
              return (
                <li
                  key={`${s.file.name}-${index}`}
                  className={styles.selectionItem}
                  data-testid="manifest-selection-item"
                >
                  <span className={styles.fileName}>{s.file.name}</span>
                  <span className={styles.kindBadge}>{kindLabel(s.file.name)}</span>
                  <select
                    className={
                      missingService
                        ? `${styles.tagInput} ${styles.tagInputMissing}`
                        : styles.tagInput
                    }
                    value={s.targetServiceElementId}
                    onChange={(e) => onServiceChange(index, e.target.value)}
                    data-testid={`manifest-service-select-${index}`}
                    aria-label={`Target service for ${s.file.name}`}
                    aria-invalid={missingService}
                  >
                    <option value="">Select target service (required)</option>
                    {services.map((svc) => (
                      <option key={svc.id} value={svc.id}>
                        {svc.name}
                      </option>
                    ))}
                  </select>
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

          {!allManifestsHaveService(selected) && (
            <p className={styles.tagWarning} data-testid="manifest-tag-warning">
              Every manifest needs a target service before you can upload.
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

      {/* --- Pending version confirmations (Spec 2026-06-27): INFORMATIONAL,
          NOT captured decisions. Version-unknown coordinates the conversation
          asks FIRST (framework pre-chosen); listed here so a detected library is
          never silently lost, kept SEPARATE from "Decisions Captured". --- */}
      {pendingVersionConfirmations.length > 0 && (
        <section
          className={styles.freeFactsSection}
          data-testid="manifest-pending-version-section"
          aria-label="Pending version confirmations"
        >
          <p
            className={styles.sectionLabel}
            data-testid="manifest-pending-version-heading"
          >
            Pending version confirmation ({pendingVersionConfirmations.length})
          </p>
          <p className={styles.freeFactsHint}>
            Detected without a resolvable version &mdash; confirm each in the
            conversation. These are NOT captured decisions yet.
          </p>
          <ul
            className={styles.freeFactsList}
            data-testid="manifest-pending-version-list"
          >
            {pendingVersionConfirmations.map((entry, index) => (
              <li
                key={`${entry.decisionCode}-${index}`}
                className={styles.freeFactItem}
                data-testid="manifest-pending-version-item"
              >
                <span className={styles.freeFactLabel}>{entry.framework}</span>
                <span className={styles.kindBadge}>{entry.decisionCode}</span>
                {entry.sourceFile && (
                  <code className={styles.sourceQuote}>
                    {shortenManifestPath(entry.sourceFile)}
                  </code>
                )}
                {entry.tag && <span className={styles.kindBadge}>{entry.tag}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* --- Tier-2 free facts (Spec 2026-06-26 TG9): informational, NOT
          questions; slotted AFTER the auto-answered decisions list. Omitted
          entirely when the gateway returned no free facts. --- */}
      {freeFacts.length > 0 && (
        <section
          className={styles.freeFactsSection}
          data-testid="manifest-free-facts-section"
          aria-label="Lower-level details detected"
        >
          <p
            className={styles.sectionLabel}
            data-testid="manifest-free-facts-heading"
          >
            Lower-level details detected
          </p>
          <p className={styles.freeFactsHint}>
            Manifest-declared technology outside the standard decisions -
            informational only, not questions. Edit or remove anything that is
            noise.
          </p>
          <ul
            className={styles.freeFactsList}
            data-testid="manifest-free-facts-list"
          >
            {freeFacts.map((fact, index) => (
              <FreeFactItem
                key={`${fact}-${index}`}
                label={fact}
                onSave={(next) => editFreeFact(index, next)}
                onRemove={() => removeFreeFact(index)}
              />
            ))}
          </ul>
        </section>
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
// Provenance badge text (Spec 2026-06-26 Task Group 9)
// ===========================================================================

/**
 * The provenance badge text for one auto-answered decision. Extends the original
 * closed `'from manifest' | 'manually entered'` pair with the inferred /
 * LLM-suggested provenance, each naming its SOURCE DEPENDENCY when known so the
 * architect can see what drove the pre-filled answer:
 *   - `manifest`  -> "from manifest"      (+ the source-file line below)
 *   - `inferred`  -> "inferred from <sourceDependency>"
 *   - `llm`       -> "LLM-suggested from <sourceDependency>"
 *   - `manual`    -> "manually entered"
 */
function provenanceBadgeText(decision: ResolvedTargetVersion): string {
  switch (decision.provenance) {
    case 'manual':
      return 'manually entered';
    case 'inferred':
      return decision.sourceDependency
        ? `inferred from ${decision.sourceDependency}`
        : 'inferred';
    case 'llm':
      return decision.sourceDependency
        ? `LLM-suggested from ${decision.sourceDependency}`
        : 'LLM-suggested';
    case 'manifest':
    default:
      return 'from manifest';
  }
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
              : decision.provenance === 'inferred'
                ? `${styles.provenanceBadge} ${styles.provenanceInferred}`
                : decision.provenance === 'llm'
                  ? `${styles.provenanceBadge} ${styles.provenanceLlm}`
                  : styles.provenanceBadge
          }
          data-testid="manifest-decision-provenance"
        >
          {provenanceBadgeText(decision)}
        </span>
        {!editing && !isUnknown && (
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

      {/* Spec 2026-06-27: a version-unknown coordinate is READ-ONLY here. The
          version is NOT captured in this panel -- it is confirmed in the
          conversation (framework pre-chosen). No inline edit, no competing
          manual capture for unknown rows. */}
      {isUnknown && (
        <div
          className={styles.versionUnknownNote}
          data-testid="manifest-version-pending-note"
        >
          Pending version confirmation &mdash; confirm in the conversation.
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

// ===========================================================================
// One Tier-2 "free fact" row (Spec 2026-06-26 Task Group 9)
//   Informational, editable/removable. NEVER a question: it carries no
//   answer/version, only the LLM-named "<friendly name> - <coordinate>" label.
//   Edit/remove mutate the local list only (the gateway already persisted them).
// ===========================================================================

function FreeFactItem({
  label,
  onSave,
  onRemove,
}: {
  label: string;
  onSave: (nextLabel: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);

  return (
    <li className={styles.freeFactItem} data-testid="manifest-free-fact-item">
      {editing ? (
        <div className={styles.editRow} data-testid="manifest-free-fact-edit-row">
          <input
            type="text"
            className={styles.editInput}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            data-testid="manifest-free-fact-input"
            aria-label={`Edit detail ${label}`}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onSave(draft.trim() || label);
                setEditing(false);
              }
            }}
          />
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => {
              onSave(draft.trim() || label);
              setEditing(false);
            }}
            data-testid="manifest-free-fact-save"
          >
            Save
          </button>
          <button
            type="button"
            className={styles.linkButton}
            onClick={() => {
              setDraft(label);
              setEditing(false);
            }}
            data-testid="manifest-free-fact-cancel"
          >
            Cancel
          </button>
        </div>
      ) : (
        <>
          <span
            className={styles.freeFactLabel}
            data-testid="manifest-free-fact-label"
          >
            {label}
          </span>
          <button
            type="button"
            className={styles.linkButton}
            onClick={() => {
              setDraft(label);
              setEditing(true);
            }}
            data-testid="manifest-free-fact-edit"
          >
            Edit
          </button>
          <button
            type="button"
            className={styles.removeButton}
            onClick={onRemove}
            data-testid="manifest-free-fact-remove"
          >
            Remove
          </button>
        </>
      )}
    </li>
  );
}
