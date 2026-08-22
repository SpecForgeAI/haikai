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

// ---------------------------------------------------------------------------
// DAO-interface + Impl idiom (2026-08-21 live diagnosis)
// ---------------------------------------------------------------------------

const CATALOG_IFACE = `package com.x;

public interface UnitCatalogDao {
  java.util.List<String> loadUnits(String date);
  void syncCatalog(String date);
}
`;

const CATALOG_IMPL = `package com.x;

public class UnitCatalogDaoImpl implements UnitCatalogDao {
  public java.util.List<String> loadUnits(String date) {
    final String sql = "select * from unit_catalog " + "where ValidFrom <= ? and ValidTo > ?";
    log("loading units");
    return run(sql);
  }

  public void syncCatalog(String date) {
    exec("insert into unit_catalog_audit (d) values (?)");
  }

  private java.util.List<String> run(String sql) { return null; }
  private void exec(String sql) { }
  private void log(String m) { }
}
`;

const CATALOG_SERVICE = `package com.x;

public class CatalogService {
  private UnitCatalogDao dao;

  public java.util.List<String> fetch(String date) {
    if (date == null) {
      throw new IllegalArgumentException("date");
    }
    return dao.loadUnits(date);
  }
}
`;

describe('DAO-interface + Impl idiom (2026-08-21)', () => {
  let dir: string;
  let result: ReturnType<typeof extractBehaviour>;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scl-daoimpl-'));
    fs.mkdirSync(path.join(dir, 'com', 'x'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'com', 'x', 'UnitCatalogDao.java'), CATALOG_IFACE);
    fs.writeFileSync(path.join(dir, 'com', 'x', 'UnitCatalogDaoImpl.java'), CATALOG_IMPL);
    fs.writeFileSync(path.join(dir, 'com', 'x', 'CatalogService.java'), CATALOG_SERVICE);
    const index = await indexJavaProject(dir);
    expect(index.parseErrors).toEqual([]);
    result = extractBehaviour(index, new Map());
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('the INTERFACE boundary mines its SQL from the implementing class', () => {
    const iface = result.boundaries.find((b) => b.symbol === 'com.x.UnitCatalogDao');
    expect(iface).toBeDefined();
    const load = iface!.operations.find((o) => o.name === 'loadUnits');
    expect(load?.sqlVerbatim).toContain('from unit_catalog');
    expect(load?.sqlVerbatim).toContain('ValidTo > ?'); // concat fragment survived
    const sync = iface!.operations.find((o) => o.name === 'syncCatalog');
    expect(sync?.sqlVerbatim).toContain('insert into unit_catalog_audit');
  });

  it('the Impl class is boundary-classified too (its methods never become tables)', () => {
    const impl = result.boundaries.find((b) => b.symbol === 'com.x.UnitCatalogDaoImpl');
    expect(impl).toBeDefined();
    expect(result.tables.some((t) => t.symbol.startsWith('com.x.UnitCatalogDaoImpl#'))).toBe(
      false,
    );
  });

  it('a call through the interface-typed field routes to the interface BOUNDARY, not a table', () => {
    const service = result.tables.find((t) => t.symbol.startsWith('com.x.CatalogService#fetch'));
    expect(service).toBeDefined();
    const ifaceKey = result.boundaries.find((b) => b.symbol === 'com.x.UnitCatalogDao')!.key;
    const callRow = service!.rows.find(
      (r) => r.outcome.type === 'call' && r.outcome.targetKey === ifaceKey,
    );
    expect(callRow).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// DAO suffix CASING (2026-08-22 live diagnosis): the same estate mixes
// `BookDaoImpl` and `BookAttributeMetaDataDAOImpl` — the upper-cased `DAO`
// suffix never boundary-classified, so `select * from hir_book_attr_name`
// was invisible and chains through the DAO died silently.
// ---------------------------------------------------------------------------

const ATTR_IFACE = `package com.x;

public interface BookAttrDAO {
  java.util.List<String> loadAttrNames(String date);
}
`;

const ATTR_IMPL = `package com.x;

public class BookAttrDAOImpl implements BookAttrDAO {
  public java.util.List<String> loadAttrNames(String date) {
    return run("select * from book_attr_name where valid_from <= ? and valid_to > ?");
  }

  private java.util.List<String> run(String sql) { return null; }
}
`;

describe('DAO suffix casing (2026-08-22)', () => {
  let dir: string;
  let result: ReturnType<typeof extractBehaviour>;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scl-daocase-'));
    fs.mkdirSync(path.join(dir, 'com', 'x'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'com', 'x', 'BookAttrDAO.java'), ATTR_IFACE);
    fs.writeFileSync(path.join(dir, 'com', 'x', 'BookAttrDAOImpl.java'), ATTR_IMPL);
    const index = await indexJavaProject(dir);
    expect(index.parseErrors).toEqual([]);
    result = extractBehaviour(index, new Map());
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('an upper-cased DAO interface is boundary-classified and mines SQL from its Impl', () => {
    const iface = result.boundaries.find((b) => b.symbol === 'com.x.BookAttrDAO');
    expect(iface).toBeDefined();
    expect(iface!.operations[0].sqlVerbatim).toContain('from book_attr_name');
  });

  it('the DAOImpl class is boundary-classified too (never a behaviour table)', () => {
    expect(result.boundaries.some((b) => b.symbol === 'com.x.BookAttrDAOImpl')).toBe(true);
    expect(result.tables.some((t) => t.symbol.startsWith('com.x.BookAttrDAOImpl#'))).toBe(false);
  });
});
