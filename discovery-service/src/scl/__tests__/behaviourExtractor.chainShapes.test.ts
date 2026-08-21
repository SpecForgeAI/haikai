/**
 * Chain-shape resolution (2026-08-21 sweep, Items 1+3).
 *
 * The sweep proved two SILENT loss classes: nested project calls
 * (first-resolution-wins dropped `dao.load` inside `mapper.wrap(dao.load(x))`)
 * and unrecognized receiver shapes (chained/ternary/cast/new/array receivers
 * produced NO row at all — walks looked complete and proven-read failed
 * open). Pins the new contract:
 *
 *   - every resolvable project call in a statement gets its own row;
 *   - receiver shapes that STATICALLY type resolve (singleton/factory
 *     return-type chaining, inline `new`, casts, arrays, static imports,
 *     fully-qualified statics) chain like any other call;
 *   - external-rooted fluent chains stay SILENT (JAX-RS Response builders
 *     must not flood the diagnosis);
 *   - a genuinely untypeable receiver goes LOUD: a `?#name(?)` unresolved
 *     call row that blocks proven-read and lands in broken_calls.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { indexJavaProject } from '../javaProjectIndex';
import { extractBehaviour } from '../behaviourExtractor';
import type { SclRow } from '../sclTypes';

const FILES: Record<string, string> = {
  'LookupDao.java': `package com.x;

public class LookupDao {
  public java.util.List<String> load(String key) {
    return run("select v from lookup_vals where k = ?");
  }
  private java.util.List<String> run(String sql) { return null; }
}
`,
  'AuditStore.java': `package com.x;

public class AuditStore {
  private static final AuditStore INSTANCE = new AuditStore();
  public static AuditStore getInstance() { return INSTANCE; }
  public void record(String what) { helper(what); }
  private void helper(String what) { }
}
`,
  'Mapper.java': `package com.x;

public class Mapper {
  public java.util.List<String> wrap(java.util.List<String> in) {
    if (in == null) { throw new IllegalArgumentException("in"); }
    return in;
  }
}
`,
  'SqlUtil.java': `package com.x;

public class SqlUtil {
  public static String clause(String x) {
    if (x == null) { return "1=1"; }
    return x;
  }
}
`,
  'StaticUser.java': `package com.x;

import static com.x.SqlUtil.clause;

public class StaticUser {
  public String build(String x) {
    log(x);
    return clause(x);
  }
  private void log(String x) { }
}
`,
  'Flow.java': `package com.x;

public class Flow {
  private LookupDao dao;
  private Mapper mapper;
  private LookupDao[] pool;

  public java.util.List<String> nested(String key) {
    return mapper.wrap(dao.load(key));
  }

  public void singletonChain(String key) {
    AuditStore.getInstance().record(key);
  }

  public void ternary(boolean f, LookupDao a, LookupDao b, String key) {
    (f ? a : b).load(key);
  }

  public void inlineNew(String key) {
    new Mapper().wrap(null);
    log(key);
  }

  public void castCall(Object o, String key) {
    ((LookupDao) o).load(key);
    log(key);
  }

  public void arrayCall(int i, String key) {
    pool[i].load(key);
    log(key);
  }

  public void loopBody(java.util.List<String> keys) {
    for (int i = 0; i < keys.size(); i++) {
      dao.load(keys.get(i));
      AuditStore.getInstance().record(keys.get(i));
    }
  }

  public void externalFluent(String key) {
    new StringBuilder().append(key).append("y").toString();
    System.out.println("done");
  }

  public java.util.List<String> viaCatch(String key) {
    try {
      return dao.load(key);
    } catch (RuntimeException e) {
      AuditStore.getInstance().record(key);
      throw e;
    }
  }

  private void log(String key) { }
}
`,
};

function callRows(rows: readonly SclRow[]): Array<{ symbol: string; key: string | null }> {
  return rows
    .filter((r) => r.outcome.type === 'call')
    .map((r) => ({
      symbol: (r.outcome as { targetSymbol: string }).targetSymbol,
      key: (r.outcome as { targetKey: string | null }).targetKey,
    }));
}

describe('chain shapes (2026-08-21 Items 1+3)', () => {
  let dir: string;
  let result: ReturnType<typeof extractBehaviour>;
  const table = (prefix: string) => {
    const t = result.tables.find((tt) => tt.symbol.startsWith(prefix));
    expect(t).toBeDefined();
    return t!;
  };

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scl-shapes-'));
    fs.mkdirSync(path.join(dir, 'com', 'x'), { recursive: true });
    for (const [name, content] of Object.entries(FILES)) {
      fs.writeFileSync(path.join(dir, 'com', 'x', name), content);
    }
    const index = await indexJavaProject(dir);
    expect(index.parseErrors).toEqual([]);
    result = extractBehaviour(index, new Map());
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('captures EVERY project call in a statement (nested calls no longer lost)', () => {
    const calls = callRows(table('com.x.Flow#nested').rows);
    expect(calls.some((c) => c.symbol.includes('Mapper#wrap'))).toBe(true);
    expect(calls.some((c) => c.symbol.includes('LookupDao#load'))).toBe(true);
    // The DAO call carries the boundary key — the walk reaches the data layer.
    const dao = calls.find((c) => c.symbol.includes('LookupDao#load'));
    expect(dao?.key).toMatch(/^Q-/);
  });

  it('singleton chaining resolves X.getInstance().record(...) to the real method', () => {
    const calls = callRows(table('com.x.Flow#singletonChain').rows);
    expect(calls).toHaveLength(1);
    expect(calls[0].symbol).toBe('com.x.AuditStore#record(String)');
    expect(calls[0].key).toMatch(/^T-/);
  });

  it('an untypeable receiver goes LOUD: a ?#name unresolved row, never silence', () => {
    const calls = callRows(table('com.x.Flow#ternary').rows);
    expect(calls).toHaveLength(1);
    expect(calls[0].symbol).toBe('?#load(?)');
    expect(calls[0].key).toBeNull();
  });

  it('inline new / cast / array receivers all resolve', () => {
    expect(callRows(table('com.x.Flow#inlineNew').rows)[0]?.symbol).toContain('Mapper#wrap');
    expect(callRows(table('com.x.Flow#castCall').rows)[0]?.symbol).toContain('LookupDao#load');
    expect(callRows(table('com.x.Flow#arrayCall').rows)[0]?.symbol).toContain('LookupDao#load');
  });

  it('a second call in a loop body rides along as its own row', () => {
    const calls = callRows(table('com.x.Flow#loopBody').rows);
    expect(calls.some((c) => c.symbol.includes('LookupDao#load'))).toBe(true);
    expect(calls.some((c) => c.symbol.includes('AuditStore#record'))).toBe(true);
  });

  it('external-rooted fluent chains stay silent (no rows, no loud noise)', () => {
    const rows = table('com.x.Flow#externalFluent').rows;
    expect(callRows(rows)).toHaveLength(0);
    expect(JSON.stringify(rows)).not.toContain('?#');
  });

  it('catch-body project calls are captured', () => {
    const calls = callRows(table('com.x.Flow#viaCatch').rows);
    expect(calls.some((c) => c.symbol.includes('AuditStore#record'))).toBe(true);
  });

  it('static-import calls resolve to the imported project class', () => {
    const calls = callRows(table('com.x.StaticUser#build').rows);
    expect(calls.some((c) => c.symbol === 'com.x.SqlUtil#clause(String)')).toBe(true);
  });
});
