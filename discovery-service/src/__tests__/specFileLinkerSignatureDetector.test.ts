/**
 * Tests for the `specFileLinker/signatureDetector.ts` module.
 *
 * Spec: 2026-05-17 Spec File Auto-Linking Phase 3, Task Group 3 (sub-task 3.4).
 *
 * Coverage:
 *  1. YAML with `openapi: 3.0.3` -> kind='openapi-3'.
 *  2. JSON with `swagger: "2.0"` -> kind='swagger-2'.
 *  3. YAML shape-based (info.title + info.version + paths, no openapi/swagger key) -> kind='shape-based'.
 *  4. Random YAML config file -> kind=null.
 *  5. Malformed YAML -> kind=null (no throw).
 */

import { isOasSpecFile } from '../services/findings/packFindingScanners/specFileLinker/signatureDetector';

describe('specFileLinker/signatureDetector', () => {
  it('Test 1: YAML with `openapi: 3.0.3` is detected as openapi-3', () => {
    const content = [
      'openapi: 3.0.3',
      'info:',
      "  title: 'PetStoreApi'",
      "  version: '1.0.0'",
      'paths: {}',
    ].join('\n');
    const result = isOasSpecFile('src/main/resources/openapi.yaml', content);
    expect(result.kind).toBe('openapi-3');
    expect(result.parsed).toBeDefined();
    expect((result.parsed as Record<string, unknown>).openapi).toBe('3.0.3');
  });

  it('Test 2: JSON with `swagger: "2.0"` is detected as swagger-2', () => {
    const content = JSON.stringify({
      swagger: '2.0',
      info: { title: 'LegacyApi', version: '1.0' },
      paths: {},
    });
    const result = isOasSpecFile(
      'src/main/resources/legacy.json',
      content,
      'json',
    );
    expect(result.kind).toBe('swagger-2');
    expect(result.parsed).toBeDefined();
    expect((result.parsed as Record<string, unknown>).swagger).toBe('2.0');
  });

  it('Test 3: YAML with info.title + info.version + paths and no openapi/swagger key is detected as shape-based', () => {
    const content = [
      'info:',
      "  title: 'ShapeOnly'",
      "  version: '2.0.1'",
      'paths:',
      '  /things:',
      '    get:',
      "      summary: 'list things'",
    ].join('\n');
    const result = isOasSpecFile('src/main/resources/api.yml', content);
    expect(result.kind).toBe('shape-based');
    expect(result.parsed).toBeDefined();
    const parsed = result.parsed as Record<string, unknown>;
    expect((parsed.info as Record<string, unknown>).title).toBe('ShapeOnly');
  });

  it('Test 4: random YAML config file returns kind=null', () => {
    const content = [
      "name: 'my-app'",
      'replicas: 3',
      'envs:',
      "  - 'production'",
      "  - 'staging'",
    ].join('\n');
    const result = isOasSpecFile('src/main/resources/values.yaml', content);
    expect(result.kind).toBeNull();
    expect(result.parsed).toBeUndefined();
  });

  it('Test 5: malformed YAML returns kind=null without throwing', () => {
    // Mismatched indentation / illegal token.
    const content = ['openapi: 3.0.3', '  : :: invalid:::', '\t  bad'].join(
      '\n',
    );
    let result: ReturnType<typeof isOasSpecFile> | undefined;
    expect(() => {
      result = isOasSpecFile('src/main/resources/broken.yaml', content);
    }).not.toThrow();
    expect(result?.kind).toBeNull();
  });

  it('Test 5b: malformed JSON returns kind=null without throwing', () => {
    const content = '{ "openapi": "3.0.3", "info": { ';
    let result: ReturnType<typeof isOasSpecFile> | undefined;
    expect(() => {
      result = isOasSpecFile('src/main/resources/broken.json', content, 'json');
    }).not.toThrow();
    expect(result?.kind).toBeNull();
  });
});
