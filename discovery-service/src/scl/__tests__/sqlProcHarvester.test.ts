/**
 * Stored-proc body harvesting (2026-08-23) — the batch-pipeline blind spot:
 * Java names only the proc; the repo's `db/procs/*.sql` bodies name the
 * tables. Pins parse, nested-exec closure, and the live estate's shape
 * (updateHierarchy_hir reads staging, writes dates, execs updateBook_hir).
 */

import { closeProcCatalog, harvestProcsFromSql } from '../sqlProcHarvester';

const UPDATE_BOOK = `
create proc updateBook_hir @cobdate varchar(8)
as
begin
  select count(*) from load_hir_book
  update load_hir_book set HierarchyId = 1 where HierarchyId is null
  insert into hir_book (BookId) select AlternateBookId from load_hir_book
  insert into hir_all_node (HierarchyId) select HierarchyId from load_hir_book
end
`;

const UPDATE_HIERARCHY = `
create procedure dbo.updateHierarchy_hir @cobdate varchar(8), @force char(1)
as
begin
  select @numBooks = count(*) from load_hir_book
  exec updateBook_hir @cobdate
  update hir_business_date set PreviousBusinessDate = CurrentBusinessDate
  insert into hir_load_date (BusinessDate) values (@cobdate)
end
`;

describe('harvestProcsFromSql', () => {
  it('parses proc bodies into reads/writes/nested calls', () => {
    const entries = harvestProcsFromSql(UPDATE_BOOK + UPDATE_HIERARCHY, 'db/procs/all.sql');
    expect(entries.map((e) => e.name)).toEqual(['updatebook_hir', 'updatehierarchy_hir']);
    const book = entries[0];
    expect(book.writes.map((w) => w.toLowerCase()).sort()).toEqual([
      'hir_all_node',
      'hir_book',
      'load_hir_book',
    ]);
    expect(book.reads.map((r) => r.toLowerCase())).toContain('load_hir_book');
    const hier = entries[1];
    expect(hier.procCalls).toEqual(['updatebook_hir']);
    expect(hier.writes.map((w) => w.toLowerCase()).sort()).toEqual([
      'hir_business_date',
      'hir_load_date',
    ]);
  });

  it('a plain migration script (no CREATE PROC) harvests NOTHING — ven_* stays honest', () => {
    const script = `insert into hir_all_node (HierarchyId)
      select hierarchy_id from ven_hierarchy_node where hierarchy_id < 0`;
    expect(harvestProcsFromSql(script, 'db/release/0.0.1/migrate.sql')).toEqual([]);
  });
});

describe('closeProcCatalog', () => {
  it('nested exec closes transitively (updateHierarchy -> updateBook tables)', () => {
    const catalog = harvestProcsFromSql(UPDATE_BOOK + UPDATE_HIERARCHY, 'db/procs/all.sql');
    const closed = closeProcCatalog(catalog);
    const hier = closed.get('updatehierarchy_hir')!;
    expect(hier.writes.map((w) => w.toLowerCase()).sort()).toEqual([
      'hir_all_node',
      'hir_book',
      'hir_business_date',
      'hir_load_date',
      'load_hir_book',
    ]);
    expect(hier.reads.map((r) => r.toLowerCase())).toContain('load_hir_book');
  });
});
