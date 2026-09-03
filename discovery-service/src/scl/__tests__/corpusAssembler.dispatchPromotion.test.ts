/**
 * Dispatch promotion (2026-09-03, spec-quality review DETAIL-01 / A-1).
 *
 * The persistence/cache seam of a Spring app is an interface with two
 * implementations (a cache decorator and a DB loader), wired by one
 * `@Qualifier` per interface. The slicer resolved that dispatch correctly and
 * used it for closure — then discarded it, so every call through the seam
 * rendered "(UNRESOLVED — no corpus contract)" while both implementations
 * sat in the corpus.
 *
 * Pins: the caller row carries BOTH implementation keys, the DI-wired
 * primary first and as `targetKey`; the keys join the caller's references;
 * the row is no longer counted as unresolved.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { sliceProject, type SclSliceResult } from '../slicer';
import { assembleCorpus } from '../corpusAssembler';

const LOADER = `package com.x;
public interface Loader {
    String load(String id);
}
`;
const CACHE_LOADER = `package com.x;
import org.springframework.stereotype.Component;
@Component("cacheLoader")
public class CacheLoader implements Loader {
    private final Loader delegate = new DbLoader();
    private final java.util.Map<String, String> cache = new java.util.HashMap<>();
    public String load(String id) {
        if (cache.containsKey(id)) {
            return cache.get(id);
        }
        String value = delegate.load(id);
        cache.put(id, value);
        return value;
    }
}
`;
const DB_LOADER = `package com.x;
public class DbLoader implements Loader {
    public String load(String id) {
        if (id == null) {
            throw new IllegalArgumentException("id");
        }
        return "row:" + id;
    }
}
`;
const SERVICE = `package com.x;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;
@Service
public class LookupService {
    @Qualifier("cacheLoader")
    private Loader loader;
    public String lookup(String id) {
        if (id.isEmpty()) {
            return "empty";
        }
        return loader.load(id);
    }
}
`;

describe('dispatch promotion onto call rows', () => {
  let dir: string;
  let slice: SclSliceResult;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scl-dispatch-'));
    fs.mkdirSync(path.join(dir, 'com', 'x'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'com', 'x', 'Loader.java'), LOADER);
    fs.writeFileSync(path.join(dir, 'com', 'x', 'CacheLoader.java'), CACHE_LOADER);
    fs.writeFileSync(path.join(dir, 'com', 'x', 'DbLoader.java'), DB_LOADER);
    fs.writeFileSync(path.join(dir, 'com', 'x', 'LookupService.java'), SERVICE);
    slice = await sliceProject(dir);
  }, 120_000);

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('carries both implementation keys with the @Qualifier-wired one primary, and drops the row from unresolved', () => {
    const corpus = assembleCorpus(slice);
    const service = slice.tables.find((t) => t.symbol.startsWith('com.x.LookupService#lookup'))!;
    expect(service).toBeDefined();
    const row = service.rows.find(
      (r) => r.outcome.type === 'call' && r.outcome.targetSymbol.startsWith('com.x.Loader#load'),
    )!;
    expect(row).toBeDefined();
    const outcome = row.outcome as Extract<typeof row.outcome, { type: 'call' }>;

    const cacheKey = slice.keyBySymbol.get('com.x.CacheLoader#load(String)');
    const dbKey = slice.keyBySymbol.get('com.x.DbLoader#load(String)');
    expect(cacheKey).toBeDefined();
    expect(dbKey).toBeDefined();

    expect(outcome.targetKeys).toEqual([cacheKey, dbKey]);
    expect(outcome.targetKey).toBe(cacheKey);
    expect(service.references).toEqual(expect.arrayContaining([cacheKey!, dbKey!]));

    const unresolved = corpus.findings.find((f) => f.kind === 'unresolved_calls');
    const sites = unresolved?.candidates ?? [];
    expect(sites.some((s) => s.includes('com.x.Loader#load'))).toBe(false);
  });
});
