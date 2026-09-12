/**
 * Spec 1 (Stored Proc & Function Behaviour Program, 2026-09-09) — T-SQL
 * routine profiler + catalog builder. Offline, invented vocabulary.
 */

import { profileTsqlRoutine, blankSqlStringLiterals, blankSqlLiteralsAndComments, blankSqlCommentsKeepLiterals } from '../services/databasePacks/sybase/tsqlRoutineProfiler';
import { buildRoutineCatalog, orderCalleesFirst } from '../services/databasePacks/routineCatalog';
import type { RoutineRecord } from '../services/databasePacks/routineTypes';

const PROC_A = `
create proc dbo.upd_ledger_roll
  @ledger_id int,
  @as_of datetime = null,
  @mode varchar(10) = 'FULL',
  @rows_done int output,
  @amount numeric(10,2) = 0.00
with recompile
as
begin
  set nocount on
  -- roll the ledger
  declare @rc int
  if @ledger_id is null
  begin
    raiserror 20012 'ledger id required'
    return -1
  end
  update ledger_ctrl set last_roll = getdate() where ledger_id = @ledger_id
  if @@rowcount = 0
  begin
    raiserror(20013, 16, 1, 'no ledger row')
    return 2
  end
  exec @rc = upd_ledger_lines @ledger_id
  select @rows_done = count(*) from ledger_line where ledger_id = @ledger_id
  select l.ledger_id, l.line_no, l.amount
    from ledger_line l
   where l.ledger_id = @ledger_id
   order by l.line_no
  select top 5 ledger_id, total from ledger_totals where ledger_id = @ledger_id
  insert into ledger_audit (ledger_id, who) select @ledger_id, suser_name()
  return 0
end
`;

const PROC_B = `
CREATE PROCEDURE upd_ledger_lines (@ledger_id int) AS
  update ledger_line set flag = 1 where ledger_id = @ledger_id
  exec purge_ledger_tmp
  return
`;

const PROC_C = `
create procedure purge_ledger_tmp as
  delete ledger_tmp
  exec upd_ledger_lines 1
`;

const FN_D = `
create function dbo.fn_ledger_total (@ledger_id int, @scale int = 2) returns numeric(18,2) as
begin
  declare @t numeric(18,2)
  select @t = sum(amount) from ledger_line where ledger_id = @ledger_id
  return @t
end
`;

const TRG_E = `
create trigger trg_ledger_line_ins on ledger_line for insert, update as
  insert into ledger_line_hist (line_no) select line_no from inserted
  exec xp_cmdshell 'echo hi'
`;

const PROC_DYN = `
create proc run_dyn @sql varchar(255) as
  exec (@sql)
  waitfor delay '00:00:01'
  exec remote_srv.otherdb.dbo.remote_proc
  insert otherdb.dbo.cross_tbl values (1)
`;

describe('profileTsqlRoutine — identifier case + literal-blind mining (2026-09-12)', () => {
  const MIXED = `
create proc dbo.UpdBook_Roll @book_id int as
begin
  print 'delete from GRD (set to invalid) -- exec dbo.PhantomProc'
  -- update ghost_tbl set x = 1
  update dbo.Book_Tbl set state = 'x' where book_id = @book_id
  exec dbo.Audit_Roll @book_id
  select * from dbo.Book_Tbl where book_id = @book_id
end
`;
  it('keeps the routine name\u2019s case (the EXEC target) while every join key stays lowercase', () => {
    const r = profileTsqlRoutine({ name: 'UpdBook_Roll', objType: 'P', text: MIXED });
    expect(r.signature_parsed).toBe(true);
    expect(r.routine_name).toBe('UpdBook_Roll');
    expect(r.schema_name).toBe('dbo');
    expect(r.proc_calls).toEqual(['audit_roll']);
    expect(r.writes).toEqual(['book_tbl']);
    expect(r.reads).toContain('book_tbl');
  });

  it('never mines a table or a call out of a string literal or a comment', () => {
    const r = profileTsqlRoutine({ name: 'UpdBook_Roll', objType: 'P', text: MIXED });
    expect(r.writes).not.toContain('grd');
    expect(r.writes).not.toContain('ghost_tbl');
    expect(r.proc_calls).not.toContain('phantomproc');
  });

  it('blankSqlStringLiterals preserves length and handles doubled quotes and N-prefixed literals', () => {
    const src = "print N'it''s done' select 1 from t where c = 'x'";
    const out = blankSqlStringLiterals(src);
    expect(out.length).toBe(src.length);
    expect(out).not.toContain("it''s");
    expect(out).toContain('select 1 from t where c =');
  });

  it('blankSqlLiteralsAndComments: a -- inside a literal does not swallow the next statement, a quote inside a comment opens nothing', () => {
    const src = "print 'x -- not a comment'\nupdate t set c = 'y'\n-- it's a comment\nselect 1 /* block 'q' */ from u";
    const out = blankSqlLiteralsAndComments(src);
    expect(out.length).toBe(src.length);
    expect(out).toContain('update t set c =');
    expect(out).toContain('select 1');
    expect(out).toContain('from u');
    expect(out).not.toContain('comment');
    expect(out).not.toContain('block');
    // Literal-keeping variant: the message text survives, the comments do not.
    const kept = blankSqlCommentsKeepLiterals(src);
    expect(kept).toContain("'x -- not a comment'");
    expect(kept).not.toContain("it's a comment");
    expect(kept).not.toContain('block');
  });
});

describe('profileTsqlRoutine — signature', () => {
  it('parses params with defaults, OUTPUT, numeric scale, recompile trailer and dotted name', () => {
    const r = profileTsqlRoutine({ name: 'upd_ledger_roll', objType: 'P', text: PROC_A });
    expect(r.signature_parsed).toBe(true);
    expect(r.routine_kind).toBe('procedure');
    expect(r.schema_name).toBe('dbo');
    expect(r.routine_name).toBe('upd_ledger_roll');
    expect(r.params.map((p) => p.name)).toEqual(['ledger_id', 'as_of', 'mode', 'rows_done', 'amount']);
    expect(r.params[1]).toMatchObject({ source_type: 'datetime', default_literal: 'null', direction: 'in' });
    expect(r.params[2]).toMatchObject({ source_type: 'varchar(10)', default_literal: "'FULL'" });
    expect(r.params[3]).toMatchObject({ direction: 'output', default_literal: null });
    expect(r.params[4]).toMatchObject({ source_type: 'numeric(10,2)', default_literal: '0.00' });
  });

  it('parses a parenthesised bare-name procedure and a function with RETURNS', () => {
    const b = profileTsqlRoutine({ name: 'upd_ledger_lines', objType: 'P', text: PROC_B });
    expect(b.signature_parsed).toBe(true);
    expect(b.params).toHaveLength(1);
    const d = profileTsqlRoutine({ name: 'fn_ledger_total', objType: 'F', text: FN_D });
    expect(d.routine_kind).toBe('function');
    expect(d.returns_type).toBe('numeric(18,2)');
    expect(d.params.map((p) => p.name)).toEqual(['ledger_id', 'scale']);
    expect(d.profile.result_selects).toHaveLength(0); // select @t = ... is an assignment
  });

  it('parses a trigger header (table + events) and infers kind from text when objType is absent', () => {
    const t = profileTsqlRoutine({ name: 'trg_ledger_line_ins', text: TRG_E });
    expect(t.routine_kind).toBe('trigger');
    expect(t.trigger_on_table).toBe('ledger_line');
    expect(t.trigger_events).toEqual(['insert', 'update']);
    expect(t.writes).toContain('ledger_line_hist');
    expect(t.profile.constructs).toContain('system_proc');
    expect(t.profile.non_compensatable_reasons).toContain('system_proc');
  });

  it('marks an unparsable header loudly instead of guessing', () => {
    const r = profileTsqlRoutine({ name: 'weird', objType: 'P', text: 'create proc weird @a as' });
    expect(r.signature_parsed).toBe(false);
    expect(r.signature_error).toMatch(/unparsed parameter/);
    const none = profileTsqlRoutine({ name: 'x', text: 'select 1' });
    expect(none.signature_parsed).toBe(false);
    expect(none.signature_error).toMatch(/kind not recognised/);
  });
});

describe('profileTsqlRoutine — static profile', () => {
  const r = profileTsqlRoutine({ name: 'upd_ledger_roll', objType: 'P', text: PROC_A });

  it('enumerates exit outcomes: RETURN values + RAISERROR sites', () => {
    expect(r.profile.return_sites.map((s) => s.value)).toEqual([-1, 2, 0]);
    expect(r.profile.return_status_trivial).toBe(false);
    expect(r.profile.raiserror_sites).toEqual([
      { number: 20012, severity: null, text_preview: 'ledger id required' },
      { number: 20013, severity: 16, text_preview: 'no ledger row' },
    ]);
  });

  it('counts only result-producing SELECTs, with ORDER BY / TOP flags', () => {
    expect(r.profile.max_result_sets).toBe(2);
    expect(r.profile.result_selects[0]).toMatchObject({ ordinal: 1, has_order_by: true, has_top: false });
    expect(r.profile.result_selects[1]).toMatchObject({ ordinal: 2, has_order_by: false, has_top: true });
    expect(r.profile.result_selects[0].select_list_static).toContain('l.ledger_id');
  });

  it('tags constructs, volatile and session-user functions, set options', () => {
    expect(r.profile.constructs).toEqual(expect.arrayContaining(['set_nocount']));
    expect(r.profile.constructs).not.toContain('dynamic_sql');
    expect(r.profile.volatile_functions).toEqual(['getdate']);
    expect(r.profile.session_user_functions).toEqual(['suser_name']);
    expect(r.profile.set_options).toEqual(['nocount on']);
    expect(r.profile.non_compensatable_reasons).toEqual([]);
  });

  it('collects reads, writes and nested calls incl. the return-status exec form', () => {
    expect(r.writes).toEqual(expect.arrayContaining(['ledger_ctrl', 'ledger_audit']));
    expect(r.reads).toEqual(expect.arrayContaining(['ledger_line', 'ledger_totals']));
    expect(r.proc_calls).toEqual(['upd_ledger_lines']);
  });

  it('flags non-compensatable constructs: dynamic SQL, waitfor, remote call, cross-db DML', () => {
    const d = profileTsqlRoutine({ name: 'run_dyn', objType: 'P', text: PROC_DYN });
    expect(d.profile.non_compensatable_reasons).toEqual(
      expect.arrayContaining(['dynamic_sql', 'waitfor', 'remote_call', 'cross_db_dml']),
    );
  });

  it('hashes are formatting-insensitive', () => {
    const a = profileTsqlRoutine({ name: 'p', objType: 'P', text: 'create proc p as select 1' });
    const b = profileTsqlRoutine({ name: 'p', objType: 'P', text: 'CREATE   PROC p\n AS\n  SELECT 1' });
    expect(a.body_hash).toBe(b.body_hash);
    expect(a.body_md5).toBe(b.body_md5);
  });
});

describe('buildRoutineCatalog + orderCalleesFirst', () => {
  const records: RoutineRecord[] = [
    profileTsqlRoutine({ name: 'upd_ledger_roll', objType: 'P', text: PROC_A }),
    profileTsqlRoutine({ name: 'upd_ledger_lines', objType: 'P', text: PROC_B }),
    profileTsqlRoutine({ name: 'purge_ledger_tmp', objType: 'P', text: PROC_C }),
    profileTsqlRoutine({ name: 'fn_ledger_total', objType: 'F', text: FN_D }),
    profileTsqlRoutine({ name: 'trg_ledger_line_ins', objType: 'TR', text: TRG_E }),
  ];
  const catalog = buildRoutineCatalog(records);
  const byName = new Map(catalog.map((r) => [r.routine_name, r]));

  it('closes writes/reads transitively, uncapped and cycle-safe (B <-> C cycle)', () => {
    const a = byName.get('upd_ledger_roll') as RoutineRecord;
    expect(a.writes_closure).toEqual(expect.arrayContaining(['ledger_ctrl', 'ledger_audit', 'ledger_line', 'ledger_tmp']));
    const b = byName.get('upd_ledger_lines') as RoutineRecord;
    expect(b.writes_closure).toEqual(expect.arrayContaining(['ledger_line', 'ledger_tmp']));
  });

  it('expands writes through triggers ON written tables', () => {
    const a = byName.get('upd_ledger_roll') as RoutineRecord;
    expect(a.trigger_expanded_writes).toEqual(['ledger_line_hist']);
    const d = byName.get('fn_ledger_total') as RoutineRecord;
    expect(d.trigger_expanded_writes).toEqual([]);
  });

  it('orders callees first and keeps cycles together', () => {
    const order = orderCalleesFirst(catalog).map((r) => r.routine_name);
    expect(order.indexOf('upd_ledger_lines')).toBeLessThan(order.indexOf('upd_ledger_roll'));
    expect(order).not.toContain('trg_ledger_line_ins');
    expect(order).toHaveLength(4);
  });
});
