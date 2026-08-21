/**
 * Hierarchy-aware resolution (2026-08-21 sweep, Item 2).
 *
 * Pins the shapes that used to break SILENTLY because method/field lookup
 * never walked the project type hierarchy:
 *   - a call to a method DECLARED ON THE BASE through a subclass receiver;
 *   - `super.method()` delegation;
 *   - a protected DAO field inherited from a project base;
 *   - a method declared on a PARENT interface, called through the child;
 *   - method references (`store::record`) resolving like calls.
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
  public void record(String what) { helper(what); }
  private void helper(String what) { }
}
`,
  'BaseSvc.java': `package com.x;

public class BaseSvc {
  protected LookupDao dao;

  public java.util.List<String> common(String key) {
    return dao.load(key);
  }
}
`,
  'SubSvc.java': `package com.x;

public class SubSvc extends BaseSvc {
  public java.util.List<String> viaInheritedField(String key) {
    log(key);
    return dao.load(key);
  }

  public java.util.List<String> viaSuper(String key) {
    log(key);
    return super.common(key);
  }

  private void log(String key) { }
}
`,
  'Caller.java': `package com.x;

public class Caller {
  private SubSvc sub;
  private AuditStore store;

  public java.util.List<String> inherited(String key) {
    log(key);
    return sub.common(key);
  }

  public void refs(java.util.List<String> keys) {
    keys.forEach(store::record);
  }

  private void log(String key) { }
}
`,
  'ReadFacade.java': `package com.x;

public interface ReadFacade {
  java.util.List<String> fetch(String key);
}
`,
  'OrgReadFacade.java': `package com.x;

public interface OrgReadFacade extends ReadFacade {
}
`,
  'OrgReadFacadeImpl.java': `package com.x;

public class OrgReadFacadeImpl implements OrgReadFacade {
  private LookupDao dao;
  public java.util.List<String> fetch(String key) {
    if (key == null) { throw new IllegalArgumentException("key"); }
    return dao.load(key);
  }
}
`,
  'FacadeUser.java': `package com.x;

public class FacadeUser {
  private OrgReadFacade facade;
  public java.util.List<String> use(String key) {
    log(key);
    return facade.fetch(key);
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

describe('hierarchy-aware resolution (2026-08-21 Item 2)', () => {
  let dir: string;
  let result: ReturnType<typeof extractBehaviour>;
  const table = (prefix: string) => {
    const t = result.tables.find((tt) => tt.symbol.startsWith(prefix));
    expect(t).toBeDefined();
    return t!;
  };

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scl-hier-'));
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

  it('a base-declared method resolves through a subclass receiver', () => {
    const calls = callRows(table('com.x.Caller#inherited').rows);
    expect(calls.some((c) => c.symbol === 'com.x.BaseSvc#common(String)' && c.key?.startsWith('T-'))).toBe(
      true,
    );
  });

  it('super.method() resolves to the project base', () => {
    const calls = callRows(table('com.x.SubSvc#viaSuper').rows);
    expect(calls.some((c) => c.symbol === 'com.x.BaseSvc#common(String)')).toBe(true);
  });

  it('a protected DAO field inherited from the base resolves to the boundary', () => {
    const calls = callRows(table('com.x.SubSvc#viaInheritedField').rows);
    const dao = calls.find((c) => c.symbol.includes('LookupDao#load'));
    expect(dao?.key).toMatch(/^Q-/);
  });

  it('a parent-interface method called through the child interface dispatches to the impl', () => {
    const calls = callRows(table('com.x.FacadeUser#use').rows);
    expect(calls.some((c) => c.symbol.includes('OrgReadFacadeImpl#fetch'))).toBe(true);
  });

  it('method references resolve like calls', () => {
    const calls = callRows(table('com.x.Caller#refs').rows);
    expect(calls.some((c) => c.symbol === 'com.x.AuditStore#record(String)')).toBe(true);
  });
});
