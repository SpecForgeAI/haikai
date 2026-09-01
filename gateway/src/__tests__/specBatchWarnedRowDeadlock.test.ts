/**
 * Spec-batch warned-row deadlock (2026-09-01).
 *
 * `generated_with_warnings` is a COMPLETED state, but the eligibility skip
 * tested `status === 'generated'` alone — so every warned row read as
 * unfinished forever. Each batch re-selected the same warned rows first,
 * regenerated them to the identical warned result, and never reached the
 * stories behind them: a live book sat FROZEN at the same spec count through
 * a full day of "successful" batch clicks. `computeNextBatchStart` shared the
 * identical bug, which kept the UI's "next batch starts at" consistent with
 * the spinning batch — both wrong the same way.
 *
 * Pins:
 *   1. the failure reconstruction: warned rows ahead of pending stories no
 *      longer crowd out real work;
 *   2. repeated batch clicks CONVERGE (every pending story gets done);
 *   3. computeNextBatchStart agrees with selectEligibleStories;
 *   4. what must NOT change: plain `generated` still skipped, `stale` rows
 *      (warned or not) still re-selected, `failed`/`insufficient_context`
 *      still retried, `regenerateAll` still forces everything, an all-done
 *      book returns empty.
 */

import {
  LoadedBookOfWork,
  MigrationStorySpecGenerationDto,
  computeNextBatchStart,
  selectEligibleStories,
} from '../services/migrationShapeSpecGenerationHandler';

function bookWith(
  stories: Array<{ id: string; workItemId: string; seq: number }>,
): LoadedBookOfWork {
  return {
    bookOfWorkId: 'book-1',
    projectId: 'proj-1',
    currentArchitectureId: 'arch-1',
    targetArchitectureId: null,
    items: stories.map((s) => ({
      id: s.id,
      type: 'story' as const,
      parentId: null,
      title: `Story ${s.id}`,
      sequenceOrder: s.seq,
      workItemId: s.workItemId,
    })),
  } as LoadedBookOfWork;
}

function row(
  workItemId: string,
  status: string,
  over: Partial<MigrationStorySpecGenerationDto> = {},
): MigrationStorySpecGenerationDto {
  return {
    projectId: 'proj-1',
    workItemId,
    status,
    generatedSpecText: status.startsWith('generated') ? 'spec text' : null,
    generationAttemptNumber: 1,
    ...over,
  } as MigrationStorySpecGenerationDto;
}

/** The live shape, scaled down: 5 warned rows ahead of 8 never-generated. */
function frozenBook() {
  const warned = Array.from({ length: 5 }, (_, i) => ({
    id: `s-warned-${i}`,
    workItemId: `wi-warned-${i}`,
    seq: i + 1,
  }));
  const pending = Array.from({ length: 8 }, (_, i) => ({
    id: `s-new-${i}`,
    workItemId: `wi-new-${i}`,
    seq: 10 + i,
  }));
  const bow = bookWith([...warned, ...pending]);
  const existing = warned.map((w) => row(w.workItemId, 'generated_with_warnings'));
  return { bow, existing, pending };
}

describe('warned-row deadlock — the failure reconstruction', () => {
  it('warned rows no longer crowd out real work: the batch selects ONLY the pending stories', () => {
    const { bow, existing } = frozenBook();
    const eligible = selectEligibleStories(bow, existing, 6, false);
    // Under the old code this returned the 5 warned rows first (plus one real
    // story) — a batch full of work that produced the identical warned result.
    expect(eligible.map((it) => it.id)).toEqual([
      's-new-0',
      's-new-1',
      's-new-2',
      's-new-3',
      's-new-4',
      's-new-5',
    ]);
    expect(eligible.every((it) => it.id.startsWith('s-new-'))).toBe(true);
  });

  it('repeated batch clicks CONVERGE: every pending story gets generated', () => {
    const { bow, existing, pending } = frozenBook();
    const rows = [...existing];
    const done = new Set<string>();
    for (let click = 0; click < 10; click++) {
      const batch = selectEligibleStories(bow, rows, 3, false);
      if (batch.length === 0) break;
      for (const it of batch) {
        done.add(it.workItemId as string);
        // Half the results come back warned — completion must not care.
        rows.push(
          row(it.workItemId as string, done.size % 2 === 0
            ? 'generated'
            : 'generated_with_warnings'),
        );
      }
    }
    expect(done.size).toBe(pending.length);
    expect(selectEligibleStories(bow, rows, 3, false)).toEqual([]);
  });

  it('computeNextBatchStart agrees with the batch: it reports the first PENDING story, never a warned one', () => {
    const { bow, existing } = frozenBook();
    // Old code: warned rows read as unfinished -> reported seq 1 while
    // claiming to do work there forever. Now: the first real story.
    expect(computeNextBatchStart(bow, existing, false)).toBe(10);
    const eligible = selectEligibleStories(bow, existing, 6, false);
    expect(eligible[0].sequenceOrder).toBe(10);
  });
});

describe('warned-row deadlock — what must NOT change', () => {
  const BOW = bookWith([
    { id: 's-a', workItemId: 'wi-a', seq: 1 },
    { id: 's-b', workItemId: 'wi-b', seq: 2 },
  ]);

  it('plain generated rows are still skipped', () => {
    const eligible = selectEligibleStories(BOW, [row('wi-a', 'generated')], 10, false);
    expect(eligible.map((it) => it.id)).toEqual(['s-b']);
  });

  it('STALE rows are still re-selected — warned or not (staleness is senior to completion)', () => {
    const eligible = selectEligibleStories(
      BOW,
      [
        row('wi-a', 'generated_with_warnings', { stale: true }),
        row('wi-b', 'generated', { stale: true }),
      ],
      10,
      false,
    );
    expect(eligible.map((it) => it.id)).toEqual(['s-a', 's-b']);
  });

  it('failed and insufficient_context rows are still retried', () => {
    const eligible = selectEligibleStories(
      BOW,
      [row('wi-a', 'failed'), row('wi-b', 'insufficient_context')],
      10,
      false,
    );
    expect(eligible.map((it) => it.id)).toEqual(['s-a', 's-b']);
  });

  it('regenerateAll still forces everything, warned rows included', () => {
    const eligible = selectEligibleStories(
      BOW,
      [row('wi-a', 'generated_with_warnings'), row('wi-b', 'generated')],
      10,
      true,
    );
    expect(eligible.map((it) => it.id)).toEqual(['s-a', 's-b']);
  });

  it('an all-done book returns an empty batch and next-start 0', () => {
    const rows = [row('wi-a', 'generated'), row('wi-b', 'generated_with_warnings')];
    expect(selectEligibleStories(BOW, rows, 10, false)).toEqual([]);
    expect(computeNextBatchStart(BOW, rows, false)).toBe(0);
  });
});
