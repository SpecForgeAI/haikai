/**
 * MigrationCarryOverAccountingPanel — carry-over triage plumbing (2026-07-26,
 * agent-os/planning/2026-07-26-carry-over-triage-build-plan.md, Item 1).
 *
 * The plan REVIEW screen's carry-over accounting surface. Replaces the old
 * "advisory, this doesn't block saving" findings banner with the truth the
 * server gate enforces: every behaviour-bearing carry-over capability/finding
 * must be CITED by a story or DISMISSED with a reason before Stage 2 (Service)
 * can start (the per-plane gate merged in 3b162be blocks service starts on it;
 * DB/UI stages are unaffected).
 *
 * Reads GET .../carry-over-coverage (server-computed — the UI never re-derives
 * the gate) and renders the un-accounted items WITH CONTENT (title / summary /
 * severity from the 2026-07-26 itemDetails join), each with the four manual
 * accounting actions:
 *
 *   - CITE — link the finding onto an existing story whose text already covers
 *     it (story picker → discoveryFindingReferences);
 *   - AMEND — edit an existing story so it actually deals with the finding
 *     (description + appended acceptance criteria + cite + the story's spec is
 *     marked STALE and drops out of stage readiness until regenerated);
 *   - NEW STORY — mint a real carry_over story embedding the finding
 *     (capabilities use the existing append-capability-story cite);
 *   - DISMISS — with a MANDATORY reason (the gate ignores reasonless
 *     dismissals).
 *
 * Every action refreshes the coverage read and fires `onCoverageChanged` so
 * the workspace can feed the Stage-2 rail card's `carry-over accounted M/N`
 * gate line.
 *
 * LLM triage (Item 3, this file's top layer): "Get suggestions" drafts ONE
 * suggested disposition per un-accounted item (server-side, one LLM call
 * each); the reviewer edits any row (disposition dropdown, target story
 * picker, editable drafts, free-text GUIDANCE + Re-draft — the guidance flows
 * into the drafting prompt, the user's requirement) and applies per-item OR
 * "Approve all suggestions". NOTHING auto-applies; rows the validator blanked
 * read "needs manual choice". Applying routes through the SAME gateway
 * actions as the manual buttons.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getCarryOverCoverage,
  dismissCarryOverItem,
  citeCapability,
  citeFindingIntoStory,
  amendStoryForFinding,
  createStoryForFinding,
  runCarryOverTriage,
  redraftTriageSuggestion,
  applyTriageSuggestions,
  type CarryOverCoverageResult,
  type CarryOverCoverageItem,
  type CarryOverItemDetail,
  type TriageSuggestion,
  type TriageDisposition,
} from '../../../api/carryOverCoverageApi';
import { ALL_WORKSTREAMS } from '../../../api/migrationBookOfWorkApi';
import styles from './MigrationBookOfWork.module.css';

/** One cite/amend target option — a STORY item of the plan. */
export interface CarryOverStoryOption {
  /** The blob item id (the AMS item-patch target). */
  id: string;
  title: string;
  description: string;
}

export interface MigrationCarryOverAccountingPanelProps {
  projectId: string;
  bookId: string;
  /** The plan's STORY items (cite / amend target picker). */
  stories: CarryOverStoryOption[];
  /**
   * Fires on every fresh coverage read (mount + after each action) so the
   * parent can drive the Stage-2 card's `carry-over accounted M/N` line.
   */
  onCoverageChanged?: (coverage: CarryOverCoverageResult | null) => void;
  readOnly?: boolean;
}

/** Which inline action form is open, and for which item. */
interface OpenAction {
  itemId: string;
  action: 'cite' | 'amend' | 'new_story' | 'dismiss';
}

/**
 * One suggestion under review (Item 3) — the gateway draft + the reviewer's
 * free-text guidance (fed back into the drafting prompt on Re-draft; the
 * user's requirement). All fields are EDITABLE before applying.
 */
export interface EditableSuggestion extends TriageSuggestion {
  guidance: string;
  /** The per-item apply failure, when the last apply attempt failed. */
  applyError: string | null;
}

/**
 * True when the suggestion is complete enough to APPLY. Mirrors the server's
 * own apply-time checks so the Apply buttons never promise a call the server
 * would reject. Pure; exported for tests.
 */
export function isSuggestionReady(s: EditableSuggestion): boolean {
  if (s.disposition === null) return false;
  if (s.disposition === 'cite' || s.disposition === 'amend_story') {
    if (s.kind !== 'finding') return false;
    if (!s.targetBookItemId) return false;
    if (s.disposition === 'amend_story') {
      const hasDescription = !!s.draftAmendment?.description?.trim();
      // Criteria live RAW in the editor (line-per-entry, blanks allowed while
      // typing) and are cleaned at apply time — ready = any non-blank line.
      const hasCriteria = (s.draftAmendment?.appendAcceptanceCriteria ?? []).some(
        (c) => c.trim() !== '',
      );
      if (!hasDescription && !hasCriteria) return false;
    }
    return true;
  }
  if (s.disposition === 'new_story') {
    if (s.kind === 'capability') return true; // the mint falls back to the item title
    return !!s.draftStory?.title?.trim() && !!s.draftStory?.description?.trim();
  }
  return !!s.dismissReason?.trim();
}

/** Clean a raw editor criteria list for the wire (trim, drop blanks). */
function cleanCriteria(raw: string[] | null | undefined): string[] {
  return (raw ?? []).map((c) => c.trim()).filter((c) => c !== '');
}

const DISPOSITION_LABELS: Record<TriageDisposition, string> = {
  cite: 'Cite existing story',
  amend_story: 'Amend story',
  new_story: 'New story',
  dismiss: 'Dismiss',
};

function severityBadgeClass(severity: string | null): string {
  const s = (severity || '').toLowerCase();
  if (s === 'critical') return styles.badgeConfidenceLow;
  if (s === 'high') return styles.badgeConfidenceMedium;
  return styles.badge;
}

/** Split a textarea's lines into clean acceptance criteria. */
function parseCriteria(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export const MigrationCarryOverAccountingPanel: React.FC<
  MigrationCarryOverAccountingPanelProps
> = ({ projectId, bookId, stories, onCoverageChanged, readOnly }) => {
  const [coverage, setCoverage] = useState<CarryOverCoverageResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showItems, setShowItems] = useState<boolean>(false);
  const [openAction, setOpenAction] = useState<OpenAction | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // ----- Inline form state (one action open at a time). -----
  const [targetStoryId, setTargetStoryId] = useState<string>('');
  const [formDescription, setFormDescription] = useState<string>('');
  const [formCriteria, setFormCriteria] = useState<string>('');
  const [formTitle, setFormTitle] = useState<string>('');
  const [formWorkstream, setFormWorkstream] = useState<string>(
    'internal_processing_implementation',
  );
  const [formReason, setFormReason] = useState<string>('');

  // ----- LLM triage state (Item 3) -----
  // Suggestions keyed by item id, EDITABLE in place. `null` = no batch run yet.
  const [suggestions, setSuggestions] = useState<Record<
    string,
    EditableSuggestion
  > | null>(null);
  const [triageBusy, setTriageBusy] = useState<boolean>(false);
  const [triageError, setTriageError] = useState<string | null>(null);
  const [applyBusy, setApplyBusy] = useState<boolean>(false);
  const [redraftBusyId, setRedraftBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await getCarryOverCoverage(projectId, bookId);
      setCoverage(result);
      setLoadError(null);
      onCoverageChanged?.(result);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Failed to load carry-over coverage.',
      );
      setCoverage(null);
      onCoverageChanged?.(null);
    }
  }, [projectId, bookId, onCoverageChanged]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const detailFor = useCallback(
    (id: string): CarryOverItemDetail | null => coverage?.itemDetails?.[id] ?? null,
    [coverage],
  );

  const openForm = useCallback(
    (item: CarryOverCoverageItem, action: OpenAction['action']) => {
      const detail = detailFor(item.id);
      setOpenAction({ itemId: item.id, action });
      setActionError(null);
      setTargetStoryId('');
      setFormReason('');
      if (action === 'new_story') {
        setFormTitle(detail?.title ?? '');
        // The description must EMBED the finding's essence — seed it with the
        // finding's own summary so the user starts from the evidence.
        setFormDescription(detail?.summary ?? '');
        setFormCriteria('');
        setFormWorkstream('internal_processing_implementation');
      } else if (action === 'amend') {
        setFormDescription('');
        setFormCriteria('');
      }
    },
    [detailFor],
  );

  /** Prefill the amend description with the picked story's current text. */
  const handlePickAmendTarget = useCallback(
    (storyId: string) => {
      setTargetStoryId(storyId);
      const story = stories.find((s) => s.id === storyId);
      if (story) setFormDescription(story.description);
    },
    [stories],
  );

  const runAction = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      setActionError(null);
      try {
        await fn();
        setOpenAction(null);
        await refresh();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'The action failed.');
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const confirmCite = useCallback(
    (item: CarryOverCoverageItem) =>
      runAction(() =>
        citeFindingIntoStory(projectId, bookId, {
          book_item_id: targetStoryId,
          finding_id: item.id,
        }),
      ),
    [runAction, projectId, bookId, targetStoryId],
  );

  const confirmAmend = useCallback(
    (item: CarryOverCoverageItem) =>
      runAction(() =>
        amendStoryForFinding(projectId, bookId, {
          book_item_id: targetStoryId,
          finding_id: item.id,
          description: formDescription.trim() !== '' ? formDescription : null,
          append_acceptance_criteria: parseCriteria(formCriteria),
        }),
      ),
    [runAction, projectId, bookId, targetStoryId, formDescription, formCriteria],
  );

  const confirmNewStory = useCallback(
    (item: CarryOverCoverageItem) => {
      if (item.kind === 'capability') {
        const detail = detailFor(item.id);
        return runAction(() =>
          citeCapability(projectId, bookId, {
            source_capability_id: item.id,
            title: formTitle.trim() !== '' ? formTitle : (detail?.title ?? item.id),
            description: formDescription.trim() !== '' ? formDescription : null,
          }),
        );
      }
      return runAction(() =>
        createStoryForFinding(projectId, bookId, {
          finding_id: item.id,
          title: formTitle,
          description: formDescription,
          workstream: formWorkstream,
          acceptance_criteria: parseCriteria(formCriteria),
        }),
      );
    },
    [
      runAction,
      projectId,
      bookId,
      detailFor,
      formTitle,
      formDescription,
      formWorkstream,
      formCriteria,
    ],
  );

  const confirmDismiss = useCallback(
    (item: CarryOverCoverageItem) => {
      const detail = detailFor(item.id);
      return runAction(() =>
        dismissCarryOverItem(projectId, {
          kind: item.kind,
          id: item.id,
          architecture_id: coverage?.architectureId ?? '',
          ...(item.kind === 'finding' ? { run_id: detail?.runId ?? null } : {}),
          reason: formReason,
        }),
      );
    },
    [runAction, projectId, detailFor, coverage, formReason],
  );

  // ----- LLM triage handlers (Item 3) -----

  /** "Get suggestions": one LLM draft per un-accounted item, server-side. */
  const handleGetSuggestions = useCallback(async () => {
    setTriageBusy(true);
    setTriageError(null);
    try {
      const { suggestions: drafted } = await runCarryOverTriage(projectId, bookId);
      const byId: Record<string, EditableSuggestion> = {};
      for (const s of drafted) {
        byId[s.itemId] = { ...s, guidance: '', applyError: null };
      }
      setSuggestions(byId);
      setShowItems(true);
      setOpenAction(null);
    } catch (err) {
      setTriageError(
        err instanceof Error ? err.message : 'Triage drafting failed.',
      );
    } finally {
      setTriageBusy(false);
    }
  }, [projectId, bookId]);

  const patchSuggestion = useCallback(
    (itemId: string, patch: Partial<EditableSuggestion>) => {
      setSuggestions((prev) => {
        if (!prev || !prev[itemId]) return prev;
        return { ...prev, [itemId]: { ...prev[itemId], ...patch } };
      });
    },
    [],
  );

  /** Reviewer changes the disposition — seed sensible drafts for the new one. */
  const handleDispositionChange = useCallback(
    (item: CarryOverCoverageItem, next: TriageDisposition | '') => {
      const detail = detailFor(item.id);
      setSuggestions((prev) => {
        if (!prev || !prev[item.id]) return prev;
        const s = prev[item.id];
        const updated: EditableSuggestion = {
          ...s,
          disposition: next === '' ? null : next,
          validationNote: null,
          applyError: null,
        };
        if (next === 'new_story' && !updated.draftStory) {
          updated.draftStory = {
            title: detail?.title ?? '',
            description: detail?.summary ?? '',
            workstream: 'internal_processing_implementation',
            acceptanceCriteria: [],
          };
        }
        if (next === 'amend_story' && !updated.draftAmendment) {
          const target = stories.find((st) => st.id === updated.targetBookItemId);
          updated.draftAmendment = {
            description: target?.description ?? null,
            appendAcceptanceCriteria: [],
          };
        }
        return { ...prev, [item.id]: updated };
      });
    },
    [detailFor, stories],
  );

  /** Re-draft ONE item with the reviewer's guidance folded into the prompt. */
  const handleRedraft = useCallback(
    async (itemId: string) => {
      const current = suggestions?.[itemId];
      if (!current) return;
      setRedraftBusyId(itemId);
      setTriageError(null);
      try {
        const { suggestion } = await redraftTriageSuggestion(projectId, bookId, {
          item_id: itemId,
          forced_disposition: current.disposition,
          guidance: current.guidance || null,
          target_book_item_id: current.targetBookItemId,
        });
        // Keep the reviewer's guidance so they can iterate on it.
        setSuggestions((prev) =>
          prev
            ? {
                ...prev,
                [itemId]: { ...suggestion, guidance: current.guidance, applyError: null },
              }
            : prev,
        );
      } catch (err) {
        setTriageError(err instanceof Error ? err.message : 'Re-draft failed.');
      } finally {
        setRedraftBusyId(null);
      }
    },
    [suggestions, projectId, bookId],
  );

  /** Apply the given suggestions (per-item Apply sends one; Approve-all sends every ready one). */
  const applySuggestionSet = useCallback(
    async (toApply: EditableSuggestion[]) => {
      if (toApply.length === 0) return;
      setApplyBusy(true);
      setTriageError(null);
      try {
        const { results, coverage: refreshed } = await applyTriageSuggestions(
          projectId,
          bookId,
          toApply.map((s) => ({
            itemId: s.itemId,
            kind: s.kind,
            disposition: s.disposition as TriageDisposition,
            targetBookItemId: s.targetBookItemId,
            draftAmendment: s.draftAmendment
              ? {
                  description: s.draftAmendment.description?.trim() || null,
                  appendAcceptanceCriteria: cleanCriteria(
                    s.draftAmendment.appendAcceptanceCriteria,
                  ),
                }
              : null,
            draftStory: s.draftStory
              ? {
                  ...s.draftStory,
                  acceptanceCriteria: cleanCriteria(s.draftStory.acceptanceCriteria),
                }
              : null,
            dismissReason: s.dismissReason,
          })),
        );
        // Applied items leave the review set; failures stay with their error.
        setSuggestions((prev) => {
          if (!prev) return prev;
          const next = { ...prev };
          for (const r of results) {
            if (r.ok) {
              delete next[r.itemId];
            } else if (next[r.itemId]) {
              next[r.itemId] = { ...next[r.itemId], applyError: r.error ?? 'apply failed' };
            }
          }
          return next;
        });
        if (refreshed) {
          setCoverage(refreshed);
          onCoverageChanged?.(refreshed);
        } else {
          await refresh();
        }
      } catch (err) {
        setTriageError(err instanceof Error ? err.message : 'Apply failed.');
      } finally {
        setApplyBusy(false);
      }
    },
    [projectId, bookId, refresh, onCoverageChanged],
  );

  // The panel renders nothing meaningful until the first read lands.
  const unaccounted = coverage?.unaccounted ?? [];
  const storyOptions = useMemo(
    () => stories.filter((s) => s.id && s.title),
    [stories],
  );
  /** The suggestions ready to apply (drives "Approve all suggestions (N)"). */
  const readySuggestions = useMemo(() => {
    if (!suggestions) return [];
    return unaccounted
      .map((item) => suggestions[item.id])
      .filter((s): s is EditableSuggestion => !!s && isSuggestionReady(s));
  }, [suggestions, unaccounted]);

  return (
    <section
      className={styles.coveragePanel}
      data-testid="carry-over-accounting-panel"
    >
      {loadError && (
        <p className={styles.coveragePanelNote} role="alert">
          Carry-over coverage unavailable: {loadError}
        </p>
      )}
      {coverage && coverage.totalMustAccount === 0 && (
        <p
          className={styles.coveragePanelNote}
          data-testid="carry-over-accounting-empty"
        >
          No behaviour-bearing carry-over items to account for.
        </p>
      )}
      {coverage && coverage.totalMustAccount > 0 && coverage.ok && (
        <p
          className={styles.coveragePanelNote}
          data-testid="carry-over-accounting-clear"
        >
          {'✓'} All {coverage.totalMustAccount} behaviour-bearing carry-over
          items are accounted for (cited by a story or dismissed with a
          reason). Stage 2 (Service) is clear of this gate.
        </p>
      )}
      {coverage && !coverage.ok && (
        <>
          <p
            className={styles.coveragePanelNote}
            data-testid="carry-over-accounting-blocking"
          >
            <strong>
              {unaccounted.length} carry-over item
              {unaccounted.length === 1 ? '' : 's'} need citing or dismissing
              before Stage 2 (Service) can start.
            </strong>{' '}
            ({coverage.accountedCount} of {coverage.totalMustAccount} accounted)
            — each behaviour-bearing carry-over finding/capability must be
            cited by a story or dismissed with a reason; non-API work has no
            reconciliation backstop.{' '}
            <button
              type="button"
              className={styles.coverageInlineLink}
              onClick={() => setShowItems((v) => !v)}
              data-testid="carry-over-accounting-toggle"
            >
              {showItems ? 'Hide items' : `Show items (${unaccounted.length})`}
            </button>
          </p>

          {/* LLM triage controls (Item 3): drafted suggestions the reviewer
              edits and approves — NOTHING auto-applies. */}
          {!readOnly && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                className={styles.selectButton}
                disabled={triageBusy || applyBusy}
                onClick={() => void handleGetSuggestions()}
                data-testid="carry-over-get-suggestions"
                title="Draft a suggested disposition for every un-accounted item (one LLM call per item) — you review and approve; nothing is applied automatically"
              >
                {triageBusy
                  ? `Drafting suggestions… (${unaccounted.length} items)`
                  : suggestions
                    ? 'Re-run suggestions'
                    : 'Get suggestions'}
              </button>
              {suggestions && (
                <button
                  type="button"
                  className={`${styles.selectButton} ${styles.selectButtonPrimary}`}
                  disabled={applyBusy || triageBusy || readySuggestions.length === 0}
                  onClick={() => void applySuggestionSet(readySuggestions)}
                  data-testid="carry-over-approve-all"
                  title="Apply every suggestion below that is complete (items marked 'needs manual choice' are skipped until you complete them)"
                >
                  {applyBusy
                    ? 'Applying…'
                    : `Approve all suggestions (${readySuggestions.length})`}
                </button>
              )}
              {triageError && (
                <span className={styles.coveragePanelNote} role="alert">
                  {triageError}
                </span>
              )}
            </div>
          )}

          {showItems && (
            <ul className={styles.coverageList} data-testid="carry-over-item-list">
              {unaccounted.map((item) => {
                const detail = detailFor(item.id);
                const isOpen = openAction?.itemId === item.id ? openAction : null;
                const suggestion = suggestions?.[item.id] ?? null;
                return (
                  <li
                    key={item.id}
                    className={styles.coverageRow}
                    data-testid={`carry-over-item-row-${item.id}`}
                    style={{ display: 'block' }}
                  >
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span className={styles.badge}>{item.kind}</span>
                      {detail?.severity && (
                        <span className={severityBadgeClass(detail.severity)}>
                          {detail.severity}
                        </span>
                      )}
                      <span className={styles.coverageRowTitle}>
                        {detail?.title ?? item.id}
                      </span>
                      {detail?.memberFindingCount != null &&
                        detail.memberFindingCount > 0 && (
                          <span className={styles.coveragePanelNote}>
                            absorbs {detail.memberFindingCount} finding
                            {detail.memberFindingCount === 1 ? '' : 's'}
                          </span>
                        )}
                    </div>
                    {detail?.summary && (
                      <div className={styles.coveragePanelNote}>{detail.summary}</div>
                    )}

                    {/* ----- Suggestion editor (Item 3): replaces the manual
                        buttons while a drafted suggestion is under review. ----- */}
                    {!readOnly && suggestion && (
                      <div
                        style={{ marginTop: 6, borderTop: '1px dashed #d0d7de', paddingTop: 6 }}
                        data-testid={`carry-over-suggestion-${item.id}`}
                      >
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <label>
                            Suggested action:{' '}
                            <select
                              value={suggestion.disposition ?? ''}
                              onChange={(e) =>
                                handleDispositionChange(
                                  item,
                                  e.target.value as TriageDisposition | '',
                                )
                              }
                              data-testid={`carry-over-suggestion-disposition-${item.id}`}
                            >
                              <option value="">— needs manual choice —</option>
                              {(item.kind === 'capability'
                                ? (['new_story', 'dismiss'] as TriageDisposition[])
                                : ([
                                    'cite',
                                    'amend_story',
                                    'new_story',
                                    'dismiss',
                                  ] as TriageDisposition[])
                              ).map((d) => (
                                <option key={d} value={d}>
                                  {DISPOSITION_LABELS[d]}
                                </option>
                              ))}
                            </select>
                          </label>
                          {(suggestion.disposition === 'cite' ||
                            suggestion.disposition === 'amend_story') && (
                            <label>
                              Target story:{' '}
                              <select
                                value={suggestion.targetBookItemId ?? ''}
                                onChange={(e) =>
                                  patchSuggestion(item.id, {
                                    targetBookItemId: e.target.value || null,
                                  })
                                }
                                data-testid={`carry-over-suggestion-target-${item.id}`}
                              >
                                <option value="">— pick a story —</option>
                                {storyOptions.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.title}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                        </div>
                        {suggestion.rationale && (
                          <div
                            className={styles.coveragePanelNote}
                            data-testid={`carry-over-suggestion-rationale-${item.id}`}
                          >
                            Rationale: {suggestion.rationale}
                          </div>
                        )}
                        {suggestion.validationNote && (
                          <div
                            className={styles.coveragePanelNote}
                            role="alert"
                            data-testid={`carry-over-suggestion-note-${item.id}`}
                          >
                            {'⚠'} {suggestion.validationNote}
                          </div>
                        )}
                        {suggestion.applyError && (
                          <div className={styles.coveragePanelNote} role="alert">
                            Apply failed: {suggestion.applyError}
                          </div>
                        )}

                        {suggestion.disposition === 'amend_story' && (
                          <>
                            <textarea
                              className={styles.modalInput}
                              style={{ width: '100%', minHeight: 70, marginTop: 4 }}
                              placeholder="Amended story description (full text)"
                              value={suggestion.draftAmendment?.description ?? ''}
                              onChange={(e) =>
                                patchSuggestion(item.id, {
                                  draftAmendment: {
                                    description: e.target.value,
                                    appendAcceptanceCriteria:
                                      suggestion.draftAmendment?.appendAcceptanceCriteria ?? [],
                                  },
                                })
                              }
                              data-testid={`carry-over-suggestion-amend-description-${item.id}`}
                            />
                            <textarea
                              className={styles.modalInput}
                              style={{ width: '100%', minHeight: 50, marginTop: 4 }}
                              placeholder="Acceptance criteria to ADD (one per line)"
                              value={(
                                suggestion.draftAmendment?.appendAcceptanceCriteria ?? []
                              ).join('\n')}
                              onChange={(e) =>
                                patchSuggestion(item.id, {
                                  draftAmendment: {
                                    description:
                                      suggestion.draftAmendment?.description ?? null,
                                    appendAcceptanceCriteria: e.target.value.split('\n'),
                                  },
                                })
                              }
                              data-testid={`carry-over-suggestion-amend-criteria-${item.id}`}
                            />
                            <div className={styles.coveragePanelNote}>
                              Applying the amendment cites this finding AND marks the
                              story{"'"}s spec STALE — regenerate specs afterwards.
                            </div>
                          </>
                        )}

                        {suggestion.disposition === 'new_story' && (
                          <>
                            <input
                              className={styles.modalInput}
                              style={{ width: '100%', marginTop: 4 }}
                              placeholder="Story title"
                              value={suggestion.draftStory?.title ?? ''}
                              onChange={(e) =>
                                patchSuggestion(item.id, {
                                  draftStory: {
                                    title: e.target.value,
                                    description: suggestion.draftStory?.description ?? '',
                                    workstream:
                                      suggestion.draftStory?.workstream ??
                                      'internal_processing_implementation',
                                    acceptanceCriteria:
                                      suggestion.draftStory?.acceptanceCriteria ?? [],
                                  },
                                })
                              }
                              data-testid={`carry-over-suggestion-story-title-${item.id}`}
                            />
                            <textarea
                              className={styles.modalInput}
                              style={{ width: '100%', minHeight: 70, marginTop: 4 }}
                              placeholder="Story description — must EMBED what this item requires"
                              value={suggestion.draftStory?.description ?? ''}
                              onChange={(e) =>
                                patchSuggestion(item.id, {
                                  draftStory: {
                                    title: suggestion.draftStory?.title ?? '',
                                    description: e.target.value,
                                    workstream:
                                      suggestion.draftStory?.workstream ??
                                      'internal_processing_implementation',
                                    acceptanceCriteria:
                                      suggestion.draftStory?.acceptanceCriteria ?? [],
                                  },
                                })
                              }
                              data-testid={`carry-over-suggestion-story-description-${item.id}`}
                            />
                            <label style={{ display: 'block', marginTop: 4 }}>
                              Workstream:{' '}
                              <select
                                value={
                                  suggestion.draftStory?.workstream ??
                                  'internal_processing_implementation'
                                }
                                onChange={(e) =>
                                  patchSuggestion(item.id, {
                                    draftStory: {
                                      title: suggestion.draftStory?.title ?? '',
                                      description:
                                        suggestion.draftStory?.description ?? '',
                                      workstream: e.target.value,
                                      acceptanceCriteria:
                                        suggestion.draftStory?.acceptanceCriteria ?? [],
                                    },
                                  })
                                }
                                data-testid={`carry-over-suggestion-story-workstream-${item.id}`}
                              >
                                {ALL_WORKSTREAMS.map((w) => (
                                  <option key={w} value={w}>
                                    {w}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <textarea
                              className={styles.modalInput}
                              style={{ width: '100%', minHeight: 50, marginTop: 4 }}
                              placeholder="Acceptance criteria (one per line)"
                              value={(suggestion.draftStory?.acceptanceCriteria ?? []).join('\n')}
                              onChange={(e) =>
                                patchSuggestion(item.id, {
                                  draftStory: {
                                    title: suggestion.draftStory?.title ?? '',
                                    description: suggestion.draftStory?.description ?? '',
                                    workstream:
                                      suggestion.draftStory?.workstream ??
                                      'internal_processing_implementation',
                                    acceptanceCriteria: e.target.value.split('\n'),
                                  },
                                })
                              }
                              data-testid={`carry-over-suggestion-story-criteria-${item.id}`}
                            />
                          </>
                        )}

                        {suggestion.disposition === 'dismiss' && (
                          <textarea
                            className={styles.modalInput}
                            style={{ width: '100%', minHeight: 50, marginTop: 4 }}
                            placeholder="Dismissal reason (required)"
                            value={suggestion.dismissReason ?? ''}
                            onChange={(e) =>
                              patchSuggestion(item.id, { dismissReason: e.target.value })
                            }
                            data-testid={`carry-over-suggestion-dismiss-reason-${item.id}`}
                          />
                        )}

                        <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                          <textarea
                            className={styles.modalInput}
                            style={{ flex: 1, minWidth: 220, minHeight: 36 }}
                            placeholder="Guidance for the re-draft (optional) — flows into the LLM prompt"
                            value={suggestion.guidance}
                            onChange={(e) =>
                              patchSuggestion(item.id, { guidance: e.target.value })
                            }
                            data-testid={`carry-over-suggestion-guidance-${item.id}`}
                          />
                          <button
                            type="button"
                            className={styles.selectButton}
                            disabled={redraftBusyId === item.id || applyBusy || triageBusy}
                            onClick={() => void handleRedraft(item.id)}
                            data-testid={`carry-over-suggestion-redraft-${item.id}`}
                            title="Re-draft this suggestion with your guidance folded into the prompt (keeps your chosen action and target)"
                          >
                            {redraftBusyId === item.id ? 'Re-drafting…' : 'Re-draft'}
                          </button>
                          <button
                            type="button"
                            className={`${styles.selectButton} ${styles.selectButtonPrimary}`}
                            disabled={applyBusy || !isSuggestionReady(suggestion)}
                            onClick={() => void applySuggestionSet([suggestion])}
                            data-testid={`carry-over-suggestion-apply-${item.id}`}
                          >
                            {applyBusy ? 'Applying…' : 'Apply'}
                          </button>
                        </div>
                      </div>
                    )}

                    {!readOnly && !suggestion && (
                      <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                        {item.kind === 'finding' && (
                          <>
                            <button
                              type="button"
                              className={styles.selectButton}
                              onClick={() => openForm(item, 'cite')}
                              data-testid={`carry-over-cite-${item.id}`}
                              title="An existing story's text already covers this — link it"
                            >
                              Cite…
                            </button>
                            <button
                              type="button"
                              className={styles.selectButton}
                              onClick={() => openForm(item, 'amend')}
                              data-testid={`carry-over-amend-${item.id}`}
                              title="Edit an existing story so it actually deals with this (its spec is marked stale until regenerated)"
                            >
                              Amend story…
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          className={styles.selectButton}
                          onClick={() => openForm(item, 'new_story')}
                          data-testid={`carry-over-new-story-${item.id}`}
                          title="Create a new story that embeds this item (it flows through normal spec generation)"
                        >
                          New story…
                        </button>
                        <button
                          type="button"
                          className={styles.selectButton}
                          onClick={() => openForm(item, 'dismiss')}
                          data-testid={`carry-over-dismiss-${item.id}`}
                          title="Consciously drop this with a recorded reason"
                        >
                          Dismiss…
                        </button>
                      </div>
                    )}

                    {isOpen && actionError && (
                      <p className={styles.coveragePanelNote} role="alert">
                        {actionError}
                      </p>
                    )}

                    {/* ----- CITE form ----- */}
                    {isOpen?.action === 'cite' && (
                      <div style={{ marginTop: 6 }} data-testid={`carry-over-cite-form-${item.id}`}>
                        <label>
                          Story that already covers it:{' '}
                          <select
                            value={targetStoryId}
                            onChange={(e) => setTargetStoryId(e.target.value)}
                            data-testid={`carry-over-cite-target-${item.id}`}
                          >
                            <option value="">— pick a story —</option>
                            {storyOptions.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.title}
                              </option>
                            ))}
                          </select>
                        </label>{' '}
                        <button
                          type="button"
                          className={`${styles.selectButton} ${styles.selectButtonPrimary}`}
                          disabled={busy || targetStoryId === ''}
                          onClick={() => void confirmCite(item)}
                          data-testid={`carry-over-cite-confirm-${item.id}`}
                        >
                          {busy ? 'Citing…' : 'Cite'}
                        </button>
                      </div>
                    )}

                    {/* ----- AMEND form ----- */}
                    {isOpen?.action === 'amend' && (
                      <div style={{ marginTop: 6 }} data-testid={`carry-over-amend-form-${item.id}`}>
                        <label>
                          Story to amend:{' '}
                          <select
                            value={targetStoryId}
                            onChange={(e) => handlePickAmendTarget(e.target.value)}
                            data-testid={`carry-over-amend-target-${item.id}`}
                          >
                            <option value="">— pick a story —</option>
                            {storyOptions.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.title}
                              </option>
                            ))}
                          </select>
                        </label>
                        <textarea
                          className={styles.modalInput}
                          style={{ width: '100%', minHeight: 70, marginTop: 4 }}
                          placeholder="Amended story description (full text — prefilled with the current one)"
                          value={formDescription}
                          onChange={(e) => setFormDescription(e.target.value)}
                          data-testid={`carry-over-amend-description-${item.id}`}
                        />
                        <textarea
                          className={styles.modalInput}
                          style={{ width: '100%', minHeight: 50, marginTop: 4 }}
                          placeholder="Acceptance criteria to ADD (one per line)"
                          value={formCriteria}
                          onChange={(e) => setFormCriteria(e.target.value)}
                          data-testid={`carry-over-amend-criteria-${item.id}`}
                        />
                        <div className={styles.coveragePanelNote}>
                          Applying the amendment cites this finding AND marks
                          the story{"'"}s spec STALE — it drops out of stage
                          readiness until you regenerate specs.
                        </div>
                        <button
                          type="button"
                          className={`${styles.selectButton} ${styles.selectButtonPrimary}`}
                          disabled={
                            busy ||
                            targetStoryId === '' ||
                            (formDescription.trim() === '' && parseCriteria(formCriteria).length === 0)
                          }
                          onClick={() => void confirmAmend(item)}
                          data-testid={`carry-over-amend-confirm-${item.id}`}
                        >
                          {busy ? 'Amending…' : 'Apply amendment'}
                        </button>
                      </div>
                    )}

                    {/* ----- NEW STORY form ----- */}
                    {isOpen?.action === 'new_story' && (
                      <div style={{ marginTop: 6 }} data-testid={`carry-over-new-story-form-${item.id}`}>
                        <input
                          className={styles.modalInput}
                          style={{ width: '100%' }}
                          placeholder="Story title"
                          value={formTitle}
                          onChange={(e) => setFormTitle(e.target.value)}
                          data-testid={`carry-over-new-story-title-${item.id}`}
                        />
                        <textarea
                          className={styles.modalInput}
                          style={{ width: '100%', minHeight: 70, marginTop: 4 }}
                          placeholder="Story description — must EMBED what this item requires (spec generation grounds on it)"
                          value={formDescription}
                          onChange={(e) => setFormDescription(e.target.value)}
                          data-testid={`carry-over-new-story-description-${item.id}`}
                        />
                        {item.kind === 'finding' && (
                          <>
                            <label style={{ display: 'block', marginTop: 4 }}>
                              Workstream:{' '}
                              <select
                                value={formWorkstream}
                                onChange={(e) => setFormWorkstream(e.target.value)}
                                data-testid={`carry-over-new-story-workstream-${item.id}`}
                              >
                                {ALL_WORKSTREAMS.map((w) => (
                                  <option key={w} value={w}>
                                    {w}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <textarea
                              className={styles.modalInput}
                              style={{ width: '100%', minHeight: 50, marginTop: 4 }}
                              placeholder="Acceptance criteria (one per line)"
                              value={formCriteria}
                              onChange={(e) => setFormCriteria(e.target.value)}
                              data-testid={`carry-over-new-story-criteria-${item.id}`}
                            />
                          </>
                        )}
                        <button
                          type="button"
                          className={`${styles.selectButton} ${styles.selectButtonPrimary}`}
                          disabled={
                            busy ||
                            (item.kind === 'finding' &&
                              (formTitle.trim() === '' || formDescription.trim() === ''))
                          }
                          onClick={() => void confirmNewStory(item)}
                          data-testid={`carry-over-new-story-confirm-${item.id}`}
                        >
                          {busy ? 'Creating…' : 'Create story'}
                        </button>
                      </div>
                    )}

                    {/* ----- DISMISS form ----- */}
                    {isOpen?.action === 'dismiss' && (
                      <div style={{ marginTop: 6 }} data-testid={`carry-over-dismiss-form-${item.id}`}>
                        <textarea
                          className={styles.modalInput}
                          style={{ width: '100%', minHeight: 50 }}
                          placeholder="Dismissal reason (required — the gate ignores reasonless dismissals)"
                          value={formReason}
                          onChange={(e) => setFormReason(e.target.value)}
                          data-testid={`carry-over-dismiss-reason-${item.id}`}
                        />
                        <button
                          type="button"
                          className={`${styles.selectButton} ${styles.selectButtonPrimary}`}
                          disabled={busy || formReason.trim() === ''}
                          onClick={() => void confirmDismiss(item)}
                          data-testid={`carry-over-dismiss-confirm-${item.id}`}
                        >
                          {busy ? 'Dismissing…' : 'Dismiss with reason'}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
};

export default MigrationCarryOverAccountingPanel;
