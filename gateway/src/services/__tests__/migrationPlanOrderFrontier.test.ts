/**
 * Plan-order frontier (2026-09-11): durable per-work-item outcomes across
 * every run of the book + the "only the NEXT item can start" rule.
 */

jest.mock('../logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  computePlanOrderFrontier,
  latestOutcomesByWorkItem,
  orderedDispatchLeaves,
} from '../migrationPlanOrderFrontier';
import type { BookOfWork, BookOfWorkItem } from '../migrationDriverAmsReads';
import type { MigrationExecutionRun } from '../migrationExecutionRunClient';

function story(id: string, parentId: string, seq: number, over: Partial<BookOfWorkItem> = {}): BookOfWorkItem {
  return { id, parentId, type: 'story', title: `Story ${id}`, sequenceOrder: seq, workItemId: `wi-${id}`, workstream: 'service_implementation', ...over };
}

/**
 * initiative I
 *   epic E1
 *     feature F1: s1, s2
 *     feature F2: s3
 *   epic E2
 *     feature F3: s4, s5
 */
function book(): BookOfWork {
  return {
    id: 'book-1',
    book_of_work_json: {
      items: [
        { id: 'I', parentId: null, type: 'initiative', title: 'Initiative', sequenceOrder: 0, workItemId: 'wi-I' },
        { id: 'E1', parentId: 'I', type: 'epic', title: 'Epic 1', sequenceOrder: 0, workItemId: 'wi-E1' },
        { id: 'F1', parentId: 'E1', type: 'feature', title: 'Feature 1', sequenceOrder: 0, workItemId: 'wi-F1' },
        story('s1', 'F1', 0),
        story('s2', 'F1', 1),
        { id: 'F2', parentId: 'E1', type: 'feature', title: 'Feature 2', sequenceOrder: 1, workItemId: 'wi-F2' },
        story('s3', 'F2', 0),
        { id: 'E2', parentId: 'I', type: 'epic', title: 'Epic 2', sequenceOrder: 1, workItemId: 'wi-E2' },
        { id: 'F3', parentId: 'E2', type: 'feature', title: 'Feature 3', sequenceOrder: 0, workItemId: 'wi-F3' },
        story('s4', 'F3', 0),
        story('s5', 'F3', 1),
      ],
    },
  };
}

function run(id: string, createdAt: string, status: string, items: Array<[string, string]>): MigrationExecutionRun {
  return {
    id,
    created_at: createdAt,
    status,
    items: items.map(([wi, st], i) => ({
      id: `${id}-${i}`,
      run_id: id,
      sequence_position: i,
      work_item_id: wi,
      status: st,
      outcome: st === 'implemented' || st === 'deployed' || st === 'failed' ? st : null,
      pr_url: st === 'implemented' ? 'https://git/mr/1' : null,
      updated_at: createdAt,
    })),
  };
}

const none = new Set<string>();

describe('latestOutcomesByWorkItem — durable across runs', () => {
  it('a story implemented in an EARLIER run keeps its outcome when a later run does not carry it', () => {
    const runs = [
      run('r2', '2026-09-11T10:00:00Z', 'dispatching', [['wi-s3', 'submitted']]),
      run('r1', '2026-09-10T10:00:00Z', 'implemented', [['wi-s1', 'implemented'], ['wi-s2', 'implemented']]),
    ];
    const out = latestOutcomesByWorkItem(runs);
    expect(out.get('wi-s1')?.status).toBe('implemented');
    expect(out.get('wi-s1')?.runId).toBe('r1');
    expect(out.get('wi-s1')?.prUrl).toBe('https://git/mr/1');
    expect(out.get('wi-s3')?.status).toBe('submitted');
  });

  it('the NEWEST run that carries the work item wins (a re-run supersedes an old failure)', () => {
    const runs = [
      run('r1', '2026-09-10T10:00:00Z', 'halted', [['wi-s1', 'failed']]),
      run('r2', '2026-09-11T10:00:00Z', 'implemented', [['wi-s1', 'implemented']]),
    ];
    expect(latestOutcomesByWorkItem(runs).get('wi-s1')?.status).toBe('implemented');
  });
});

describe('orderedDispatchLeaves — mirrors the driver order, planes in stage order', () => {
  it('walks depth-first by sequenceOrder and puts db-plane leaves before service-plane ones', () => {
    const b = book();
    // s3 is a DB-plane story: it must come FIRST even though it is third in the tree.
    b.book_of_work_json!.items!.find((i) => i.id === 's3')!.workstream = 'target_database_schema_implementation';
    const order = orderedDispatchLeaves(b, none).map((i) => i.id);
    expect(order).toEqual(['s3', 's1', 's2', 's4', 's5']);
  });

  it('skips deferred and manual-execution stories and structural nodes', () => {
    const b = book();
    b.book_of_work_json!.items!.find((i) => i.id === 's2')!.tags = ['execution:manual'];
    const order = orderedDispatchLeaves(b, new Set(['wi-s4'])).map((i) => i.id);
    expect(order).toEqual(['s1', 's3', 's5']);
  });
});

describe('computePlanOrderFrontier — only the NEXT item can start', () => {
  it('nothing implemented: the first story, its feature, its epic and the initiative are startable; everything after is blocked', () => {
    const f = computePlanOrderFrontier({ book: book(), deferredWorkItemIds: none, runs: [] });
    expect(f.frontierBookItemId).toBe('s1');
    expect(f.nodes.s1.startable).toBe(true);
    expect(f.nodes.s1.remainingWorkItemIds).toEqual(['wi-s1']);
    expect(f.nodes.F1.startable).toBe(true);
    expect(f.nodes.F1.remainingWorkItemIds).toEqual(['wi-s1', 'wi-s2']);
    expect(f.nodes.E1.startable).toBe(true);
    expect(f.nodes.E1.remainingWorkItemIds).toEqual(['wi-s1', 'wi-s2', 'wi-s3']);
    expect(f.nodes.I.startable).toBe(true);
    expect(f.nodes.I.leafCount).toBe(5);
    // Ahead of the frontier: blocked, naming the FIRST leaf that must run.
    expect(f.nodes.s2.startable).toBe(false);
    expect(f.nodes.s2.reason).toBe('blocked_by_preceding');
    expect(f.nodes.s2.blockedBy).toEqual({ bookItemId: 's1', workItemId: 'wi-s1', title: 'Story s1', precedingCount: 1 });
    expect(f.nodes.F2.reason).toBe('blocked_by_preceding');
    expect(f.nodes.F2.blockedBy?.precedingCount).toBe(2);
    expect(f.nodes.E2.reason).toBe('blocked_by_preceding');
    expect(f.nodes.E2.blockedBy?.precedingCount).toBe(3);
    expect(f.nodes.E2.reasonText).toContain('3 specs before this must be implemented first');
  });

  it('a partially implemented feature is CURRENT: it starts its remainder; the next feature is still blocked', () => {
    const runs = [run('r1', '2026-09-10T10:00:00Z', 'implemented', [['wi-s1', 'implemented']])];
    const f = computePlanOrderFrontier({ book: book(), deferredWorkItemIds: none, runs });
    expect(f.frontierBookItemId).toBe('s2');
    expect(f.nodes.s1.startable).toBe(false);
    expect(f.nodes.s1.reason).toBe('all_implemented');
    expect(f.nodes.F1.startable).toBe(true);
    expect(f.nodes.F1.doneCount).toBe(1);
    expect(f.nodes.F1.leafCount).toBe(2);
    expect(f.nodes.F1.remainingWorkItemIds).toEqual(['wi-s2']);
    expect(f.nodes.F2.startable).toBe(false);
    expect(f.nodes.F2.blockedBy?.bookItemId).toBe('s2');
  });

  it('when the previous feature is complete, the next feature (and the next epic, when its epic is complete) unlock', () => {
    const runs = [
      run('r1', '2026-09-10T10:00:00Z', 'implemented', [['wi-s1', 'implemented'], ['wi-s2', 'implemented'], ['wi-s3', 'deployed']]),
    ];
    const f = computePlanOrderFrontier({ book: book(), deferredWorkItemIds: none, runs });
    expect(f.frontierBookItemId).toBe('s4');
    expect(f.nodes.E1.reason).toBe('all_implemented');
    expect(f.nodes.E1.doneCount).toBe(3);
    expect(f.nodes.E2.startable).toBe(true);
    expect(f.nodes.F3.startable).toBe(true);
    expect(f.nodes.s4.startable).toBe(true);
    expect(f.nodes.s5.startable).toBe(false);
    // The initiative is partially done: still startable for its remainder.
    expect(f.nodes.I.startable).toBe(true);
    expect(f.nodes.I.remainingWorkItemIds).toEqual(['wi-s4', 'wi-s5']);
  });

  it('a FAILED leaf is the frontier (re-startable), and everything is greyed while a run is in flight', () => {
    const halted = [run('r1', '2026-09-10T10:00:00Z', 'halted', [['wi-s1', 'implemented'], ['wi-s2', 'failed']])];
    const f = computePlanOrderFrontier({ book: book(), deferredWorkItemIds: none, runs: halted });
    expect(f.frontierBookItemId).toBe('s2');
    expect(f.leaves.find((l) => l.bookItemId === 's2')?.status).toBe('failed');
    expect(f.nodes.s2.startable).toBe(true);
    expect(f.nodes.F1.failedCount).toBe(1);

    const inFlight = [run('r2', '2026-09-11T10:00:00Z', 'dispatching', [['wi-s2', 'submitted']]), ...halted];
    const g = computePlanOrderFrontier({ book: book(), deferredWorkItemIds: none, runs: inFlight });
    expect(g.runInFlight).toBe(true);
    expect(g.leaves.find((l) => l.bookItemId === 's2')?.status).toBe('in_flight');
    expect(Object.values(g.nodes).every((n) => !n.startable)).toBe(true);
    expect(g.nodes.s2.reason).toBe('run_in_flight');
  });

  it('a pending item of a SETTLED (halted) run is not in flight — it is simply not started', () => {
    const runs = [run('r1', '2026-09-10T10:00:00Z', 'halted', [['wi-s1', 'failed'], ['wi-s2', 'pending']])];
    const f = computePlanOrderFrontier({ book: book(), deferredWorkItemIds: none, runs });
    expect(f.runInFlight).toBe(false);
    expect(f.leaves.find((l) => l.bookItemId === 's2')?.status).toBe('not_started');
  });

  it('an unsaved next story (no work item id) refuses with not_saved; a structural node with no leaves has no_dispatchable_leaves', () => {
    const b = book();
    b.book_of_work_json!.items!.find((i) => i.id === 's1')!.workItemId = null;
    b.book_of_work_json!.items!.push({ id: 'F9', parentId: 'E2', type: 'feature', title: 'Empty', sequenceOrder: 9 });
    const f = computePlanOrderFrontier({ book: b, deferredWorkItemIds: none, runs: [] });
    expect(f.nodes.s1.reason).toBe('not_saved');
    expect(f.nodes.F1.reason).toBe('not_saved');
    expect(f.nodes.F9.reason).toBe('no_dispatchable_leaves');
  });

  it('plane order beats tree order: a db-plane story deep in the tree is the frontier and blocks the first service story', () => {
    const b = book();
    b.book_of_work_json!.items!.find((i) => i.id === 's4')!.workstream = 'target_database_schema_implementation';
    const f = computePlanOrderFrontier({ book: b, deferredWorkItemIds: none, runs: [] });
    expect(f.frontierBookItemId).toBe('s4');
    expect(f.nodes.s1.startable).toBe(false);
    expect(f.nodes.s1.blockedBy?.bookItemId).toBe('s4');
    expect(f.nodes.F3.startable).toBe(false); // s4 (db) then s5 (service) are NOT contiguous globally
    expect(f.nodes.F3.remainingPlanes).toEqual(['db', 'service']);
    expect(f.nodes.s4.startable).toBe(true);
  });
});
