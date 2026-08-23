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

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { SclFinding } from './sclTypes';
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
  /** MD5 over the WHITESPACE-NORMALIZED body — the drift comparator
   *  (live-vs-repo) and duplicate detector key on this, so formatting
   *  differences never read as divergence. */
  bodyMd5: string;
  /** Where the body came from: the repo tree or the live catalog. */
  source: 'repo' | 'live';
}

/** One raw proc/function/trigger source pulled from a LIVE catalog by an
 *  engine pack (e.g. sysobjects+syscomments). Text is the reassembled
 *  CREATE body. */
export interface LiveProcSource {
  name: string;
  objType?: string;
  text: string;
}

/** Whitespace-normalized MD5 — formatting-insensitive body identity. */
export function normalizedBodyMd5(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase();
  return crypto.createHash('md5').update(normalized).digest('hex');
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
      bodyMd5: normalizedBodyMd5(body),
      source: 'repo',
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

/** Parse LIVE catalog sources (engine-pack harvested) into catalog entries.
 *  Each source is one object's reassembled body; the same CREATE-splitting
 *  parser runs over it, so a source containing several definitions still
 *  yields them all. */
export function catalogFromLiveSources(sources: LiveProcSource[]): ProcCatalogEntry[] {
  const out: ProcCatalogEntry[] = [];
  for (const src of sources ?? []) {
    if (!src || typeof src.text !== 'string' || src.text.length === 0) continue;
    const parsed = harvestProcsFromSql(src.text, `db://live/${src.name ?? 'object'}`);
    if (parsed.length > 0) {
      for (const entry of parsed) out.push({ ...entry, source: 'live' });
    }
  }
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}

export interface ProcMergeResult {
  /** Unique-by-name merged catalog. LIVE WINS on any divergence — the live
   *  body is what production actually executes. */
  entries: ProcCatalogEntry[];
  findings: SclFinding[];
  summary: {
    repoCount: number;
    liveCount: number;
    mergedCount: number;
    driftCount: number;
    liveOnlyCount: number;
    repoOnlyCount: number;
    repoDuplicateCount: number;
  };
}

/**
 * Merge the repo harvest with the live-catalog harvest (2026-08-23 audit
 * finding: the repo LIES — duplicate divergent bodies in-tree and live-only
 * hand-hacked variants; a bare-name first-wins pick was silent). Rules:
 *   - live entry present  -> live wins; if a repo body's md5 differs ->
 *     `proc_repo_drift` finding naming both.
 *   - live-only           -> kept + `proc_live_only` finding.
 *   - repo-only           -> kept + `proc_repo_only` finding (a proc the
 *     live DB no longer carries — stale repo or dropped object).
 *   - repo duplicates (same name, DIFFERENT md5 across files) ->
 *     `proc_repo_duplicate` finding listing every path; the live body (or,
 *     without live, the first path) is what the merged catalog carries.
 */
export function mergeProcCatalogs(
  repo: ProcCatalogEntry[],
  live: ProcCatalogEntry[],
): ProcMergeResult {
  const findings: SclFinding[] = [];
  const repoByName = new Map<string, ProcCatalogEntry[]>();
  for (const entry of repo) {
    const list = repoByName.get(entry.name) ?? [];
    list.push(entry);
    repoByName.set(entry.name, list);
  }
  const liveByName = new Map<string, ProcCatalogEntry>();
  for (const entry of live) {
    if (!liveByName.has(entry.name)) liveByName.set(entry.name, entry);
  }

  let driftCount = 0;
  let repoDuplicateCount = 0;
  for (const [name, entries] of repoByName) {
    const distinct = new Set(entries.map((e) => e.bodyMd5));
    if (distinct.size > 1) {
      repoDuplicateCount++;
      findings.push({
        kind: 'proc_repo_duplicate',
        symbol: name,
        detail:
          `${entries.length} in-repo definitions with ${distinct.size} distinct bodies: ` +
          entries.map((e) => e.sourcePath).join(', '),
      });
    }
  }

  const merged: ProcCatalogEntry[] = [];
  const seen = new Set<string>();
  for (const [name, liveEntry] of liveByName) {
    seen.add(name);
    merged.push(liveEntry);
    const repoEntries = repoByName.get(name) ?? [];
    if (repoEntries.length === 0) {
      findings.push({
        kind: 'proc_live_only',
        symbol: name,
        detail: 'exists in the LIVE catalog with no repo definition — hand-deployed variant; effect maps use the live body',
      });
    } else if (!repoEntries.some((e) => e.bodyMd5 === liveEntry.bodyMd5)) {
      driftCount++;
      findings.push({
        kind: 'proc_repo_drift',
        symbol: name,
        detail:
          `LIVE body differs from every repo definition (live md5 ${liveEntry.bodyMd5.slice(0, 8)} vs ` +
          repoEntries.map((e) => `${e.sourcePath}:${e.bodyMd5.slice(0, 8)}`).join(', ') +
          ') — the live body wins; reconcile the repo',
      });
    }
  }
  for (const [name, entries] of repoByName) {
    if (seen.has(name)) continue;
    merged.push(entries[0]);
    findings.push({
      kind: 'proc_repo_only',
      symbol: name,
      detail: `repo defines it (${entries[0].sourcePath}) but the live catalog does not — stale script or dropped object`,
    });
  }
  merged.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  findings.sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : a.kind < b.kind ? -1 : 1));
  return {
    entries: merged,
    findings,
    summary: {
      repoCount: repo.length,
      liveCount: live.length,
      mergedCount: merged.length,
      driftCount,
      liveOnlyCount: [...liveByName.keys()].filter((n) => !(repoByName.get(n) ?? []).length).length,
      repoOnlyCount: [...repoByName.keys()].filter((n) => !liveByName.has(n)).length,
      repoDuplicateCount,
    },
  };
}

/** A detected sequence-generator idiom: a proc/function whose body is the
 *  legacy "sequence table" pattern — `update T set C = C + 1 [where N = @p]`
 *  then a select of the value. The identity generator of every create path
 *  in estates without identity columns (Oracle Nine item 2). */
export interface SequenceGeneratorIdiom {
  procName: string;
  seqTable: string;
  numberColumn: string;
  /** The name-discriminator column (`where SequenceName = @p`), or null
   *  for single-row sequence tables. */
  nameColumn: string | null;
}

const SEQ_UPDATE_RE =
  /update\s+([A-Za-z0-9_."\[\]]+)\s+set\s+([A-Za-z0-9_"\[\]]+)\s*=\s*\2\s*[+]\s*1(?:\s+where\s+([A-Za-z0-9_"\[\]]+)\s*=\s*@)?/i;

/** Detect the sequence-generator idiom across harvested sources. A match
 *  requires BOTH the self-increment update AND a select in the same body
 *  (the value must be returned to the caller to count as a generator). */
export function detectSequenceGeneratorIdioms(
  sources: LiveProcSource[],
): SequenceGeneratorIdiom[] {
  const out: SequenceGeneratorIdiom[] = [];
  for (const src of sources ?? []) {
    const text = src?.text ?? '';
    const m = SEQ_UPDATE_RE.exec(text);
    if (!m) continue;
    if (!/\bselect\b/i.test(text)) continue;
    const bare = (raw: string): string => {
      const cleaned = raw.replace(/[[\]"]/g, '').trim();
      return cleaned.split('.').pop() ?? cleaned;
    };
    out.push({
      procName: (src.name ?? '').toLowerCase(),
      seqTable: bare(m[1]),
      numberColumn: bare(m[2]),
      nameColumn: m[3] ? bare(m[3]) : null,
    });
  }
  out.sort((a, b) => (a.procName < b.procName ? -1 : 1));
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
