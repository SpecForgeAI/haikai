/**
 * DbMigrationPackTranslationReviewer
 *
 * Spec: 2026-06-11 LLM-Assisted DB Object Translation Drafts —
 * Task Group 5 (Task 5.5).
 *
 * Side-by-side draft reviewer built on the `MigrationDeliveryInlineDiff.tsx`
 * precedent: it reuses the exported `computeLineDiff` LCS to ALIGN the two
 * panes — source T-SQL on the left, draft PL/pgSQL on the right — with
 * removed-only lines tinted red on the left and added-only lines tinted
 * green on the right.
 *
 * Alongside the panes:
 *   - the judge verdict + confidence + the construct/concern/severity flags
 *     table (flags INFORM the reviewer, they never gate the actions);
 *   - prominent fidelity warning banners — "body truncated at capture"
 *     (terminal `needs_manual`, NO review possible) and "literals collapsed
 *     at capture — re-scan recommended" (`legacy_redacted`, reviewable but
 *     warned);
 *   - review controls: approve / reject / needs-rework, each with optional
 *     notes (needs-rework notes encouraged); reviewed-at shown after action.
 *
 * There is deliberately NO editing affordance for the draft SQL anywhere —
 * the draft is a starting artifact for the reviewer's IDE (spec rule).
 */

import React, { useMemo, useState } from 'react';
import { computeLineDiff } from '../MigrationDeliveryDashboard/MigrationDeliveryInlineDiff';
import type {
  DbMigrationPackParityReport,
  DbMigrationPackTranslationAttempt,
  DbMigrationPackTranslationDto,
  DbMigrationPackTranslationReviewAction,
  DbMigrationPackWaiverScope,
} from '../../../api/dbMigrationPackApi';
import {
  loopStatusLabel,
  verdictLabel,
} from './dbMigrationPackWorkbench';
import styles from './DbMigrationPack.module.css';

/**
 * Workbench evidence bundle (2026-09-09 Spec 4). Present ONLY for routine
 * rows the loop manages; absent for views / jobs / check constraints, which
 * keep the original reviewer exactly as it was.
 */
export interface DbMigrationPackReviewerWorkbench {
  attempts: DbMigrationPackTranslationAttempt[];
  parityReport: DbMigrationPackParityReport | null;
  evidenceLoading: boolean;
  evidenceError: string | null;
  /** The server's 409 reason from the last blocked Approve, if any. */
  approveReason: string | null;
  /** Reviewer guidance feeds the NEXT loop attempt (decision 16). */
  onGuidanceRetry: (guidance: string) => void;
  onWaive: (
    scope: DbMigrationPackWaiverScope,
    scenario: string | null,
    reason: string,
  ) => void;
}

export interface DbMigrationPackTranslationReviewerProps {
  translation: DbMigrationPackTranslationDto;
  busy: boolean;
  onReview: (
    action: DbMigrationPackTranslationReviewAction,
    notes: string,
  ) => void;
  onClose: () => void;
  /**
   * Supply the FULL source body for a truncated capture (2026-08-07): the
   * old terminal "translate it by hand in your IDE" dead-end is gone.
   */
  onSupplyBody?: (sourceBody: string) => void;
  /** Source engine display name (pane title); neutral when absent. */
  sourceEngineDisplay?: string | null;
  /** Behaviour evidence + guidance/waive controls for a routine row. */
  workbench?: DbMigrationPackReviewerWorkbench;
}

interface AlignedLine {
  left: string | null;
  right: string | null;
  op: 'equal' | 'added' | 'removed';
}

export const DbMigrationPackTranslationReviewer: React.FC<
  DbMigrationPackTranslationReviewerProps
> = ({ translation, busy, onReview, onClose, onSupplyBody, workbench, sourceEngineDisplay }) => {
  const [notes, setNotes] = useState<string>(translation.reviewer_notes ?? '');
  const [suppliedBody, setSuppliedBody] = useState<string>('');
  // --- workbench-only local state (2026-09-09 Spec 4) ------------------------
  const [guidance, setGuidance] = useState<string>('');
  const [openDiffAttempt, setOpenDiffAttempt] = useState<number | null>(null);
  const [waiveOpen, setWaiveOpen] = useState(false);
  const [waiveScope, setWaiveScope] =
    useState<DbMigrationPackWaiverScope>('routine');
  const [waiveScenario, setWaiveScenario] = useState<string>('');
  const [waiveReason, setWaiveReason] = useState<string>('');
  const [waiveError, setWaiveError] = useState<string | null>(null);

  const sourceBody = translation.source_body ?? '';
  const draftContent = translation.draft_content ?? '';
  const hasDraft = draftContent.length > 0;
  const isNeedsManual = translation.pipeline_state === 'needs_manual';
  const verdict = translation.judge_verdict_json;
  const flags = Array.isArray(verdict?.flags) ? verdict!.flags! : [];

  // LCS-aligned side-by-side rows (MigrationDeliveryInlineDiff precedent).
  const alignedLines = useMemo<AlignedLine[]>(() => {
    if (!hasDraft) {
      return sourceBody
        .split('\n')
        .map((text) => ({ left: text, right: null, op: 'removed' as const }));
    }
    return computeLineDiff(sourceBody, draftContent).map((line) => ({
      left: line.op === 'added' ? null : line.text,
      right: line.op === 'removed' ? null : line.text,
      op: line.op,
    }));
  }, [sourceBody, draftContent, hasDraft]);

  // Review is possible only for a drafted row carrying its judge verdict —
  // unverified drafts never become reviewable, needs_manual is terminal.
  // A workbench routine row is reviewable whenever it has a draft: the loop
  // may have left it `exhausted` / `apply_failed`, and the reviewer is exactly
  // where the human decides what to do about that (approve is still gated
  // SERVER-side on evidence and answers 409 with the reason).
  const reviewable =
    !isNeedsManual &&
    hasDraft &&
    (translation.pipeline_state === 'drafted' || workbench !== undefined);

  // Failing scenarios only — the reviewer's job is the divergences.
  const failingScenarios = useMemo(
    () =>
      (workbench?.parityReport?.scenarios ?? []).filter(
        (scenario) =>
          scenario.verdict !== 'match' && scenario.verdict !== 'tolerated',
      ),
    [workbench?.parityReport],
  );

  const attempts = workbench?.attempts ?? [];

  /** LCS diff of one attempt's draft against the previous attempt's. */
  const diffForAttempt = (attemptNo: number) => {
    const index = attempts.findIndex((a) => a.attemptNo === attemptNo);
    if (index <= 0) return null;
    const previous = attempts[index - 1].draftContent ?? '';
    const current = attempts[index].draftContent ?? '';
    return computeLineDiff(previous, current);
  };

  const submitWaiver = () => {
    const reason = waiveReason.trim();
    if (!reason) {
      setWaiveError(
        'A reason is required — every waived routine or scenario carries one.',
      );
      return;
    }
    if (waiveScope === 'scenario' && waiveScenario.trim().length === 0) {
      setWaiveError('Pick the scenario this waiver covers.');
      return;
    }
    setWaiveError(null);
    workbench?.onWaive(
      waiveScope,
      waiveScope === 'scenario' ? waiveScenario.trim() : null,
      reason,
    );
    setWaiveOpen(false);
    setWaiveReason('');
  };

  return (
    <div
      className={styles.manifestSection}
      data-testid="db-pack-translation-reviewer"
    >
      <div className={styles.reviewerHeader}>
        <div>
          <h4 className={styles.manifestSectionTitle}>
            <span className={styles.badge}>{translation.kind}</span>{' '}
            {translation.object_ref}
          </h4>
          <p className={styles.manifestNote}>
            {translation.translation_key}
            {translation.translated_at
              ? ` · drafted ${translation.translated_at}`
              : ''}
          </p>
        </div>
        <button
          type="button"
          className={styles.actionButton}
          onClick={onClose}
          data-testid="db-pack-translation-reviewer-close"
        >
          Close
        </button>
      </div>

      {/* Fidelity warning banners (prominent, above the panes). */}
      {translation.truncated === true && (
        <div
          className={styles.errorBanner}
          data-testid="db-pack-translation-truncated-banner"
        >
          Body truncated at capture (64KB cap) — no review is possible for
          this object until the FULL source body is supplied. Paste it below
          (from the original source) and the pipeline re-translates it; no
          manual translation outside the tool.
        </div>
      )}
      {translation.truncated === true && onSupplyBody && (
        <div
          className={styles.manifestSection}
          data-testid="db-pack-translation-supply-body"
        >
          <textarea
            className={styles.reviewerNotesInput}
            rows={10}
            placeholder="Paste the COMPLETE source body here…"
            value={suppliedBody}
            onChange={(e) => setSuppliedBody(e.target.value)}
            disabled={busy}
            data-testid="db-pack-translation-supply-body-input"
          />
          <button
            type="button"
            className={styles.actionButton}
            disabled={busy || suppliedBody.trim().length === 0}
            onClick={() => onSupplyBody(suppliedBody)}
            data-testid="db-pack-translation-supply-body-submit"
          >
            Supply full source body
          </button>
        </div>
      )}
      {translation.legacy_redacted === true && (
        <div
          className={styles.staleBanner}
          data-testid="db-pack-translation-legacy-banner"
        >
          <span>
            Source literals collapsed at capture — re-scan recommended. This
            body was captured before the targeted-scrub redaction fix; string
            literals were blanket-collapsed, so the draft may be incomplete.
            Re-run discovery to capture the full body.
          </span>
        </div>
      )}

      {/* Side-by-side panes: source T-SQL left, draft PL/pgSQL right. */}
      <div className={styles.reviewerLayout}>
        <div
          className={styles.reviewerPane}
          data-testid="db-pack-translation-source"
        >
          <div className={styles.reviewerPaneTitle}>Source T-SQL ({sourceEngineDisplay ?? 'source engine'})</div>
          {alignedLines.map((line, idx) => (
            <div
              key={`l-${idx}`}
              className={`${styles.reviewerLine} ${
                line.left === null
                  ? styles.reviewerLineBlank
                  : line.op === 'removed'
                    ? styles.reviewerLineRemoved
                    : ''
              }`}
            >
              {line.left === null || line.left === ''
                ? ' '
                : line.left}
            </div>
          ))}
        </div>
        <div
          className={styles.reviewerPane}
          data-testid="db-pack-translation-draft"
        >
          <div className={styles.reviewerPaneTitle}>Draft PL/pgSQL (PostgreSQL)</div>
          {hasDraft ? (
            alignedLines.map((line, idx) => (
              <div
                key={`r-${idx}`}
                className={`${styles.reviewerLine} ${
                  line.right === null
                    ? styles.reviewerLineBlank
                    : line.op === 'added'
                      ? styles.reviewerLineAdded
                      : ''
                }`}
              >
                {line.right === null || line.right === ''
                  ? ' '
                  : line.right}
              </div>
            ))
          ) : (
            <div className={styles.emptyMessage} data-testid="db-pack-translation-no-draft">
              {isNeedsManual
                ? 'No draft — this object needs manual translation.'
                : 'No draft yet — run Translate to produce one.'}
            </div>
          )}
        </div>
      </div>

      {/* Judge verdict + confidence + flags table. */}
      {verdict && (
        <div
          className={styles.verdictPanel}
          data-testid="db-pack-translation-verdict"
        >
          <h4 className={styles.manifestSectionTitle}>Judge verdict</h4>
          <p className={styles.manifestNote}>
            Verdict:{' '}
            <span className={styles.badge}>
              {typeof verdict.verdict === 'string' ? verdict.verdict : '—'}
            </span>{' '}
            · Confidence:{' '}
            {typeof verdict.confidence === 'number'
              ? verdict.confidence.toFixed(2)
              : '—'}
          </p>
          {flags.length > 0 && (
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th>Construct</th>
                  <th>Concern</th>
                  <th>Severity</th>
                </tr>
              </thead>
              <tbody>
                {flags.map((flag, idx) => (
                  <tr key={idx} data-testid={`db-pack-translation-flag-${idx}`}>
                    <td>
                      <code>{flag.construct}</code>
                    </td>
                    <td>{flag.concern}</td>
                    <td>
                      <span
                        className={
                          flag.severity === 'high'
                            ? styles.badgeMissing
                            : flag.severity === 'medium'
                              ? styles.badgeFlagged
                              : styles.badge
                        }
                      >
                        {flag.severity}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className={styles.manifestNote}>
            Judge flags inform the review — they never gate approval.
          </p>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Workbench: behaviour verdict + evidence + guidance (Spec 4).         */}
      {/* ------------------------------------------------------------------ */}
      {workbench && (
        <>
          <div
            className={styles.verdictPanel}
            data-testid="db-pack-wb-verdict"
          >
            <h4 className={styles.manifestSectionTitle}>Behaviour verdict</h4>
            <p className={styles.manifestNote}>
              <span
                className={
                  translation.loop_status === 'reconciled'
                    ? styles.badgeResolved
                    : translation.loop_status === 'exhausted' ||
                        translation.loop_status === 'apply_failed'
                      ? styles.badgeMissing
                      : styles.badgeFlagged
                }
                data-testid="db-pack-wb-loop-status-badge"
              >
                {loopStatusLabel(translation)}
              </span>{' '}
              · {verdictLabel(translation)}
              {typeof translation.best_attempt_no === 'number'
                ? ` · best attempt ${translation.best_attempt_no}`
                : ''}
            </p>
            {(translation.verdict_json?.signatures ?? []).length > 0 && (
              <ul
                className={styles.orderedList}
                data-testid="db-pack-wb-signatures"
              >
                {(translation.verdict_json?.signatures ?? []).map((sig, i) => (
                  <li key={`sig-${i}`}>
                    <code>{sig}</code>
                  </li>
                ))}
              </ul>
            )}
            {translation.verdict_json?.apply_error && (
              <p className={styles.manifestNote}>
                Apply error: {String(translation.verdict_json.apply_error)}
              </p>
            )}
            {verdict?.invocation_descriptor && (
              <p
                className={styles.manifestNote}
                data-testid="db-pack-wb-descriptor"
              >
                Invocation shape:{' '}
                <span className={styles.badge}>
                  {String(verdict.invocation_descriptor.shape ?? '—')}
                </span>{' '}
                {verdict.invocation_descriptor.pg_function ? (
                  <code>{String(verdict.invocation_descriptor.pg_function)}</code>
                ) : null}{' '}
                · confidence{' '}
                {String(verdict.invocation_descriptor.confidence ?? '—')}
                {(verdict.invocation_descriptor.rules_cited ?? []).length > 0
                  ? ` · rules ${(
                      verdict.invocation_descriptor.rules_cited ?? []
                    ).join(', ')}`
                  : ''}
              </p>
            )}
            {workbench.evidenceError && (
              <div
                className={styles.errorBanner}
                data-testid="db-pack-wb-evidence-error"
              >
                {workbench.evidenceError}
              </div>
            )}
          </div>

          {/* Failing scenarios — expected vs actual per divergent dimension. */}
          <div
            className={styles.manifestSection}
            data-testid="db-pack-wb-failing-scenarios"
          >
            <h4 className={styles.manifestSectionTitle}>
              Failing scenarios ({failingScenarios.length})
            </h4>
            {workbench.evidenceLoading && failingScenarios.length === 0 ? (
              <p className={styles.manifestNote}>Loading the parity report…</p>
            ) : failingScenarios.length === 0 ? (
              <p className={styles.manifestNote}>
                {workbench.parityReport
                  ? 'No failing scenarios in the latest parity report.'
                  : 'No parity report yet — reconcile this routine to produce one.'}
              </p>
            ) : (
              failingScenarios.map((scenario, index) => (
                <div
                  key={scenario.scenarioName ?? `scenario-${index}`}
                  className={styles.verdictPanel}
                  data-testid={`db-pack-wb-scenario-${index}`}
                >
                  <p className={styles.manifestNote}>
                    <strong>{scenario.scenarioName ?? '(unnamed)'}</strong>{' '}
                    <span className={styles.badgeMissing}>
                      {scenario.verdict ?? 'divergent'}
                    </span>{' '}
                    {scenario.scenarioType ? (
                      <span className={styles.badge}>{scenario.scenarioType}</span>
                    ) : null}{' '}
                    {scenario.waived ? (
                      <span className={styles.badgeResolved}>waived</span>
                    ) : null}
                    {scenario.signature ? (
                      <>
                        {' '}
                        · signature <code>{scenario.signature}</code>
                      </>
                    ) : null}
                    {scenario.unverifiableReason ? (
                      <> · unverifiable: {scenario.unverifiableReason}</>
                    ) : null}
                  </p>
                  <table className={styles.dataTable}>
                    <thead>
                      <tr>
                        <th>Dimension</th>
                        <th>Verdict</th>
                        <th>Where</th>
                        <th>Expected</th>
                        <th>Actual</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scenario.dimensions
                        .filter((d) => d.verdict !== 'match')
                        .map((dimension, dIndex) => {
                          const examples =
                            dimension.examples.length > 0
                              ? dimension.examples
                              : [
                                  {
                                    where: dimension.firstDivergence,
                                    expected: null,
                                    actual: null,
                                  },
                                ];
                          return examples.map((example, eIndex) => (
                            <tr
                              key={`d-${dIndex}-${eIndex}`}
                              data-testid={`db-pack-wb-dimension-${index}-${dIndex}-${eIndex}`}
                            >
                              <td>
                                {dimension.dimension ?? '—'}
                                {dimension.advisory ? ' (advisory)' : ''}
                              </td>
                              <td>{dimension.verdict ?? '—'}</td>
                              <td>
                                <code>
                                  {example.where ??
                                    dimension.firstDivergence ??
                                    '—'}
                                </code>
                              </td>
                              <td>
                                <code>{example.expected ?? '—'}</code>
                              </td>
                              <td>
                                <code>{example.actual ?? '—'}</code>
                              </td>
                            </tr>
                          ));
                        })}
                    </tbody>
                  </table>
                  {scenario.dimensions.some((d) => d.detail) && (
                    <p className={styles.manifestNote}>
                      {scenario.dimensions
                        .filter((d) => d.detail)
                        .map((d) => d.detail)
                        .join(' · ')}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Attempt history with diff vs the previous attempt. */}
          <div
            className={styles.manifestSection}
            data-testid="db-pack-wb-attempts"
          >
            <h4 className={styles.manifestSectionTitle}>
              Attempt history ({attempts.length})
            </h4>
            {attempts.length === 0 ? (
              <p className={styles.manifestNote}>
                {workbench.evidenceLoading
                  ? 'Loading the attempt history…'
                  : 'No attempts recorded yet.'}
              </p>
            ) : (
              <table className={styles.dataTable}>
                <thead>
                  <tr>
                    <th>Attempt</th>
                    <th>Verdict</th>
                    <th>Evidence rung</th>
                    <th>Judge</th>
                    <th>Guidance</th>
                    <th>Diff</th>
                  </tr>
                </thead>
                <tbody>
                  {attempts.map((attempt) => (
                    <tr
                      key={attempt.id || `attempt-${attempt.attemptNo}`}
                      data-testid={`db-pack-wb-attempt-${attempt.attemptNo}`}
                    >
                      <td>{attempt.attemptNo}</td>
                      <td>
                        <span
                          className={
                            attempt.verdict === 'reconciled'
                              ? styles.badgeResolved
                              : styles.badgeMissing
                          }
                        >
                          {attempt.verdict ?? '—'}
                        </span>
                      </td>
                      <td>
                        {attempt.evidenceRungs?.rung ?? '—'}
                        {typeof attempt.evidenceRungs?.divergent === 'number'
                          ? ` (${attempt.evidenceRungs.divergent} divergent)`
                          : ''}
                        {attempt.evidenceRungs?.error
                          ? ` — ${attempt.evidenceRungs.error}`
                          : ''}
                      </td>
                      <td>
                        {typeof attempt.judgeVerdict?.verdict === 'string'
                          ? attempt.judgeVerdict.verdict
                          : '—'}
                        {typeof attempt.judgeVerdict?.confidence === 'number'
                          ? ` (${attempt.judgeVerdict.confidence.toFixed(2)})`
                          : ''}
                      </td>
                      <td>{attempt.guidanceText ?? '—'}</td>
                      <td>
                        {attempt.attemptNo > 1 ? (
                          <button
                            type="button"
                            className={styles.actionButton}
                            onClick={() =>
                              setOpenDiffAttempt(
                                openDiffAttempt === attempt.attemptNo
                                  ? null
                                  : attempt.attemptNo,
                              )
                            }
                            data-testid={`db-pack-wb-attempt-diff-toggle-${attempt.attemptNo}`}
                          >
                            {openDiffAttempt === attempt.attemptNo
                              ? 'Hide diff'
                              : 'Diff vs previous'}
                          </button>
                        ) : (
                          <span className={styles.manifestNote}>first</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {openDiffAttempt !== null && (
              <div
                className={styles.reviewerPane}
                data-testid={`db-pack-wb-attempt-diff-${openDiffAttempt}`}
              >
                <div className={styles.reviewerPaneTitle}>
                  Attempt {openDiffAttempt} vs attempt {openDiffAttempt - 1}
                </div>
                {(diffForAttempt(openDiffAttempt) ?? []).map((line, idx) => (
                  <div
                    key={`diff-${idx}`}
                    className={`${styles.reviewerLine} ${
                      line.op === 'added'
                        ? styles.reviewerLineAdded
                        : line.op === 'removed'
                          ? styles.reviewerLineRemoved
                          : ''
                    }`}
                  >
                    {line.op === 'added'
                      ? '+ '
                      : line.op === 'removed'
                        ? '- '
                        : '  '}
                    {line.text === '' ? ' ' : line.text}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Guidance & retry — the ONLY human intervention (decision 16). */}
          <div
            className={styles.reviewControls}
            data-testid="db-pack-wb-guidance-panel"
          >
            <label
              className={styles.filterLabel}
              htmlFor="db-pack-wb-guidance-input"
            >
              Reviewer guidance for the next attempt
            </label>
            <textarea
              id="db-pack-wb-guidance-input"
              className={styles.reviewNotes}
              rows={3}
              placeholder="What should the next translation attempt do differently? The source stays the specification — never ask for the failing inputs to be special-cased."
              value={guidance}
              onChange={(e) => setGuidance(e.target.value)}
              disabled={busy}
              data-testid="db-pack-wb-guidance"
            />
            <div className={styles.actionsBar}>
              <button
                type="button"
                className={styles.actionButton}
                onClick={() => {
                  workbench.onGuidanceRetry(guidance.trim());
                  setGuidance('');
                }}
                disabled={busy || guidance.trim().length === 0}
                title="Runs one more loop attempt with this guidance in the prompt — the draft is never edited by hand"
                data-testid="db-pack-wb-retry"
              >
                Guidance & retry
              </button>
              <button
                type="button"
                className={styles.actionButton}
                onClick={() => {
                  setWaiveOpen((open) => !open);
                  setWaiveError(null);
                }}
                data-testid="db-pack-wb-waive"
              >
                Waive…
              </button>
            </div>

            {waiveOpen && (
              <div
                className={styles.inlineResolve}
                data-testid="db-pack-wb-waive-panel"
              >
                <label className={styles.filterGroup}>
                  <span className={styles.filterLabel}>Scope</span>
                  <select
                    className={styles.filterSelect}
                    value={waiveScope}
                    onChange={(e) =>
                      setWaiveScope(
                        e.target.value as DbMigrationPackWaiverScope,
                      )
                    }
                    data-testid="db-pack-wb-waive-scope"
                  >
                    <option value="routine">routine</option>
                    <option value="scenario">scenario</option>
                  </select>
                </label>
                {waiveScope === 'scenario' && (
                  <label className={styles.filterGroup}>
                    <span className={styles.filterLabel}>Scenario</span>
                    {failingScenarios.length > 0 ? (
                      <select
                        className={styles.filterSelect}
                        value={waiveScenario}
                        onChange={(e) => setWaiveScenario(e.target.value)}
                        data-testid="db-pack-wb-waive-scenario"
                      >
                        <option value="">Select a scenario…</option>
                        {failingScenarios.map((scenario, i) => (
                          <option
                            key={scenario.scenarioName ?? `s-${i}`}
                            value={scenario.scenarioName ?? ''}
                          >
                            {scenario.scenarioName ?? '(unnamed)'}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        className={styles.filterInput}
                        value={waiveScenario}
                        onChange={(e) => setWaiveScenario(e.target.value)}
                        data-testid="db-pack-wb-waive-scenario"
                      />
                    )}
                  </label>
                )}
                <label className={styles.filterGroup}>
                  <span className={styles.filterLabel}>Reason (required)</span>
                  <input
                    type="text"
                    className={styles.filterInput}
                    value={waiveReason}
                    onChange={(e) => setWaiveReason(e.target.value)}
                    data-testid="db-pack-wb-waive-reason"
                  />
                </label>
                <button
                  type="button"
                  className={styles.actionButton}
                  onClick={submitWaiver}
                  disabled={busy}
                  data-testid="db-pack-wb-waive-confirm"
                >
                  Record waiver
                </button>
                <button
                  type="button"
                  className={styles.actionButton}
                  onClick={() => {
                    setWaiveOpen(false);
                    setWaiveError(null);
                  }}
                  data-testid="db-pack-wb-waive-cancel"
                >
                  Cancel
                </button>
              </div>
            )}
            {waiveError && (
              <div
                className={styles.errorBanner}
                data-testid="db-pack-wb-waive-error"
              >
                {waiveError}
              </div>
            )}
            <p className={styles.manifestNote}>
              A waived routine or scenario is recorded as "reconciled with
              waivers" — never counted as fully reconciled.
            </p>
          </div>
        </>
      )}

      {/* Review controls — approve / reject / needs-rework with notes. */}
      {reviewable ? (
        <div
          className={styles.reviewControls}
          data-testid="db-pack-translation-review-controls"
        >
          <label className={styles.filterLabel} htmlFor="db-pack-translation-review-notes">
            Reviewer notes (encouraged for needs-rework)
          </label>
          <textarea
            id="db-pack-translation-review-notes"
            className={styles.reviewNotes}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            data-testid="db-pack-translation-review-notes"
          />
          <div className={styles.actionsBar}>
            <button
              type="button"
              className={`${styles.actionButton} ${styles.actionButtonPrimary}`}
              onClick={() => onReview('approve', notes)}
              disabled={busy}
              data-testid="db-pack-translation-approve"
            >
              Approve
            </button>
            <button
              type="button"
              className={styles.actionButton}
              onClick={() => onReview('reject', notes)}
              disabled={busy}
              data-testid="db-pack-translation-reject"
            >
              Reject
            </button>
            <button
              type="button"
              className={styles.actionButton}
              onClick={() => onReview('needs_rework', notes)}
              disabled={busy}
              data-testid="db-pack-translation-needs-rework"
            >
              Needs rework
            </button>
            <span className={styles.badge}>{translation.review_status}</span>
          </div>
          {/* Evidence-gated approve (decision 17): the server answers 409 with
              a readable reason — surface it right where Approve was pressed. */}
          {workbench?.approveReason && (
            <div
              className={styles.errorBanner}
              data-testid="db-pack-wb-approve-reason"
            >
              Approve refused: {workbench.approveReason}
            </div>
          )}
        </div>
      ) : (
        !isNeedsManual && (
          <p className={styles.manifestNote}>
            Review actions become available once a judge-verified draft
            exists.
          </p>
        )
      )}

      {translation.reviewed_at && (
        <p
          className={styles.manifestNote}
          data-testid="db-pack-translation-reviewed-at"
        >
          Reviewed at {translation.reviewed_at}
          {translation.reviewer_notes
            ? ` — notes: ${translation.reviewer_notes}`
            : ''}
        </p>
      )}
    </div>
  );
};

export default DbMigrationPackTranslationReviewer;
