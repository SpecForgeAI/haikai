/**
 * Stored-procedure body harvesting (2026-08-23).
 *
 * Ground-truth traces showed the estate's batch pipeline lives in
 * `db/procs/*.sql`: Java names only the PROC (`exec updateTree_roll`),
 * while the proc body names the tables (reads `load_deal_book`, writes
 * `biz_date_ctrl`, nested `exec updateBook_roll` -> `deal_book`). The
 * repo carries every body — this harvester reads the `.sql` files the
 * Java-only slicer ignored and builds a proc -> tables catalog the effect
 * walk expands through (transitively, cycle-safe).
 *
 * Dynamic predicate SQL assembled from DATA rows inside a proc stays
 * invisible by nature; the STATIC statements of the body — which name the
 * tables — are what this captures.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  parseProcCallsFromSql,
  parseReadTablesFromSql,
  parseWriteTablesFromSql,
} from './effectCandidateEmitter';

export interface ProcCatalogEntry {
  /** Lowercased bare proc/function name (schema + brackets stripped). */
  name: string;
  sourcePath: string;
  writes: string[];
  reads: string[];
  /** Lowercased bare names of procs this body itself calls (`exec` / `{call}`). */
  procCalls: string[];
}

const SKIP_DIRS = new Set(['target', 'build', '.git', 'node_modules']);

function walkSqlFiles(rootDir: string): string[] {
  const out: string[] = [];
  const stack: string[] = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(full);
      } else if (e.name.toLowerCase().endsWith('.sql')) {
        out.push(full);
      }
    }
  }
  out.sort();
  return out;
}

const CREATE_PROC_RE =
  /\bcreate\s+(?:proc(?:edure)?|function)\s+([A-Za-z0-9_."\[\]]+)/gi;

function bareName(raw: string): string {
  const cleaned = raw.replace(/[[\]"]/g, '').trim();
  return (cleaned.split('.').pop() ?? cleaned).toLowerCase();
}

/** All CREATE PROC/FUNCTION bodies in one file: each body spans from its
 *  CREATE to the next CREATE (or EOF) — good enough for table mining. */
export function harvestProcsFromSql(sqlText: string, sourcePath: string): ProcCatalogEntry[] {
  const matches: Array<{ name: string; start: number }> = [];
  CREATE_PROC_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CREATE_PROC_RE.exec(sqlText)) !== null) {
    matches.push({ name: bareName(m[1]), start: m.index });
  }
  const out: ProcCatalogEntry[] = [];
  for (let i = 0; i < matches.length; i++) {
    const body = sqlText.slice(
      matches[i].start,
      i + 1 < matches.length ? matches[i + 1].start : sqlText.length,
    );
    const selfName = matches[i].name;
    out.push({
      name: selfName,
      sourcePath,
      writes: parseWriteTablesFromSql(body),
      reads: parseReadTablesFromSql(body),
      procCalls: parseProcCallsFromSql(body)
        .map((p) => p.toLowerCase())
        .filter((p) => p !== selfName),
    });
  }
  return out;
}

/** Harvest the whole tree. Deterministic: sorted files, sorted entries. */
export function harvestProcCatalog(rootDir: string): ProcCatalogEntry[] {
  const out: ProcCatalogEntry[] = [];
  for (const file of walkSqlFiles(rootDir)) {
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const rel = path.relative(rootDir, file).split(path.sep).join('/');
    out.push(...harvestProcsFromSql(text, rel));
  }
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.sourcePath < b.sourcePath ? -1 : 1));
  return out;
}

/** name -> transitively-closed {writes, reads} (nested `exec` followed,
 *  cycle-safe, depth-capped — updateTree_roll -> updateBook_roll). */
export function closeProcCatalog(
  catalog: ProcCatalogEntry[],
): Map<string, { writes: string[]; reads: string[] }> {
  const byName = new Map<string, ProcCatalogEntry>();
  for (const entry of catalog) if (!byName.has(entry.name)) byName.set(entry.name, entry);
  const closed = new Map<string, { writes: string[]; reads: string[] }>();
  for (const entry of catalog) {
    const writes: string[] = [];
    const reads: string[] = [];
    const pushAll = (into: string[], values: string[]) => {
      for (const v of values) {
        if (!into.some((x) => x.toLowerCase() === v.toLowerCase())) into.push(v);
      }
    };
    const seen = new Set<string>();
    const queue: Array<{ name: string; depth: number }> = [{ name: entry.name, depth: 0 }];
    while (queue.length > 0) {
      const { name, depth } = queue.shift() as { name: string; depth: number };
      if (seen.has(name) || depth > 3) continue;
      seen.add(name);
      const p = byName.get(name);
      if (!p) continue;
      pushAll(writes, p.writes);
      pushAll(reads, p.reads);
      for (const called of p.procCalls) queue.push({ name: called, depth: depth + 1 });
    }
    closed.set(entry.name, { writes, reads });
  }
  return closed;
}
