/**
 * BaselineSequenceView Component
 *
 * Spec: 2026-06-18 Stateful Sequence Scenarios (Spec D) -- Task Group 4 (4.4).
 *
 * Renders a baseline item's pinned stateful-sequence chain when its
 * `sequence_json` is non-null: the ordered steps (index, role badge
 * setup/act/cleanup, method + path, expected_status) and the inter-step
 * `$N.<path>` references each step resolves at replay. Reuses the existing
 * baseline-detail badge/list/detailRow styling -- NO charting widget.
 *
 * The component is rendered ONLY when `BaselineDetailView` detects a non-null
 * `sequence_json`; a null sequence keeps today's single-shot rendering entirely
 * unchanged. The raw blob is read DEFENSIVELY (loose Record): a malformed /
 * partial sequence degrades gracefully (skipped fields, never a crash).
 *
 * `sequence_json` shape (snake_case wire, AMS changeset 192):
 *   { steps: [ { index, role: 'setup'|'act'|'cleanup', kind: 'http',
 *       request: { method, path, query, headers, body }, expected_status,
 *       response_refs: [ { ref: '$<step>.<jsonpath>', from_step, json_path } ] } ],
 *     act_step_index, cleanup_best_effort }.
 */

import React from 'react';
import styles from './ApiBaselinesListPage.module.css';

export type SequenceStepRole = 'setup' | 'act' | 'cleanup';

interface ParsedSequenceRef {
  ref: string;
  fromStep: number | null;
  jsonPath: string | null;
}

interface ParsedSequenceStep {
  index: number;
  role: SequenceStepRole | string;
  kind: string;
  method: string;
  path: string;
  expectedStatus: number | null;
  refs: ParsedSequenceRef[];
}

interface ParsedSequence {
  steps: ParsedSequenceStep[];
  actStepIndex: number | null;
  cleanupBestEffort: boolean;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Defensively parse the raw `sequence_json` blob into the typed
 * {@link ParsedSequence}. Returns `null` for null / absent / non-object /
 * empty-steps values so the caller renders nothing. Never throws; unknown /
 * mistyped fields coerce to neutral defaults.
 */
export function parseSequenceJson(
  raw: Record<string, unknown> | null | undefined,
): ParsedSequence | null {
  const root = asRecord(raw);
  if (!root) return null;
  const rawSteps = root.steps;
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) return null;

  const steps: ParsedSequenceStep[] = [];
  rawSteps.forEach((rawStep, position) => {
    const step = asRecord(rawStep);
    if (!step) return;
    const request = asRecord(step.request);
    const refsRaw = step.response_refs;
    const refs: ParsedSequenceRef[] = Array.isArray(refsRaw)
      ? refsRaw
          .map((r): ParsedSequenceRef | null => {
            const ref = asRecord(r);
            if (!ref) return null;
            const refStr = asString(ref.ref);
            if (refStr === null) return null;
            return {
              ref: refStr,
              fromStep: asNumber(ref.from_step),
              jsonPath: asString(ref.json_path),
            };
          })
          .filter((r): r is ParsedSequenceRef => r !== null)
      : [];
    steps.push({
      index: asNumber(step.index) ?? position,
      role: asString(step.role) ?? 'act',
      kind: asString(step.kind) ?? 'http',
      method: (asString(request?.method) ?? '').toUpperCase(),
      path: asString(request?.path) ?? '',
      expectedStatus: asNumber(step.expected_status),
      refs,
    });
  });

  if (steps.length === 0) return null;

  return {
    steps,
    actStepIndex: asNumber(root.act_step_index),
    cleanupBestEffort: root.cleanup_best_effort !== false,
  };
}

/** Human label for a step role. */
function roleLabel(role: string): string {
  switch (role) {
    case 'setup':
      return 'Setup';
    case 'act':
      return 'Act';
    case 'cleanup':
      return 'Cleanup';
    default:
      return role || 'Step';
  }
}

/**
 * Map a role to a distinct existing status-badge class so the three roles read
 * apart at a glance without a new colour system: act == active (the behaviour
 * under test), setup == draft (precondition), cleanup == archived (teardown).
 */
function roleBadgeClass(role: string): string {
  switch (role) {
    case 'act':
      return styles.statusActive;
    case 'setup':
      return styles.statusDraft;
    case 'cleanup':
      return styles.statusArchived;
    default:
      return styles.statusDraft;
  }
}

export interface BaselineSequenceViewProps {
  /** The baseline item's raw `sequence_json` (null => render nothing). */
  sequenceJson: Record<string, unknown> | null | undefined;
}

export const BaselineSequenceView: React.FC<BaselineSequenceViewProps> = ({
  sequenceJson,
}) => {
  const seq = parseSequenceJson(sequenceJson);
  if (!seq) return null;

  return (
    <div className={styles.detailRow} data-testid="baseline-detail-sequence">
      <span className={styles.detailKey}>Sequence:</span>
      <div style={{ display: 'block', width: '100%' }}>
        <div data-testid="baseline-detail-sequence-meta" style={{ marginBottom: 4 }}>
          {seq.steps.length} step{seq.steps.length === 1 ? '' : 's'}
          {seq.actStepIndex !== null ? ` (act at index ${seq.actStepIndex})` : ''}
          {seq.cleanupBestEffort ? ' — cleanup best-effort' : ''}
        </div>
        <ul
          className={styles.list}
          data-testid="baseline-detail-sequence-steps"
        >
          {seq.steps.map((step, i) => (
            <li
              key={`${step.index}-${i}`}
              className={styles.row}
              style={{ display: 'block' }}
              data-testid="baseline-detail-sequence-step"
              data-step-index={step.index}
              data-step-role={step.role}
            >
              <div className={styles.detailRow}>
                <span style={{ color: '#666', marginRight: 6 }}>
                  #{step.index}
                </span>
                <span
                  className={`${styles.statusBadge} ${roleBadgeClass(step.role)}`}
                  data-testid="baseline-detail-sequence-step-role"
                  data-role={step.role}
                >
                  {roleLabel(step.role)}
                </span>{' '}
                <strong>{step.method || '?'}</strong> {step.path || '(no path)'}
                {step.expectedStatus !== null ? (
                  <span style={{ color: '#666' }}>
                    {' '}
                    — expects {step.expectedStatus}
                  </span>
                ) : null}
              </div>
              {step.refs.length > 0 && (
                <div className={styles.detailRow}>
                  <span className={styles.detailKey}>Refs:</span>
                  <span data-testid="baseline-detail-sequence-step-refs">
                    {step.refs.map((r, ri) => (
                      <code
                        key={`${r.ref}-${ri}`}
                        className={styles.contentHash}
                        style={{ marginRight: 6 }}
                        data-testid="baseline-detail-sequence-ref"
                        data-ref={r.ref}
                      >
                        {r.ref}
                      </code>
                    ))}
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default BaselineSequenceView;
