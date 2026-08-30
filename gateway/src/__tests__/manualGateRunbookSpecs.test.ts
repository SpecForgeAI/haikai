/**
 * Manual-gate runbook specs (2026-08-30).
 *
 * The codebase was inconsistent with itself: the execution-class module said
 * manual work "NEVER generates a spec", yet `buildManualGateSpecText` already
 * rendered a real numbered runbook for `execution:manual-gate` capture/closure
 * gates — it just never ran, because `selectEligibleStories` blanket-filtered
 * ALL manual work. Pins:
 *
 *   - `isManualGateRunbookItem` is true ONLY for execution:manual-gate items;
 *   - the DISPATCH INVARIANT: runbook items remain classified `manual` (the
 *     driver's skip is tag-based, so a persisted spec row cannot make them
 *     dispatchable — the 2026-08-04-1 ruling's real protection);
 *   - `recommendedNextActionForItem` never tells a manual item to press the
 *     generate button (which the eligibility filter forbids);
 *   - `selectEligibleStories` admits manual-gate runbook items alongside
 *     automated stories, keeps every OTHER manual shape excluded, and still
 *     honours the generated-row / workItemId guards.
 */

import {
  MANUAL_EXECUTION_TAG,
  executionClassForItem,
  isManualExecutionItem,
  isManualGateRunbookItem,
  recommendedNextActionForItem,
} from '../services/migrationExecutionClass';
import {
  LoadedBookOfWork,
  MigrationStorySpecGenerationDto,
  selectEligibleStories,
} from '../services/migrationShapeSpecGenerationHandler';

// ---------------------------------------------------------------------------
// Tag shapes (tool vocabulary — these are wire constants, not estate data)
// ---------------------------------------------------------------------------

const MANUAL_GATE_TAGS = ['provenance:plan-deterministic', 'execution:manual-gate', MANUAL_EXECUTION_TAG];
const PLAIN_MANUAL_TAGS = [MANUAL_EXECUTION_TAG];
const PACK_REVIEW_TAGS = ['provenance:pack']; // no verbatim-carriage tag -> manual review gate
const PREREQUISITE_TAGS = ['provenance:prerequisite'];
const AUTOMATED_TAGS = ['stream:code', 'provenance:plan-deterministic'];

describe('isManualGateRunbookItem', () => {
  it('is true ONLY for execution:manual-gate items', () => {
    expect(isManualGateRunbookItem({ tags: MANUAL_GATE_TAGS })).toBe(true);
    expect(isManualGateRunbookItem({ tags: PLAIN_MANUAL_TAGS })).toBe(false);
    expect(isManualGateRunbookItem({ tags: PACK_REVIEW_TAGS })).toBe(false);
    expect(isManualGateRunbookItem({ tags: PREREQUISITE_TAGS })).toBe(false);
    expect(isManualGateRunbookItem({ tags: AUTOMATED_TAGS })).toBe(false);
    expect(isManualGateRunbookItem({ tags: null })).toBe(false);
  });

  it('DISPATCH INVARIANT: runbook items are STILL classified manual — a spec row cannot make them dispatchable', () => {
    // The execution driver's skip consults isManualExecutionItem (tag-based),
    // never "does a spec row exist" — this is what the 2026-08-04-1 ruling
    // actually protects. Persisting the runbook must not reclassify.
    expect(executionClassForItem({ tags: MANUAL_GATE_TAGS })).toBe('manual');
    expect(isManualExecutionItem({ tags: MANUAL_GATE_TAGS })).toBe(true);
    // Even a bare legacy manual-gate tag (no canonical execution:manual).
    expect(executionClassForItem({ tags: ['execution:manual-gate'] })).toBe('manual');
  });
});

describe('recommendedNextActionForItem', () => {
  it('points manual-gate items at their persisted procedure', () => {
    expect(recommendedNextActionForItem({ tags: MANUAL_GATE_TAGS })).toBe(
      'Work the persisted manual-gate procedure; complete when its gate condition holds.',
    );
  });

  it('points every OTHER manual shape at its own acceptance criteria', () => {
    for (const tags of [PLAIN_MANUAL_TAGS, PACK_REVIEW_TAGS, PREREQUISITE_TAGS]) {
      expect(recommendedNextActionForItem({ tags })).toBe(
        'Manual work item — no spec is generated. Complete the task and satisfy its acceptance criteria.',
      );
    }
  });

  it('keeps the generate default for automated items', () => {
    expect(recommendedNextActionForItem({ tags: AUTOMATED_TAGS })).toBe(
      'Generate the focused shape-spec for this story.',
    );
    expect(recommendedNextActionForItem({ tags: [] })).toBe(
      'Generate the focused shape-spec for this story.',
    );
  });

  it('NO manual shape ever advertises spec generation', () => {
    for (const tags of [MANUAL_GATE_TAGS, PLAIN_MANUAL_TAGS, PACK_REVIEW_TAGS, PREREQUISITE_TAGS]) {
      expect(recommendedNextActionForItem({ tags })).not.toContain(
        'Generate the focused shape-spec',
      );
    }
  });
});

// ---------------------------------------------------------------------------
// selectEligibleStories
// ---------------------------------------------------------------------------

function bookWith(
  stories: Array<{ id: string; workItemId: string | null; tags?: string[] }>,
): LoadedBookOfWork {
  return {
    bookOfWorkId: 'book-1',
    projectId: 'proj-1',
    currentArchitectureId: 'arch-1',
    targetArchitectureId: null,
    items: stories.map((s, i) => ({
      id: s.id,
      type: 'story' as const,
      parentId: null,
      title: `Story ${s.id}`,
      sequenceOrder: i,
      workItemId: s.workItemId,
      tags: s.tags ?? [],
    })),
  } as LoadedBookOfWork;
}

function generatedRow(
  workItemId: string,
  over: Partial<MigrationStorySpecGenerationDto> = {},
): MigrationStorySpecGenerationDto {
  return {
    projectId: 'proj-1',
    workItemId,
    status: 'generated',
    generatedSpecText: 'spec text',
    generationAttemptNumber: 1,
    ...over,
  } as MigrationStorySpecGenerationDto;
}

describe('selectEligibleStories — manual-gate runbook admission', () => {
  const MIXED_BOOK = bookWith([
    { id: 's-auto', workItemId: 'wi-auto', tags: AUTOMATED_TAGS },
    { id: 's-gate-1', workItemId: 'wi-gate-1', tags: MANUAL_GATE_TAGS },
    { id: 's-gate-2', workItemId: 'wi-gate-2', tags: MANUAL_GATE_TAGS },
    { id: 's-gate-3', workItemId: 'wi-gate-3', tags: ['execution:manual-gate'] },
    { id: 's-review', workItemId: 'wi-review', tags: PACK_REVIEW_TAGS },
    { id: 's-prereq', workItemId: 'wi-prereq', tags: PREREQUISITE_TAGS },
    { id: 's-manual', workItemId: 'wi-manual', tags: PLAIN_MANUAL_TAGS },
  ]);

  it('admits the automated story AND every manual-gate runbook item; excludes all other manual shapes', () => {
    const eligible = selectEligibleStories(MIXED_BOOK, [], 10, false);
    const ids = eligible.map((it) => it.id).sort();
    expect(ids).toEqual(['s-auto', 's-gate-1', 's-gate-2', 's-gate-3']);
    // The shape: 4 of 7 — three runbook gates + the automated story; the
    // review gate, prerequisite gate and plain manual item stay out.
    expect(eligible).toHaveLength(4);
  });

  it('respects an already-generated row for a runbook item (no needless regeneration)', () => {
    const eligible = selectEligibleStories(
      MIXED_BOOK,
      [generatedRow('wi-gate-1')],
      10,
      false,
    );
    const ids = eligible.map((it) => it.id);
    expect(ids).not.toContain('s-gate-1');
    expect(ids).toContain('s-gate-2');

    // regenerateAll brings it back, like any automated story.
    const regenerated = selectEligibleStories(
      MIXED_BOOK,
      [generatedRow('wi-gate-1')],
      10,
      true,
    );
    expect(regenerated.map((it) => it.id)).toContain('s-gate-1');
  });

  it('keeps the workItemId guard: an unsaved manual-gate story is not eligible', () => {
    const book = bookWith([
      { id: 's-gate-saved', workItemId: 'wi-1', tags: MANUAL_GATE_TAGS },
      { id: 's-gate-unsaved', workItemId: null, tags: MANUAL_GATE_TAGS },
    ]);
    const eligible = selectEligibleStories(book, [], 10, false);
    expect(eligible.map((it) => it.id)).toEqual(['s-gate-saved']);
  });
});
