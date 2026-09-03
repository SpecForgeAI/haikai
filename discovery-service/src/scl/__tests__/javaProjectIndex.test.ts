/**
 * SCL Java project index tests — real tree-sitter parse of the fixture
 * legacy app (src/scl/__tests__/fixtures/legacy-app).
 *
 * Parse-heavy suite: goes through the process-scoped tree-sitter binding
 * (custom Jest environment injects the worker-singleton), so it is safe in
 * combined runs; run via `npm test -- --testPathPattern=scl`.
 */

import * as path from 'path';
import { indexJavaProject, type JavaProjectIndex } from '../javaProjectIndex';

const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'legacy-app');

describe('indexJavaProject (fixture legacy app)', () => {
  let index: JavaProjectIndex;

  beforeAll(async () => {
    index = await indexJavaProject(FIXTURE_ROOT);
  });

  it('parses the whole fixture tree with zero parse errors', () => {
    expect(index.parseErrors).toEqual([]);
  });

  it('indexes every class / interface / enum (annotation types excluded)', () => {
    // 20 .java files, of which 2 are @interface aspect definitions (not
    // classes) => 18 indexed project types.
    expect(index.classesByFqn.size).toBe(18);
    const expected = [
      'com.legacy.hier.api.ViewResource',
      'com.legacy.hier.api.NodeResource',
      'com.legacy.hier.provider.HierarchyViewProvider',
      'com.legacy.hier.provider.ViewCache',
      'com.legacy.hier.provider.ViewEnricher',
      'com.legacy.hier.dao.ViewDao',
      'com.legacy.hier.service.NodeService',
      'com.legacy.hier.service.NodeServiceImpl',
      'com.legacy.hier.service.CachingNodeServiceImpl',
      'com.legacy.hier.model.HierarchyViewDetail',
      'com.legacy.hier.model.FilterCriteria',
      'com.legacy.hier.model.ResponseEnvelope',
      'com.legacy.hier.model.ResponseCode',
      'com.legacy.hier.util.CookieUtils',
      'com.legacy.hier.exception.ViewNotFoundException',
      'com.legacy.hier.exception.NoDataFoundException',
      'com.legacy.hier.jobs.NightlyRollupJob',
      'com.legacy.hier.orphan.LegacyImportTool',
    ];
    for (const fqn of expected) {
      expect(index.classesByFqn.has(fqn)).toBe(true);
    }
    // Aspect @interface definitions must NOT be indexed as classes.
    expect(index.classesByFqn.has('com.legacy.hier.aspect.ExecutionTimeLogging')).toBe(false);
    expect(index.classesByFqn.has('com.legacy.hier.aspect.AuditDbLogging')).toBe(false);
  });

  it('extracts ViewResource methods with annotations and parameter types', () => {
    const viewResource = index.classesByFqn.get('com.legacy.hier.api.ViewResource');
    expect(viewResource).toBeDefined();
    expect(viewResource!.kind).toBe('class');
    expect(viewResource!.annotations).toContain('@Path("/views")');

    const methodNames = viewResource!.methods.map((m) => m.name);
    expect(methodNames).toContain('getView');
    expect(methodNames).toContain('getAllViews');

    const getView = viewResource!.methods.find((m) => m.name === 'getView')!;
    expect(getView.annotations).toContain('@GET');
    expect(getView.annotations).toContain('@Path("/{viewId}")');
    expect(
      getView.annotations.some(
        (a) =>
          a.startsWith('@Produces') &&
          a.includes('MediaType.APPLICATION_JSON') &&
          a.includes('MediaType.APPLICATION_XML')
      )
    ).toBe(true);
    expect(getView.paramTypes).toEqual(['String', 'String', 'Integer', 'javax.ws.rs.core.HttpHeaders']);
    expect(getView.paramNames).toEqual(['system', 'ssoToken', 'viewId', 'headers']);
    expect(getView.returnType).toBe('javax.ws.rs.core.Response'); // FQ via the file's explicit import (2026-09-03)
    expect(getView.bodyNode).not.toBeNull();
    expect(getView.classFqn).toBe('com.legacy.hier.api.ViewResource');
    expect(getView.startLine).toBeGreaterThan(1);
    expect(getView.sourceText).toContain('CookieUtils.readSsoCookie');
  });

  it('indexes interfaces with body-less methods', () => {
    const nodeService = index.classesByFqn.get('com.legacy.hier.service.NodeService');
    expect(nodeService).toBeDefined();
    expect(nodeService!.kind).toBe('interface');
    const findNode = nodeService!.methods.find((m) => m.name === 'findNode');
    expect(findNode).toBeDefined();
    expect(findNode!.bodyNode).toBeNull();
  });

  it('implementationsOf(NodeService) returns both implementations (the dispatch-ambiguity fixture)', () => {
    const impls = index.implementationsOf('NodeService');
    expect(impls.map((c) => c.fqn)).toEqual([
      'com.legacy.hier.service.CachingNodeServiceImpl',
      'com.legacy.hier.service.NodeServiceImpl',
    ]);
    // Fully-qualified form resolves identically.
    const byFqn = index.implementationsOf('com.legacy.hier.service.NodeService');
    expect(byFqn.map((c) => c.fqn)).toEqual(impls.map((c) => c.fqn));
  });

  it('indexes enums with their constants', () => {
    const responseCode = index.classesByFqn.get('com.legacy.hier.model.ResponseCode');
    expect(responseCode).toBeDefined();
    expect(responseCode!.kind).toBe('enum');
    expect(responseCode!.fields.map((f) => f.name)).toEqual(['SUCCESS', 'NO_DATA_FOUND', 'FATAL']);
    expect(responseCode!.fields.every((f) => f.type === 'enum-constant')).toBe(true);
  });

  it('captures field modifiers and verbatim initializers (the Dao SQL constant)', () => {
    const dao = index.classesByFqn.get('com.legacy.hier.dao.ViewDao')!;
    const sqlField = dao.fields.find((f) => f.name === 'FIND_LATEST_SQL');
    expect(sqlField).toBeDefined();
    expect(sqlField!.modifiers).toEqual(expect.arrayContaining(['static', 'final']));
    expect(sqlField!.initializer).toBe(
      '"SELECT id, name, valid_from, valid_to FROM hier_view WHERE view_id = ? ORDER BY version DESC"'
    );
  });

  it('records config-reference reachability signals from resource files', () => {
    const entries = Array.from(index.configReferences.entries());
    const beans = entries.find(([p]) => p.endsWith('beans.xml'));
    expect(beans).toBeDefined();
    expect(beans![1]).toContain('com.legacy.hier.service.NodeServiceImpl');
  });

  it('stores file paths relative to the indexed root (portable cites)', () => {
    const dao = index.classesByFqn.get('com.legacy.hier.dao.ViewDao')!;
    expect(dao.filePath).toBe('src/main/java/com/legacy/hier/dao/ViewDao.java');
    expect(index.rootDir).toBe(FIXTURE_ROOT);
  });
});

describe('subclassesOf (2026-08-21 abstract-class dispatch expansion)', () => {
  let index: JavaProjectIndex;
  beforeAll(async () => {
    index = await indexJavaProject(FIXTURE_ROOT);
  });

  it('finds project classes extending a named base (simple or FQN form)', () => {
    const subs = index.subclassesOf('Exception').map((c) => c.simpleName);
    expect(subs).toEqual(['NoDataFoundException', 'ViewNotFoundException']);
  });

  it('returns [] for a base nothing extends, sorted deterministic otherwise', () => {
    expect(index.subclassesOf('com.legacy.hier.dao.ViewDao')).toEqual([]);
    const twice = index.subclassesOf('Exception').map((c) => c.fqn);
    expect(twice).toEqual([...twice].sort());
  });
});
