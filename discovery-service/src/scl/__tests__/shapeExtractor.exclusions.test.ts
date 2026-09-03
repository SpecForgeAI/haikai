/**
 * Shape corpus exclusions (2026-09-03, spec-quality review IMPL-04).
 *
 * Every field-bearing class used to become a `[S-...]` shape: in one estate
 * 24% of the "DTO & domain shapes" were test classes and 16% were
 * services/DAOs/loaders, and the modernize.dto.* decision use-counts were
 * computed over that population (57 test classes nominally in scope to
 * become records; a Spring singleton flagged mutated-in-flight). Test
 * sources and framework-managed beans are excluded and recorded.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { indexJavaProject } from '../javaProjectIndex';
import { extractShapes } from '../shapeExtractor';

const DTO = `package com.x;
public class OrderResponse {
    private String orderId;
    private java.math.BigDecimal total;
    public String getOrderId() { return orderId; }
    public java.math.BigDecimal getTotal() { return total; }
}
`;
const BEAN = `package com.x;
import org.springframework.stereotype.Service;
@Service
public class ViewProvider {
    private String cachedView;
    private int hits;
    public String current() { return cachedView; }
}
`;
const TEST_CLASS = `package com.x;
public class OrderResponseTest {
    private String fixtureId;
    private OrderResponse subject;
}
`;

describe('extractShapes exclusions', () => {
  let dir: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scl-shape-excl-'));
    fs.mkdirSync(path.join(dir, 'src', 'main', 'java', 'com', 'x'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src', 'test', 'java', 'com', 'x'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'main', 'java', 'com', 'x', 'OrderResponse.java'), DTO);
    fs.writeFileSync(path.join(dir, 'src', 'main', 'java', 'com', 'x', 'ViewProvider.java'), BEAN);
    fs.writeFileSync(path.join(dir, 'src', 'test', 'java', 'com', 'x', 'OrderResponseTest.java'), TEST_CLASS);
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('keeps the plain DTO, excludes the @Service bean and the test class, and records why', async () => {
    const index = await indexJavaProject(dir);
    const result = extractShapes(index);
    const symbols = result.shapes.map((s) => s.symbol);
    expect(symbols).toContain('com.x.OrderResponse');
    expect(symbols).not.toContain('com.x.ViewProvider');
    expect(symbols).not.toContain('com.x.OrderResponseTest');
    expect(result.excluded).toEqual([
      { symbol: 'com.x.OrderResponseTest', reason: 'test_source' },
      { symbol: 'com.x.ViewProvider', reason: 'managed_bean' },
    ]);
  });
});
