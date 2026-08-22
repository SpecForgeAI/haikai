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
  fetchRawModelForFoundations,
  listFoundationDecisions,
  type ApplyFoundationDecisionInput,
  type FoundationDecisionDto,
} from '../../../api/foundationsApi';
import {
  deriveFoundationQuestions,
  deriveJointFoundationQuestions,
  entityFactsFromCandidates,
  type FoundationQuestion,
  type RawModelLike,
} from './foundationRules';

export interface FoundationsReviewPanelProps {
  projectId: string;
  architectureId: string;
  candidates: DiscoveryCandidateDto[];
  /** 'database' (default): DB-side rules over this run's candidates.
   *  'code' (Spec 5): JOINT CRUD-matrix rules over the committed model
   *  (never-CRUDed / write-only / read-only / excluded-but-code-touches). */
  mode?: 'database' | 'code';
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
  mode = 'database',
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

  // JOINT mode (Spec 5): the committed model is the evidence source.
  const [rawModel, setRawModel] = useState<RawModelLike | null>(null);
  useEffect(() => {
    if (mode !== 'code') return;
    let cancelled = false;
    void fetchRawModelForFoundations(projectId, architectureId).then((m) => {
      if (!cancelled) setRawModel((m as RawModelLike) ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [mode, projectId, architectureId]);

  const questions: FoundationQuestion[] = useMemo(() => {
    if (!decisionsLoaded) return [];
    if (mode === 'code') {
      if (!rawModel) return [];
      return deriveJointFoundationQuestions(
        rawModel,
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
    }
    if (facts.length === 0) return [];
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
  }, [facts, decisions, decisionsLoaded, mode, rawModel]);

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

  // LIVE suppression (Spec 2 follow-up, 2026-08-22): a table covered by a
  // PENDING exclude/volatile answer in one card asks no questions in any
  // OTHER card — conflicting questions are forbidden. Changing the answer
  // back reveals the dependents again (pure recompute, nothing is lost).
  const pendingScopeByTable = useMemo(() => {
    const map = new Map<string, string>(); // lowercase table -> question_key
    for (const q of questions) {
      const answer = selectedAnswer(q);
      const option = q.options.find((o) => o.answer === answer);
      const scope = option?.scope;
      if (scope !== 'excluded' && scope !== 'volatile') continue;
      const userExcluded = excludedTargets[q.question_key] ?? new Set<string>();
      for (const target of q.targets) {
        if (userExcluded.has(target.entity_name)) continue;
        const key = target.entity_name.toLowerCase();
        if (!map.has(key)) map.set(key, q.question_key);
      }
    }
    return map;
  }, [questions, selectedAnswer, excludedTargets]);

  /** Targets of `q` NOT covered by a pending exclusion from ANOTHER card. */
  const remainingTargets = useCallback(
    (q: FoundationQuestion) =>
      q.targets.filter((t) => {
        const coveredBy = pendingScopeByTable.get(t.entity_name.toLowerCase());
        return !coveredBy || coveredBy === q.question_key;
      }),
    [pendingScopeByTable],
  );

  const visibleQuestions = useMemo(
    () => questions.filter((q) => remainingTargets(q).length > 0),
    [questions, remainingTargets],
  );
  const hiddenCount = questions.length - visibleQuestions.length;

  /** Apply-time targets: user-included MINUS pending-covered-elsewhere. */
  const effectiveTargets = useCallback(
    (q: FoundationQuestion): string[] => {
      const remaining = new Set(remainingTargets(q).map((t) => t.entity_name));
      return includedTargets(q).filter((n) => remaining.has(n));
    },
    [includedTargets, remainingTargets],
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
    for (const q of visibleQuestions) {
      const answer = selectedAnswer(q);
      const option = q.options.find((o) => o.answer === answer);
      const targets = effectiveTargets(q);
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

  if (mode === 'database' && facts.length === 0) return null;
  if (mode === 'code' && questions.length === 0 && decisions.length === 0) return null;

  return (
    <div data-testid="foundations-review-panel" style={{ marginBottom: 16 }}>
      <h3 style={{ margin: '0 0 4px' }}>
        Foundations review{' '}
        {decisionsLoaded && (
          <span style={{ fontWeight: 400, color: '#555' }}>
            — {visibleQuestions.length} open question
            {visibleQuestions.length === 1 ? '' : 's'} · {decisions.length} decided
          </span>
        )}
      </h3>
      <p style={{ margin: '0 0 8px', color: '#555', fontSize: 13 }}>
        Estate-level decisions taken here become durable model facts every later stage cites
        (capture, S0, pack, reconciliation). Unanswered questions use safe defaults — include
        everything, keys fail-closed — and never block the save.
      </p>
      {hiddenCount > 0 && (
        <p
          style={{ color: '#777', fontSize: 13, margin: '0 0 8px' }}
          data-testid="foundations-hidden-note"
        >
          {hiddenCount} question{hiddenCount === 1 ? '' : 's'} hidden — their tables are
          covered by a pending exclude/volatile answer above. Change that answer to bring
          them back.
        </p>
      )}
      {loadError && (
        <p style={{ color: '#b26a00' }} data-testid="foundations-load-error">
          Decisions could not be loaded ({loadError}) — questions shown without settled-state
          filtering.
        </p>
      )}

      {visibleQuestions.map((q) => {
        const answer = selectedAnswer(q);
        const excluded = excludedTargets[q.question_key] ?? new Set<string>();
        const cardTargets = remainingTargets(q);
        const included = effectiveTargets(q);
        const attributeCount = cardTargets
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
            {cardTargets.length > 1 ? (
              <details style={{ marginBottom: 6 }}>
                <summary style={{ cursor: 'pointer', fontSize: 13 }}>
                  {included.length} of {cardTargets.length} table(s) selected
                </summary>
                <ul style={{ margin: '4px 0 0 18px', fontSize: 13 }}>
                  {cardTargets.map((t) => (
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
              cardTargets[0]?.note && (
                <div style={{ fontSize: 13, color: '#777', marginBottom: 6 }}>
                  {cardTargets[0].note}
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

      {visibleQuestions.length === 0 && decisionsLoaded && (
        <p style={{ color: '#1b5e20', fontSize: 13 }} data-testid="foundations-all-settled">
          No open foundation questions — all settled for the current evidence.
        </p>
      )}

      {visibleQuestions.length > 0 && (
        <button
          type="button"
          onClick={handleApply}
          disabled={applying}
          data-testid="foundations-apply"
          style={{ padding: '6px 14px', cursor: 'pointer' }}
        >
          {applying ? 'Applying…' : `Apply ${visibleQuestions.length} answer(s)`}
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
