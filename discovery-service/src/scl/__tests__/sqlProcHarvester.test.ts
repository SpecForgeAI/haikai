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
