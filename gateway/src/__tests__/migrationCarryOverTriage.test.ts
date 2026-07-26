/**
 * Carry-over triage tests (2026-07-26,
 * agent-os/planning/2026-07-26-carry-over-triage-build-plan.md, Item 2).
 *
 * The LLM drafts; the human approves; the BOOKKEEPING is deterministic. These
 * pins hold the deterministic parts:
 *
 *   1. `validateTriagePayload` — every violation BLANKS the disposition with a
 *      note (no silent coercion): unknown disposition, capability cite/amend,
 *      missing/unknown target, empty amendment, missing story draft fields,
 *      out-of-vocabulary workstream, reasonless dismiss.
 *   2. `draftSingleSuggestion` — a forced disposition the model drifts from is
 *      blanked for re-review; an LLM failure fail-softs to a null-disposition
 *      suggestion (one bad call never sinks the batch); fenced JSON parses.
 *   3. Prompt assembly — reviewer guidance and the forced disposition are
 *      folded into the user prompt (the user's requirement); capabilities get
 *      the new_story|dismiss constraint line.
 *   4. `applyTriageSuggestions` — each disposition routes to the SAME Item-1
 *      action AMS callers the manual buttons use, sequential + fail-soft, and
 *      a finding dismissal carries its run id.
 *
 * All LLM calls are injected mocks (the live-LLM guard stays respected).
 */

jest.mock('../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  validateTriagePayload,
  draftSingleSuggestion,
  runCarryOverTriage,
  applyTriageSuggestions,
  buildTriageUserPrompt,
  TriageItemInput,
  TriageStoryIndexEntry,
  TriageLlmCaller,
} from '../services/migrationCarryOverTriage';
import { CarryOverActionDeps } from '../services/migrationCarryOverActions';
import { CarryOverItemDetail } from '../services/migrationCarryOverCoverageReads';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT_ID = 'proj-1';
const BOOK_ID = 'book-1';
const ARCH_ID = 'arch-1';

function findingDetail(over: Partial<CarryOverItemDetail> = {}): CarryOverItemDetail {
  return {
    kind: 'finding',
    title: 'Ledger close halts on replication lag',
    summary: 'The close job aborts when replication lag exceeds 5 minutes.',
    severity: 'high',
    category: 'operational_artifact',
    runId: 'run-9',
    reviewStatus: 'approved',
    memberFindingCount: null,
    ...over,
  };
}

function findingItem(id = 'f-1'): TriageItemInput {
  return { id, kind: 'finding', detail: findingDetail() };
}

function capabilityItem(id = 'cap-1'): TriageItemInput {
  return {
    id,
    kind: 'capability',
    detail: findingDetail({ kind: 'capability', severity: null, memberFindingCount: 3 }),
  };
}

const STORY_INDEX: TriageStoryIndexEntry[] = [
  {
    bookItemId: 's-close',
    title: 'Recreate the ledger close endpoint',
    description: 'Implements POST /ledger/close verbatim.',
    workstream: 'api_migration',
  },
  {
    bookItemId: 's-purge',
    title: 'Recreate the archive purge job',
    description: 'Weekly purge of archived rows.',
    workstream: 'internal_processing_implementation',
  },
];

// ---------------------------------------------------------------------------
// 1 — deterministic validation
// ---------------------------------------------------------------------------

describe('validateTriagePayload', () => {
  it('accepts a clean cite / amend / new_story / dismiss', () => {
    const cite = validateTriagePayload(findingItem(), STORY_INDEX, {
      disposition: 'cite',
      target_book_item_id: 's-close',
      rationale: 'The close story already covers the lag halt.',
    });
    expect(cite.disposition).toBe('cite');
    expect(cite.targetBookItemId).toBe('s-close');
    expect(cite.validationNote).toBeNull();

    const amend = validateTriagePayload(findingItem(), STORY_INDEX, {
      disposition: 'amend_story',
      target_book_item_id: 's-close',
      rationale: 'In scope but unaddressed.',
      draft_amendment: {
        description: 'Implements POST /ledger/close verbatim, halting on replication lag.',
        append_acceptance_criteria: ['Halts when lag exceeds 5 minutes.', ' '],
      },
    });
    expect(amend.disposition).toBe('amend_story');
    expect(amend.draftAmendment).toEqual({
      description: 'Implements POST /ledger/close verbatim, halting on replication lag.',
      appendAcceptanceCriteria: ['Halts when lag exceeds 5 minutes.'],
    });

    const story = validateTriagePayload(findingItem(), STORY_INDEX, {
      disposition: 'new_story',
      rationale: 'No existing home.',
      draft_story: {
        title: 'Recreate the replication-lag guard',
        description: 'The close aborts when replication lag exceeds 5 minutes; the target must too.',
        workstream: 'internal_processing_implementation',
        acceptance_criteria: ['Guard verified.'],
      },
    });
    expect(story.disposition).toBe('new_story');
    expect(story.draftStory?.workstream).toBe('internal_processing_implementation');

    const dismiss = validateTriagePayload(findingItem(), STORY_INDEX, {
      disposition: 'dismiss',
      rationale: 'Superseded.',
      dismiss_reason: 'Managed replication makes the lag guard obsolete.',
    });
    expect(dismiss.disposition).toBe('dismiss');
    expect(dismiss.dismissReason).toBe('Managed replication makes the lag guard obsolete.');
  });

  it('BLANKS the disposition (never coerces) on every violation, with a note', () => {
    // Unknown disposition.
    expect(
      validateTriagePayload(findingItem(), STORY_INDEX, { disposition: 'defer' })
        .disposition
    ).toBeNull();

    // A capability cannot cite/amend (its citation is the capability-story mint).
    const capCite = validateTriagePayload(capabilityItem(), STORY_INDEX, {
      disposition: 'cite',
      target_book_item_id: 's-close',
    });
    expect(capCite.disposition).toBeNull();
    expect(capCite.validationNote).toContain('capability');

    // Cite onto a non-existent story.
    const badTarget = validateTriagePayload(findingItem(), STORY_INDEX, {
      disposition: 'cite',
      target_book_item_id: 's-ghost',
    });
    expect(badTarget.disposition).toBeNull();
    expect(badTarget.validationNote).toContain('s-ghost');

    // An amendment that drafts nothing.
    expect(
      validateTriagePayload(findingItem(), STORY_INDEX, {
        disposition: 'amend_story',
        target_book_item_id: 's-close',
        draft_amendment: { description: '  ', append_acceptance_criteria: [] },
      }).disposition
    ).toBeNull();

    // A story draft missing its description.
    expect(
      validateTriagePayload(findingItem(), STORY_INDEX, {
        disposition: 'new_story',
        draft_story: { title: 'T', description: '', workstream: 'api_migration' },
      }).disposition
    ).toBeNull();

    // An out-of-vocabulary workstream.
    const badWs = validateTriagePayload(findingItem(), STORY_INDEX, {
      disposition: 'new_story',
      draft_story: {
        title: 'T',
        description: 'D',
        workstream: 'made_up_stream',
      },
    });
    expect(badWs.disposition).toBeNull();
    expect(badWs.validationNote).toContain('made_up_stream');

    // A reasonless dismissal.
    expect(
      validateTriagePayload(findingItem(), STORY_INDEX, {
        disposition: 'dismiss',
        dismiss_reason: '   ',
      }).disposition
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2 + 3 — drafting seam (mocked LLM) + prompt assembly
// ---------------------------------------------------------------------------

describe('draftSingleSuggestion', () => {
  it('parses fenced JSON, and BLANKS a draft that drifted from the forced disposition', async () => {
    const fenced: TriageLlmCaller = async () => ({
      content:
        '```json\n' +
        JSON.stringify({
          disposition: 'dismiss',
          rationale: 'r',
          dismiss_reason: 'Obsolete under managed replication.',
        }) +
        '\n```',
    });

    // Un-forced: the fenced dismiss parses and validates.
    const free = await draftSingleSuggestion(
      { projectId: PROJECT_ID, item: findingItem(), storyIndex: STORY_INDEX },
      fenced
    );
    expect(free.disposition).toBe('dismiss');

    // Forced amend but the model drafted dismiss → blanked for re-review.
    const forced = await draftSingleSuggestion(
      {
        projectId: PROJECT_ID,
        item: findingItem(),
        storyIndex: STORY_INDEX,
        forcedDisposition: 'amend_story',
      },
      fenced
    );
    expect(forced.disposition).toBeNull();
    expect(forced.validationNote).toContain("asked for 'amend_story'");
  });

  it('fail-softs an LLM failure to a null-disposition suggestion (one bad call never sinks the batch)', async () => {
    const boom: TriageLlmCaller = async () => {
      throw new Error('429 too many requests');
    };
    const suggestion = await draftSingleSuggestion(
      { projectId: PROJECT_ID, item: findingItem(), storyIndex: STORY_INDEX },
      boom
    );
    expect(suggestion.disposition).toBeNull();
    expect(suggestion.validationNote).toContain('429');
  });
});

describe('buildTriageUserPrompt', () => {
  it('folds the reviewer guidance + forced disposition in, and constrains capabilities to new_story|dismiss', () => {
    const prompt = buildTriageUserPrompt({
      item: findingItem(),
      storyIndex: STORY_INDEX,
      forcedDisposition: 'amend_story',
      guidance: 'Focus the amendment on the 5-minute lag threshold.',
    });
    expect(prompt).toContain('THE REVIEWER HAS CHOSEN the disposition "amend_story"');
    expect(prompt).toContain('REVIEWER GUIDANCE');
    expect(prompt).toContain('Focus the amendment on the 5-minute lag threshold.');
    expect(prompt).toContain('[s-close] "Recreate the ledger close endpoint"');

    const capPrompt = buildTriageUserPrompt({
      item: capabilityItem(),
      storyIndex: STORY_INDEX,
    });
    expect(capPrompt).toContain('allowed dispositions are "new_story" or "dismiss" ONLY');
    expect(capPrompt).toContain('absorbs 3 member finding(s)');
  });
});

describe('runCarryOverTriage', () => {
  it('drafts one suggestion per item, in order, sequentially', async () => {
    const seen: string[] = [];
    const caller: TriageLlmCaller = async ({ label }) => {
      seen.push(label);
      return {
        content: JSON.stringify({
          disposition: 'dismiss',
          rationale: 'r',
          dismiss_reason: `reason for ${label}`,
        }),
      };
    };
    const suggestions = await runCarryOverTriage(
      {
        projectId: PROJECT_ID,
        bookId: BOOK_ID,
        items: [findingItem('f-1'), findingItem('f-2')],
        storyIndex: STORY_INDEX,
      },
      caller
    );
    expect(seen).toEqual(['f-1', 'f-2']);
    expect(suggestions.map((s) => s.itemId)).toEqual(['f-1', 'f-2']);
    expect(suggestions[0].dismissReason).toBe('reason for f-1');
  });
});

// ---------------------------------------------------------------------------
// 4 — apply (approved suggestions → the Item-1 AMS callers)
// ---------------------------------------------------------------------------

describe('applyTriageSuggestions', () => {
  function actionDeps(over: Partial<CarryOverActionDeps> = {}): CarryOverActionDeps {
    return {
      appendCapabilityStory: jest.fn().mockResolvedValue({
        work_item_id: 'wi-cap',
        book_item_id: 'capstory-1',
      }),
      patchCapabilityReview: jest.fn().mockResolvedValue({}),
      patchFindingReview: jest.fn().mockResolvedValue({}),
      citeFindingOnStory: jest.fn().mockResolvedValue({ already_cited: false }),
      amendStoryItem: jest.fn().mockResolvedValue({
        book_item_id: 's-close',
        work_item_id: 'wi-1',
        specs_marked_stale: 1,
      }),
      addManualStoryItem: jest.fn().mockResolvedValue({
        work_item_id: 'wi-new',
        book_item_id: 'manual-1',
      }),
      ...over,
    };
  }

  function detailMap(): Map<string, CarryOverItemDetail> {
    return new Map([
      ['f-1', findingDetail()],
      ['f-2', findingDetail()],
      ['cap-1', findingDetail({ kind: 'capability', title: 'Nightly batch spine' })],
    ]);
  }

  it('routes every disposition to the right AMS caller (capability new_story = the capability-story mint) and a finding dismissal carries its RUN id', async () => {
    const deps = actionDeps();
    const results = await applyTriageSuggestions(
      {
        projectId: PROJECT_ID,
        bookId: BOOK_ID,
        architectureId: ARCH_ID,
        itemDetailById: detailMap(),
        suggestions: [
          { itemId: 'f-1', kind: 'finding', disposition: 'cite', targetBookItemId: 's-close' },
          {
            itemId: 'f-2',
            kind: 'finding',
            disposition: 'amend_story',
            targetBookItemId: 's-close',
            draftAmendment: {
              description: 'Amended.',
              appendAcceptanceCriteria: ['Criterion.'],
            },
          },
          {
            itemId: 'cap-1',
            kind: 'capability',
            disposition: 'new_story',
            draftStory: {
              title: 'Recreate the nightly batch spine',
              description: 'The JIL chain, verbatim.',
              workstream: 'internal_processing_implementation',
              acceptanceCriteria: [],
            },
          },
        ],
      },
      deps
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(deps.citeFindingOnStory).toHaveBeenCalledWith(PROJECT_ID, BOOK_ID, 's-close', 'f-1');
    expect(deps.amendStoryItem).toHaveBeenCalledWith(
      PROJECT_ID,
      BOOK_ID,
      's-close',
      expect.objectContaining({ cite_finding_id: 'f-2', description: 'Amended.' })
    );
    // Capability new_story = append-capability-story (the D3 mint), never add-item.
    expect(deps.appendCapabilityStory).toHaveBeenCalledWith(
      PROJECT_ID,
      BOOK_ID,
      expect.objectContaining({
        source_capability_id: 'cap-1',
        title: 'Recreate the nightly batch spine',
      })
    );
    expect(deps.addManualStoryItem).not.toHaveBeenCalled();

    // Dismissal of a finding is run-scoped.
    const deps2 = actionDeps();
    await applyTriageSuggestions(
      {
        projectId: PROJECT_ID,
        bookId: BOOK_ID,
        architectureId: ARCH_ID,
        itemDetailById: detailMap(),
        suggestions: [
          {
            itemId: 'f-1',
            kind: 'finding',
            disposition: 'dismiss',
            dismissReason: 'Obsolete under managed replication.',
          },
        ],
      },
      deps2
    );
    expect(deps2.patchFindingReview).toHaveBeenCalledWith(
      PROJECT_ID,
      ARCH_ID,
      'run-9',
      'f-1',
      expect.objectContaining({ review_status: 'dismissed' })
    );
  });

  it('is fail-soft per item: a failing action records an error and the batch continues', async () => {
    const deps = actionDeps({
      citeFindingOnStory: jest.fn().mockRejectedValue(new Error('AMS 500')),
    });
    const results = await applyTriageSuggestions(
      {
        projectId: PROJECT_ID,
        bookId: BOOK_ID,
        architectureId: ARCH_ID,
        itemDetailById: detailMap(),
        suggestions: [
          { itemId: 'f-1', kind: 'finding', disposition: 'cite', targetBookItemId: 's-close' },
          {
            itemId: 'f-2',
            kind: 'finding',
            disposition: 'dismiss',
            dismissReason: 'Out of scope by decision.',
          },
        ],
      },
      deps
    );
    expect(results[0].ok).toBe(false);
    expect(results[0].error).toContain('AMS 500');
    expect(results[1].ok).toBe(true);
  });
});
