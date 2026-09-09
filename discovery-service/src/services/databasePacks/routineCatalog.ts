/**
 * Routine catalog builder (Stored Proc & Function Behaviour Program, Spec 1,
 * 2026-09-09) — engine-neutral.
 *
 * Takes the per-routine records an engine-pack profiler produced and fills
 * the transitive closures the behaviour capture sizes its compensation
 * brackets from:
 *
 *   - `writes_closure` / `reads_closure`: the routine's own sets plus every
 *     routine it calls, transitively, UNCAPPED and cycle-safe (the SCL
 *     catalog's depth-3 cap under-reported side-effect scope; a bracket
 *     sized from an under-reported closure is exactly the failure mode the
 *     capture must never have);
 *   - `trigger_expanded_writes`: writes contributed by triggers defined ON
 *     any table in the write closure (and, transitively, routines those
 *     triggers call) — the audit's "unexplained changes" class.
 *
 * Pure function; deterministic (sorted, lower-cased, de-duplicated).
 */

import type { RoutineRecord } from './routineTypes';

function uniqLowerSorted(values: Iterable<string>): string[] {
  const set = new Set<string>();
  for (const v of values) {
    const s = v.trim().toLowerCase();
    if (s.length > 0) set.add(s);
  }
  return [...set].sort();
}

/** Fill closures on every record. Returns NEW records (inputs untouched). */
export function buildRoutineCatalog(records: RoutineRecord[]): RoutineRecord[] {
  const callables = new Map<string, RoutineRecord>();
  for (const r of records) {
    if (r.routine_kind === 'trigger') continue;
    const key = r.routine_name.toLowerCase();
    if (!callables.has(key)) callables.set(key, r);
  }
  const triggersByTable = new Map<string, RoutineRecord[]>();
  for (const r of records) {
    if (r.routine_kind !== 'trigger' || !r.trigger_on_table) continue;
    const key = r.trigger_on_table.toLowerCase();
    const list = triggersByTable.get(key) ?? [];
    list.push(r);
    triggersByTable.set(key, list);
  }

  const closeCalls = (
    root: RoutineRecord,
  ): { writes: Set<string>; reads: Set<string>; visited: Set<string> } => {
    const writes = new Set<string>();
    const reads = new Set<string>();
    const visited = new Set<string>();
    const queue: RoutineRecord[] = [root];
    while (queue.length > 0) {
      const cur = queue.shift() as RoutineRecord;
      const key = `${cur.routine_kind}:${cur.routine_name.toLowerCase()}`;
      if (visited.has(key)) continue;
      visited.add(key);
      for (const w of cur.writes) writes.add(w.toLowerCase());
      for (const rd of cur.reads) reads.add(rd.toLowerCase());
      for (const called of cur.proc_calls) {
        const callee = callables.get(called.toLowerCase());
        if (callee) queue.push(callee);
      }
    }
    return { writes, reads, visited };
  };

  return records.map((record) => {
    const own = closeCalls(record);
    // Trigger expansion: any written table with triggers contributes the
    // triggers' own closures; iterate to a fixed point (a trigger may write
    // a table that itself has triggers).
    const expanded = new Set<string>();
    const seenTriggers = new Set<string>();
    const frontier = [...own.writes];
    while (frontier.length > 0) {
      const table = frontier.pop() as string;
      for (const trig of triggersByTable.get(table) ?? []) {
        const tkey = trig.routine_name.toLowerCase();
        if (seenTriggers.has(tkey)) continue;
        seenTriggers.add(tkey);
        const tc = closeCalls(trig);
        for (const w of tc.writes) {
          if (!own.writes.has(w) && !expanded.has(w)) {
            expanded.add(w);
            frontier.push(w);
          }
        }
        for (const rd of tc.reads) own.reads.add(rd);
      }
    }
    return {
      ...record,
      reads_closure: uniqLowerSorted(own.reads),
      writes_closure: uniqLowerSorted(own.writes),
      trigger_expanded_writes: uniqLowerSorted(expanded),
    };
  });
}

/**
 * Callee-first ordering (Spec 4 uses the same rule at reconcile time):
 * routines with no resolvable proc calls first, callers only after every
 * callee. Cycles are emitted together, after their members' other callees.
 * Triggers are excluded (they are not invoked directly).
 */
export function orderCalleesFirst(records: RoutineRecord[]): RoutineRecord[] {
  const callables = records.filter((r) => r.routine_kind !== 'trigger');
  const byName = new Map(callables.map((r) => [r.routine_name.toLowerCase(), r]));
  const order: RoutineRecord[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (r: RoutineRecord): void => {
    const key = r.routine_name.toLowerCase();
    const st = state.get(key);
    if (st === 'done' || st === 'visiting') return;
    state.set(key, 'visiting');
    for (const called of [...r.proc_calls].sort()) {
      const callee = byName.get(called.toLowerCase());
      if (callee) visit(callee);
    }
    state.set(key, 'done');
    order.push(r);
  };
  for (const r of [...callables].sort((a, b) => a.routine_name.localeCompare(b.routine_name))) visit(r);
  return order;
}
