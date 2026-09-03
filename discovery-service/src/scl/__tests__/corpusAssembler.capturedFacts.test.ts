/**
 * Captured behaviour facts (2026-09-03, spec-quality review BEHAV-03/04/05).
 *
 * Three facts the behaviour rows alone hid, each a pure join over the index
 * and the tables:
 *   - cache-fronting: a warm in-process cache serves the read with NO data
 *     access; a miss loads whatever the loader loads; writes are process-local;
 *   - aspect advice: an annotation-driven aspect runs on every invocation of
 *     the methods carrying its marker, and its data effects reach them;
 *   - data-derived authorisation: access decided by a predicate reading
 *     tables — the tables ARE the access-control list.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { sliceProject, type SclSliceResult } from '../slicer';
import { assembleCorpus, type SclCorpus } from '../corpusAssembler';

const AUDITED = `package com.x;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
@Retention(RetentionPolicy.RUNTIME)
public @interface Audited { }
`;
const ASPECT = `package com.x;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
@Aspect
public class AuditAspect {
    private final AuditDao auditDao = new AuditDao();
    @Around("@annotation(com.x.Audited)")
    public Object audit(ProceedingJoinPoint pjp) throws Throwable {
        if (pjp == null) {
            throw new IllegalStateException("no join point");
        }
        auditDao.insertAudit(pjp.toString());
        return pjp.proceed();
    }
}
`;
const AUDIT_DAO = `package com.x;
public class AuditDao {
    private static final String INSERT_AUDIT = "insert into audit_trail_info (detail) values (?)";
    public void insertAudit(String detail) {
        if (detail == null) {
            return;
        }
        execute(INSERT_AUDIT, detail);
    }
    private void execute(String sql, String arg) { }
}
`;
const ACL = `package com.x;
public class TagAcl {
    public boolean isReadPermitted(String user, String view) {
        if (user == null) {
            return false;
        }
        return view.startsWith(user);
    }
}
`;
const RESOURCE = `package com.x;
import java.util.HashMap;
import java.util.Map;
public class ViewResource {
    private final Map<String, String> viewCache = new HashMap<>();
    private final TagAcl acl = new TagAcl();
    private final ViewLoader loader = new ViewLoader();
    @Audited
    public String getView(String user, String viewId) {
        if (!acl.isReadPermitted(user, viewId)) {
            return "PERMISSION_DENIED";
        }
        if (viewCache.containsKey(viewId)) {
            return viewCache.get(viewId);
        }
        String loaded = loader.load(viewId);
        viewCache.put(viewId, loaded);
        return loaded;
    }
    public void refreshCache() {
        if (viewCache.isEmpty()) {
            return;
        }
        viewCache.clear();
    }
}
`;
const LOADER = `package com.x;
public class ViewLoader {
    public String load(String viewId) {
        if (viewId == null) {
            throw new IllegalArgumentException("viewId");
        }
        return "view:" + viewId;
    }
}
`;

describe('captured behaviour facts', () => {
  let dir: string;
  let slice: SclSliceResult;
  let corpus: SclCorpus;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scl-facts-'));
    fs.mkdirSync(path.join(dir, 'com', 'x'), { recursive: true });
    for (const [name, src] of [
      ['Audited.java', AUDITED],
      ['AuditAspect.java', ASPECT],
      ['AuditDao.java', AUDIT_DAO],
      ['TagAcl.java', ACL],
      ['ViewResource.java', RESOURCE],
      ['ViewLoader.java', LOADER],
    ] as const) {
      fs.writeFileSync(path.join(dir, 'com', 'x', name), src);
    }
    slice = await sliceProject(dir);
    corpus = assembleCorpus(slice);
  }, 120_000);

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function getView() {
    return slice.tables.find((t) => t.symbol.startsWith('com.x.ViewResource#getView'))!;
  }

  it('BEHAV-03: attaches cache-fronting facts — field, type, key, and the process-local mutation sites', () => {
    const table = getView();
    expect(table.cacheFacts).toBeDefined();
    expect(table.cacheFacts!.cacheField).toBe('viewCache');
    expect(table.cacheFacts!.cacheType).toBe('Map<String, String>');
    expect(table.cacheFacts!.keyType).toBe('String');
    expect(table.cacheFacts!.mutators).toEqual([
      { symbol: 'com.x.ViewResource#getView(String,String)', operations: ['put'] },
      { symbol: 'com.x.ViewResource#refreshCache()', operations: ['clear'] },
    ]);
  });

  it('BEHAV-04: joins the annotation-driven aspect onto the advised method and reaches its table', () => {
    const table = getView();
    expect(table.advisedBy).toBeDefined();
    expect(table.advisedBy).toHaveLength(1);
    const advice = table.advisedBy![0];
    expect(advice.aspectSymbol).toBe('com.x.AuditAspect#audit(org.aspectj.lang.ProceedingJoinPoint)');
    expect(advice.adviceKind).toBe('@Around');
    expect(advice.pointcut).toBe('@annotation(com.x.Audited)');
    expect(advice.targetKey).toBe(slice.keyBySymbol.get(advice.aspectSymbol));
    expect(table.references).toContain(advice.targetKey);
    // The un-advised method carries nothing.
    const refresh = slice.tables.find((t) => t.symbol.startsWith('com.x.ViewResource#refreshCache'))!;
    expect(refresh.advisedBy).toBeUndefined();
  });

  it('BEHAV-05: marks the data-derived authorisation predicate, its denial outcome, and surfaces a finding', () => {
    const table = getView();
    expect(table.authorisation).toBeDefined();
    expect(table.authorisation!.predicates).toEqual(['!acl.isReadPermitted(user, viewId)']);
    expect(table.authorisation!.deniedOutcomes.some((d) => /PERMISSION_DENIED|value:String/.test(d))).toBe(true);
    const finding = corpus.findings.find((f) => f.kind === 'data_derived_authorisation');
    expect(finding).toBeDefined();
    expect(finding!.symbol).toBe(table.symbol);
    expect(finding!.candidates).toContain('!acl.isReadPermitted(user, viewId)');
  });
});
