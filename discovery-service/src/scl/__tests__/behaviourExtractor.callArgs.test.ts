/**
 * Verbatim call arguments on dispatch/call rows (2026-09-03, DETAIL-02).
 *
 * The spec row rendered only the callee signature — `loadDatesFor(String,
 * boolean)` — while the call site's literal arguments ARE the behaviour: the
 * string selects which feed's dates are consulted and the boolean suppresses
 * a cache refresh. Rows now carry the arguments verbatim, with a constant
 * reference resolved to its initializer.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { indexJavaProject } from '../javaProjectIndex';
import { extractBehaviour } from '../behaviourExtractor';

const LOADER = `package com.x;
public class FeedLoader {
    public java.util.List<String> loadDatesFor(String feed, boolean refresh) {
        if (refresh) {
            return java.util.Collections.emptyList();
        }
        return java.util.Collections.singletonList(feed);
    }
}
`;
const CALLER = `package com.x;
public class HierarchyProvider {
    private static final String FEED = "Hierarchy_Loaded";
    private final FeedLoader loader = new FeedLoader();
    public int countDates(String org) {
        if (org == null) {
            return 0;
        }
        java.util.List<String> dates = loader.loadDatesFor(FEED, false);
        return dates.size();
    }
}
`;

describe('call rows carry verbatim arguments', () => {
  let dir: string;
  let result: ReturnType<typeof extractBehaviour>;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scl-callargs-'));
    fs.mkdirSync(path.join(dir, 'com', 'x'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'com', 'x', 'FeedLoader.java'), LOADER);
    fs.writeFileSync(path.join(dir, 'com', 'x', 'HierarchyProvider.java'), CALLER);
    const index = await indexJavaProject(dir);
    result = extractBehaviour(index, new Map());
  }, 120_000);

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('records each argument verbatim and resolves a static final constant to its initializer', () => {
    const caller = result.tables.find((t) => t.symbol.startsWith('com.x.HierarchyProvider#countDates'))!;
    expect(caller).toBeDefined();
    const call = caller.rows.find(
      (r) => r.outcome.type === 'call' && r.outcome.targetSymbol.startsWith('com.x.FeedLoader#loadDatesFor'),
    )!;
    expect(call).toBeDefined();
    const outcome = call.outcome as Extract<typeof call.outcome, { type: 'call' }>;
    expect(outcome.args).toEqual(['FEED = "Hierarchy_Loaded"', 'false']);
  });
});
