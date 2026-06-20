/**
 * CaptureReviewPanel Component
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 9
 *
 * Reviewer-facing panel rendered inside `CaptureSessionDetailView` once a
 * capture session reaches `running`, `completed`, or `failed` status. Lists
 * every captured row grouped by operation -> scenario -> captures and
 * exposes the four review-time actions per spec:
 *   - accept (PATCH `accepted=true, accepted_at=NOW()`)
 *   - reject + reviewer notes (PATCH `accepted=false` + structured notes)
 *   - rename scenario (PATCH the parent `scenarios.scenario_name`)
 *   - mask response field(s) (PATCH the structured `reviewer_notes` payload)
 *
 * Spec contract enforced here:
 *   - NO `/rerun` affordance ANYWHERE. Not even a disabled placeholder.
 *     The "rerun scenario" UI was explicitly cut in v1 -- captures that
 *     fail are evidence for the reviewer to accept-with-notes, reject, or
 *     ignore until the next full run.
 *   - Masks are applied at render time only. The original redacted JSON on
 *     the capture row is never mutated -- the mask metadata lives in
 *     `reviewer_notes` and the renderer walks the tree replacing matched
 *     paths with a placeholder.
 *   - Only operations actually present in the captured rows are surfaced;
 *     operations with no captures (e.g. excluded mutating ops) don't appear
 *     in this panel at all -- they live in the wizard step 4 table during
 *     setup.
 *
 * The "Save as Baseline" CTA appears once the panel detects at least one
 * `accepted=true` capture. Opening it mounts the sibling
 * `SaveAsBaselineModal` which owns the baseline + items POST flow.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ApiBehaviourCaptureDto,
  ApiBehaviourDiagnosticDto,
  ApiBehaviourOperationDto,
  ApiBehaviourScenarioDto,
  FieldMask,
  ReviewerNotesPayload,
  listCaptures,
  listDiagnostics,
  listOperations,
  listScenarios,
  parseReviewerNotes,
  serialiseReviewerNotes,
  updateCapture,
  updateCapturesBatch,
  updateScenario,
  type BatchUpdateCaptureItem,
  type BatchUpdateCaptureFailure,
} from '../../api/apiBehaviourClient';
import styles from './CaptureReviewPanel.module.css';
import { SaveAsBaselineModal } from './SaveAsBaselineModal';
import { AddNewBehaviourModal } from './AddNewBehaviourModal';
import {
  MigrationDiscoveryContext,
  fetchMigrationDiscoveryContext,
} from '../../api/migrationDiscoveryContextApi';

// ============================================================================
// Props
// ============================================================================

export interface CaptureReviewPanelProps {
  projectId: string;
  architectureId: string;
  sessionId: string;
  /**
   * When `true` the panel renders the data in read-only mode -- still showing
   * all captures, but suppressing the action buttons. The detail view passes
   * `true` while the session is still `running` so users can watch progress
   * without acting on rows that may yet be retried by the loop.
   */
  readOnly?: boolean;
  /**
   * Raw `coverage_summary_json` off the capture session (snake_case JSONB
   * wire), threaded down from `CaptureSessionDetailView` so the
   * Save-as-Baseline modal can surface oracle coverage (display-only).
   * Null / absent renders as 'coverage not recorded'. Spec: 2026-06-17
   * Oracle Coverage Scoring -- Task 3.4.
   */
  coverageSummaryJson?: Record<string, unknown> | null;
  /**
   * Session `mutating_calls_confirmed` posture, threaded from
   * `CaptureSessionDetailView`. Passed into the Add-New-Behaviour modal so a
   * mutating manual send shows a STRONGER warning when the session never
   * confirmed mutating calls (the send is still permitted on explicit intent).
   * Spec: 2026-06-20 Add New Behaviour -- Manual Capture (Task Group 6).
   */
  mutatingCallsConfirmed?: boolean | null;
  /**
   * Whether the session's in-memory secret is loaded (parent-owned
   * `secretsLoadedLocal`). The Add-New-Behaviour modal needs it because a
   * manual send reuses that secret; when false the panel routes the reviewer
   * to the parent re-enter prompt via {@link onRequestReenterSecrets}.
   * Spec: 2026-06-20 Add New Behaviour -- Manual Capture (Task Group 6).
   */
  secretsLoaded?: boolean;
  /**
   * Ask the parent (`CaptureSessionDetailView`) to surface its EXISTING
   * re-enter-secrets prompt (testid `capture-session-detail-reenter-secrets-prompt`).
   * Invoked when the modal needs a secret that is not loaded -- the panel
   * never rebuilds secret entry.
   */
  onRequestReenterSecrets?: () => void;
}

// ============================================================================
// Internal helpers
// ============================================================================

interface GroupedCapture {
  operation: ApiBehaviourOperationDto;
  scenarios: Array<{
    scenario: ApiBehaviourScenarioDto;
    captures: ApiBehaviourCaptureDto[];
  }>;
}

function operationLabel(op: ApiBehaviourOperationDto): string {
  const method = (op.method ?? '').toUpperCase();
  const path = op.path ?? '(no path)';
  return method ? `${method} ${path}` : path;
}

function compareOperations(
  a: ApiBehaviourOperationDto,
  b: ApiBehaviourOperationDto,
): number {
  const ap = a.path ?? '';
  const bp = b.path ?? '';
  if (ap !== bp) return ap < bp ? -1 : 1;
  const am = (a.method ?? '').toUpperCase();
  const bm = (b.method ?? '').toUpperCase();
  if (am !== bm) return am < bm ? -1 : 1;
  return 0;
}

function compareScenarios(
  a: ApiBehaviourScenarioDto,
  b: ApiBehaviourScenarioDto,
): number {
  const an = a.scenario_name ?? '';
  const bn = b.scenario_name ?? '';
  if (an !== bn) return an < bn ? -1 : 1;
  return 0;
}

function compareCapturesByAttempt(
  a: ApiBehaviourCaptureDto,
  b: ApiBehaviourCaptureDto,
): number {
  const aa = a.attempt_number ?? 0;
  const ba = b.attempt_number ?? 0;
  return aa - ba;
}

/**
 * Group the flat capture / scenario / operation list into the
 * (operation -> scenario -> captures) tree the table renders from. Captures
 * that don't have matching scenarios or operations in the loaded lists are
 * dropped silently -- this can happen mid-run while the new service is still
 * inserting rows; the polling loop in `CaptureSessionDetailView` will refresh
 * the panel on the next tick.
 */
function group(
  operations: ApiBehaviourOperationDto[] = [],
  scenarios: ApiBehaviourScenarioDto[] = [],
  captures: ApiBehaviourCaptureDto[] = [],
): GroupedCapture[] {
  // Defensive: a list endpoint that returns an empty/204/non-array body
  // resolves to a non-array here; coerce so the .map/.for below never crash
  // (mirrors the source-side coercion in `refresh`).
  const ops = Array.isArray(operations) ? operations : [];
  const scens = Array.isArray(scenarios) ? scenarios : [];
  const caps = Array.isArray(captures) ? captures : [];
  const opById = new Map(ops.map((o) => [o.id, o]));
  const scenarioById = new Map(scens.map((s) => [s.id, s]));

  // Bucket captures by (operationId, scenarioId).
  const byOp = new Map<string, Map<string, ApiBehaviourCaptureDto[]>>();
  for (const cap of caps) {
    if (!opById.has(cap.operation_id)) continue;
    if (!scenarioById.has(cap.scenario_id)) continue;
    let scenarioMap = byOp.get(cap.operation_id);
    if (!scenarioMap) {
      scenarioMap = new Map();
      byOp.set(cap.operation_id, scenarioMap);
    }
    let captureList = scenarioMap.get(cap.scenario_id);
    if (!captureList) {
      captureList = [];
      scenarioMap.set(cap.scenario_id, captureList);
    }
    captureList.push(cap);
  }

  const grouped: GroupedCapture[] = [];
  for (const [opId, scenarioMap] of byOp.entries()) {
    const op = opById.get(opId);
    if (!op) continue;
    const scenarioEntries: GroupedCapture['scenarios'] = [];
    for (const [scenarioId, capList] of scenarioMap.entries()) {
      const scenario = scenarioById.get(scenarioId);
      if (!scenario) continue;
      capList.sort(compareCapturesByAttempt);
      scenarioEntries.push({ scenario, captures: capList });
    }
    scenarioEntries.sort((a, b) => compareScenarios(a.scenario, b.scenario));
    grouped.push({ operation: op, scenarios: scenarioEntries });
  }
  grouped.sort((a, b) => compareOperations(a.operation, b.operation));
  return grouped;
}

const MASK_PLACEHOLDER = '«masked»';

/**
 * Recursively rebuild a JSON value with paths listed in `maskPaths` replaced
 * by the placeholder string. Original input is never mutated.
 *
 * Path syntax: dotted segments for object keys, `[<index>]` for array
 * indices, e.g. `body.users[0].email`. The walker tracks the current path
 * as it descends and does an exact-string compare against the mask set.
 */
function applyMasks(
  value: unknown,
  maskPaths: Set<string>,
  currentPath: string,
): unknown {
  if (maskPaths.has(currentPath)) {
    return MASK_PLACEHOLDER;
  }
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((v, i) =>
      applyMasks(v, maskPaths, `${currentPath}[${i}]`),
    );
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const nextPath = currentPath ? `${currentPath}.${k}` : k;
      out[k] = applyMasks(v, maskPaths, nextPath);
    }
    return out;
  }
  return value;
}

function formatJsonWithMasks(
  body: Record<string, unknown> | null,
  masks: FieldMask[],
  rootKey: string,
): string {
  if (body === null) return '—';
  const maskSet = new Set(masks.map((m) => m.path));
  const masked = applyMasks(body, maskSet, rootKey) as Record<string, unknown>;
  try {
    return JSON.stringify(masked, null, 2);
  } catch {
    return String(masked);
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Unexpected error';
}

/**
 * Render a best-effort captures-batch `failed[]` as a single human-readable
 * warning line naming the captures that did NOT patch (by capture `id`). The
 * accepted/rejected rows still committed -- this is informational, not an
 * error. `verb` is the action that partially failed ("accept"/"reject").
 * Spec: 2026-06-20 R2 (do not silently drop `failed[]`).
 */
function describeCaptureBatchFailures(
  failed: BatchUpdateCaptureFailure[],
  verb: string,
): string {
  const labels = failed.map((f) => f.id);
  const noun = failed.length === 1 ? 'capture' : 'captures';
  return (
    `${failed.length} ${noun} could not be ${verb}ed and ${
      failed.length === 1 ? 'was' : 'were'
    } skipped ` +
    `(the rest were ${verb}ed): ${labels.join(', ')}.`
  );
}

/**
 * System reason marker the capture-session orchestrator writes to a
 * non-canonical capture's `reviewer_notes` when it reject-and-hides the LLM's
 * intermediate fumbles (intent-driven canonical capture, validation-service
 * `captureSessionOrchestrator.ts` -> `NON_CANONICAL_REVIEWER_NOTE`). It is a
 * BARE string, distinct from the structured `{ text, masks }` reviewer-notes
 * JSON a human reject writes via this panel.
 *
 * Spec: 2026-06-17 Intent-Driven Canonical Capture.
 */
const NON_CANONICAL_REVIEWER_NOTE = 'superseded_non_canonical';

/**
 * True when a capture is an auto-rejected non-canonical fumble: `accepted` is
 * explicitly `false` AND `reviewer_notes` is exactly the system marker. A
 * human reject (which carries free-text / structured `{ text, masks }` notes,
 * or none) is NOT a fumble and stays visible. `accepted === false` alone is
 * deliberately NOT sufficient -- that is also a human reject.
 *
 * Spec: 2026-06-17 Intent-Driven Canonical Capture.
 */
function isAutoRejectedFumble(cap: ApiBehaviourCaptureDto): boolean {
  return (
    cap.accepted === false &&
    (cap.reviewer_notes ?? '').trim() === NON_CANONICAL_REVIEWER_NOTE
  );
}

// ============================================================================
// Component
// ============================================================================

export const CaptureReviewPanel: React.FC<CaptureReviewPanelProps> = ({
  projectId,
  architectureId,
  sessionId,
  readOnly = false,
  coverageSummaryJson,
  mutatingCallsConfirmed = null,
  secretsLoaded = false,
  onRequestReenterSecrets,
}) => {
  const [operations, setOperations] = useState<ApiBehaviourOperationDto[]>([]);
  const [scenarios, setScenarios] = useState<ApiBehaviourScenarioDto[]>([]);
  const [captures, setCaptures] = useState<ApiBehaviourCaptureDto[]>([]);
  // Session diagnostics. Carries the `sequence_pinned` marker rows the
  // capture orchestrator writes for stateful sequence scenarios; passed to
  // the Save-as-baseline modal so the assembled `sequence_json` is carried
  // onto the canonical ACT-step baseline item (Spec D, Task Group 4).
  const [diagnostics, setDiagnostics] = useState<ApiBehaviourDiagnosticDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Expanded capture rows -- inline scenario detail with redacted bodies.
  const [expandedCaptureIds, setExpandedCaptureIds] = useState<Set<string>>(
    () => new Set(),
  );

  // Per-row in-flight tracking so we can disable mid-PATCH.
  const [actionInFlight, setActionInFlight] = useState<string | null>(null);

  // Reject + notes form state -- captureId -> pending notes string.
  const [rejectNotesDraft, setRejectNotesDraft] = useState<Record<string, string>>({});
  const [openRejectFormFor, setOpenRejectFormFor] = useState<string | null>(null);

  // Mask form state -- captureId -> pending path/label inputs.
  const [maskPathDraft, setMaskPathDraft] = useState<Record<string, string>>({});
  const [maskLabelDraft, setMaskLabelDraft] = useState<Record<string, string>>({});
  const [openMaskFormFor, setOpenMaskFormFor] = useState<string | null>(null);

  // Rename scenario state -- scenarioId -> pending name string.
  const [renameDraft, setRenameDraft] = useState<Record<string, string>>({});
  const [openRenameFormFor, setOpenRenameFormFor] = useState<string | null>(null);

  // Save-as-baseline modal visibility.
  const [saveModalOpen, setSaveModalOpen] = useState(false);

  // Best-effort batch warning (Spec 2026-06-20 R2/R4). Accept All / Reject All
  // now collapse to a SINGLE `updateCapturesBatch` call; a non-atomic batch can
  // return `failed[]` (rows that did not patch) while the rest committed. Surface
  // that here as a non-fatal warning naming the failed captures rather than
  // silently dropping them. "Accept and Save All" also parks its accept-step
  // `failed[]` here so the warning persists while the save modal completes --
  // the combined (accept + save) failure view R4 requires.
  const [warning, setWarning] = useState<string | null>(null);

  // Add-New-Behaviour (manual capture) modal visibility. Spec 2026-06-20.
  const [addBehaviourModalOpen, setAddBehaviourModalOpen] = useState(false);

  // ---- Discovery context (Spec 2026-05-16 Task Group 4) ---------------
  // The capture review panel fetches the migration discovery context once on
  // mount so it can surface discovery-supported annotations alongside each
  // scenario. The AMS aggregation DTO surfaces:
  //   - `findingsSummary.countsByCategory` (presence of `runtime_usage`,
  //     `missing_contract_detail`, `business_logic`, etc. at session level)
  //   - `unresolvedDecisionTasks[]`
  //   - `runtimeUsageSummary` / `databaseDiscoverySummary`
  // It does NOT surface finding -> endpoint method/path links, so we cannot
  // JOIN per-row at this layer. The annotations are rendered at session
  // level (top-of-panel banner) plus a per-scenario `db_sample` badge that
  // reads off `scenario.generation_source`, and a per-row sentinel when the
  // session itself has zero findings.
  const [discoveryCtx, setDiscoveryCtx] = useState<MigrationDiscoveryContext | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMigrationDiscoveryContext(projectId, {
      currentArchitectureId: architectureId,
      includeFindings: true,
    })
      .then((ctx) => {
        if (!cancelled) setDiscoveryCtx(ctx);
      })
      .catch(() => {
        // Fail-soft: leave discoveryCtx null; the panel falls back to the
        // existing UI with no discovery-supported annotations.
        if (!cancelled) setDiscoveryCtx(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, architectureId]);

  const discoveryCategoryCounts = discoveryCtx?.findingsSummary?.countsByCategory ?? {};
  const hasRuntimeUsageFindings =
    (discoveryCtx?.runtimeUsageSummary?.runtimeFindingCount ?? 0) > 0 ||
    (discoveryCategoryCounts.runtime_usage ?? 0) > 0;
  const hasMissingContractDetail =
    (discoveryCategoryCounts.missing_contract_detail ?? 0) > 0;
  const unresolvedDecisionTaskCount =
    (discoveryCtx?.unresolvedDecisionTasks ?? []).length;
  const hasDbSampleHints =
    (discoveryCtx?.databaseDiscoverySummary?.sampleDataHintCount ?? 0) > 0 ||
    (discoveryCtx?.findingsSummary?.sampleDataHintCount ?? 0) > 0;
  const totalFindings = discoveryCtx?.findingsSummary?.totalFindings ?? 0;
  const sessionHasNoDiscoveryEvidence = discoveryCtx !== null && totalFindings === 0;

  // ---- Initial load ----------------------------------------------------
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [ops, scens, caps, diags] = await Promise.all([
        listOperations(projectId, architectureId, sessionId),
        listScenarios(projectId, architectureId, sessionId),
        listCaptures(projectId, architectureId, sessionId),
        // Best-effort: diagnostics carry the sequence_pinned markers. A
        // failure here must NOT fail the whole review load, so swallow it
        // to an empty list (the single-shot path renders unchanged).
        listDiagnostics(projectId, architectureId, sessionId).catch(() => []),
      ]);
      // Coerce defensively: the list endpoints are typed `[]` but a 204 /
      // empty / non-array body resolves to undefined; never put a non-array
      // into state or the `group()` / `.filter` consumers crash.
      setOperations(Array.isArray(ops) ? ops : []);
      setScenarios(Array.isArray(scens) ? scens : []);
      setCaptures(Array.isArray(caps) ? caps : []);
      setDiagnostics(Array.isArray(diags) ? diags : []);
      setError(null);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, [projectId, architectureId, sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // ---- Derived state ---------------------------------------------------
  // Intent-driven canonical capture: the orchestrator persists EVERY HTTP
  // attempt (the canonical capture PLUS the LLM's intermediate fumbles) but
  // reject-and-hides the fumbles with a system reason marker. Filter those out
  // here so the review surface shows only the canonical + genuinely-reviewable
  // captures; human-rejected captures (no system marker) stay visible. The
  // grouping, the tally, the save-modal, and the panel header count all read
  // off `visibleCaptures`, never the raw `captures` array.
  const visibleCaptures = useMemo(
    () => captures.filter((c) => !isAutoRejectedFumble(c)),
    [captures],
  );

  const grouped = useMemo(
    () => group(operations, scenarios, visibleCaptures),
    [operations, scenarios, visibleCaptures],
  );

  const acceptedCount = useMemo(
    () => visibleCaptures.filter((c) => c.accepted === true).length,
    [visibleCaptures],
  );

  const operationsWithoutAccepted = useMemo(() => {
    const accepted = new Set(
      visibleCaptures.filter((c) => c.accepted === true).map((c) => c.operation_id),
    );
    return operations.filter((o) => !accepted.has(o.id));
  }, [operations, visibleCaptures]);
  // Union of redacted request-header KEYS across ALL the session's 2xx captures
  // (regardless of accept/reject), used to prefill the Add-New-Behaviour modal's
  // header editor. Reads the RAW `captures` array (not `visibleCaptures`) so
  // auto-rejected intermediate fumbles still contribute their header keys. Auth
  // headers are already redacted out upstream so they never appear here.
  // Spec: 2026-06-20 Add New Behaviour -- Manual Capture (Task Group 6).
  const manualHeaderKeyUnion = useMemo(() => {
    const keys = new Set<string>();
    for (const cap of captures) {
      const status = cap.response_status ?? 0;
      if (status < 200 || status >= 300) continue;
      const hdrs = cap.request_headers_redacted_json;
      if (hdrs && typeof hdrs === 'object') {
        for (const k of Object.keys(hdrs)) keys.add(k);
      }
    }
    return Array.from(keys).sort();
  }, [captures]);

  // ---- Mutators --------------------------------------------------------

  const handleAccept = useCallback(
    async (capture: ApiBehaviourCaptureDto) => {
      setActionInFlight(`accept:${capture.id}`);
      try {
        const updated = await updateCapture(projectId, architectureId, capture.id, {
          accepted: true,
          accepted_at: new Date().toISOString(),
        });
        setCaptures((prev) =>
          prev.map((c) => (c.id === capture.id ? updated : c)),
        );
      } catch (err) {
        setError(describeError(err));
      } finally {
        setActionInFlight(null);
      }
    },
    [projectId, architectureId],
  );

  const handleRejectSubmit = useCallback(
    async (capture: ApiBehaviourCaptureDto) => {
      const notes = rejectNotesDraft[capture.id] ?? '';
      setActionInFlight(`reject:${capture.id}`);
      try {
        const existing = parseReviewerNotes(capture.reviewer_notes);
        const payload: ReviewerNotesPayload = {
          text: notes,
          masks: existing.masks,
        };
        const updated = await updateCapture(projectId, architectureId, capture.id, {
          accepted: false,
          accepted_at: null,
          reviewer_notes: serialiseReviewerNotes(payload),
        });
        setCaptures((prev) =>
          prev.map((c) => (c.id === capture.id ? updated : c)),
        );
        setOpenRejectFormFor(null);
        setRejectNotesDraft((prev) => {
          const next = { ...prev };
          delete next[capture.id];
          return next;
        });
      } catch (err) {
        setError(describeError(err));
      } finally {
        setActionInFlight(null);
      }
    },
    [projectId, architectureId, rejectNotesDraft],
  );

  // ---- Bulk mutators ---------------------------------------------------
  // Bulk accept/reject now collapse to a SINGLE best-effort `updateCapturesBatch`
  // call over the *visible* captures (Spec 2026-06-20 R2) -- replacing the former
  // per-row PATCH loop that fired one gateway request per capture (~263 PATCHes
  // for a large session) and tripped the rate limiter. The batch is NON-atomic:
  // a bad item lands in `failed[]` while the rest commit. The returned
  // `updated[]` DTOs are merged back into local state the same way `handleAccept`
  // merges a single returned row (so the table + accepted tally update without a
  // full reload); `failed[]` is surfaced as a non-fatal warning naming the
  // captures that did not patch -- never silently dropped.

  // Merge a batch's returned `updated[]` rows back into local capture state by
  // id (rows not in the batch are left untouched). One setState for the whole
  // batch rather than one per row.
  const mergeUpdatedCaptures = useCallback(
    (updated: ApiBehaviourCaptureDto[]) => {
      if (updated.length === 0) return;
      const byId = new Map(updated.map((u) => [u.id, u]));
      setCaptures((prev) => prev.map((c) => byId.get(c.id) ?? c));
    },
    [],
  );

  // The accept-batch payload: every visible capture -> the SAME accept patch
  // (`accepted=true` + a single shared iso `accepted_at`). Shared by Accept All
  // and the combined Accept-and-Save-All action.
  const buildAcceptItems = useCallback((): BatchUpdateCaptureItem[] => {
    const acceptedAt = new Date().toISOString();
    return visibleCaptures.map((capture) => ({
      id: capture.id,
      patch: { accepted: true, accepted_at: acceptedAt },
    }));
  }, [visibleCaptures]);

  const handleAcceptAll = useCallback(async () => {
    if (visibleCaptures.length === 0) return;
    setActionInFlight('bulk');
    setWarning(null);
    try {
      const { updated, failed } = await updateCapturesBatch(
        projectId,
        architectureId,
        buildAcceptItems(),
      );
      mergeUpdatedCaptures(updated);
      if (failed.length > 0) {
        setWarning(describeCaptureBatchFailures(failed, 'accept'));
      }
    } catch (err) {
      setError(describeError(err));
    } finally {
      setActionInFlight(null);
    }
  }, [
    projectId,
    architectureId,
    visibleCaptures,
    buildAcceptItems,
    mergeUpdatedCaptures,
  ]);

  const handleRejectAll = useCallback(async () => {
    if (visibleCaptures.length === 0) return;
    const confirmed = window.confirm(
      `Reject all ${visibleCaptures.length} captures? This clears any acceptance and cannot be undone in bulk.`,
    );
    if (!confirmed) return;
    setActionInFlight('bulk');
    setWarning(null);
    try {
      // Each visible capture carries its OWN notes-preserving patch so the
      // reject preserves that row's existing reviewer-notes masks exactly as
      // the former per-row loop did (`{ accepted:false, accepted_at:null,
      // reviewer_notes:<masks-preserving payload> }`). Built into one batch.
      const items: BatchUpdateCaptureItem[] = visibleCaptures.map((capture) => {
        const existing = parseReviewerNotes(capture.reviewer_notes);
        const payload: ReviewerNotesPayload = {
          text: '',
          masks: existing.masks,
        };
        return {
          id: capture.id,
          patch: {
            accepted: false,
            accepted_at: null,
            reviewer_notes: serialiseReviewerNotes(payload),
          },
        };
      });
      const { updated, failed } = await updateCapturesBatch(
        projectId,
        architectureId,
        items,
      );
      mergeUpdatedCaptures(updated);
      if (failed.length > 0) {
        setWarning(describeCaptureBatchFailures(failed, 'reject'));
      }
    } catch (err) {
      setError(describeError(err));
    } finally {
      setActionInFlight(null);
    }
  }, [
    projectId,
    architectureId,
    visibleCaptures,
    mergeUpdatedCaptures,
  ]);

  // "Accept and Save All" (Spec 2026-06-20 R2/R4): run the accept batch, then
  // trigger the existing Save flow (open `SaveAsBaselineModal`, which owns the
  // best-effort save batch + post-save navigation to the list). On a PARTIAL
  // accept failure we PROCEED to the save step for the captures that DID accept
  // and PARK the accept `failed[]` in the panel-level warning so it stays
  // visible while the modal completes -- the modal independently surfaces its
  // own save `failed[]`, giving the reviewer the combined (accept + save)
  // failure view R4 requires. Only a hard accept-batch throw (network-level)
  // aborts before the save step.
  const handleAcceptAndSaveAll = useCallback(async () => {
    if (visibleCaptures.length === 0) return;
    setActionInFlight('bulk');
    setWarning(null);
    try {
      const { updated, failed } = await updateCapturesBatch(
        projectId,
        architectureId,
        buildAcceptItems(),
      );
      mergeUpdatedCaptures(updated);
      if (failed.length > 0) {
        // Proceed-on-partial: keep the accept failures visible (the modal adds
        // its own save failures) and still open the save flow for the accepted.
        setWarning(describeCaptureBatchFailures(failed, 'accept'));
      }
      setSaveModalOpen(true);
    } catch (err) {
      // A hard accept-batch failure (nothing accepted) aborts before save.
      setError(describeError(err));
    } finally {
      setActionInFlight(null);
    }
  }, [
    projectId,
    architectureId,
    visibleCaptures,
    buildAcceptItems,
    mergeUpdatedCaptures,
  ]);

  const handleMaskSubmit = useCallback(
    async (capture: ApiBehaviourCaptureDto) => {
      const path = (maskPathDraft[capture.id] ?? '').trim();
      const label = (maskLabelDraft[capture.id] ?? '').trim();
      if (!path) return;
      setActionInFlight(`mask:${capture.id}`);
      try {
        const existing = parseReviewerNotes(capture.reviewer_notes);
        // De-dupe by path -- a second add with the same path replaces the
        // label rather than stacking entries.
        const otherMasks = existing.masks.filter((m) => m.path !== path);
        const newMask: FieldMask = label ? { path, label } : { path };
        const payload: ReviewerNotesPayload = {
          text: existing.text,
          masks: [...otherMasks, newMask],
        };
        const updated = await updateCapture(projectId, architectureId, capture.id, {
          reviewer_notes: serialiseReviewerNotes(payload),
        });
        setCaptures((prev) =>
          prev.map((c) => (c.id === capture.id ? updated : c)),
        );
        setOpenMaskFormFor(null);
        setMaskPathDraft((prev) => {
          const next = { ...prev };
          delete next[capture.id];
          return next;
        });
        setMaskLabelDraft((prev) => {
          const next = { ...prev };
          delete next[capture.id];
          return next;
        });
      } catch (err) {
        setError(describeError(err));
      } finally {
        setActionInFlight(null);
      }
    },
    [projectId, architectureId, maskPathDraft, maskLabelDraft],
  );

  const handleRenameSubmit = useCallback(
    async (scenario: ApiBehaviourScenarioDto) => {
      const newName = (renameDraft[scenario.id] ?? '').trim();
      if (!newName || newName === scenario.scenario_name) {
        setOpenRenameFormFor(null);
        return;
      }
      setActionInFlight(`rename:${scenario.id}`);
      try {
        const updated = await updateScenario(projectId, architectureId, scenario.id, {
          scenario_name: newName,
        });
        setScenarios((prev) =>
          prev.map((s) => (s.id === scenario.id ? updated : s)),
        );
        setOpenRenameFormFor(null);
        setRenameDraft((prev) => {
          const next = { ...prev };
          delete next[scenario.id];
          return next;
        });
      } catch (err) {
        setError(describeError(err));
      } finally {
        setActionInFlight(null);
      }
    },
    [projectId, architectureId, renameDraft],
  );

  const toggleExpanded = useCallback((captureId: string) => {
    setExpandedCaptureIds((prev) => {
      const next = new Set(prev);
      if (next.has(captureId)) next.delete(captureId);
      else next.add(captureId);
      return next;
    });
  }, []);

  // ---- Render ----------------------------------------------------------

  if (loading) {
    return (
      <div className={styles.panel} data-testid="capture-review-panel">
        <div className={styles.emptyMessage}>Loading captured rows…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.panel} data-testid="capture-review-panel">
        <div className={styles.errorBanner}>{error}</div>
      </div>
    );
  }

  if (grouped.length === 0) {
    return (
      <div className={styles.panel} data-testid="capture-review-panel">
        <div className={styles.emptyMessage}>
          No captured rows yet for this session.
        </div>
        {/* Allow adding an ad-hoc behaviour even on an empty session so a
            reviewer can fill a coverage gap. Review time only (readOnly false). */}
        {!readOnly && (
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => setAddBehaviourModalOpen(true)}
              disabled={actionInFlight !== null}
              data-testid="capture-review-add-behaviour"
            >
              Add New Behaviour
            </button>
          </div>
        )}
        {addBehaviourModalOpen && (
          <AddNewBehaviourModal
            projectId={projectId}
            architectureId={architectureId}
            sessionId={sessionId}
            operations={operations}
            headerKeyUnion={manualHeaderKeyUnion}
            mutatingCallsConfirmed={mutatingCallsConfirmed}
            secretsLoaded={secretsLoaded}
            onRequestReenterSecrets={() => onRequestReenterSecrets?.()}
            onClose={() => setAddBehaviourModalOpen(false)}
            onSaved={() => {
              setAddBehaviourModalOpen(false);
              void refresh();
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className={styles.panel} data-testid="capture-review-panel">
      <div className={styles.panelHeader}>
        <h3>Captured behaviour ({visibleCaptures.length})</h3>
        <div className={styles.headerActions}>
          <span
            className={styles.acceptedTally}
            data-testid="capture-review-accepted-count"
          >
            {acceptedCount} accepted
          </span>
          {!readOnly && visibleCaptures.length > 0 && (
            <>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => void handleAcceptAll()}
                disabled={actionInFlight !== null}
                data-testid="capture-review-accept-all"
              >
                Accept all
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => void handleRejectAll()}
                disabled={actionInFlight !== null}
                data-testid="capture-review-reject-all"
              >
                Reject all
              </button>
              {/* Combined Accept-and-Save-All (Spec 2026-06-20 R2/R4): accept
                  every visible capture in one batch, then open the Save flow.
                  Proceeds to save on a partial accept failure. */}
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => void handleAcceptAndSaveAll()}
                disabled={actionInFlight !== null}
                data-testid="capture-review-accept-and-save-all"
              >
                Accept and Save All
              </button>
            </>
          )}
          {!readOnly && acceptedCount > 0 && (
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => setSaveModalOpen(true)}
              data-testid="capture-review-open-save-baseline"
            >
              Save as Baseline
            </button>
          )}
          {/* Add New Behaviour (manual capture). Review time only (readOnly
              false). Spec: 2026-06-20 Add New Behaviour -- Manual Capture. */}
          {!readOnly && (
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => setAddBehaviourModalOpen(true)}
              disabled={actionInFlight !== null}
              data-testid="capture-review-add-behaviour"
            >
              Add New Behaviour
            </button>
          )}
        </div>
      </div>

      {warning && (
        <div
          className={styles.warningBanner}
          data-testid="capture-review-batch-warning"
        >
          {warning}
        </div>
      )}

      {discoveryCtx && (
        <div
          className={styles.discoveryBanner}
          data-testid="capture-review-discovery-banner"
        >
          <span className={styles.discoveryBannerTitle}>Discovery context:</span>
          {totalFindings > 0
            ? `${totalFindings} finding${totalFindings === 1 ? '' : 's'} linked to this architecture`
            : 'No discovery findings linked to this architecture'}
          <div className={styles.discoveryBadgeRow}>
            {hasRuntimeUsageFindings && (
              <span
                className={styles.discoveryBadge}
                data-testid="capture-review-discovery-runtime-usage-badge"
                title="Endpoint prioritised due to runtime usage findings"
              >
                Endpoint prioritised due to runtime usage
              </span>
            )}
            {hasDbSampleHints && (
              <span
                className={`${styles.discoveryBadge} ${styles.discoveryBadgeInfo}`}
                data-testid="capture-review-discovery-db-sample-badge"
                title="Discovery surfaced DB sample-data hints for this architecture"
              >
                Sample data hints available
              </span>
            )}
            {hasMissingContractDetail && (
              <span
                className={`${styles.discoveryBadge} ${styles.discoveryBadgeWarning}`}
                data-testid="capture-review-discovery-missing-contract-detail"
                title="Discovery flagged missing contract detail on one or more endpoints"
              >
                Warning: missing contract detail
              </span>
            )}
            {unresolvedDecisionTaskCount > 0 && (
              <span
                className={`${styles.discoveryBadge} ${styles.discoveryBadgeWarning}`}
                data-testid="capture-review-discovery-decision-task-warning"
                title="Unresolved discovery decision tasks may affect endpoint behaviour"
              >
                Warning: {unresolvedDecisionTaskCount} unresolved decision task
                {unresolvedDecisionTaskCount === 1 ? '' : 's'}
              </span>
            )}
            {sessionHasNoDiscoveryEvidence && (
              <span
                className={`${styles.discoveryBadge} ${styles.discoveryBadgeWarning}`}
                data-testid="capture-review-discovery-no-evidence"
                title="No discovery findings linked to this architecture; LLM had no discovery context to draw on"
              >
                Warning: no discovery evidence linked
              </span>
            )}
          </div>
        </div>
      )}

      <table className={styles.reviewTable} data-testid="capture-review-table">
        <thead>
          <tr>
            <th>Operation</th>
            <th>Scenario</th>
            <th>Status</th>
            <th>Attempt</th>
            <th>Reviewer</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {grouped.map(({ operation, scenarios: scenarioRows }) =>
            scenarioRows.map(({ scenario, captures: capRows }) =>
              capRows.map((cap) => {
                const expanded = expandedCaptureIds.has(cap.id);
                const notesPayload = parseReviewerNotes(cap.reviewer_notes);
                const acceptedLabel =
                  cap.accepted === true ? 'accepted' : cap.accepted === false ? 'rejected' : '—';
                return (
                  <React.Fragment key={cap.id}>
                    <tr
                      data-testid="capture-review-row"
                      data-capture-id={cap.id}
                      data-operation-id={operation.id}
                      data-scenario-id={scenario.id}
                      data-accepted={String(cap.accepted ?? '')}
                    >
                      <td>{operationLabel(operation)}</td>
                      <td>
                        {openRenameFormFor === scenario.id && !readOnly ? (
                          <span className={styles.inlineForm}>
                            <input
                              type="text"
                              value={renameDraft[scenario.id] ?? scenario.scenario_name ?? ''}
                              onChange={(e) =>
                                setRenameDraft((prev) => ({
                                  ...prev,
                                  [scenario.id]: e.target.value,
                                }))
                              }
                              data-testid="capture-review-rename-input"
                            />
                            <button
                              type="button"
                              className={styles.smallButton}
                              onClick={() => handleRenameSubmit(scenario)}
                              disabled={actionInFlight !== null}
                              data-testid="capture-review-rename-submit"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className={styles.smallButton}
                              onClick={() => setOpenRenameFormFor(null)}
                              disabled={actionInFlight !== null}
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <>
                            {scenario.scenario_name ?? '(unnamed)'}
                            {!readOnly && (
                              <button
                                type="button"
                                className={styles.linkButton}
                                onClick={() => {
                                  setOpenRenameFormFor(scenario.id);
                                  setRenameDraft((prev) => ({
                                    ...prev,
                                    [scenario.id]: scenario.scenario_name ?? '',
                                  }));
                                }}
                                disabled={actionInFlight !== null}
                                data-testid="capture-review-rename-button"
                              >
                                rename
                              </button>
                            )}
                            {/* Per-scenario discovery-supported badges
                                (Spec 2026-05-16 Task Group 4). The DB
                                sample-hint badge reads directly off
                                `scenario.generation_source`, which is
                                durably set by the orchestrator when a
                                scenario is generated from a DB sample
                                tool call. */}
                            {scenario.generation_source === 'db_sample' && (
                              <span
                                className={`${styles.discoveryBadge} ${styles.discoveryBadgeInfo}`}
                                data-testid="capture-review-scenario-db-sample-badge"
                                title="Scenario generated using DB sample hint"
                              >
                                DB sample hint
                              </span>
                            )}
                            {/* Manual capture badge (Spec 2026-06-20 Add New
                                Behaviour). Mirrors the db_sample badge block;
                                keyed off `scenario.generation_source ===
                                'manual'`, set by the amvs manual-capture route. */}
                            {scenario.generation_source === 'manual' && (
                              <span
                                className={`${styles.discoveryBadge} ${styles.discoveryBadgeInfo}`}
                                data-testid="capture-review-scenario-manual-badge"
                                title="Scenario added manually during review"
                              >
                                Manual
                              </span>
                            )}
                            {sessionHasNoDiscoveryEvidence && (
                              <span
                                className={styles.discoveryRowNote}
                                data-testid="capture-review-row-no-discovery-evidence"
                                title="No discovery findings were linked to this architecture when the capture session ran"
                              >
                                no discovery evidence linked
                              </span>
                            )}
                          </>
                        )}
                      </td>
                      <td>
                        {cap.response_status ?? (cap.error_type ? `err:${cap.error_type}` : '—')}
                      </td>
                      <td>{cap.attempt_number ?? '—'}</td>
                      <td data-testid="capture-review-accepted-cell">{acceptedLabel}</td>
                      <td>
                        <button
                          type="button"
                          className={styles.linkButton}
                          onClick={() => toggleExpanded(cap.id)}
                          data-testid="capture-review-expand-toggle"
                        >
                          {expanded ? 'Hide' : 'Show'} detail
                        </button>
                        {!readOnly && (
                          <>
                            <button
                              type="button"
                              className={styles.smallButton}
                              onClick={() => handleAccept(cap)}
                              disabled={actionInFlight !== null}
                              data-testid="capture-review-accept-button"
                            >
                              Accept
                            </button>
                            <button
                              type="button"
                              className={styles.smallButton}
                              onClick={() => {
                                setOpenRejectFormFor(cap.id);
                                setRejectNotesDraft((prev) => ({
                                  ...prev,
                                  [cap.id]: notesPayload.text,
                                }));
                              }}
                              disabled={actionInFlight !== null}
                              data-testid="capture-review-reject-button"
                            >
                              Reject
                            </button>
                            <button
                              type="button"
                              className={styles.smallButton}
                              onClick={() => {
                                setOpenMaskFormFor(cap.id);
                                setMaskPathDraft((prev) => ({
                                  ...prev,
                                  [cap.id]: '',
                                }));
                                setMaskLabelDraft((prev) => ({
                                  ...prev,
                                  [cap.id]: '',
                                }));
                              }}
                              disabled={actionInFlight !== null}
                              data-testid="capture-review-mask-button"
                            >
                              Mask field
                            </button>
                          </>
                        )}
                      </td>
                    </tr>

                    {/* Reject + notes inline form */}
                    {openRejectFormFor === cap.id && !readOnly && (
                      <tr data-testid="capture-review-reject-form-row">
                        <td colSpan={6}>
                          <div className={styles.inlineForm}>
                            <label>
                              Reviewer notes:
                              <textarea
                                value={rejectNotesDraft[cap.id] ?? ''}
                                onChange={(e) =>
                                  setRejectNotesDraft((prev) => ({
                                    ...prev,
                                    [cap.id]: e.target.value,
                                  }))
                                }
                                rows={3}
                                data-testid="capture-review-reject-notes-input"
                              />
                            </label>
                            <div className={styles.cta}>
                              <button
                                type="button"
                                className={styles.smallButton}
                                onClick={() => setOpenRejectFormFor(null)}
                                disabled={actionInFlight !== null}
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                className={styles.smallButton}
                                onClick={() => handleRejectSubmit(cap)}
                                disabled={actionInFlight !== null}
                                data-testid="capture-review-reject-submit"
                              >
                                Confirm reject
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}

                    {/* Mask field inline form */}
                    {openMaskFormFor === cap.id && !readOnly && (
                      <tr data-testid="capture-review-mask-form-row">
                        <td colSpan={6}>
                          <div className={styles.inlineForm}>
                            <label>
                              Field path (e.g. response.body.user.email):
                              <input
                                type="text"
                                value={maskPathDraft[cap.id] ?? ''}
                                onChange={(e) =>
                                  setMaskPathDraft((prev) => ({
                                    ...prev,
                                    [cap.id]: e.target.value,
                                  }))
                                }
                                data-testid="capture-review-mask-path-input"
                              />
                            </label>
                            <label>
                              Optional label:
                              <input
                                type="text"
                                value={maskLabelDraft[cap.id] ?? ''}
                                onChange={(e) =>
                                  setMaskLabelDraft((prev) => ({
                                    ...prev,
                                    [cap.id]: e.target.value,
                                  }))
                                }
                                data-testid="capture-review-mask-label-input"
                              />
                            </label>
                            <div className={styles.cta}>
                              <button
                                type="button"
                                className={styles.smallButton}
                                onClick={() => setOpenMaskFormFor(null)}
                                disabled={actionInFlight !== null}
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                className={styles.smallButton}
                                onClick={() => handleMaskSubmit(cap)}
                                disabled={actionInFlight !== null}
                                data-testid="capture-review-mask-submit"
                              >
                                Apply mask
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}

                    {/* Inline expansion: redacted request + response with masks */}
                    {expanded && (
                      <tr data-testid="capture-review-expanded-row">
                        <td colSpan={6}>
                          <div className={styles.expandedBlock}>
                            <div className={styles.expandedSection}>
                              <strong>Request:</strong>
                              <pre
                                className={styles.codeBlock}
                                data-testid="capture-review-expanded-request"
                              >
                                {formatJsonWithMasks(
                                  cap.request_body_json,
                                  notesPayload.masks,
                                  'request.body',
                                )}
                              </pre>
                            </div>
                            <div className={styles.expandedSection}>
                              <strong>Response (status {cap.response_status ?? '—'}):</strong>
                              <pre
                                className={styles.codeBlock}
                                data-testid="capture-review-expanded-response"
                              >
                                {formatJsonWithMasks(
                                  cap.response_body_json,
                                  notesPayload.masks,
                                  'response.body',
                                )}
                              </pre>
                            </div>
                            {notesPayload.text && (
                              <div className={styles.expandedSection}>
                                <strong>Reviewer notes:</strong>
                                <pre className={styles.codeBlock}>{notesPayload.text}</pre>
                              </div>
                            )}
                            {notesPayload.masks.length > 0 && (
                              <div
                                className={styles.expandedSection}
                                data-testid="capture-review-mask-summary"
                              >
                                <strong>Masked fields:</strong>
                                <ul>
                                  {notesPayload.masks.map((m) => (
                                    <li key={m.path}>
                                      {m.path}
                                      {m.label ? ` (${m.label})` : ''}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              }),
            ),
          )}
        </tbody>
      </table>

      {saveModalOpen && (
        <SaveAsBaselineModal
          projectId={projectId}
          architectureId={architectureId}
          sessionId={sessionId}
          captures={visibleCaptures}
          operations={operations}
          scenarios={scenarios}
          operationsWithoutAccepted={operationsWithoutAccepted}
          coverageSummaryJson={coverageSummaryJson}
          diagnostics={diagnostics}
          onClose={() => setSaveModalOpen(false)}
        />
      )}
      {addBehaviourModalOpen && (
        <AddNewBehaviourModal
          projectId={projectId}
          architectureId={architectureId}
          sessionId={sessionId}
          operations={operations}
          headerKeyUnion={manualHeaderKeyUnion}
          mutatingCallsConfirmed={mutatingCallsConfirmed}
          secretsLoaded={secretsLoaded}
          onRequestReenterSecrets={() => onRequestReenterSecrets?.()}
          onClose={() => setAddBehaviourModalOpen(false)}
          onSaved={() => {
            setAddBehaviourModalOpen(false);
            void refresh();
          }}
        />
      )}
    </div>
  );
};

export default CaptureReviewPanel;
