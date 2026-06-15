/**
 * MigrationDeliveryStoryDrawer
 *
 * Spec: 2026-05-19 Migration Delivery Progress and Evidence Tracking
 * Task Group 11 -- Story detail drawer + "Missing inputs" subsection.
 *
 * Spec: 2026-05-20 Cross-Story Context Injection -- Task Group 7.2
 * extends this drawer with pass-2 visibility:
 *   - Pass-2 chip alongside confidence/status chips.
 *   - "No meaningful change" chip when the pass-2 output is byte-equivalent.
 *   - "What changed and why" block from `pass2_changes_summary`.
 *   - Inline diff between `pass1_spec_text` and `generated_spec_text`.
 *   - Contradiction warnings (`contradicts_sibling`,
 *     `aligned_with_epic_decision`) rendered in the warnings panel.
 *   - Budget warning placeholder when `budget_meta_json.trimmed` carries
 *     non-zero drops, surfaced via the existing
 *     `MigrationDeliverySectionRetryPlaceholder` (kept retry-less here --
 *     the budget warning is informational, not retryable).
 *
 * Spec: 2026-05-20 Missing Input Resolver Flow -- Task Group 6.3
 * REPLACES the read-only Missing-inputs subsection (Addition C) with the
 * structured `MigrationDeliveryStoryDrawerResolverPanel`. The drawer becomes
 * the entry point for per-row resolution affordances; the dashboard surfaces
 * (Group 7) own the cross-story bulk-resolve + ready-to-retry surfaces. The
 * drawer's other sections (header chips, parent path, pass-2 diff, warnings,
 * budget banner) are untouched. Callers supply the resolver-panel context
 * (`resolverRows`, `recommendedNextAction`, etc.) when the story is
 * `insufficient_context`; when those props are absent the drawer falls back
 * to the read-only entries renderer so legacy callers keep working.
 *
 * Spec: 2026-05-20 Spec Quality Scoring -- Task Group 7
 * adds a "Quality breakdown" collapsible section. It renders ONLY when the
 * spec-generation row carries a non-null `qualityScore`. The section header
 * has a right-aligned "Recompute quality score" icon button that POSTs the
 * gateway single-row recompute endpoint and refreshes the drawer state
 * in-place (no full page reload). A delta chip surfaces next to the
 * composite score when the grade letter derived from `previousQualityScore`
 * differs from the current `qualityGrade` -- letter-change-only, no numeric
 * delta per spec.md "Out of Scope".
 *
 * Right-hand side panel drawer (520px wide, max 100vw on small screens).
 * Dismissible via Esc, backdrop click, or X close button (spec.md test 32 /
 * matches `MigrationShapeSpecGeneration/StoryResultDrawer.tsx` conventions).
 *
 * Sections (in render order):
 *   1. Story header  -- title, type, workstream
 *   2. Parent path   -- initiative > epic > feature
 *   3. Status row    -- backlog / spec generation / implementation / evidence
 *      + pass-2 chip when `specGeneration.generationPass === 2`
 *      + no-meaningful-change chip when `noMeaningfulChange === true`
 *   4. Quality breakdown (Spec Quality Scoring 2026-05-20) when
 *      `specGeneration.qualityScore` is set
 *   5. Needs-attention reasons (when the story has needs-attention items)
 *   6. Resolver panel (Group 6 of the resolver-flow spec) when the story is
 *      `insufficient_context` AND `resolverRows` was supplied. Otherwise the
 *      legacy read-only Missing-inputs subsection renders.
 *   7. Pass-2 "what changed and why" summary + inline diff (only when
 *      `specGeneration.generationPass === 2`).
 *   8. Cross-story warnings panel (contradicts_sibling /
 *      aligned_with_epic_decision).
 *   9. Budget warning inline placeholder when `budget_meta_json.trimmed`
 *      carries non-zero drops or the warnings array contains
 *      `no_sibling_context_available`.
 *
 * `missingInputs[]` source:
 *   The drawer can receive `missingInputs[]` either as an explicit prop
 *   (when the caller already has the matching needs-attention row in hand)
 *   or it can derive it by looking up the story's `workItemId` against
 *   the dashboard's `needsAttention[]` list. The dashboard container
 *   typically passes the needs-attention row directly to keep the drawer
 *   stateless.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  MigrationDeliveryHierarchyNodeDto,
  MigrationDeliveryNeedsAttentionItemDto,
  MissingInputEntry,
} from '../../../api/migrationDeliveryDashboardApi';
import MigrationDeliveryInlineDiff from './MigrationDeliveryInlineDiff';
import MigrationDeliveryStoryDrawerResolverPanel, {
  type ResolverPanelRow,
} from './MigrationDeliveryStoryDrawerResolverPanel';
import type {
  MissingInputResolutionDto,
  MissingInputType,
} from '../../../api/missingInputResolutionsApi';
import {
  recomputeSpecQuality as defaultRecomputeSpecQuality,
  manualEditSpec as defaultManualEditSpec,
  type QualityDimensionEntry as ApiQualityDimensionEntry,
  type RecomputeSpecQualityResponse,
  type SpecGenerationRow,
} from '../../../api/specGenerationApi';
import { qualityGradeBadgeClass, type QualityGrade } from './QualityGradeChip';
import SpecMarkdownEditor, {
  type SpecMarkdownEditorHandle,
} from './SpecMarkdownEditor';
import { computeLineDiff } from '../../../utils/lineDiff';
import { useToast } from '../../../contexts/ToastContext';
import styles from './MigrationDeliveryDashboard.module.css';

// ============================================================================
// Public sub-types -- the cross-story context injection enrichment shape
// ============================================================================

/**
 * Subset of `SpecGenerationRow` (from `specGenerationApi.ts`) the drawer
 * actually reads to render pass-2 surfaces. Kept narrow so the dashboard
 * container can pass either the per-story result from the most recent batch
 * OR a fresh row fetched from AMS without forcing the full row shape.
 */
export interface StoryPassTwoDetail {
  /** 1 = pass-1; 2 = pass-2; null = legacy row. */
  generationPass: number | null;
  /** Snapshot of pass-1 text for inline diff against `generatedSpecText`. */
  pass1SpecText: string | null;
  /** Current spec text (pass-2 output for pass-2 rows). */
  generatedSpecText: string | null;
  /** "What changed and why" blurb produced by the gateway pass-2 wrap-up. */
  pass2ChangesSummary: string | null;
  /**
   * Mirror of the resolver `budget_meta` envelope. Read keys defensively
   * because the shape is a JSONB blob:
   *   { used_tokens, max_tokens, trimmed: { sibling_specs_dropped, ... },
   *     warnings: [...] }
   */
  budgetMetaJson: Record<string, unknown> | null;
  /** True when pass-2 was byte-equivalent to pass-1. */
  noMeaningfulChange: boolean | null;
  /**
   * Raw warnings entries as persisted by the gateway (one object per
   * warning, with shape `{ kind, ... }` -- see Task Group 5.6 contradiction
   * detection).
   */
  warnings?: Array<Record<string, unknown>>;
  /**
   * Resolver-flow (2026-05-20) -- "What to do next" banner content sourced
   * from `recommendedNextAction` on the spec-generation DTO.
   */
  recommendedNextAction?: string | null;
  // ---- Spec Quality Scoring (2026-05-20, Task Group 7) ------------------
  /**
   * Spec-generation row id, required for the single-row recompute call.
   * Optional because legacy callers and pre-quality-scoring tests may not
   * supply it.
   */
  specGenerationId?: string | null;
  /** Composite 0-100 quality score. Null when not yet scored. */
  qualityScore?: number | null;
  /** A-F grade letter. Null when not yet scored. */
  qualityGrade?: QualityGrade | null;
  /** Per-dimension breakdown from the AMS scorer. */
  qualityDimensions?: ApiQualityDimensionEntry[] | null;
  /** Previous composite score, used to render the delta chip. */
  previousQualityScore?: number | null;
  // ----- In-Product Spec Editor + Confirm-Overwrite (2026-05-20) ---------
  /** True when a user has saved a manual edit through the drawer. */
  manuallyEdited?: boolean | null;
  /** ISO-8601 timestamp of the latest manual save. */
  lastManuallyEditedAt?: string | null;
  /** Identity (X-User-Id) of the user who last saved. */
  lastManuallyEditedBy?: string | null;
  /** Single-slot snapshot of the prior LLM-generated text for the diff toggle. */
  previousSpecText?: string | null;
}

// ============================================================================
// Props
// ============================================================================

export interface MigrationDeliveryStoryDrawerProps {
  /** The selected story node from the hierarchy tree. */
  story: MigrationDeliveryHierarchyNodeDto;
  /**
   * Parent-path titles (initiative -> epic -> feature). Pass an empty array
   * if not known; the drawer renders the path inline when at least one
   * entry is present.
   */
  parentPath?: string[];
  /**
   * The needs-attention row whose `workItemId` matches this story.
   * Optional; pass null/undefined when the story has no needs-attention
   * item. When passed AND the story is insufficient_context, the drawer
   * renders the "Missing inputs" subsection from this row's
   * `missingInputs[]`.
   */
  needsAttentionItem?: MigrationDeliveryNeedsAttentionItemDto | null;
  /**
   * Cross-Story Context Injection (2026-05-20) -- per-story spec-generation
   * row carrying the pass-2 enrichment fields. When null/undefined, none of
   * the new pass-2 surfaces render.
   */
  specGeneration?: StoryPassTwoDetail | null;
  /** Optional URL to the WorkItem detail surface. */
  workItemHref?: string;
  /** Optional URL to the generated spec. */
  generatedSpecHref?: string;
  /** Optional URL to the WorkItem Implement workspace. */
  implementWorkspaceHref?: string;
  /** Invoked when the drawer should close (X / Esc / backdrop). */
  onClose: () => void;
  // ----------------------------------------------------------------------
  // Resolver-flow (2026-05-20) -- structured resolver panel inputs. When
  // any of these is present AND the story is insufficient_context, the
  // drawer renders the new resolver panel in place of the read-only
  // Missing-inputs subsection. The container typically populates `rows`
  // from a join of `missing_input_keys_json` x `missing_inputs_json` x the
  // project's active resolutions.
  // ----------------------------------------------------------------------
  /** Project id for the resolver panel's API calls. */
  projectId?: string;
  /** Book-of-work id sent to the retry-batch endpoint. */
  bookOfWorkId?: string;
  /** Architecture id used to build the target-architecture deep-link. */
  architectureId?: string;
  /** Hydrated rows powering the structured resolver panel. */
  resolverRows?: ResolverPanelRow[];
  /** Display name / id stamped on the resolution audit row. */
  resolvedBy?: string;
  /**
   * Navigate to the target-architecture workspace with the missing element's
   * logical name pre-filled. Typically implemented via react-router's
   * `useNavigate` pushing
   * `/projects/{projectId}/architectures/{architectureId}/target-architecture
   *  ?missingTargetElementLogicalName=<encoded>`.
   */
  onOpenTargetArchitecture?: (logicalName: string | null) => void;
  /**
   * Called after every successful resolver-panel write. Routes that mount
   * the drawer should dispatch `LOAD_MODEL` on `type === 'mapping'` writes
   * per `project_appshell_model_cache.md`.
   */
  onResolutionPersisted?: (input: {
    type: MissingInputType;
    resolution: MissingInputResolutionDto | null;
    affectedSpecIds: string[];
  }) => void;
  /** Called after a successful retry-batch fired from the resolver panel. */
  onRetryComplete?: (result: unknown) => void;
  /** Called when the retry-batch is gated behind a cost-preview confirmation. */
  onRetryRequiresConfirmation?: (input: {
    costPreview: unknown;
    threshold: string | undefined;
  }) => void;
  /**
   * Spec Quality Scoring (2026-05-20, Task Group 7) test seam: override the
   * gateway single-row recompute call. Defaults to the real client.
   */
  recomputeSpecQualityFn?: typeof defaultRecomputeSpecQuality;
  // -------------------------------------------------------------------------
  // In-Product Spec Editor + Confirm-Overwrite (2026-05-20, Task Group 7).
  // -------------------------------------------------------------------------
  /** Identity stamped on the manual-edit audit row (sent as X-User-Id). */
  editedBy?: string;
  /**
   * Called when the user successfully saves a manual edit. Receives the
   * refreshed per-row DTO so the dashboard can reconcile its in-memory state
   * (hierarchy chip refresh, post-batch table, etc.).
   */
  onManualEditSaved?: (row: SpecGenerationRow) => void;
  /**
   * Optional Regenerate handler. When supplied, the drawer header renders a
   * Regenerate button. The handler is responsible for the actual regenerate
   * call -- the drawer only signals intent; the parent dashboard branches on
   * manuallyEdited to mount the single-story modal vs proceed directly.
   */
  onRegenerate?: (input: { overwriteManuallyEdited: boolean }) => void;
  /** Test seam: override the gateway manual-edit API. */
  manualEditSpecFn?: typeof defaultManualEditSpec;
}

// ============================================================================
// Helpers
// ============================================================================

/** Group missing-input entries by `kind` (Mappings / Baselines / Contracts / ...). */
function groupMissingInputsByKind(
  entries: ReadonlyArray<MissingInputEntry>,
): Array<{ kind: string; entries: MissingInputEntry[] }> {
  const groups = new Map<string, MissingInputEntry[]>();
  for (const entry of entries) {
    const key = entry.kind || 'Other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)?.push(entry);
  }
  // Stable insertion-order groupings (Map preserves insertion order).
  return Array.from(groups.entries()).map(([kind, group]) => ({
    kind,
    entries: group,
  }));
}

function labelForKind(kind: string): string {
  if (!kind) return 'Other';
  const titled = kind.charAt(0).toUpperCase() + kind.slice(1);
  if (titled.endsWith('s')) return titled;
  return `${titled}s`;
}

// ----------------------------------------------------------------------------
// Spec Quality Scoring helpers (Task Group 7.4)
// ----------------------------------------------------------------------------

/**
 * Map a composite 0-100 score to the matching grade letter using the AMS
 * pinned thresholds (A >= 85, B 70-84, C 55-69, D 40-54, F < 40). Mirrors
 * the AMS `SpecQualityScorer` constants. Returns null for null input so the
 * delta chip stays absent when no previous score exists.
 */
export function gradeLetterFromScore(score: number | null | undefined): QualityGrade | null {
  if (score == null) return null;
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

// ----------------------------------------------------------------------------
// Cross-story warning derivation helpers
// ----------------------------------------------------------------------------

interface ContradictsSiblingWarning {
  kind: 'contradicts_sibling';
  siblingWorkItemId: string;
  conflictingDecisionKey?: string | null;
  severity?: string | null;
}

interface AlignedWithEpicWarning {
  kind: 'aligned_with_epic_decision';
  decisionKey?: string | null;
}

interface BudgetWarningSignal {
  siblingSpecsDropped: number;
  evidenceRefsDropped: number;
  findingsDropped: number;
  noSiblingContextAvailable: boolean;
}

/**
 * Pure helper: extract structured contradiction warnings from the raw
 * warnings_json array. Exported for direct unit-test exercise.
 */
export function extractContradictsSiblingWarnings(
  warnings: ReadonlyArray<Record<string, unknown>> | null | undefined,
): ContradictsSiblingWarning[] {
  if (!warnings || warnings.length === 0) return [];
  const out: ContradictsSiblingWarning[] = [];
  for (const w of warnings) {
    if (w && w.kind === 'contradicts_sibling') {
      const siblingWorkItemId =
        typeof w.siblingWorkItemId === 'string'
          ? w.siblingWorkItemId
          : typeof w.sibling_work_item_id === 'string'
            ? (w.sibling_work_item_id as string)
            : '';
      if (!siblingWorkItemId) continue;
      out.push({
        kind: 'contradicts_sibling',
        siblingWorkItemId,
        conflictingDecisionKey:
          typeof w.conflictingDecisionKey === 'string'
            ? w.conflictingDecisionKey
            : typeof w.conflicting_decision_key === 'string'
              ? (w.conflicting_decision_key as string)
              : null,
        severity:
          typeof w.severity === 'string' ? (w.severity as string) : null,
      });
    }
  }
  return out;
}

/**
 * Pure helper: extract structured epic-alignment warnings from the raw
 * warnings_json array. Exported for direct unit-test exercise.
 */
export function extractAlignedWithEpicWarnings(
  warnings: ReadonlyArray<Record<string, unknown>> | null | undefined,
): AlignedWithEpicWarning[] {
  if (!warnings || warnings.length === 0) return [];
  const out: AlignedWithEpicWarning[] = [];
  for (const w of warnings) {
    if (w && w.kind === 'aligned_with_epic_decision') {
      out.push({
        kind: 'aligned_with_epic_decision',
        decisionKey:
          typeof w.decisionKey === 'string'
            ? w.decisionKey
            : typeof w.decision_key === 'string'
              ? (w.decision_key as string)
              : null,
      });
    }
  }
  return out;
}

/**
 * Pure helper: read trimming counts from the budget_meta_json blob. Returns
 * a normalised `BudgetWarningSignal` ready for the inline banner.
 */
export function deriveBudgetWarningSignal(
  budgetMetaJson: Record<string, unknown> | null | undefined,
  rawWarnings: ReadonlyArray<Record<string, unknown>> | null | undefined,
): BudgetWarningSignal {
  let siblingSpecsDropped = 0;
  let evidenceRefsDropped = 0;
  let findingsDropped = 0;
  if (budgetMetaJson && typeof budgetMetaJson === 'object') {
    const trimmed = (budgetMetaJson as Record<string, unknown>).trimmed;
    if (trimmed && typeof trimmed === 'object') {
      const t = trimmed as Record<string, unknown>;
      const readNumber = (v: unknown): number =>
        typeof v === 'number' && Number.isFinite(v) ? v : 0;
      siblingSpecsDropped = readNumber(t.sibling_specs_dropped);
      evidenceRefsDropped = readNumber(t.evidence_refs_dropped);
      findingsDropped = readNumber(t.findings_dropped);
    }
  }
  let noSiblingContextAvailable = false;
  if (budgetMetaJson && typeof budgetMetaJson === 'object') {
    const ws = (budgetMetaJson as Record<string, unknown>).warnings;
    if (Array.isArray(ws)) {
      for (const w of ws) {
        if (typeof w === 'string' && w.includes('no_sibling_context_available')) {
          noSiblingContextAvailable = true;
          break;
        }
      }
    }
  }
  if (!noSiblingContextAvailable && rawWarnings) {
    for (const w of rawWarnings) {
      if (w && (w.kind === 'no_sibling_context_available' || w.code === 'no_sibling_context_available')) {
        noSiblingContextAvailable = true;
        break;
      }
    }
  }
  return {
    siblingSpecsDropped,
    evidenceRefsDropped,
    findingsDropped,
    noSiblingContextAvailable,
  };
}

// ============================================================================
// Component
// ============================================================================

export const MigrationDeliveryStoryDrawer: React.FC<
  MigrationDeliveryStoryDrawerProps
> = ({
  story,
  parentPath,
  needsAttentionItem,
  specGeneration,
  workItemHref,
  generatedSpecHref,
  implementWorkspaceHref,
  onClose,
  projectId,
  bookOfWorkId,
  architectureId,
  resolverRows,
  resolvedBy,
  onOpenTargetArchitecture,
  onResolutionPersisted,
  onRetryComplete,
  onRetryRequiresConfirmation,
  recomputeSpecQualityFn = defaultRecomputeSpecQuality,
  editedBy,
  onManualEditSaved,
  onRegenerate,
  manualEditSpecFn = defaultManualEditSpec,
}) => {
  // ----- Esc-to-close ------------------------------------------------------
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const isInsufficient = story.specGenerationStatus === 'insufficient_context';
  const missingInputs = useMemo<MissingInputEntry[]>(
    () => needsAttentionItem?.missingInputs ?? [],
    [needsAttentionItem],
  );
  const groupedMissing = useMemo(
    () => groupMissingInputsByKind(missingInputs),
    [missingInputs],
  );
  const missingInputsCount = story.missingInputsCount ?? missingInputs.length;

  // Resolver panel is active when the caller supplied the full Group-6
  // context (projectId + bookOfWorkId + architectureId + resolverRows). When
  // ANY of those are missing we fall back to the legacy read-only renderer
  // so existing callers keep working.
  const resolverPanelActive =
    isInsufficient &&
    !!projectId &&
    !!bookOfWorkId &&
    !!architectureId &&
    Array.isArray(resolverRows) &&
    resolverRows.length > 0 &&
    !!story.workItemId;

  // ----- Pass-2 derived state ---------------------------------------------
  const isPassTwo = specGeneration?.generationPass === 2;
  const isNoMeaningfulChange =
    isPassTwo && specGeneration?.noMeaningfulChange === true;
  const contradictionWarnings = useMemo(
    () => extractContradictsSiblingWarnings(specGeneration?.warnings),
    [specGeneration?.warnings],
  );
  const alignedWithEpicWarnings = useMemo(
    () => extractAlignedWithEpicWarnings(specGeneration?.warnings),
    [specGeneration?.warnings],
  );
  const budgetSignal = useMemo(
    () =>
      deriveBudgetWarningSignal(
        specGeneration?.budgetMetaJson,
        specGeneration?.warnings,
      ),
    [specGeneration?.budgetMetaJson, specGeneration?.warnings],
  );
  const hasBudgetWarning =
    budgetSignal.siblingSpecsDropped > 0 ||
    budgetSignal.evidenceRefsDropped > 0 ||
    budgetSignal.findingsDropped > 0 ||
    budgetSignal.noSiblingContextAvailable;

  // ----- Quality breakdown state (Spec Quality Scoring 2026-05-20) --------
  // Local state lets the recompute button refresh the section in-place. We
  // seed it from `specGeneration` whenever the drawer is opened for a new
  // story; the effect below resyncs on prop changes.
  const [qualityScore, setQualityScore] = useState<number | null>(
    specGeneration?.qualityScore ?? null,
  );
  const [qualityGrade, setQualityGrade] = useState<QualityGrade | null>(
    specGeneration?.qualityGrade ?? null,
  );
  const [qualityDimensions, setQualityDimensions] = useState<
    ApiQualityDimensionEntry[] | null
  >(specGeneration?.qualityDimensions ?? null);
  const [previousQualityScore, setPreviousQualityScore] = useState<number | null>(
    specGeneration?.previousQualityScore ?? null,
  );
  const [recomputing, setRecomputing] = useState<boolean>(false);
  const [recomputeError, setRecomputeError] = useState<string | null>(null);

  useEffect(() => {
    setQualityScore(specGeneration?.qualityScore ?? null);
    setQualityGrade(specGeneration?.qualityGrade ?? null);
    setQualityDimensions(specGeneration?.qualityDimensions ?? null);
    setPreviousQualityScore(specGeneration?.previousQualityScore ?? null);
    setRecomputeError(null);
  }, [
    specGeneration?.qualityScore,
    specGeneration?.qualityGrade,
    specGeneration?.qualityDimensions,
    specGeneration?.previousQualityScore,
    specGeneration?.specGenerationId,
  ]);

  const specGenerationId = specGeneration?.specGenerationId ?? null;

  const handleRecomputeQuality = useCallback(async () => {
    if (!projectId || !specGenerationId) return;
    setRecomputing(true);
    setRecomputeError(null);
    try {
      const result: RecomputeSpecQualityResponse = await recomputeSpecQualityFn(
        projectId,
        specGenerationId,
      );
      setQualityScore(result.qualityScore);
      setQualityGrade(result.qualityGrade);
      setQualityDimensions(result.qualityDimensions);
      setPreviousQualityScore(result.previousQualityScore);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Recompute failed';
      setRecomputeError(message);
    } finally {
      setRecomputing(false);
    }
  }, [projectId, specGenerationId, recomputeSpecQualityFn]);

  const previousGradeLetter = useMemo(
    () => gradeLetterFromScore(previousQualityScore),
    [previousQualityScore],
  );
  const showDeltaChip =
    qualityGrade != null &&
    previousGradeLetter != null &&
    previousGradeLetter !== qualityGrade;

  const showQualityBreakdown = qualityScore != null;
  const recomputeDisabled =
    recomputing || !projectId || !specGenerationId;

  // --------------------------------------------------------------------------
  // In-Product Spec Editor (2026-05-20, Task Group 7) -- local state machine.
  // --------------------------------------------------------------------------
  type EditorMode = 'view' | 'edit';
  type SaveStatus = 'clean' | 'dirty' | 'saving' | 'saved';

  const initialSpecText = useMemo<string>(
    () => specGeneration?.generatedSpecText ?? '',
    [specGeneration?.generatedSpecText],
  );

  const [editorMode, setEditorMode] = useState<EditorMode>('view');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('clean');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [bufferedSpecText, setBufferedSpecText] =
    useState<string>(initialSpecText);
  const [showPreviousVersion, setShowPreviousVersion] = useState<boolean>(false);
  const [localGeneratedSpecText, setLocalGeneratedSpecText] =
    useState<string | null>(specGeneration?.generatedSpecText ?? null);
  const [localPreviousSpecText, setLocalPreviousSpecText] =
    useState<string | null>(specGeneration?.previousSpecText ?? null);
  const [localManuallyEdited, setLocalManuallyEdited] =
    useState<boolean | null>(specGeneration?.manuallyEdited ?? null);
  const [localLastManuallyEditedAt, setLocalLastManuallyEditedAt] =
    useState<string | null>(specGeneration?.lastManuallyEditedAt ?? null);
  const [localLastManuallyEditedBy, setLocalLastManuallyEditedBy] =
    useState<string | null>(specGeneration?.lastManuallyEditedBy ?? null);
  const editorRef = useRef<SpecMarkdownEditorHandle | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    setLocalGeneratedSpecText(specGeneration?.generatedSpecText ?? null);
    setLocalPreviousSpecText(specGeneration?.previousSpecText ?? null);
    setLocalManuallyEdited(specGeneration?.manuallyEdited ?? null);
    setLocalLastManuallyEditedAt(specGeneration?.lastManuallyEditedAt ?? null);
    setLocalLastManuallyEditedBy(specGeneration?.lastManuallyEditedBy ?? null);
    setBufferedSpecText(specGeneration?.generatedSpecText ?? '');
    setEditorMode('view');
    setSaveStatus('clean');
    setSaveError(null);
    setShowPreviousVersion(false);
  }, [
    specGeneration?.specGenerationId,
    specGeneration?.generatedSpecText,
    specGeneration?.previousSpecText,
    specGeneration?.manuallyEdited,
    specGeneration?.lastManuallyEditedAt,
    specGeneration?.lastManuallyEditedBy,
  ]);

  const handleEditorDirtyChange = useCallback((isDirty: boolean) => {
    setSaveStatus((prev) => {
      if (prev === 'saving') return prev;
      return isDirty ? 'dirty' : 'clean';
    });
  }, []);

  const performSave = useCallback(
    async (textToSave: string) => {
      if (!projectId || !specGenerationId) {
        setSaveError('Project or spec id missing -- cannot save.');
        return;
      }
      setSaveStatus('saving');
      setSaveError(null);
      try {
        const row = await manualEditSpecFn(
          projectId,
          specGenerationId,
          textToSave,
          editedBy ?? 'unknown-user',
        );
        setLocalGeneratedSpecText(row.generatedSpecText ?? textToSave);
        setLocalPreviousSpecText(row.previousSpecText ?? null);
        setLocalManuallyEdited(row.manuallyEdited ?? true);
        setLocalLastManuallyEditedAt(row.lastManuallyEditedAt ?? null);
        setLocalLastManuallyEditedBy(
          row.lastManuallyEditedBy ?? editedBy ?? null,
        );
        setBufferedSpecText(row.generatedSpecText ?? textToSave);
        setSaveStatus('saved');
        const q = row as {
          qualityScore?: number | null;
          qualityGrade?: QualityGrade | null;
          qualityDimensions?: ApiQualityDimensionEntry[] | null;
          previousQualityScore?: number | null;
        };
        if (q.qualityScore !== undefined) setQualityScore(q.qualityScore ?? null);
        if (q.qualityGrade !== undefined) setQualityGrade(q.qualityGrade ?? null);
        if (q.qualityDimensions !== undefined) {
          setQualityDimensions(q.qualityDimensions ?? null);
        }
        if (q.previousQualityScore !== undefined) {
          setPreviousQualityScore(q.previousQualityScore ?? null);
        }
        if (onManualEditSaved) onManualEditSaved(row);
        if (!textToSave.startsWith('/agent-os:shape-spec')) {
          showToast(
            "Spec doesn't start with /agent-os:shape-spec -- saved anyway",
            'info',
          );
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Manual edit failed';
        setSaveError(message);
        setSaveStatus('dirty');
      }
    },
    [
      projectId,
      specGenerationId,
      manualEditSpecFn,
      editedBy,
      onManualEditSaved,
      showToast,
    ],
  );

  const handleEditorSave = useCallback(
    (value: string) => {
      setBufferedSpecText(value);
      void performSave(value);
    },
    [performSave],
  );

  const handleSaveClick = useCallback(() => {
    const live = editorRef.current?.getValue() ?? bufferedSpecText;
    setBufferedSpecText(live);
    void performSave(live);
  }, [performSave, bufferedSpecText]);

  const handleDiscardClick = useCallback(() => {
    if (saveStatus === 'dirty') {
      const confirmed = window.confirm(
        'You have unsaved changes. Discard them?',
      );
      if (!confirmed) return;
    }
    setBufferedSpecText(localGeneratedSpecText ?? '');
    setEditorMode('view');
    setSaveStatus('clean');
    setSaveError(null);
  }, [saveStatus, localGeneratedSpecText]);

  const handleEnterEditMode = useCallback(() => {
    setBufferedSpecText(localGeneratedSpecText ?? '');
    setEditorMode('edit');
    setSaveStatus('clean');
    setSaveError(null);
    setShowPreviousVersion(false);
  }, [localGeneratedSpecText]);

  const handleRegenerateClick = useCallback(() => {
    if (!onRegenerate) return;
    onRegenerate({ overwriteManuallyEdited: false });
  }, [onRegenerate]);

  const saveButtonLabel =
    saveStatus === 'saving' ? 'Saving\u2026'
      : saveStatus === 'saved' ? 'Saved'
        : 'Save';
  const saveStatusBadgeClass =
    saveStatus === 'saving' ? styles.editorSaveStatusSaving
      : saveStatus === 'saved' ? styles.editorSaveStatusSaved
        : saveStatus === 'dirty' ? styles.editorSaveStatusDirty
          : styles.editorSaveStatus;

  const hasPreviousVersion =
    localPreviousSpecText != null && localPreviousSpecText.length > 0;

  const previousVersionDiff = useMemo(() => {
    if (!showPreviousVersion || !hasPreviousVersion) return [];
    return computeLineDiff(
      localPreviousSpecText ?? '',
      localGeneratedSpecText ?? '',
    );
  }, [
    showPreviousVersion,
    hasPreviousVersion,
    localPreviousSpecText,
    localGeneratedSpecText,
  ]);

  return (
    <div
      className={styles.drawerBackdrop}
      data-testid="mdd-story-drawer-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        className={styles.drawer}
        data-testid="mdd-story-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mdd-story-drawer-title"
      >
        <header className={styles.drawerHeader}>
          <h2
            id="mdd-story-drawer-title"
            className={styles.drawerTitle}
            data-testid="mdd-story-drawer-title"
          >
            {story.title}
          </h2>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
            data-testid="mdd-story-drawer-header-actions"
          >
            {localManuallyEdited === true && (
              <span
                className={styles.editedIndicator}
                data-testid="mdd-story-drawer-edited-indicator"
                title={
                  'Last edited by ' +
                  (localLastManuallyEditedBy ?? 'unknown') +
                  ' on ' +
                  (localLastManuallyEditedAt ?? 'unknown date')
                }
              >
                Edited
              </span>
            )}
            {localGeneratedSpecText != null && (
              <button
                type="button"
                className={styles.dialogSecondaryButton}
                data-testid="mdd-story-drawer-mode-toggle"
                onClick={() => {
                  if (editorMode === 'view') handleEnterEditMode();
                  else handleDiscardClick();
                }}
              >
                {editorMode === 'view' ? 'Edit' : 'View'}
              </button>
            )}
            {onRegenerate && (
              <button
                type="button"
                className={styles.dialogSecondaryButton}
                data-testid="mdd-story-drawer-regenerate"
                onClick={handleRegenerateClick}
              >
                Regenerate
              </button>
            )}
            <button
              type="button"
              className={styles.drawerCloseButton}
              data-testid="mdd-story-drawer-close"
              onClick={onClose}
              aria-label="Close story drawer"
            >
              X
            </button>
          </div>
        </header>

        <div className={styles.drawerBody} data-testid="mdd-story-drawer-body">
          {/* Story metadata: type, workstream */}
          <section className={styles.drawerSection}>
            <p
              className={styles.drawerSubtle}
              data-testid="mdd-story-drawer-type"
            >
              {story.type.toUpperCase()}
              {story.workstream ? ` -- ${story.workstream}` : ''}
            </p>
          </section>

          {/* Parent path: initiative > epic > feature */}
          {parentPath && parentPath.length > 0 && (
            <section className={styles.drawerSection}>
              <h3 className={styles.drawerSectionTitle}>Parent path</h3>
              <p
                className={styles.drawerParagraph}
                data-testid="mdd-story-drawer-parent-path"
              >
                {parentPath.join(' > ')}
              </p>
            </section>
          )}

          {/* Status row */}
          <section className={styles.drawerSection}>
            <h3 className={styles.drawerSectionTitle}>Delivery status</h3>
            <p
              className={styles.drawerParagraph}
              data-testid="mdd-story-drawer-backlog-status"
            >
              <strong>Backlog: </strong>
              {story.backlogStatus}
            </p>
            <p
              className={styles.drawerParagraph}
              data-testid="mdd-story-drawer-spec-status"
            >
              <strong>Spec generation: </strong>
              {story.specGenerationStatus ?? 'not_attempted'}
              {story.specGenerationConfidence
                ? ` (${story.specGenerationConfidence} confidence)`
                : ''}
            </p>
            {/* Pass-2 chips (cross-story context injection 2026-05-20). */}
            {isPassTwo && (
              <div
                className={styles.drawerChipRow}
                data-testid="mdd-story-drawer-pass-chip-row"
              >
                <span
                  className={`${styles.badge} ${styles.badgePassTwo}`}
                  data-testid="mdd-story-drawer-pass-2-badge"
                >
                  Pass 2
                </span>
                {isNoMeaningfulChange && (
                  <span
                    className={`${styles.badge} ${styles.badgeNoMeaningfulChange}`}
                    data-testid="mdd-story-drawer-no-meaningful-change-badge"
                  >
                    Pass 2: no meaningful change
                  </span>
                )}
              </div>
            )}
            <p
              className={styles.drawerParagraph}
              data-testid="mdd-story-drawer-impl-status"
            >
              <strong>Implementation: </strong>
              {story.implementationStatus ?? 'not_started'}
            </p>
            <p
              className={styles.drawerParagraph}
              data-testid="mdd-story-drawer-evidence-status"
            >
              <strong>Evidence: </strong>
              {story.evidenceStatus}
            </p>
          </section>

          {/* WorkItem id (handy for cross-surface debugging) */}
          {story.workItemId && (
            <section className={styles.drawerSection}>
              <p
                className={styles.drawerSubtle}
                data-testid="mdd-story-drawer-work-item-id"
              >
                WorkItem id: {story.workItemId}
              </p>
            </section>
          )}

          {/* Quality breakdown (Spec Quality Scoring 2026-05-20, Task Group 7).
              Renders only when the spec-generation row carries a non-null
              qualityScore. Insufficient-context / failed rows store nulls
              server-side per spec.md so the section is absent (not empty). */}
          {showQualityBreakdown && (
            <section
              className={styles.drawerSection}
              data-testid="mdd-story-drawer-quality-breakdown"
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <h3
                  className={styles.drawerSectionTitle}
                  data-testid="mdd-story-drawer-quality-breakdown-title"
                >
                  Quality breakdown
                </h3>
                <button
                  type="button"
                  className={styles.headerNavLink}
                  data-testid="mdd-story-drawer-quality-recompute"
                  onClick={() => void handleRecomputeQuality()}
                  disabled={recomputeDisabled}
                  title="Recompute quality score"
                  aria-label="Recompute quality score"
                >
                  {recomputing ? 'Recomputing\u2026' : 'Recompute'}
                </button>
              </div>
              <p
                className={styles.drawerParagraph}
                data-testid="mdd-story-drawer-quality-composite"
              >
                <strong>Score: </strong>
                <span
                  className={`${styles.badge} ${qualityGradeBadgeClass(qualityGrade)}`}
                  data-testid="mdd-story-drawer-quality-grade-badge"
                  data-grade={qualityGrade ?? 'na'}
                >
                  {qualityGrade ?? '--'}
                </span>
                {' '}
                <span data-testid="mdd-story-drawer-quality-score-value">
                  {qualityScore}/100
                </span>
                {showDeltaChip && (
                  <span
                    className={`${styles.badge} ${qualityGradeBadgeClass(qualityGrade)}`}
                    data-testid="mdd-story-drawer-quality-delta"
                    style={{ marginLeft: 8 }}
                    title={`Grade letter changed from ${previousGradeLetter} to ${qualityGrade}`}
                  >
                    {previousGradeLetter} {'->'} {qualityGrade}
                  </span>
                )}
              </p>
              {recomputeError && (
                <p
                  className={`${styles.drawerParagraph} ${styles.drawerSubtle}`}
                  role="alert"
                  data-testid="mdd-story-drawer-quality-recompute-error"
                >
                  Recompute failed: {recomputeError}
                </p>
              )}
              <div data-testid="mdd-story-drawer-quality-dimensions">
                {(qualityDimensions ?? []).map((dim, idx) => (
                  <div
                    key={`${dim.name}-${idx}`}
                    className={styles.drawerParagraph}
                    data-testid={`mdd-story-drawer-quality-dimension-${idx}`}
                    style={{
                      display: 'flex',
                      gap: 8,
                      alignItems: 'baseline',
                    }}
                  >
                    <span
                      style={{ minWidth: 120, fontWeight: 600 }}
                      data-testid={`mdd-story-drawer-quality-dimension-${idx}-name`}
                    >
                      {dim.name}
                    </span>
                    <span
                      className={styles.badge}
                      data-testid={`mdd-story-drawer-quality-dimension-${idx}-score`}
                    >
                      {dim.score}
                    </span>
                    <span
                      className={styles.drawerSubtle}
                      data-testid={`mdd-story-drawer-quality-dimension-${idx}-reason`}
                    >
                      {dim.reason}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Needs-attention reason */}
          {needsAttentionItem && needsAttentionItem.reason && (
            <section className={styles.drawerSection}>
              <h3 className={styles.drawerSectionTitle}>Needs attention</h3>
              <p
                className={styles.drawerParagraph}
                data-testid="mdd-story-drawer-needs-attention-reason"
              >
                {needsAttentionItem.reason}
              </p>
            </section>
          )}

          {/* Resolver panel (Group 6) -- replaces the legacy read-only
              Missing-inputs subsection when full context is supplied. */}
          {resolverPanelActive && (
            <MigrationDeliveryStoryDrawerResolverPanel
              projectId={projectId!}
              bookOfWorkId={bookOfWorkId!}
              architectureId={architectureId!}
              workItemId={story.workItemId!}
              recommendedNextAction={
                specGeneration?.recommendedNextAction ?? null
              }
              rows={resolverRows!}
              missingInputs={missingInputs}
              resolvedBy={resolvedBy}
              onOpenTargetArchitecture={onOpenTargetArchitecture}
              onResolutionPersisted={onResolutionPersisted}
              onRetryComplete={onRetryComplete}
              onRetryRequiresConfirmation={onRetryRequiresConfirmation}
            />
          )}

          {/* Legacy read-only Missing inputs subsection (Addition C). Renders
              only when the resolver panel is NOT active, so existing callers
              that have not yet adopted the resolver-row shape keep working. */}
          {!resolverPanelActive && isInsufficient && missingInputs.length > 0 && (
            <section className={styles.drawerSection}>
              <h3
                className={styles.drawerSectionTitle}
                data-testid="mdd-story-drawer-missing-inputs-title"
              >
                Missing inputs ({missingInputsCount})
              </h3>
              <div data-testid="mdd-story-drawer-missing-inputs">
                {groupedMissing.map((group) => (
                  <div
                    key={group.kind}
                    className={styles.drawerMissingGroup}
                    data-testid={`mdd-story-drawer-missing-inputs-group-${group.kind}`}
                  >
                    <h4
                      className={styles.drawerMissingGroupTitle}
                      data-testid={`mdd-story-drawer-missing-inputs-group-${group.kind}-title`}
                    >
                      {labelForKind(group.kind)} ({group.entries.length})
                    </h4>
                    {group.entries.map((entry, idx) => (
                      <div
                        key={idx}
                        className={styles.drawerMissingEntry}
                        data-testid={`mdd-story-drawer-missing-inputs-group-${group.kind}-entry-${idx}`}
                      >
                        <span
                          className={styles.drawerMissingEntryId}
                          data-testid={`mdd-story-drawer-missing-inputs-group-${group.kind}-entry-${idx}-id`}
                        >
                          {entry.id ?? '-'}
                        </span>
                        <span
                          className={styles.drawerMissingEntryReason}
                          data-testid={`mdd-story-drawer-missing-inputs-group-${group.kind}-entry-${idx}-reason`}
                        >
                          {entry.reason}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ----- Pass-2 "what changed and why" + inline diff ------------- */}
          {isPassTwo && (
            <section
              className={styles.drawerSection}
              data-testid="mdd-story-drawer-pass-2-section"
            >
              <h3 className={styles.drawerSectionTitle}>
                What changed and why
              </h3>
              {specGeneration?.pass2ChangesSummary ? (
                <p
                  className={styles.drawerParagraph}
                  data-testid="mdd-story-drawer-pass-2-changes-summary"
                >
                  {specGeneration.pass2ChangesSummary}
                </p>
              ) : (
                <p
                  className={`${styles.drawerParagraph} ${styles.drawerSubtle}`}
                  data-testid="mdd-story-drawer-pass-2-changes-summary-empty"
                >
                  No "what changed and why" summary was produced.
                </p>
              )}
              <h4
                className={styles.drawerSectionTitle}
                data-testid="mdd-story-drawer-diff-title"
              >
                Pass 1 vs current
              </h4>
              <MigrationDeliveryInlineDiff
                pass1Text={specGeneration?.pass1SpecText ?? null}
                pass2Text={specGeneration?.generatedSpecText ?? null}
                testId="mdd-story-drawer-inline-diff"
              />
            </section>
          )}

          {/* ----- Cross-story warnings panel ------------------------------ */}
          {(contradictionWarnings.length > 0 ||
            alignedWithEpicWarnings.length > 0) && (
            <section
              className={styles.drawerSection}
              data-testid="mdd-story-drawer-warnings-panel"
            >
              <h3 className={styles.drawerSectionTitle}>Cross-story signals</h3>
              {contradictionWarnings.length > 0 && (
                <div data-testid="mdd-story-drawer-contradiction-warnings">
                  {contradictionWarnings.map((w, idx) => (
                    <div
                      key={`contradiction-${idx}`}
                      className={styles.drawerWarningRow}
                      data-testid={`mdd-story-drawer-contradiction-warning-${idx}`}
                    >
                      <span
                        className={`${styles.badge} ${styles.badgeContradiction}`}
                      >
                        Contradicts sibling
                      </span>
                      <span
                        className={styles.drawerWarningText}
                        data-testid={`mdd-story-drawer-contradiction-warning-${idx}-sibling-id`}
                      >
                        Sibling work-item: {w.siblingWorkItemId}
                        {w.conflictingDecisionKey
                          ? ` (decision key: ${w.conflictingDecisionKey})`
                          : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {alignedWithEpicWarnings.length > 0 && (
                <div data-testid="mdd-story-drawer-aligned-with-epic-warnings">
                  {alignedWithEpicWarnings.map((w, idx) => (
                    <div
                      key={`aligned-${idx}`}
                      className={styles.drawerWarningRow}
                      data-testid={`mdd-story-drawer-aligned-warning-${idx}`}
                    >
                      <span
                        className={`${styles.badge} ${styles.badgeAlignedWithEpic}`}
                      >
                        Aligned with epic decision
                      </span>
                      <span className={styles.drawerWarningText}>
                        {w.decisionKey ?? 'Matches a confirmed epic decision'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* ----- Budget warning inline placeholder ---------------------- */}
          {hasBudgetWarning && (
            <section
              className={styles.drawerSection}
              data-testid="mdd-story-drawer-budget-warning-section"
            >
              <div
                className={styles.placeholder}
                role="status"
                data-testid="mdd-story-drawer-budget-warning"
              >
                <span className={styles.placeholderText}>
                  Cross-story context budget hit limits:
                </span>
                {budgetSignal.siblingSpecsDropped > 0 && (
                  <span
                    className={styles.placeholderText}
                    data-testid="mdd-story-drawer-budget-warning-sibling-specs"
                  >
                    {` Trimmed ${budgetSignal.siblingSpecsDropped} sibling spec(s).`}
                  </span>
                )}
                {budgetSignal.evidenceRefsDropped > 0 && (
                  <span
                    className={styles.placeholderText}
                    data-testid="mdd-story-drawer-budget-warning-evidence-refs"
                  >
                    {` Trimmed ${budgetSignal.evidenceRefsDropped} evidence ref(s).`}
                  </span>
                )}
                {budgetSignal.findingsDropped > 0 && (
                  <span
                    className={styles.placeholderText}
                    data-testid="mdd-story-drawer-budget-warning-findings"
                  >
                    {` Trimmed ${budgetSignal.findingsDropped} discovery finding(s).`}
                  </span>
                )}
                {budgetSignal.noSiblingContextAvailable && (
                  <span
                    className={styles.placeholderText}
                    data-testid="mdd-story-drawer-budget-warning-no-sibling-context"
                  >
                    {' no_sibling_context_available -- budget could not fit any sibling summary.'}
                  </span>
                )}
              </div>
            </section>
          )}

          {/* In-Product Spec Editor (2026-05-20, Task Group 7) -- inline spec
              text + editor + diff section. */}
          {localGeneratedSpecText != null && (
            <section
              className={styles.drawerSection}
              data-testid="mdd-story-drawer-spec-text-section"
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <h3 className={styles.drawerSectionTitle}>Generated spec</h3>
                {editorMode === 'edit' ? (
                  <span
                    className={saveStatusBadgeClass}
                    data-testid="mdd-story-drawer-save-status"
                    data-status={saveStatus}
                  >
                    {saveButtonLabel}
                  </span>
                ) : hasPreviousVersion ? (
                  <button
                    type="button"
                    className={styles.diffToggleButton}
                    data-testid="mdd-story-drawer-previous-version-toggle"
                    onClick={() => setShowPreviousVersion((v) => !v)}
                  >
                    {showPreviousVersion
                      ? 'Hide previous version'
                      : 'View previous version'}
                  </button>
                ) : null}
              </div>
              {editorMode === 'edit' ? (
                <>
                  <SpecMarkdownEditor
                    ref={editorRef}
                    initialValue={bufferedSpecText}
                    onSave={handleEditorSave}
                    onDirtyChange={handleEditorDirtyChange}
                    testId="mdd-story-drawer-spec-editor"
                  />
                  {saveError && (
                    <div
                      className={styles.editorErrorBanner}
                      role="alert"
                      data-testid="mdd-story-drawer-save-error"
                    >
                      Save failed: {saveError}
                    </div>
                  )}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'flex-end',
                      gap: 8,
                      marginTop: 8,
                    }}
                    data-testid="mdd-story-drawer-editor-footer"
                  >
                    <button
                      type="button"
                      className={styles.dialogSecondaryButton}
                      data-testid="mdd-story-drawer-discard-button"
                      onClick={handleDiscardClick}
                    >
                      Discard
                    </button>
                    <button
                      type="button"
                      className={styles.dialogPrimaryButton}
                      data-testid="mdd-story-drawer-save-button"
                      onClick={handleSaveClick}
                      disabled={saveStatus === 'saving'}
                    >
                      {saveButtonLabel}
                    </button>
                  </div>
                </>
              ) : showPreviousVersion && hasPreviousVersion ? (
                <div
                  className={styles.inlineDiffContainer}
                  data-testid="mdd-story-drawer-previous-version-diff"
                >
                  {previousVersionDiff.map((line, idx) => {
                    const lineClass =
                      line.type === 'added'
                        ? styles.inlineDiffLineAdded
                        : line.type === 'removed'
                          ? styles.inlineDiffLineRemoved
                          : styles.inlineDiffLineEqual;
                    const prefix =
                      line.type === 'added'
                        ? '+ '
                        : line.type === 'removed'
                          ? '- '
                          : '  ';
                    return (
                      <div
                        key={idx}
                        className={lineClass}
                        data-testid={`mdd-story-drawer-previous-version-diff-line-${idx}`}
                        data-op={line.type}
                      >
                        <span
                          className={styles.inlineDiffLinePrefix}
                          aria-hidden="true"
                        >
                          {prefix}
                        </span>
                        <span className={styles.inlineDiffLineText}>
                          {line.text === '' ? '\u00a0' : line.text}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <pre
                  className={styles.drawerSpecPre}
                  data-testid="mdd-story-drawer-spec-text"
                >
                  {localGeneratedSpecText}
                </pre>
              )}
            </section>
          )}

          {/* Generated spec link (only when a spec has actually been generated) */}
          {(story.specGenerationStatus === 'generated' ||
            story.specGenerationStatus === 'generated_with_warnings') &&
            generatedSpecHref && (
              <section className={styles.drawerSection}>
                <a
                  href={generatedSpecHref}
                  data-testid="mdd-story-drawer-generated-spec-link"
                >
                  Open generated spec
                </a>
              </section>
            )}

          {/* Implementation workspace link (only when artifacts are present) */}
          {story.implementationStatus === 'artifacts_present' &&
            implementWorkspaceHref && (
              <section className={styles.drawerSection}>
                <a
                  href={implementWorkspaceHref}
                  data-testid="mdd-story-drawer-implement-link"
                >
                  Open implementation workspace
                </a>
              </section>
            )}

          {/* WorkItem link */}
          {workItemHref && (
            <section className={styles.drawerSection}>
              <a href={workItemHref} data-testid="mdd-story-drawer-work-item-link">
                Open WorkItem
              </a>
            </section>
          )}
        </div>
      </aside>
    </div>
  );
};

export default MigrationDeliveryStoryDrawer;
