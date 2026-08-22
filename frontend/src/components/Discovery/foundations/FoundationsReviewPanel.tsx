/**
 * FoundationsReviewPanel (Foundations & Scope program, Spec 2, 2026-08-22).
 *
 * The estate-triage section that rides ON the DB-scan review (one scan, one
 * review, one save): derives the open foundation questions from the run's
 * candidates + the architecture's stored decisions, renders one card per
 * question (recommended default pre-selected, per-target opt-out, cascade
 * preview line), and applies answers through the gateway -> MCP
 * (model-write owner). Unanswered questions never block — safe defaults
 * apply downstream. A card whose stored decision went stale shows the
 * previous answer chip.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { DiscoveryCandidateDto } from '../../../api/discoveryApi';
import {
  applyFoundationDecisions,
  listFoundationDecisions,
  type ApplyFoundationDecisionInput,
  type FoundationDecisionDto,
} from '../../../api/foundationsApi';
import {
  deriveFoundationQuestions,
  entityFactsFromCandidates,
  type FoundationQuestion,
} from './foundationRules';

export interface FoundationsReviewPanelProps {
  projectId: string;
  architectureId: string;
  candidates: DiscoveryCandidateDto[];
  /** Fired after answers were applied (the page refetches candidates). */
  onApplied?: () => void;
}

const cardStyle: React.CSSProperties = {
  border: '1px solid #ddd',
  borderRadius: 6,
  padding: '10px 12px',
  marginBottom: 10,
  background: '#fbfbfb',
};

export const FoundationsReviewPanel: React.FC<FoundationsReviewPanelProps> = ({
  projectId,
  architectureId,
  candidates,
  onApplied,
}) => {
  const [decisions, setDecisions] = useState<FoundationDecisionDto[]>([]);
  const [decisionsLoaded, setDecisionsLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [excludedTargets, setExcludedTargets] = useState<Record<string, Set<string>>>({});
  const [applying, setApplying] = useState(false);
  const [applyNote, setApplyNote] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [showDecided, setShowDecided] = useState(false);

  const refetchDecisions = useCallback(async () => {
    try {
      const list = await listFoundationDecisions(projectId, architectureId);
      setDecisions(list);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load foundation decisions');
    } finally {
      setDecisionsLoaded(true);
    }
  }, [projectId, architectureId]);

  useEffect(() => {
    void refetchDecisions();
  }, [refetchDecisions]);

  const facts = useMemo(() => entityFactsFromCandidates(candidates), [candidates]);

  const questions: FoundationQuestion[] = useMemo(() => {
    if (!decisionsLoaded || facts.length === 0) return [];
    return deriveFoundationQuestions(
      facts,
      decisions.map((d) => ({
        decision_key: d.decision_key,
        rule_key: d.rule_key,
        answer: d.answer,
        scope: d.scope,
        targets_json: d.targets_json ?? [],
        evidence_hash: d.evidence_hash,
        stale: d.stale,
      })),
    );
  }, [facts, decisions, decisionsLoaded]);

  const selectedAnswer = useCallback(
    (q: FoundationQuestion): string =>
      selected[q.question_key] ??
      q.options.find((o) => o.recommended)?.answer ??
      q.options[0]?.answer ??
      '',
    [selected],
  );

  const includedTargets = useCallback(
    (q: FoundationQuestion): string[] => {
      const excluded = excludedTargets[q.question_key] ?? new Set<string>();
      return q.targets.map((t) => t.entity_name).filter((n) => !excluded.has(n));
    },
    [excludedTargets],
  );

  const nextDecisionKey = useCallback(
    (offset: number): string => {
      const used = new Set(decisions.map((d) => d.decision_key));
      let n = decisions.length + 1 + offset;
      while (used.has(`F-${n}`)) n += 1;
      return `F-${n}`;
    },
    [decisions],
  );

  const handleApply = async () => {
    if (applying) return;
    const inputs: ApplyFoundationDecisionInput[] = [];
    let fresh = 0;
    for (const q of questions) {
      const answer = selectedAnswer(q);
      const option = q.options.find((o) => o.answer === answer);
      const targets = includedTargets(q);
      if (!option || targets.length === 0) continue;
      const decisionKey = q.stale_decision?.decision_key ?? nextDecisionKey(fresh);
      if (!q.stale_decision) fresh += 1;
      inputs.push({
        decision_key: decisionKey,
        rule_key: q.rule_key,
        question_text: q.title,
        answer: option.answer,
        scope: option.scope ?? null,
        target_entity_names: targets,
        payload_json: option.payload ?? null,
        rationale: 'answered in the DB-scan foundations review',
        evidence_hash: q.evidence_hash,
      });
    }
    if (inputs.length === 0) return;
    setApplying(true);
    setApplyError(null);
    setApplyNote(null);
    try {
      const result = await applyFoundationDecisions(projectId, architectureId, inputs);
      setApplyNote(
        `${result.decisions_upserted} decision(s) recorded · ${result.entities_updated} ` +
          `entit${result.entities_updated === 1 ? 'y' : 'ies'} tagged` +
          (result.skipped.length > 0 ? ` · ${result.skipped.length} target(s) skipped` : ''),
      );
      await refetchDecisions();
      onApplied?.();
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : 'Apply failed');
    } finally {
      setApplying(false);
    }
  };

  if (facts.length === 0) return null;

  return (
    <div data-testid="foundations-review-panel" style={{ marginBottom: 16 }}>
      <h3 style={{ margin: '0 0 4px' }}>
        Foundations review{' '}
        {decisionsLoaded && (
          <span style={{ fontWeight: 400, color: '#555' }}>
            — {questions.length} open question{questions.length === 1 ? '' : 's'} ·{' '}
            {decisions.length} decided
          </span>
        )}
      </h3>
      <p style={{ margin: '0 0 8px', color: '#555', fontSize: 13 }}>
        Estate-level decisions taken here become durable model facts every later stage cites
        (capture, S0, pack, reconciliation). Unanswered questions use safe defaults — include
        everything, keys fail-closed — and never block the save.
      </p>
      {loadError && (
        <p style={{ color: '#b26a00' }} data-testid="foundations-load-error">
          Decisions could not be loaded ({loadError}) — questions shown without settled-state
          filtering.
        </p>
      )}

      {questions.map((q) => {
        const answer = selectedAnswer(q);
        const excluded = excludedTargets[q.question_key] ?? new Set<string>();
        const included = includedTargets(q);
        const attributeCount = q.targets
          .filter((t) => !excluded.has(t.entity_name))
          .reduce((sum, t) => sum + t.attribute_count, 0);
        return (
          <div key={q.question_key} style={cardStyle} data-testid={`foundation-q-${q.question_key}`}>
            <div style={{ fontWeight: 600 }}>
              {q.title}
              {q.stale_decision && (
                <span
                  style={{
                    marginLeft: 8,
                    color: '#b26a00',
                    fontWeight: 500,
                    fontSize: 12,
                  }}
                  data-testid={`foundation-q-${q.question_key}-stale`}
                >
                  STALE — previously {q.stale_decision.decision_key}:{' '}
                  {q.stale_decision.previous_answer} (evidence changed)
                </span>
              )}
            </div>
            <div style={{ color: '#555', fontSize: 13, margin: '2px 0 6px' }}>{q.detail}</div>
            {q.targets.length > 1 ? (
              <details style={{ marginBottom: 6 }}>
                <summary style={{ cursor: 'pointer', fontSize: 13 }}>
                  {included.length} of {q.targets.length} table(s) selected
                </summary>
                <ul style={{ margin: '4px 0 0 18px', fontSize: 13 }}>
                  {q.targets.map((t) => (
                    <li key={t.entity_name}>
                      <label>
                        <input
                          type="checkbox"
                          checked={!excluded.has(t.entity_name)}
                          onChange={(e) =>
                            setExcludedTargets((prev) => {
                              const next = new Set(prev[q.question_key] ?? []);
                              if (e.target.checked) next.delete(t.entity_name);
                              else next.add(t.entity_name);
                              return { ...prev, [q.question_key]: next };
                            })
                          }
                        />{' '}
                        <code>{t.entity_name}</code>
                        {t.note ? <span style={{ color: '#777' }}> — {t.note}</span> : null}
                      </label>
                    </li>
                  ))}
                </ul>
              </details>
            ) : (
              q.targets[0]?.note && (
                <div style={{ fontSize: 13, color: '#777', marginBottom: 6 }}>
                  {q.targets[0].note}
                </div>
              )
            )}
            {q.options.map((o) => (
              <label key={o.answer} style={{ display: 'block', fontSize: 13 }}>
                <input
                  type="radio"
                  name={`fq-${q.question_key}`}
                  checked={answer === o.answer}
                  onChange={() =>
                    setSelected((prev) => ({ ...prev, [q.question_key]: o.answer }))
                  }
                />{' '}
                {o.label}
              </label>
            ))}
            <div style={{ fontSize: 12, color: '#777', marginTop: 4 }}>
              Cascade: {included.length} table(s), {attributeCount} attribute(s) ride along;
              relationships touching excluded tables follow automatically.
            </div>
          </div>
        );
      })}

      {questions.length === 0 && decisionsLoaded && (
        <p style={{ color: '#1b5e20', fontSize: 13 }} data-testid="foundations-all-settled">
          No open foundation questions — all settled for the current evidence.
        </p>
      )}

      {questions.length > 0 && (
        <button
          type="button"
          onClick={handleApply}
          disabled={applying}
          data-testid="foundations-apply"
          style={{ padding: '6px 14px', cursor: 'pointer' }}
        >
          {applying ? 'Applying…' : `Apply ${questions.length} answer(s)`}
        </button>
      )}
      {applyNote && (
        <p style={{ color: '#1b5e20', fontSize: 13 }} data-testid="foundations-apply-note">
          {applyNote}
        </p>
      )}
      {applyError && (
        <p style={{ color: '#c62828', fontSize: 13 }} data-testid="foundations-apply-error">
          {applyError}
        </p>
      )}

      {decisions.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            onClick={() => setShowDecided((v) => !v)}
            data-testid="foundations-decided-toggle"
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              textDecoration: 'underline',
              color: '#555',
              fontSize: 13,
            }}
          >
            {showDecided ? 'Hide' : 'Show'} decided ({decisions.length})
          </button>
          {showDecided && (
            <ul style={{ margin: '4px 0 0 18px', fontSize: 13 }}>
              {decisions.map((d) => (
                <li key={d.decision_key} data-testid={`foundation-decision-${d.decision_key}`}>
                  <strong>{d.decision_key}</strong> · {d.rule_key} → {d.answer}
                  {d.scope ? ` (${d.scope})` : ''} ·{' '}
                  {(d.targets_json ?? []).length} target(s)
                  {d.stale ? (
                    <span style={{ color: '#b26a00' }}> · STALE — re-confirm above</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default FoundationsReviewPanel;
