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
 * The bulk-create is sequential rather than `Promise.all` so that a
 * partial-failure leaves an obvious "N items written, item N+1 failed"
 * trail rather than racing through and aborting halfway with confusing
 * partial state.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ApiBehaviourCaptureDto,
  ApiBehaviourOperationDto,
  ApiBehaviourScenarioDto,
  createBaseline,
  createBaselineItem,
} from '../../api/apiBehaviourClient';
import { useArchitectureDispatch } from '../../contexts/ArchitectureContext';
import { useProject } from '../../contexts/ProjectContext';
import { loadModelByProjectId } from '../../api/modelApi';
import styles from './CaptureReviewPanel.module.css';

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
  onClose: () => void;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Unexpected error';
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
  onClose,
}) => {
  const navigate = useNavigate();
  const dispatch = useArchitectureDispatch();
  const activeProject = useProject();
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const handleSubmit = useCallback(async () => {
    if (!name.trim() || acceptedCaptures.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const baseline = await createBaseline(projectId, architectureId, {
        project_id: projectId,
        architecture_id: architectureId,
        session_id: sessionId,
        name: name.trim(),
        notes: notes.trim() || null,
      });

      // Sequential bulk create -- see file comment for rationale.
      for (const cap of acceptedCaptures) {
        const op = operationById.get(cap.operation_id);
        const scenario = scenarioById.get(cap.scenario_id);
        await createBaselineItem(projectId, architectureId, {
          baseline_id: baseline.id,
          capture_id: cap.id,
          operation_id: cap.operation_id,
          scenario_id: cap.scenario_id,
          method: op?.method ?? cap.request_method ?? null,
          path: op?.path ?? cap.request_path ?? null,
          scenario_name: scenario?.scenario_name ?? null,
          request_json: cap.request_body_json,
          response_status: cap.response_status,
          response_json: cap.response_body_json,
          business_notes: null,
        });
      }

      // Spec Group 10: AppShell model cache invalidation.
      // Baseline create + baseline-item bulk-create both write rows to AMS
      // tables that the AppShell per-(project, architecture) in-memory
      // model cache is unaware of. The save flow is always scoped to the
      // currently-active architecture (same-arch flow), so we use
      // LOAD_MODEL rather than invalidateArchitectureModelCache so the
      // user lands on the baseline detail view with a fresh model already
      // in hand.
      //
      // Cache-refresh failures are NON-FATAL for the success path: we log
      // a warning and proceed to the baseline detail navigation. The user
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

      navigate(
        `/projects/${projectId}/architectures/${architectureId}` +
          `/api-behaviour/baselines/${baseline.id}`,
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
