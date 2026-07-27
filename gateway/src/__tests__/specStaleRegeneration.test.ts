/**
 * Stale-spec regeneration mechanics (carry-over triage plumbing, 2026-07-26,
 * agent-os/planning/2026-07-26-carry-over-triage-build-plan.md Item 1).
 *
 * A story AMENDED for a carry-over finding keeps its generated spec row but is
 * marked STALE server-side (AMS `items/{id}/amend`). Three seams must agree on
 * what that means, and these pins hold them together:
 *
 *   1. `normaliseAmsRow` maps the newly-exposed stale trio off the AMS wire
 *      (the columns existed since the Target Architecture Authoring Flow but
 *      were never on the DTO — without this the gateway can't see staleness);
 *   2. `selectEligibleStories` treats a STALE generated row as needing
 *      REgeneration (the R-8 skip-generated rule is carved out) — so the plan
 *      screen's normal "Generate specs" batch regenerates amended stories,
 *      and regeneration's clear-on-success closes the loop;
 *   3. `isStorySpecReady` refuses a stale row (CD-7) — the amended story
 *      drops out of stage readiness until regenerated.
 *
 * No LLM, no AMS — pure functions + the wire normaliser.
 */

jest.mock('../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  selectEligibleStories,
  normaliseAmsRow,
  MigrationStorySpecGenerationDto,
  LoadedBookOfWork,
} from '../services/migrationShapeSpecGenerationHandler';
import { isStorySpecReady } from '../services/migrationExecutionDriver';
import { SpecGeneration } from '../services/migrationDriverAmsReads';

function bookWith(stories: Array<{ id: string; workItemId: string }>): LoadedBookOfWork {
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
    })),
  };
}

function generatedRow(
  workItemId: string,
  over: Partial<MigrationStorySpecGenerationDto> = {}
): MigrationStorySpecGenerationDto {
  return {
    projectId: 'proj-1',
    workItemId,
    status: 'generated',
    generatedSpecText: 'spec text',
    generationAttemptNumber: 1,
    ...over,
  };
}

describe('stale-spec regeneration mechanics', () => {
  it('normaliseAmsRow maps the stale trio off the snake_case AMS wire (and tolerates camelCase)', () => {
    const snake = normaliseAmsRow({
      id: 'sg-1',
      project_id: 'proj-1',
      work_item_id: 'wi-1',
      status: 'generated',
      stale: true,
      stale_reason: 'story_amended_for_finding:f-1',
      stale_marked_at: '2026-07-26T10:00:00Z',
    });
    expect(snake.stale).toBe(true);
    expect(snake.staleReason).toBe('story_amended_for_finding:f-1');
    expect(snake.staleMarkedAt).toBe('2026-07-26T10:00:00Z');

    const camel = normaliseAmsRow({
      id: 'sg-2',
      projectId: 'proj-1',
      workItemId: 'wi-2',
      status: 'generated',
      stale: true,
      staleReason: 'resolution_reset',
    });
    expect(camel.stale).toBe(true);
    expect(camel.staleReason).toBe('resolution_reset');
  });

  it('selectEligibleStories INCLUDES a stale generated row (the amended story regenerates through the normal batch) and still skips fresh generated rows', () => {
    const bow = bookWith([
      { id: 's-fresh', workItemId: 'wi-fresh' },
      { id: 's-stale', workItemId: 'wi-stale' },
      { id: 's-new', workItemId: 'wi-new' },
    ]);
    const existing = [
      generatedRow('wi-fresh'),
      generatedRow('wi-stale', {
        stale: true,
        staleReason: 'story_amended_for_finding:f-1',
      }),
      // wi-new has no row at all (classic not-attempted).
    ];

    const eligible = selectEligibleStories(bow, existing, 10, false);
    const ids = eligible.map((it) => it.id);
    expect(ids).toContain('s-stale');
    expect(ids).toContain('s-new');
    expect(ids).not.toContain('s-fresh');
  });

  it('isStorySpecReady REFUSES a stale row (CD-7): the amended story drops out of stage readiness until regenerated', () => {
    const item = {
      id: 's-1',
      parentId: null,
      type: 'story',
      title: 'Amended story',
      sequenceOrder: 0,
      workItemId: 'wi-1',
    } as never;
    const staleRow: SpecGeneration = {
      id: 'sg-1',
      work_item_id: 'wi-1',
      status: 'generated',
      generated_spec_text: 'spec',
      stale_reason: 'story_amended_for_finding:f-1',
      generation_attempt_number: 2,
      created_at: '2026-07-26T10:00:00Z',
    };
    expect(isStorySpecReady(item, [staleRow])).toBe(false);

    // Clearing the reason (successful regeneration) restores readiness.
    expect(
      isStorySpecReady(item, [{ ...staleRow, stale_reason: null }])
    ).toBe(true);
  });

  it('isStorySpecReady honours BOTH stale flags and manual_ready (2026-07-27, card/gate parity)', () => {
    const item = {
      id: 's-1',
      parentId: null,
      type: 'story',
      title: 'Story',
      sequenceOrder: 0,
      workItemId: 'wi-1',
    } as never;

    // The target-architecture mark-stale stamps `stale` with NO reason —
    // the gate must refuse it just the same (the card already did).
    const staleBooleanOnly: SpecGeneration = {
      id: 'sg-1',
      work_item_id: 'wi-1',
      status: 'generated',
      generated_spec_text: 'spec',
      stale: true,
      stale_reason: null,
      generation_attempt_number: 1,
      created_at: '2026-07-27T10:00:00Z',
    };
    expect(isStorySpecReady(item, [staleBooleanOnly])).toBe(false);

    // A human-accepted MANUAL spec (Phase 1a) counts as ready — the card
    // always counted it; pre-fix the gate refused it ("enabled button ⇒
    // server says yes" cuts both ways).
    const manualReadyRow: SpecGeneration = {
      id: 'sg-2',
      work_item_id: 'wi-1',
      status: 'insufficient_context',
      generated_spec_text: 'human-supplied spec',
      manual_ready: true,
      stale: false,
      stale_reason: null,
      generation_attempt_number: 1,
      created_at: '2026-07-27T10:00:00Z',
    };
    expect(isStorySpecReady(item, [manualReadyRow])).toBe(true);

    // …but a STALE manual-ready row is still refused (stale wins).
    expect(
      isStorySpecReady(item, [{ ...manualReadyRow, stale: true }])
    ).toBe(false);
  });
});
