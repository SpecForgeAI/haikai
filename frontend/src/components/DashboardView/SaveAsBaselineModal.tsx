/**
 * SaveAsBaselineModal Component
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 9
 *   + Task Group 10: AppShell model cache invalidation. Baseline create +
 *     baseline-item bulk-create both write to AMS rows that the AppShell
 *     per-(project, architecture) in-memory model cache is unaware of.
 *     The baseline is created against the currently-active architecture
 *     (same-arch flow per spec routing), so per the cache contract we
 *     dispatch `LOAD_MODEL` with a fresh fetch immediately after the bulk
 *     create succeeds and BEFORE navigating to the baseline detail view.
 *
 * Modal owned by `CaptureReviewPanel`. Confirms the reviewer's intent to
 * promote the accepted captures of the current session into a durable
 * baseline. On submit:
 *
 *   1. POST `baselines` with `{ project_id, architecture_id, session_id,
 *      name, notes }`. AMS returns the new baseline row.
 *   2. For each accepted capture, POST `baseline-items` with the matching
 *      operation/scenario metadata + the redacted request/response shapes
 *      pulled from the capture row.
 *   3. Dispatch `LOAD_MODEL` with a fresh fetch so the AppShell cache for
 *      the active architecture picks up the new baseline rows.
 *   4. On success, navigate to
 *      `/projects/:p/architectures/:a/api-behaviour/baselines/:newId`.
 *
 * Per spec:
 *   - Only `accepted=true` captures are eligible. The modal exposes a
 *     coverage warning listing any operation that has zero accepted captures
 *     so the reviewer can choose to either back out and accept more, or
 *     proceed knowing the baseline is partial.
 *   - The original redacted JSON travels straight from the capture into the
 *     baseline item -- the row IS the evidence. Mask metadata from
 *     `reviewer_notes` is intentionally NOT applied here: the baseline
 *     stores the as-captured shape; the mask is a render-time UX concern.
 *   - Baselines start in `draft` status. Promotion to `active` happens via
 *     a separate flow out of scope for v1.
 *
 * The baseline items are persisted in ONE best-effort batch request
 * (`createBaselineItemsBatch`) rather than N sequential POSTs -- this avoids
 * the gateway rate-limit storm and returns a per-item `failed[]`, so a
 * partial save surfaces an explicit warning naming the items that failed
 * while the successfully-created items are still saved.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ApiBehaviourCaptureDto,
  ApiBehaviourDiagnosticDto,
  ApiBehaviourOperationDto,
  ApiBehaviourScenarioDto,
  createBaseline,
  createBaselineItemsBatch,
  type BatchCreateBaselineItemFailure,
} from '../../api/apiBehaviourClient';
import { useArchitectureDispatch } from '../../contexts/ArchitectureContext';
import { useProject } from '../../contexts/ProjectContext';
import { loadModelByProjectId } from '../../api/modelApi';
import styles from './CaptureReviewPanel.module.css';
import { CoverageSummaryPanel } from './CoverageSummaryPanel';

export interface SaveAsBaselineModalProps {
  projectId: string;
  architectureId: string;
  sessionId: string;
  captures: ApiBehaviourCaptureDto[];
  operations: ApiBehaviourOperationDto[];
  scenarios: ApiBehaviourScenarioDto[];
  /**
   * Operations that have zero `accepted=true` captures. Surfaced as a
   * coverage warning so the reviewer doesn't accidentally lock a baseline
   * with gaps. Empty array -> full coverage, no warning.
   */
  operationsWithoutAccepted: ApiBehaviourOperationDto[];
  /**
   * Session diagnostics. Carries the `sequence_pinned` marker rows written
   * by the capture orchestrator for stateful sequence scenarios:
   * `detail_json = { marker: 'sequence_pinned', canonical_capture_id,
   * sequence_json, volatile_paths_json }`. When a marker's
   * `canonical_capture_id` matches the ACT-step capture being pinned, the
   * assembled `sequence_json` (+ the ref-derived `volatile_paths_json`) is
   * carried onto that capture's baseline item -- mirroring exactly how
   * `volatile_paths_json` is carried today. OPTIONAL / defaults to `[]` so
   * non-sequence callers (and existing tests) are unaffected.
   * Spec: 2026-06-18 Stateful Sequence Scenarios (Spec D) -- Task Group 4.
   */
  diagnostics?: ApiBehaviourDiagnosticDto[];
  /**
   * Raw `coverage_summary_json` off the capture session (snake_case JSONB
   * wire). Display-only: surfaced beside the coverage warning so the reviewer
   * sees overall + per-endpoint oracle coverage (with missed reasons + thin
   * flags) before locking the baseline. Null / absent renders as 'coverage
   * not recorded'. Spec: 2026-06-17 Oracle Coverage Scoring -- Task 3.4.
   */
  coverageSummaryJson?: Record<string, unknown> | null;
  onClose: () => void;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Unexpected error';
}

/**
 * Render the best-effort batch `failed[]` as a single human-readable warning
 * line naming the captures that did not persist (by `capture_id`, falling
 * back to the 0-based submitted index when the item carried none). The save
 * still succeeded for the created rows -- this is informational, not an error.
 */
function describeBatchFailures(
  failed: BatchCreateBaselineItemFailure[],
): string {
  const labels = failed.map(
    (f) => f.capture_id ?? `item #${f.index}`,
  );
  const noun = failed.length === 1 ? 'item' : 'items';
  return (
    `${failed.length} ${noun} could not be saved and were skipped ` +
    `(the rest were saved): ${labels.join(', ')}.`
  );
}

function operationLabel(op: ApiBehaviourOperationDto): string {
  const method = (op.method ?? '').toUpperCase();
  const path = op.path ?? '(no path)';
  return method ? `${method} ${path}` : path;
}

export const SaveAsBaselineModal: React.FC<SaveAsBaselineModalProps> = ({
  projectId,
  architectureId,
  sessionId,
  captures,
  operations,
  scenarios,
  operationsWithoutAccepted,
  coverageSummaryJson,
  diagnostics = [],
  onClose,
}) => {
  const navigate = useNavigate();
  const dispatch = useArchitectureDispatch();
  const activeProject = useProject();
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Best-effort batch save (Spec 2026-06-20, R1/R4): the save POSTs every
  // accepted capture in ONE `createBaselineItemsBatch` call rather than looping
  // one gateway request per capture (which tripped the rate limiter). The call
  // is NON-atomic: a bad item is reported in `failed[]` WITHOUT aborting the
  // rest, so the save still succeeds for the `created` rows. Surface `failed[]`
  // here as a non-fatal warning naming the captures that did not persist.
  const [warning, setWarning] = useState<string | null>(null);

  const acceptedCaptures = useMemo(
    () => captures.filter((c) => c.accepted === true),
    [captures],
  );

  const operationById = useMemo(
    () => new Map(operations.map((o) => [o.id, o])),
    [operations],
  );

  const scenarioById = useMemo(
    () => new Map(scenarios.map((s) => [s.id, s])),
    [scenarios],
  );

  // Stateful-sequence carry (Spec D, Task Group 4). The capture orchestrator
  // persists the assembled `sequence_json` (+ the ref-derived
  // `volatile_paths_json`) as a `sequence_pinned`-marked diagnostic keyed to
  // the canonical ACT-step capture. Index those markers by
  // `canonical_capture_id` so the per-capture pin loop can carry them onto
  // the matching ACT-step baseline item -- exactly mirroring the existing
  // `volatile_paths_json` carry. Read DEFENSIVELY: a malformed / absent
  // marker simply yields no carry (the single-shot path, unchanged).
  const sequenceCarryByCaptureId = useMemo(() => {
    const map = new Map<
      string,
      {
        sequence_json: Record<string, unknown> | null;
        volatile_paths_json: Record<string, unknown> | null;
      }
    >();
    for (const diag of diagnostics) {
      const detail = diag.detail_json;
      if (!detail || typeof detail !== 'object') continue;
      if (detail.marker !== 'sequence_pinned') continue;
      const captureId = detail.canonical_capture_id;
      if (typeof captureId !== 'string' || captureId.length === 0) continue;
      const seq =
        detail.sequence_json &&
        typeof detail.sequence_json === 'object' &&
        !Array.isArray(detail.sequence_json)
          ? (detail.sequence_json as Record<string, unknown>)
          : null;
      if (!seq) continue;
      const vol =
        detail.volatile_paths_json &&
        typeof detail.volatile_paths_json === 'object' &&
        !Array.isArray(detail.volatile_paths_json)
          ? (detail.volatile_paths_json as Record<string, unknown>)
          : null;
      map.set(captureId, { sequence_json: seq, volatile_paths_json: vol });
    }
    return map;
  }, [diagnostics]);

  const handleSubmit = useCallback(async () => {
    if (!name.trim() || acceptedCaptures.length === 0) return;
    setSubmitting(true);
    setError(null);
    setWarning(null);
    try {
      const baseline = await createBaseline(projectId, architectureId, {
        project_id: projectId,
        architecture_id: architectureId,
        session_id: sessionId,
        name: name.trim(),
        notes: notes.trim() || null,
      });

      // Best-effort batch create (Spec 2026-06-20, R1/R4). Build the item
      // array EXACTLY as the former per-capture loop did (the
      // `{ query, headers, body }` request_json envelope, the
      // `{ headers, body }` response_json envelope, and the volatile /
      // sequence carry per item), then POST them all in ONE
      // `createBaselineItemsBatch` call instead of N sequential POSTs. The
      // call is non-atomic: `created` rows commit even when `failed[]` is
      // non-empty, so we treat the save as succeeded for the created items.
      const items = acceptedCaptures.map((cap) => {
        const op = operationById.get(cap.operation_id);
        const scenario = scenarioById.get(cap.scenario_id);
        return {
          baseline_id: baseline.id,
          capture_id: cap.id,
          operation_id: cap.operation_id,
          scenario_id: cap.scenario_id,
          method: op?.method ?? cap.request_method ?? null,
          path: op?.path ?? cap.request_path ?? null,
          scenario_name: scenario?.scenario_name ?? null,
          // AMS requires request_json to be a NON-NULL object (jsonb NOT NULL,
          // validated "requestJson is required"). A body-less GET has
          // request_body_json=null, which 400'd EVERY save once an accepted GET
          // capture was included. Pin a { query, headers, body } envelope --
          // never null, and symmetric with the target side (targetReplayRunner)
          // and the response_json envelope below.
          request_json: {
            query: cap.request_query_json ?? null,
            headers: cap.request_headers_redacted_json ?? null,
            body: cap.request_body_json ?? null,
          },
          response_status: cap.response_status,
          // Pin the source baseline item's response as a { headers, body }
          // envelope SYMMETRIC with the target side (targetReplayRunner stores
          // `{ headers: capture.response_headers_redacted_json, body:
          // response_body_json }`). The reconcile comparator unwraps both sides
          // the same way and now diffs the response HEADERS too -- without the
          // wrapper here the comparator would have no source headers to diff
          // against and would skip the header dimension. Headers are ALREADY
          // captured + redacted on the capture row (response_headers_redacted_json);
          // this is NOT a new capture. Pre-existing baselines that lack the
          // wrapper degrade gracefully comparator-side (the header dimension is
          // skipped -- no false break). Spec: 2026-06-17 Reconcile Full-Response
          // Fidelity & Distinct Break Types -- R5.
          response_json: {
            headers: cap.response_headers_redacted_json ?? null,
            body: cap.response_body_json,
          },
          business_notes: null,
          // Carry the capture-time volatility envelope forward onto the
          // immutable source baseline item (write-once at pin time). The probe
          // measured it during capture; `null`/absent => strict comparison.
          // Spec: 2026-06-16 Reconcile-Time Determinism & Volatile-Value
          // Handling -- FU-2 (frontend carry-through).
          //
          // Stateful-sequence carry (Spec D, Task Group 4): when this capture
          // is the canonical ACT step of a pinned sequence, carry the
          // assembled `sequence_json` AND prefer the ref-derived
          // `volatile_paths_json` from the `sequence_pinned` marker (the
          // generated ids referenced as `$N.<path>` are expected-volatile by
          // construction). Non-sequence captures keep `sequence_json: null`
          // and the capture-row volatile envelope -- pinned exactly as today.
          volatile_paths_json:
            sequenceCarryByCaptureId.get(cap.id)?.volatile_paths_json ??
            cap.volatile_paths_json ??
            null,
          sequence_json:
            sequenceCarryByCaptureId.get(cap.id)?.sequence_json ?? null,
        };
      });

      const { failed } = await createBaselineItemsBatch(
        projectId,
        architectureId,
        items,
      );

      // Best-effort: the save SUCCEEDS for the created rows even when some
      // items failed. Surface the failures as a non-fatal warning naming the
      // exact captures (by `capture_id`, falling back to the submitted index)
      // so the reviewer knows the baseline is partial -- we still proceed to
      // refresh the model and navigate to the list.
      if (failed.length > 0) {
        setWarning(describeBatchFailures(failed));
      }

      // Spec Group 10: AppShell model cache invalidation.
      // Baseline create + baseline-item bulk-create both write rows to AMS
      // tables that the AppShell per-(project, architecture) in-memory
      // model cache is unaware of. The save flow is always scoped to the
      // currently-active architecture (same-arch flow), so we use
      // LOAD_MODEL rather than invalidateArchitectureModelCache so the
      // user lands on the baselines list with a fresh model already
      // in hand.
      //
      // Cache-refresh failures are NON-FATAL for the success path: we log
      // a warning and proceed to the baselines-list navigation. The user
      // can manually refresh if they need to see the new rows in their
      // current architecture view.
      try {
        const fileName = activeProject?.name ?? 'architecture-model';
        const model = await loadModelByProjectId(projectId, architectureId);
        dispatch({ type: 'LOAD_MODEL', payload: model, fileName });
      } catch (refreshErr) {
        console.warn(
          '[SaveAsBaselineModal] Could not refresh active model after baseline create:',
          refreshErr,
        );
      }

      // Post-save navigation (Spec 2026-06-20, R4): land back on the
      // baselines LIST -- NOT the per-item detail dump. The new baseline
      // shows there as `draft`; activation is a deliberate, separate Make
      // Active action (no auto-activate, because a best-effort save can
      // leave gaps).
      navigate(
        `/projects/${projectId}/architectures/${architectureId}` +
          `/api-behaviour`,
      );
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }, [
    name,
    notes,
    projectId,
    architectureId,
    sessionId,
    acceptedCaptures,
    operationById,
    scenarioById,
    sequenceCarryByCaptureId,
    navigate,
    dispatch,
    activeProject?.name,
  ]);

  const canSubmit = name.trim().length > 0 && acceptedCaptures.length > 0 && !submitting;

  return (
    <div
      className={styles.modalBackdrop}
      data-testid="save-as-baseline-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className={styles.modal} data-testid="save-as-baseline-modal">
        <h3>Save as Baseline</h3>

        <div className={styles.summaryRow} data-testid="save-as-baseline-accepted-summary">
          {acceptedCaptures.length} accepted capture
          {acceptedCaptures.length === 1 ? '' : 's'} will be promoted.
        </div>

        {/* Oracle coverage summary (Spec 2026-06-17). Display-only: overall
            + per-endpoint coverage with honest missed-dimension reasons and
            thin-coverage flags, beside the existing coverage warning. Null /
            absent renders as 'coverage not recorded' -- never an error. No
            hard gate; the reviewer can still save. Reuses the modal's
            warningBanner + discoveryBadge styling -- no charting widget. */}
        <CoverageSummaryPanel
          raw={coverageSummaryJson}
          testId="save-as-baseline-coverage-summary"
          classes={{
            banner: styles.warningBanner,
            badge: styles.discoveryBadge,
            badgeWarning: styles.discoveryBadgeWarning,
          }}
        />

        {operationsWithoutAccepted.length > 0 && (
          <div
            className={styles.warningBanner}
            data-testid="save-as-baseline-coverage-warning"
          >
            <strong>Some operations have no accepted captures.</strong>
            <div>
              These operations will not appear in the baseline. You can back
              out and accept captures for them first, or proceed knowing the
              baseline is partial:
            </div>
            <ul>
              {operationsWithoutAccepted.map((op) => (
                <li key={op.id}>{operationLabel(op)}</li>
              ))}
            </ul>
          </div>
        )}

        <label>
          Baseline name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. petclinic baseline v1"
            disabled={submitting}
            data-testid="save-as-baseline-name-input"
          />
        </label>

        <label>
          Notes (optional)
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            disabled={submitting}
            data-testid="save-as-baseline-notes-input"
          />
        </label>

        {error && <div className={styles.errorBanner}>{error}</div>}

        {warning && (
          <div
            className={styles.warningBanner}
            data-testid="save-as-baseline-batch-warning"
          >
            {warning}
          </div>
        )}

        <div className={styles.cta}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={onClose}
            disabled={submitting}
            data-testid="save-as-baseline-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={handleSubmit}
            disabled={!canSubmit}
            data-testid="save-as-baseline-submit"
          >
            {submitting ? 'Saving…' : 'Save baseline'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SaveAsBaselineModal;
