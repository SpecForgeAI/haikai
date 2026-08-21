/**
 * Boundary SQL capture — widened idioms (2026-08-21).
 *
 * Live diagnosis: every DAO the walks reached showed `sql 0` although the
 * ops existed — the old capture only saw same-class String constants and
 * single inline literals with a SELECT-family verb. Pins the three legacy
 * idioms now covered:
 *   (a) CROSS-CLASS SQL constants (`SqlConstants.GET_ORGS`);
 *   (b) concatenated fragments ("SELECT a " + "FROM t") reassembled;
 *   (c) stored-procedure call strings ("{call dbo.sp_x(?)}" / "exec sp_x")
 *       captured as sqlVerbatim even without a SELECT-family verb.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { indexJavaProject } from '../javaProjectIndex';
import { extractBehaviour } from '../behaviourExtractor';

const SQL_CONSTANTS = `package com.x;

public class SqlConstants {
  public static final String GET_ORGS = "SELECT id, name FROM org_unit WHERE active = 1";
}
`;

const DAO = `package com.x;

public class OrgUnitDao {
  private static final String FIND_ONE = "SELECT id FROM org_unit WHERE id = ?";

  public java.util.List<String> loadAll(String region) {
    log("loading " + region);
    return run(SqlConstants.GET_ORGS);
  }

  public String findOne(int id) {
    return run(FIND_ONE);
  }

  public java.util.List<String> loadJoined(String date) {
    String sql = "SELECT u.id, m.tag " + "FROM units u " + "JOIN unit_map m ON m.unit_id = u.id";
    return run(sql);
  }

  public void syncUnits(String date) {
    exec("{call dbo.sp_sync_units(?)}");
  }

  public void logOnly(String message) {
    log("nothing sql-ish here at all");
  }

  private java.util.List<String> run(String sql) { return null; }
  private String log(String m) { return m; }
  private void exec(String s) { }
}
`;

describe('boundary SQL capture idioms (2026-08-21)', () => {
  let dir: string;
  let opsByName: Map<string, { sqlVerbatim: string | null }>;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scl-sqlcap-'));
    fs.mkdirSync(path.join(dir, 'com', 'x'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'com', 'x', 'SqlConstants.java'), SQL_CONSTANTS);
    fs.writeFileSync(path.join(dir, 'com', 'x', 'OrgUnitDao.java'), DAO);
    const index = await indexJavaProject(dir);
    expect(index.parseErrors).toEqual([]);
    const result = extractBehaviour(index, new Map());
    const dao = result.boundaries.find((b) => b.symbol === 'com.x.OrgUnitDao');
    expect(dao).toBeDefined();
    opsByName = new Map(dao!.operations.map((o) => [o.name, o]));
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('captures a CROSS-CLASS SQL constant', () => {
    expect(opsByName.get('loadAll')?.sqlVerbatim).toContain('FROM org_unit');
  });

  it('same-class constants still work', () => {
    expect(opsByName.get('findOne')?.sqlVerbatim).toContain('WHERE id = ?');
  });

  it('reassembles concatenated fragments so the FROM/JOIN clauses survive', () => {
    const sql = opsByName.get('loadJoined')?.sqlVerbatim ?? '';
    expect(sql).toContain('FROM units u');
    expect(sql).toContain('JOIN unit_map m');
  });

  it('captures stored-procedure call strings without SELECT-family verbs', () => {
    expect(opsByName.get('syncUnits')?.sqlVerbatim).toContain('call dbo.sp_sync_units');
  });

  it('a method with only non-SQL strings stays honestly null', () => {
    expect(opsByName.get('logOnly')?.sqlVerbatim).toBeNull();
  });
});
