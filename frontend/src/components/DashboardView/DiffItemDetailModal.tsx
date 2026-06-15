/**
 * DiffItemDetailModal Component
 *
 * Spec: 2026-05-25 API Test Harness -- Diff Engine -- Task Group 5
 * Task 5.3.
 *
 * Side-by-side modal for inspecting a single diff item. Renders the source
 * response JSON on the left and the target response JSON on the right,
 * with the differing JSON-pointer paths (from `body_diff_json`)
 * highlighted as colour-coded annotations beneath both panes.
 *
 * Naming convention: "diff" in code / data / engineering names; "drift"
 * in user-facing UI copy. This modal opens from the "View diff" action
 * on each row of the Drift report tab. Closes on backdrop click or `Esc`.
 *
 * Location: under `frontend/src/components/DashboardView/` (colocated with
 * the parent `BaselineDetailView` + `DriftReportTab`) -- NOT under
 * `frontend/src/components/ApiBehaviour/`. The latter is the wizard home
 * and is not a parent of this view (per the component-location caveat in
 * spec.md).
 */

import React, { useEffect } from 'react';
import type {
  ApiBehaviourDiffItemDto,
  ApiBehaviourBaselineItemDto,
} from '../../api/apiBehaviourClient';
import styles from './ApiBaselinesListPage.module.css';

export interface DiffItemDetailModalProps {
  diffItem: ApiBehaviourDiffItemDto;
  /** Optional source baseline item used to render the source response JSON. */
  sourceBaselineItem?: ApiBehaviourBaselineItemDto | null;
  /** Optional target baseline item used to render the target response JSON. */
  targetBaselineItem?: ApiBehaviourBaselineItemDto | null;
  onClose: () => void;
}

/**
 * Map a per-pointer change kind (as recorded by `jsonShapeComparator`) to
 * the CSS class controlling its highlight colour. Unknown kinds fall back
 * to the value_changed colour (orange) so the user still sees the path.
 */
function annotationClass(kind: string): string {
  switch (kind) {
    case 'key_added':
      return styles.diffAnnotationKeyAdded;
    case 'key_removed':
      return styles.diffAnnotationKeyRemoved;
    case 'type_changed':
      return styles.diffAnnotationTypeChanged;
    case 'value_changed':
    default:
      return styles.diffAnnotationValueChanged;
  }
}

/**
 * Pretty-print a JSON value into a string. `null` is rendered as the
 * em-dash placeholder so empty bodies don't show literal `null`.
 */
function formatJson(value: unknown): string {
  if (value === null || value === undefined) return '—';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Walk `body_diff_json` into a flat array of `{ pointer, kind }` entries
 * suitable for the annotations list. The comparator persists the diff
 * blob with one of two top-level shapes:
 *   - `{ differences: [{ pointer, kind }, ...] }` (the canonical
 *     comparator output)
 *   - a flat map of `pointer -> kind` (a simpler alternative shape)
 *
 * We tolerate either form so the modal renders regardless of which one
 * the runner persists. An empty / missing blob renders no annotations.
 */
function extractAnnotations(
  bodyDiff: Record<string, unknown> | null | undefined,
): Array<{ pointer: string; kind: string }> {
  if (!bodyDiff || typeof bodyDiff !== 'object') return [];
  const out: Array<{ pointer: string; kind: string }> = [];
  const rawDifferences = (bodyDiff as Record<string, unknown>).differences;
  if (Array.isArray(rawDifferences)) {
    for (const entry of rawDifferences) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      const pointer = typeof e.pointer === 'string' ? e.pointer : null;
      const kind = typeof e.kind === 'string' ? e.kind : 'value_changed';
      if (pointer) out.push({ pointer, kind });
    }
    return out;
  }
  // Flat-map fallback: { '/foo/bar': 'value_changed', ... }
  for (const [pointer, kind] of Object.entries(bodyDiff)) {
    if (typeof kind === 'string' && pointer.startsWith('/')) {
      out.push({ pointer, kind });
    }
  }
  return out;
}

export const DiffItemDetailModal: React.FC<DiffItemDetailModalProps> = ({
  diffItem,
  sourceBaselineItem,
  targetBaselineItem,
  onClose,
}) => {
  // Close on Esc (Escape) -- standard modal accessibility.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const annotations = extractAnnotations(diffItem.body_diff_json);

  const sourceJson = sourceBaselineItem ? sourceBaselineItem.response_json : null;
  const targetJson = targetBaselineItem ? targetBaselineItem.response_json : null;

  return (
    <div
      className={styles.diffModalBackdrop}
      data-testid="diff-item-detail-modal-backdrop"
      onClick={onClose}
    >
      <div
        className={styles.diffModalPanel}
        data-testid="diff-item-detail-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.diffModalHeader}>
          <strong>
            {diffItem.method} {diffItem.path}
            {diffItem.scenario_name ? (
              <>
                {' '}
                <span style={{ color: '#666' }}>— {diffItem.scenario_name}</span>
              </>
            ) : null}
          </strong>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={onClose}
            data-testid="diff-item-detail-modal-close"
          >
            Close
          </button>
        </div>
        <div className={styles.diffModalBody}>
          <div data-testid="diff-item-detail-modal-source">
            <div className={styles.diffPaneHeader}>
              Source response
              {diffItem.source_response_status !== null
                ? ` (status ${diffItem.source_response_status})`
                : ''}
            </div>
            <pre className={styles.diffPane}>{formatJson(sourceJson)}</pre>
          </div>
          <div data-testid="diff-item-detail-modal-target">
            <div className={styles.diffPaneHeader}>
              Target response
              {diffItem.target_response_status !== null
                ? ` (status ${diffItem.target_response_status})`
                : ''}
            </div>
            <pre className={styles.diffPane}>{formatJson(targetJson)}</pre>
          </div>
        </div>
        {annotations.length > 0 && (
          <div
            className={styles.diffAnnotations}
            data-testid="diff-item-detail-modal-annotations"
          >
            <strong>Differences:</strong>
            {annotations.map((a) => (
              <div
                key={`${a.pointer}|${a.kind}`}
                className={`${styles.diffAnnotation} ${annotationClass(a.kind)}`}
                data-testid="diff-item-detail-modal-annotation"
                data-annotation-pointer={a.pointer}
                data-annotation-kind={a.kind}
              >
                <code>{a.pointer}</code> — {a.kind}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default DiffItemDetailModal;
