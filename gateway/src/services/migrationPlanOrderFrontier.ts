/**
 * Plan-order frontier (2026-09-11): which work item is NEXT to implement, and
 * what every work item's durable execution outcome is.
 *
 * The plan screen could only start whole stages (the Stage N cards) or one
 * spec at a time from the Implementation screen. Starting from a work item
 * (an initiative, epic, feature or story) needs two things the screen never
 * had:
 *
 *   1. A DURABLE per-work-item outcome. Run items already record
 *      `implemented` / `deployed` per work item, but the screen only ever read
 *      the book's LATEST run, so a story implemented in an earlier stage run
 *      lost its outcome the moment a newer run started. The outcome here is
 *      read across EVERY run of the book, newest first, so it survives.
 *   2. The ORDER rule. Specs MUST run in migration-plan order, so the only
 *      item that can be started is the next one: a story is startable when
 *      every leaf before it is implemented; a feature / epic / initiative is
 *      startable when its not-yet-implemented leaves are EXACTLY the next
 *      leaves in the global order (a partially implemented parent is "current"
 *      and starts its remainder; a parent further ahead is blocked by the
 *      preceding leaves, and the first of them is named).
 *
 * The order mirrors the driver exactly: the book walk (depth, sequenceOrder)
 * restricted to dispatchable leaves (stories + TEST siblings; never deferred,
 * never manual-execution), then stable-sorted by plane (db -> service -> ui)
 * because the stage cards run planes in that order. Pure: no I/O.
 */

import {
  isDispatchableLeafItem,
  planeForItem,
  walkBookOfWorkItems,
  PLANE_ORDER,
  MigrationPlane,
} from './migrationExecutionDriver';
import { isManualExecutionItem } from './migrationExecutionClass';
import type { BookOfWork, BookOfWorkItem } from './migrationDriverAmsReads';
import type { MigrationExecutionRun, MigrationExecutionRunItem } from './migrationExecutionRunClient';

/** Run statuses during which another start must be refused. */
const RUN_IN_FLIGHT_STATUSES = new Set<string>([
  'started',
  'dispatching',
  'awaiting_approval',
  'reconciling',
  'needs_target_credentials',
]);

/** Run statuses in which a pending item is NOT going to move on its own. */
const RUN_SETTLED_STATUSES = new Set<string>([
  'halted',
  'failed',
  'deployed',
  'implemented',
  'reconciled',
  'reconcile_failed',
]);

export type LeafExecutionStatus =
  | 'implemented'
  | 'deployed'
  | 'in_flight'
  | 'failed'
  | 'not_started';

export interface WorkItemExecutionOutcome {
  workItemId: string;
  /** The raw run-item status (pending | ... | implemented | deployed | failed | rejected). */
  status: string;
  outcome: string | null;
  runId: string | null;
  runStatus: string | null;
  branch: string | null;
  prUrl: string | null;
  specName: string | null;
  updatedAt: string | null;
}

export interface FrontierLeaf {
  bookItemId: string;
  workItemId: string | null;
  title: string;
  plane: MigrationPlane;
  /** 0-based position in the global dispatch order. */
  position: number;
  status: LeafExecutionStatus;
  outcome: WorkItemExecutionOutcome | null;
}

export type StartRefusalReason =
  | 'ok'
  | 'all_implemented'
  | 'no_dispatchable_leaves'
  | 'blocked_by_preceding'
  | 'run_in_flight'
  | 'not_saved';

export interface NodeEligibility {
  bookItemId: string;
  workItemId: string | null;
  /** Dispatchable leaves in this node's subtree (the node itself if a leaf). */
  leafCount: number;
  doneCount: number;
  failedCount: number;
  inFlightCount: number;
  /** Planes the REMAINING leaves span (a batch cannot mix db with others). */
  remainingPlanes: MigrationPlane[];
  /** Work-item ids of the not-yet-implemented leaves, in dispatch order. */
  remainingWorkItemIds: string[];
  /** Book-item ids of the same leaves, in dispatch order. */
  remainingBookItemIds: string[];
  startable: boolean;
  reason: StartRefusalReason;
  /** Human wording for the reason (the menu shows it greyed). */
  reasonText: string;
  /** When blocked_by_preceding: the first leaf that must run first. */
  blockedBy: { bookItemId: string; workItemId: string | null; title: string; precedingCount: number } | null;
}

export interface PlanOrderFrontier {
  bookId: string;
  runInFlight: boolean;
  activeRunId: string | null;
  activeRunStatus: string | null;
  /** The next leaf to implement (null when everything is implemented). */
  frontierBookItemId: string | null;
  leaves: FrontierLeaf[];
  nodes: Record<string, NodeEligibility>;
  /** Durable outcomes keyed by work item id. */
  outcomesByWorkItem: Record<string, WorkItemExecutionOutcome>;
}

function timeOf(value: string | null | undefined): number {
  if (!value) return 0;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

/**
 * The latest run-item outcome per work item across EVERY run of the book.
 * Runs arrive newest first from AMS; the newest run that carries the work
 * item wins, and within one run the latest-updated row wins (a re-dispatched
 * retry rewrites the same row, so ties are rare).
 */
export function latestOutcomesByWorkItem(
  runs: MigrationExecutionRun[]
): Map<string, WorkItemExecutionOutcome> {
  const sortedRuns = runs
    .slice()
    .sort((a, b) => timeOf(b.created_at) - timeOf(a.created_at));
  const out = new Map<string, WorkItemExecutionOutcome>();
  for (const run of sortedRuns) {
    const byWorkItem = new Map<string, MigrationExecutionRunItem>();
    for (const item of run.items ?? []) {
      if (!item.work_item_id) continue;
      const prev = byWorkItem.get(item.work_item_id);
      if (!prev || timeOf(item.updated_at) >= timeOf(prev.updated_at)) {
        byWorkItem.set(item.work_item_id, item);
      }
    }
    for (const [workItemId, item] of byWorkItem) {
      if (out.has(workItemId)) continue; // a newer run already answered
      out.set(workItemId, {
        workItemId,
        status: item.status ?? 'pending',
        outcome: item.outcome ?? null,
        runId: run.id ?? null,
        runStatus: run.status ?? null,
        branch: item.branch ?? null,
        prUrl: item.pr_url ?? null,
        specName: item.spec_name ?? null,
        updatedAt: item.updated_at ?? null,
      });
    }
  }
  return out;
}

function leafStatusOf(outcome: WorkItemExecutionOutcome | null): LeafExecutionStatus {
  if (!outcome) return 'not_started';
  const st = outcome.status;
  if (st === 'implemented') return 'implemented';
  if (st === 'deployed') return 'deployed';
  if (st === 'failed' || st === 'rejected') return 'failed';
  // pending / answering / submitting / submitted: moving only while the run is.
  if (outcome.runStatus && RUN_SETTLED_STATUSES.has(outcome.runStatus)) return 'not_started';
  return 'in_flight';
}

/**
 * The global dispatch order of the book's dispatchable leaves: the driver's
 * walk (depth, sequenceOrder), minus deferred and manual-execution items,
 * stable-sorted by plane in stage order.
 */
export function orderedDispatchLeaves(
  book: BookOfWork,
  deferredWorkItemIds: Set<string>
): BookOfWorkItem[] {
  const items = book.book_of_work_json?.items ?? [];
  const walked = walkBookOfWorkItems(items).filter(
    (item) =>
      isDispatchableLeafItem(item) &&
      !(item.workItemId && deferredWorkItemIds.has(item.workItemId)) &&
      !isManualExecutionItem(item)
  );
  const planeRank = (item: BookOfWorkItem): number => PLANE_ORDER.indexOf(planeForItem(item));
  return walked
    .map((item, index) => ({ item, index }))
    .sort((a, b) => planeRank(a.item) - planeRank(b.item) || a.index - b.index)
    .map((e) => e.item);
}

export function isRunInFlight(run: MigrationExecutionRun | null | undefined): boolean {
  return !!run?.status && RUN_IN_FLIGHT_STATUSES.has(run.status);
}

/**
 * Compute the frontier + every node's start eligibility.
 */
export function computePlanOrderFrontier(params: {
  book: BookOfWork;
  deferredWorkItemIds: Set<string>;
  runs: MigrationExecutionRun[];
}): PlanOrderFrontier {
  const { book } = params;
  const bookId = book.id ?? '';
  const items = book.book_of_work_json?.items ?? [];
  const outcomes = latestOutcomesByWorkItem(params.runs);

  const newestRun = params.runs
    .slice()
    .sort((a, b) => timeOf(b.created_at) - timeOf(a.created_at))[0];
  const runInFlight = isRunInFlight(newestRun);

  const orderedLeafItems = orderedDispatchLeaves(book, params.deferredWorkItemIds);
  const leaves: FrontierLeaf[] = orderedLeafItems.map((item, position) => {
    const outcome = item.workItemId ? outcomes.get(item.workItemId) ?? null : null;
    return {
      bookItemId: item.id ?? '',
      workItemId: item.workItemId ?? null,
      title: item.title ?? '',
      plane: planeForItem(item),
      position,
      status: leafStatusOf(outcome),
      outcome,
    };
  });
  const isDone = (leaf: FrontierLeaf): boolean =>
    leaf.status === 'implemented' || leaf.status === 'deployed';
  const globalRemaining = leaves.filter((l) => !isDone(l));
  const frontierBookItemId = globalRemaining.length > 0 ? globalRemaining[0].bookItemId : null;

  // Subtree membership: every node -> the leaves beneath it (a leaf -> itself).
  const childrenByParent = new Map<string | null, BookOfWorkItem[]>();
  for (const item of items) {
    const list = childrenByParent.get(item.parentId ?? null) ?? [];
    list.push(item);
    childrenByParent.set(item.parentId ?? null, list);
  }
  const leafByBookItemId = new Map(leaves.map((l) => [l.bookItemId, l] as const));
  const subtreeLeaves = new Map<string, FrontierLeaf[]>();
  const collect = (item: BookOfWorkItem): FrontierLeaf[] => {
    const id = item.id ?? '';
    if (subtreeLeaves.has(id)) return subtreeLeaves.get(id)!;
    const own = leafByBookItemId.get(id);
    const acc: FrontierLeaf[] = own ? [own] : [];
    for (const kid of childrenByParent.get(id) ?? []) acc.push(...collect(kid));
    // Dispatch order, not tree order (planes re-sequence).
    acc.sort((a, b) => a.position - b.position);
    subtreeLeaves.set(id, acc);
    return acc;
  };
  for (const item of items) collect(item);

  const nodes: Record<string, NodeEligibility> = {};
  for (const item of items) {
    const id = item.id ?? '';
    if (!id) continue;
    const mine = subtreeLeaves.get(id) ?? [];
    const remaining = mine.filter((l) => !isDone(l));
    const base: NodeEligibility = {
      bookItemId: id,
      workItemId: item.workItemId ?? null,
      leafCount: mine.length,
      doneCount: mine.filter(isDone).length,
      failedCount: mine.filter((l) => l.status === 'failed').length,
      inFlightCount: mine.filter((l) => l.status === 'in_flight').length,
      remainingPlanes: PLANE_ORDER.filter((p) => remaining.some((l) => l.plane === p)),
      remainingWorkItemIds: remaining.map((l) => l.workItemId).filter((w): w is string => !!w),
      remainingBookItemIds: remaining.map((l) => l.bookItemId),
      startable: false,
      reason: 'ok',
      reasonText: '',
      blockedBy: null,
    };
    if (mine.length === 0) {
      nodes[id] = {
        ...base,
        reason: 'no_dispatchable_leaves',
        reasonText: 'No implementable story beneath this item (deferred, manual or structural only).',
      };
      continue;
    }
    if (remaining.length === 0) {
      nodes[id] = {
        ...base,
        reason: 'all_implemented',
        reasonText: 'Already implemented.',
      };
      continue;
    }
    if (runInFlight) {
      nodes[id] = {
        ...base,
        reason: 'run_in_flight',
        reasonText: `A run is already in flight (${newestRun?.status ?? 'unknown'}) — wait for it to finish or halt it.`,
      };
      continue;
    }
    // The order rule: the node's remaining leaves must be EXACTLY the next
    // leaves in the global order.
    let blockedAt = -1;
    for (let i = 0; i < remaining.length; i++) {
      if (globalRemaining[i]?.bookItemId !== remaining[i].bookItemId) {
        blockedAt = i;
        break;
      }
    }
    if (blockedAt >= 0) {
      // The first global leaf (from that position) that is NOT in this subtree.
      const inSubtree = new Set(remaining.map((l) => l.bookItemId));
      let precedingCount = 0;
      let blocker: FrontierLeaf | null = null;
      for (const g of globalRemaining) {
        if (g.bookItemId === remaining[blockedAt].bookItemId) break;
        if (!inSubtree.has(g.bookItemId)) {
          precedingCount++;
          if (!blocker) blocker = g;
        }
      }
      nodes[id] = {
        ...base,
        reason: 'blocked_by_preceding',
        reasonText: blocker
          ? `${precedingCount} spec${precedingCount === 1 ? '' : 's'} before this must be implemented first — next is "${blocker.title}".`
          : 'Earlier specs in the plan must be implemented first.',
        blockedBy: blocker
          ? {
              bookItemId: blocker.bookItemId,
              workItemId: blocker.workItemId,
              title: blocker.title,
              precedingCount,
            }
          : null,
      };
      continue;
    }
    const unsaved = remaining.filter((l) => !l.workItemId);
    if (unsaved.length > 0) {
      nodes[id] = {
        ...base,
        reason: 'not_saved',
        reasonText: `${unsaved.length} story${unsaved.length === 1 ? ' is' : 'ies are'} not saved to the backlog yet — save the book first.`,
      };
      continue;
    }
    nodes[id] = {
      ...base,
      startable: true,
      reason: 'ok',
      reasonText: `Next in plan order: ${remaining.length} spec${remaining.length === 1 ? '' : 's'}.`,
    };
  }

  const outcomesByWorkItem: Record<string, WorkItemExecutionOutcome> = {};
  for (const [k, v] of outcomes) outcomesByWorkItem[k] = v;

  return {
    bookId,
    runInFlight,
    activeRunId: newestRun?.id ?? null,
    activeRunStatus: newestRun?.status ?? null,
    frontierBookItemId,
    leaves,
    nodes,
    outcomesByWorkItem,
  };
}
