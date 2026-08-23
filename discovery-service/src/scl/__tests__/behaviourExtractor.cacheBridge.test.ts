/**
 * Guava cache-transparency bridge (2026-08-23) — the live-estate idiom that
 * severed EVERY read chain:
 *
 *   Service -> CacheFront.getX(k) -> cache.getUnchecked(k)   [external Guava]
 *                                       ... anonymous CacheLoader.load()
 *                                       (built in the CONSTRUCTOR)
 *                                       -> DBLoader.loadX(k) -> Dao -> SQL
 *
 * Pins:
 *   1. cache-front methods are TABLES (a get-family call on a Cache-typed
 *      field counts as a project call — no more inlining away);
 *   2. their rows carry the bridged 'cache miss -> loader' call to the
 *      DB loader mined from the constructor's anonymous CacheLoader;
 *   3. the loader's own chain reaches the DAO boundary as usual;
 *   4. a Map-typed field does NOT bridge (type-gated, not name-gated).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { indexJavaProject } from '../javaProjectIndex';
import { extractBehaviour } from '../behaviourExtractor';

const CACHE_FRONT = `package com.x;

import com.google.common.cache.CacheBuilder;
import com.google.common.cache.CacheLoader;
import com.google.common.cache.LoadingCache;

public class FilterCacheFront {
  private final LoadingCache<String, Object> cache;
  private final FilterDBLoader dbLoader;

  public FilterCacheFront(FilterDBLoader dbLoader, String spec) {
    this.dbLoader = dbLoader;
    this.cache = CacheBuilder.from(spec).build(new CacheLoader<String, Object>() {
      public Object load(String key) {
        return dbLoader.loadFilters(key);
      }
    });
  }

  public Object getFilters(String key) {
    return cache.getUnchecked(key);
  }
}
`;

const DB_LOADER = `package com.x;

public class FilterDBLoader {
  private FilterDao filterDao;

  public Object loadFilters(String key) {
    log(key);
    return filterDao.getAllFilters(key);
  }

  private void log(String k) { }
}
`;

const DAO_IFACE = `package com.x;

public interface FilterDao {
  Object getAllFilters(String key);
}
`;

const DAO_IMPL = `package com.x;

public class FilterDaoImpl implements FilterDao {
  public Object getAllFilters(String key) {
    return run("select * from screen_filter where ValidFrom <= ? and ValidTo > ?");
  }

  private Object run(String sql) { return null; }
}
`;

const SERVICE = `package com.x;

public class FilterService {
  private FilterCacheFront filterCache;

  public Object fetch(String key) {
    if (key == null) {
      throw new IllegalArgumentException("key");
    }
    return filterCache.getFilters(key);
  }
}
`;

const MAP_HOLDER = `package com.x;

public class PlainMapHolder {
  private java.util.Map<String, Object> lookup;

  public Object find(String key) {
    if (key == null) {
      throw new IllegalArgumentException("key");
    }
    return lookup.get(key);
  }
}
`;

describe('Guava cache-transparency bridge (2026-08-23)', () => {
  let dir: string;
  let result: ReturnType<typeof extractBehaviour>;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scl-cachebridge-'));
    fs.mkdirSync(path.join(dir, 'com', 'x'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'com', 'x', 'FilterCacheFront.java'), CACHE_FRONT);
    fs.writeFileSync(path.join(dir, 'com', 'x', 'FilterDBLoader.java'), DB_LOADER);
    fs.writeFileSync(path.join(dir, 'com', 'x', 'FilterDao.java'), DAO_IFACE);
    fs.writeFileSync(path.join(dir, 'com', 'x', 'FilterDaoImpl.java'), DAO_IMPL);
    fs.writeFileSync(path.join(dir, 'com', 'x', 'FilterService.java'), SERVICE);
    fs.writeFileSync(path.join(dir, 'com', 'x', 'PlainMapHolder.java'), MAP_HOLDER);
    const index = await indexJavaProject(dir);
    expect(index.parseErrors).toEqual([]);
    result = extractBehaviour(index, new Map());
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('the cache-front method is a TABLE, not an inlined accessor', () => {
    const front = result.tables.find((t) =>
      t.symbol.startsWith('com.x.FilterCacheFront#getFilters'),
    );
    expect(front).toBeDefined();
  });

  it('bridges the cache read to the constructor-built anonymous CacheLoader delegate', () => {
    const front = result.tables.find((t) =>
      t.symbol.startsWith('com.x.FilterCacheFront#getFilters'),
    )!;
    const bridge = front.rows.find(
      (r) =>
        r.outcome.type === 'call' &&
        r.outcome.targetSymbol.startsWith('com.x.FilterDBLoader#loadFilters'),
    );
    expect(bridge).toBeDefined();
    expect(bridge!.conditionVerbatim).toBe('cache miss -> loader');
  });

  it('the service call into the cache front stays a resolved chain hop', () => {
    const service = result.tables.find((t) => t.symbol.startsWith('com.x.FilterService#fetch'))!;
    const frontKey = result.keyBySymbol?.get?.('com.x.FilterCacheFront#getFilters(String)');
    const call = service.rows.find(
      (r) =>
        r.outcome.type === 'call' &&
        r.outcome.targetSymbol.startsWith('com.x.FilterCacheFront#getFilters'),
    );
    expect(call).toBeDefined();
    if (frontKey) {
      expect((call!.outcome as { targetKey: string | null }).targetKey).toBe(frontKey);
    }
  });

  it('the loader chain ends on the DAO boundary with the mined SQL', () => {
    const dao = result.boundaries.find((b) => b.symbol === 'com.x.FilterDao');
    expect(dao).toBeDefined();
    expect(dao!.operations[0].sqlVerbatim).toContain('from screen_filter');
    const loader = result.tables.find((t) =>
      t.symbol.startsWith('com.x.FilterDBLoader#loadFilters'),
    )!;
    const daoCall = loader.rows.find(
      (r) => r.outcome.type === 'call' && r.outcome.targetSymbol.includes('FilterDao'),
    );
    expect(daoCall).toBeDefined();
  });

  it('a plain Map field does NOT bridge (type-gated)', () => {
    const holder = result.tables.find((t) => t.symbol.startsWith('com.x.PlainMapHolder#find'));
    if (holder) {
      expect(
        holder.rows.some(
          (r) => r.outcome.type === 'call' && r.outcome.targetSymbol.includes('FilterDBLoader'),
        ),
      ).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// web.xml handler detection end-to-end (Oracle Nine item 6): the bean-mapped
// HttpRequestHandler becomes an EXTERNAL corpus root with its url-pattern.
// ---------------------------------------------------------------------------

const REFRESH_HANDLER = `package com.x;

public class RefreshHandler implements org.springframework.web.HttpRequestHandler {
  private FilterDBLoader dbLoader;

  public void handleRequest(Object request, Object response) {
    if (request == null) {
      throw new IllegalArgumentException("request");
    }
    dbLoader.loadFilters("all");
  }
}
`;

const WEB_XML = `<?xml version="1.0"?>
<web-app>
  <servlet>
    <servlet-name>refreshHandler</servlet-name>
    <servlet-class>org.springframework.web.context.support.HttpRequestHandlerServlet</servlet-class>
  </servlet>
  <servlet-mapping>
    <servlet-name>refreshHandler</servlet-name>
    <url-pattern>/refreshCache</url-pattern>
  </servlet-mapping>
</web-app>
`;

describe('web.xml handler roots (Oracle Nine item 6)', () => {
  it('a bean-mapped HttpRequestHandler becomes an external web_xml root', async () => {
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'scl-webxml-'));
    fs.mkdirSync(path.join(dir2, 'com', 'x'), { recursive: true });
    fs.mkdirSync(path.join(dir2, 'WEB-INF'), { recursive: true });
    fs.writeFileSync(path.join(dir2, 'com', 'x', 'RefreshHandler.java'), REFRESH_HANDLER);
    fs.writeFileSync(path.join(dir2, 'com', 'x', 'FilterDBLoader.java'), DB_LOADER);
    fs.writeFileSync(path.join(dir2, 'com', 'x', 'FilterDao.java'), DAO_IFACE);
    fs.writeFileSync(path.join(dir2, 'com', 'x', 'FilterDaoImpl.java'), DAO_IMPL);
    fs.writeFileSync(path.join(dir2, 'WEB-INF', 'web.xml'), WEB_XML);
    try {
      const { sliceProject } = await import('../slicer');
      const { assembleCorpus } = await import('../corpusAssembler');
      const slice = await sliceProject(dir2);
      expect(slice.index.webXmlHandlerMappings).toHaveLength(1);
      const corpus = assembleCorpus(slice);
      const root = corpus.roots.find((r) => r.detail === 'web_xml:/refreshCache');
      expect(root).toBeDefined();
      expect(root!.kind).toBe('external');
      expect(root!.symbol).toContain('RefreshHandler#handleRequest');
    } finally {
      fs.rmSync(dir2, { recursive: true, force: true });
    }
  });
});
