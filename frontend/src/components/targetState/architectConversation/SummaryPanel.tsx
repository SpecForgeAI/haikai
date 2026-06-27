/**
 * SummaryPanel
 *
 * Spec: 2026-05-24 Target State Architect-Persona Conversation -- Commit 5, Surface 7 support
 *       (extended 2026-05-25 Tech-Stack.md Pre-fill, Task Group 5: source-quote review)
 *
 * Right-side panel always visible during the conversation. Renders the
 * captured-decision rows grouped by scope (architecture-wide first, then
 * per-element exceptions grouped by element). Each row is clickable to open
 * the revise-prior-answer flow (Surface 7).
 *
 * Per Q8 the panel visually distinguishes `'deferred'` rows from un-answered
 * questions. Un-answered questions are NOT in `capturedDecisions[]` (they
 * have no row); the panel does not surface them -- the count of un-answered
 * is implicit in the close-conversation gate.
 *
 * 2026-05-25 Tech-Stack.md Pre-fill (Task Group 5): rows whose
 * `createdByTask === 'tech-stack-md-prefill'` carry a JSON `answerValue` of
 * shape `{ value, sourceQuote, sourceFile }`. The panel unwraps that JSON at
 * render time and shows an expandable "Source" subsection under the row so
 * the reviewer can audit the verbatim quote the LLM extracted. Source-quote
 * text appears ONLY on this review surface; the main transcript pane never
 * renders it (per Q22 isolation rule).
 *
 * The "Preview prompt-ready output" link surfaces Spec 2's
 * `TargetStateDecisionsContextResolver` output. The parent tab wires
 * `onPreviewPromptOutput` to the gateway
 * `.../architect-conversation/prompt-ready-output` endpoint and renders the
 * resolver's grouped-by-scope markdown in a read-only modal.
 */

import { forwardRef, useMemo, useState } from 'react';
import {
  OPT_OUT_ANSWER_VALUE,
  type CapturedDecisionRow,
} from '../../../api/architectConversationApi';
import styles from './ArchitectConversation.module.css';

export const TECH_STACK_PREFILL_TASK_NAME = 'tech-stack-md-prefill';

export interface SummaryPanelProps {
  decisions: CapturedDecisionRow[];
  onReviseDecision?: (decision: CapturedDecisionRow) => void;
  onPreviewPromptOutput?: () => void;
}

interface GroupedSummary {
  architectureRows: CapturedDecisionRow[];
  elementGroups: { groupKey: string; refType: string; refId: string; rows: CapturedDecisionRow[] }[];
}

function groupByScope(rows: CapturedDecisionRow[]): GroupedSummary {
  const architectureRows: CapturedDecisionRow[] = [];
  const elementMap = new Map<string, CapturedDecisionRow[]>();
  for (const row of rows) {
    if (row.scopeKind === 'architecture') {
      architectureRows.push(row);
    } else if (row.scopeRefType && row.scopeRefId) {
      const key = `${row.scopeRefType}:${row.scopeRefId}`;
      const arr = elementMap.get(key) ?? [];
      arr.push(row);
      elementMap.set(key, arr);
    }
  }
  const elementGroups = Array.from(elementMap.entries()).map(([key, rs]) => {
    const [refType, refId] = key.split(':');
    return { groupKey: key, refType, refId, rows: rs };
  });
  return { architectureRows, elementGroups };
}

/**
 * Pre-fill rows wrap their `answerValue` as JSON `{ value, sourceQuote,
 * sourceFile }`. Parse defensively so a malformed row never throws and
 * falls back to "raw value, no source".
 */
interface PrefillUnwrapped {
  value: string;
  sourceQuote: string | null;
  sourceFile: string | null;
}

function unwrapPrefillAnswerValue(raw: string): PrefillUnwrapped {
  try {
    const parsed = JSON.parse(raw) as Partial<PrefillUnwrapped> & {
      value?: unknown;
      sourceQuote?: unknown;
      sourceFile?: unknown;
    };
    return {
      value:
        typeof parsed.value === 'string' && parsed.value.length > 0
          ? parsed.value
          : raw,
      sourceQuote:
        typeof parsed.sourceQuote === 'string' && parsed.sourceQuote.length > 0
          ? parsed.sourceQuote
          : null,
      sourceFile:
        typeof parsed.sourceFile === 'string' && parsed.sourceFile.length > 0
          ? parsed.sourceFile
          : null,
    };
  } catch {
    return { value: raw, sourceQuote: null, sourceFile: null };
  }
}

export const SummaryPanel = forwardRef<HTMLDivElement, SummaryPanelProps>(
  function SummaryPanel(
    { decisions, onReviseDecision, onPreviewPromptOutput },
    ref,
  ) {
    const grouped = useMemo(() => groupByScope(decisions), [decisions]);

    return (
      <aside
        ref={ref}
        className={styles.summaryPanel}
        data-testid="architect-conversation-summary-panel"
        tabIndex={-1}
      >
        <h3 style={{ margin: 0 }}>Decisions Captured</h3>

        <div className={styles.summaryGroup}>
          <div className={styles.summaryGroupHeader}>Architecture-wide</div>
          {grouped.architectureRows.length === 0 ? (
            <p
              style={{ fontSize: '0.85rem', color: '#57606a', margin: 0 }}
              data-testid="architect-conversation-summary-empty"
            >
              No decisions captured yet.
            </p>
          ) : (
            grouped.architectureRows.map((row) => (
              <SummaryRow
                key={row.decisionId}
                row={row}
                onClick={onReviseDecision ? () => onReviseDecision(row) : undefined}
              />
            ))
          )}
        </div>

        {grouped.elementGroups.map((group) => (
          <div className={styles.summaryGroup} key={group.groupKey}>
            <div className={styles.summaryGroupHeader}>
              {group.refType}: {group.refId}
            </div>
            {group.rows.map((row) => (
              <SummaryRow
                key={row.decisionId}
                row={row}
                onClick={onReviseDecision ? () => onReviseDecision(row) : undefined}
              />
            ))}
          </div>
        ))}

        <div className={styles.summaryPanelFooter}>
          <button
            type="button"
            className={styles.linkButton}
            onClick={onPreviewPromptOutput}
            data-testid="architect-conversation-summary-preview-prompt-link"
          >
            Preview prompt-ready output
          </button>
        </div>
      </aside>
    );
  },
);

interface SummaryRowProps {
  row: CapturedDecisionRow;
  onClick?: () => void;
}

function SummaryRow({ row, onClick }: SummaryRowProps) {
  const isDeferred = row.answerValue === 'deferred';
  const isNotApplicable = row.answerValue === OPT_OUT_ANSWER_VALUE;
  const isPrefill = row.createdByTask === TECH_STACK_PREFILL_TASK_NAME;
  const [expanded, setExpanded] = useState(false);

  const unwrapped = useMemo(
    () => (isPrefill ? unwrapPrefillAnswerValue(row.answerValue) : null),
    [isPrefill, row.answerValue],
  );

  const displayValue = isDeferred
    ? 'Deferred'
    : isNotApplicable
      ? 'N/A'
      : unwrapped?.value ?? row.answerSummary ?? String(row.answerValue);

  return (
    <div
      className={styles.summaryRow}
      data-testid={`architect-conversation-summary-row-${row.decisionCode}`}
      data-deferred={isDeferred ? 'true' : 'false'}
      data-prefill={isPrefill ? 'true' : 'false'}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
        <span className={styles.summaryRowCode}>{row.decisionCode}</span>
        <span
          className={`${styles.summaryRowValue} ${isDeferred ? styles.summaryRowDeferred : ''}`}
        >
          {displayValue}
        </span>
      </div>
      {isPrefill && unwrapped?.sourceQuote && (
        <div style={{ width: '100%' }}>
          <button
            type="button"
            className={styles.linkButton}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            data-testid={`architect-conversation-summary-source-toggle-${row.decisionCode}`}
            aria-expanded={expanded}
          >
            {expanded ? 'Hide source' : 'Show source'}
          </button>
          {expanded && (
            <div
              data-testid={`architect-conversation-summary-source-${row.decisionCode}`}
              style={{
                marginTop: '0.25rem',
                padding: '0.5rem',
                background: '#f6f8fa',
                border: '1px solid #d0d7de',
                borderRadius: 4,
                fontSize: '0.8rem',
                whiteSpace: 'pre-wrap',
              }}
            >
              <div
                style={{
                  fontWeight: 600,
                  fontSize: '0.7rem',
                  textTransform: 'uppercase',
                  color: '#57606a',
                  marginBottom: '0.25rem',
                }}
              >
                Source quote
                {unwrapped.sourceFile ? ` (${unwrapped.sourceFile})` : ''}
              </div>
              <span data-testid={`architect-conversation-summary-source-quote-${row.decisionCode}`}>
                {unwrapped.sourceQuote}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
