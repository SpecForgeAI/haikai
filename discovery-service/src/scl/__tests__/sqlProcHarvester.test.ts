/**
 * Stored-proc body harvesting (2026-08-23) — the batch-pipeline blind spot:
 * Java names only the proc; the repo's `db/procs/*.sql` bodies name the
 * tables. Pins parse, nested-exec closure, and the live estate's shape
 * (updateTree_roll reads staging, writes dates, execs updateBook_roll).
 */

import { closeProcCatalog, harvestProcsFromSql } from '../sqlProcHarvester';

const UPDATE_BOOK = `
create proc updateBook_roll @cobdate varchar(8)
as
begin
  select count(*) from load_deal_book
  update load_deal_book set HierarchyId = 1 where HierarchyId is null
  insert into deal_book (BookId) select AlternateBookId from load_deal_book
  insert into all_node_map (HierarchyId) select HierarchyId from load_deal_book
end
`;

const UPDATE_HIERARCHY = `
create procedure dbo.updateTree_roll @cobdate varchar(8), @force char(1)
as
begin
  select @numBooks = count(*) from load_deal_book
  exec updateBook_roll @cobdate
  update biz_date_ctrl set PreviousBusinessDate = CurrentBusinessDate
  insert into load_date_log (BusinessDate) values (@cobdate)
end
`;

describe('harvestProcsFromSql', () => {
  it('parses proc bodies into reads/writes/nested calls', () => {
    const entries = harvestProcsFromSql(UPDATE_BOOK + UPDATE_HIERARCHY, 'db/procs/all.sql');
    expect(entries.map((e) => e.name)).toEqual(['updatebook_roll', 'updatetree_roll']);
    const book = entries[0];
    expect(book.writes.map((w) => w.toLowerCase()).sort()).toEqual([
      'all_node_map',
      'deal_book',
      'load_deal_book',
    ]);
    expect(book.reads.map((r) => r.toLowerCase())).toContain('load_deal_book');
    const hier = entries[1];
    expect(hier.procCalls).toEqual(['updatebook_roll']);
    expect(hier.writes.map((w) => w.toLowerCase()).sort()).toEqual([
      'biz_date_ctrl',
      'load_date_log',
    ]);
  });

  it('a plain migration script (no CREATE PROC) harvests NOTHING — ext_* stays honest', () => {
    const script = `insert into all_node_map (HierarchyId)
      select hierarchy_id from ext_tree_node where hierarchy_id < 0`;
    expect(harvestProcsFromSql(script, 'db/release/0.0.1/migrate.sql')).toEqual([]);
  });
});

describe('closeProcCatalog', () => {
  it('nested exec closes transitively (updateHierarchy -> updateBook tables)', () => {
    const catalog = harvestProcsFromSql(UPDATE_BOOK + UPDATE_HIERARCHY, 'db/procs/all.sql');
    const closed = closeProcCatalog(catalog);
    const hier = closed.get('updatetree_roll')!;
    expect(hier.writes.map((w) => w.toLowerCase()).sort()).toEqual([
      'all_node_map',
      'biz_date_ctrl',
      'deal_book',
      'load_date_log',
      'load_deal_book',
    ]);
    expect(hier.reads.map((r) => r.toLowerCase())).toContain('load_deal_book');
  });
});

// ---------------------------------------------------------------------------
// Live-vs-repo merge (Oracle Nine item 1, 2026-08-23): the repo can LIE —
// duplicate divergent bodies in-tree and hand-deployed live-only variants.
// LIVE WINS; every divergence is a loud finding, never a silent pick.
// ---------------------------------------------------------------------------

import {
  catalogFromLiveSources,
  mergeProcCatalogs,
  normalizedBodyMd5,
} from '../sqlProcHarvester';

describe('normalizedBodyMd5', () => {
  it('is whitespace/formatting insensitive but body sensitive', () => {
    const a = normalizedBodyMd5('create proc p as\n  update t set x = 1');
    const b = normalizedBodyMd5('CREATE   PROC p AS update t SET x = 1');
    const c = normalizedBodyMd5('create proc p as update t set x = 2');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('mergeProcCatalogs', () => {
  const repoEntry = (name: string, path: string, body: string) =>
    harvestProcsFromSql(`create proc ${name} as ${body}`, path)[0];
  const liveEntry = (name: string, body: string) =>
    catalogFromLiveSources([{ name, text: `create proc ${name} as ${body}` }])[0];

  it('LIVE wins on drift, with a proc_repo_drift finding naming both bodies', () => {
    const repo = [repoEntry('roll_dates', 'db/procs/005.sql', 'update biz_date_ctrl set d = 1')];
    const live = [liveEntry('roll_dates', 'update biz_date_ctrl set d = 1 insert into load_date_log (d) values (1)')];
    const result = mergeProcCatalogs(repo, live);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].source).toBe('live');
    expect(result.entries[0].writes.map((w) => w.toLowerCase()).sort()).toEqual([
      'biz_date_ctrl',
      'load_date_log',
    ]);
    expect(result.findings.map((f) => f.kind)).toEqual(['proc_repo_drift']);
    expect(result.summary.driftCount).toBe(1);
  });

  it('live-only and repo-only both surface loudly; identical bodies stay silent', () => {
    const repo = [
      repoEntry('same_proc', 'db/procs/001.sql', 'update t1 set x = 1'),
      repoEntry('dropped_proc', 'db/procs/002.sql', 'update t2 set x = 1'),
    ];
    const live = [
      liveEntry('same_proc', 'update t1 set x = 1'),
      liveEntry('hand_hacked22', 'update t3 set x = 1'),
    ];
    const result = mergeProcCatalogs(repo, live);
    expect(result.entries.map((e) => e.name).sort()).toEqual([
      'dropped_proc',
      'hand_hacked22',
      'same_proc',
    ]);
    const kinds = result.findings.map((f) => `${f.kind}:${f.symbol}`).sort();
    expect(kinds).toEqual([
      'proc_live_only:hand_hacked22',
      'proc_repo_only:dropped_proc',
    ]);
    expect(result.summary.liveOnlyCount).toBe(1);
    expect(result.summary.repoOnlyCount).toBe(1);
    expect(result.summary.driftCount).toBe(0);
  });

  it('duplicate DIVERGENT repo definitions are a loud finding (no silent first-wins)', () => {
    const repo = [
      repoEntry('twice_defined', 'db/procs/005.sql', 'update t set x = 1'),
      repoEntry('twice_defined', 'db/release/0.0.18/procs/005.sql', 'update t set x = 2'),
    ];
    const result = mergeProcCatalogs(repo, []);
    expect(result.findings.some((f) => f.kind === 'proc_repo_duplicate' && f.symbol === 'twice_defined')).toBe(true);
    expect(result.findings.find((f) => f.kind === 'proc_repo_duplicate')!.detail).toContain('db/procs/005.sql');
    expect(result.summary.repoDuplicateCount).toBe(1);
  });
});
