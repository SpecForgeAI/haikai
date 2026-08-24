/**
 * Enum-held SQL (Kiro 2026-08-24): legacy estates keep operational SQL in
 * enum constants (`SqlOperations.UPDATE("update biz_date_ctrl ...")`) and
 * execute it via `for (Op op : Op.values()) exec(op.getSql())`. Such an
 * enum IS a boundary: each SQL-bearing constant becomes an operation named
 * after the constant; the method ops (getSql/values) stay sql-less so a
 * reach through them falls back to the class-level union.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { indexJavaProject } from '../javaProjectIndex';
import { extractBehaviour } from '../behaviourExtractor';

const SQL_ENUM = `package com.x;

public enum SqlOperations {
  UPDATE_ROLL("update biz_date_ctrl set prev_d = d, d = getdate()"),
  SELECT_PREV("select convert(varchar(8), prev_d, 112) from biz_date_ctrl"),
  PLAIN("not sql at all");

  private final String sql;

  SqlOperations(String sql) { this.sql = sql; }

  public String getSql() { return sql; }
}
`;

const PLAIN_ENUM = `package com.x;

public enum Colour {
  RED, GREEN;
}
`;

const SEQUENCE_DAO = `package com.x;

public class SequenceDao {
  public int getNext(String name) {
    run("update seq_registry set SeqNumber = SeqNumber + 1 where SeqName = ?");
    return run("select SeqNumber from seq_registry where SeqName = ?");
  }
  private int run(String sql) { return 0; }
}
`;

const FILTER_DAO = `package com.x;

public class FilterDao {
  private SequenceDao sequenceDao;

  public void addFilter(String name) {
    int id = sequenceDao.getNext("FilterId");
    run("insert into screen_filter (FilterId, Name) values (?, ?)");
  }
  private int run(String sql) { return 0; }
}
`;

describe('DAO->DAO delegation capture (Kiro 2026-08-24 issue A)', () => {
  let dir: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scl-delegation-'));
    fs.mkdirSync(path.join(dir, 'com', 'x'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'com', 'x', 'SequenceDao.java'), SEQUENCE_DAO);
    fs.writeFileSync(path.join(dir, 'com', 'x', 'FilterDao.java'), FILTER_DAO);
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('records a boundary op delegating to another boundary as Fqn#method', async () => {
    const index = await indexJavaProject(dir);
    expect(index.parseErrors).toEqual([]);
    const result = extractBehaviour(index, new Map());
    const filterDao = result.boundaries.find((b) => b.symbol === 'com.x.FilterDao')!;
    expect(filterDao).toBeDefined();
    const addFilter = filterDao.operations.find((o) => o.name === 'addFilter')!;
    expect(addFilter.delegatesTo).toEqual(['com.x.SequenceDao#getNext']);
    // Non-delegating ops carry no field at all.
    const seqDao = result.boundaries.find((b) => b.symbol === 'com.x.SequenceDao')!;
    const getNext = seqDao.operations.find((o) => o.name === 'getNext')!;
    expect(getNext.delegatesTo).toBeUndefined();
  });
});

describe('enum-held SQL boundaries (2026-08-24)', () => {
  let dir: string;
  let result: ReturnType<typeof extractBehaviour>;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scl-enumsql-'));
    fs.mkdirSync(path.join(dir, 'com', 'x'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'com', 'x', 'SqlOperations.java'), SQL_ENUM);
    fs.writeFileSync(path.join(dir, 'com', 'x', 'Colour.java'), PLAIN_ENUM);
    const index = await indexJavaProject(dir);
    expect(index.parseErrors).toEqual([]);
    result = extractBehaviour(index, new Map());
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('an SQL-bearing enum becomes a boundary with one op per SQL constant', () => {
    const boundarySymbols = result.boundaries.map((b) => b.symbol);
    expect(boundarySymbols).toContain('com.x.SqlOperations');
    const enumBoundary = result.boundaries.find((b) => b.symbol === 'com.x.SqlOperations')!;
    const opsByName = new Map(enumBoundary.operations.map((o) => [o.name, o.sqlVerbatim]));
    expect(opsByName.get('UPDATE_ROLL')).toContain('update biz_date_ctrl');
    expect(opsByName.get('SELECT_PREV')).toContain('from biz_date_ctrl');
    // The non-SQL constant contributes NO operation.
    expect(opsByName.has('PLAIN')).toBe(false);
    // Method ops stay sql-less: a values()/getSql() reach falls back to the
    // class union downstream.
    expect(opsByName.get('getSql') ?? null).toBeNull();
  });

  it('a plain enum stays a non-boundary (no phantom boundaries)', () => {
    expect(result.boundaries.map((b) => b.symbol)).not.toContain('com.x.Colour');
  });
});
