/**
 * Tests for `wadlEndpointEmitter.ts` (Spec 2026-05-21 WADL Deterministic
 * Parser, Task Group 3).
 *
 * Coverage (per tasks.md 3.1):
 *  1. happyPathInterfacePlusEndpoints -- 1 interface + 3 operations produces
 *     1 `interface_definition` + 3 `endpoint` findings in correct order.
 *  2. skipsInterfaceWhenParseErrorSet -- `parseError` populated -> NO
 *     findings emitted (the gap emitter owns that case).
 *  3. descriptionCarryThrough -- operation `doc` flows through to the
 *     finding's `summary`.
 *  4. payloadShape -- `detailJson` carries the documented envelope keys for
 *     both interface and endpoint findings.
 *  5. nullDescriptionTolerance -- `doc: null` on an operation -> the
 *     resulting finding's `summary` is undefined (omitted from the input;
 *     the emitter does NOT inject `null`).
 *  6. emptyOperationsList -- a parse result with 1 interface but 0
 *     operations emits only the `interface_definition` finding.
 */

import { emitWadlFindings } from '../wadlEndpointEmitter';
import type {
  WadlInterface,
  WadlOperation,
  WadlParseResult,
} from '../wadlParser';

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function makeInterface(overrides: Partial<WadlInterface> = {}): WadlInterface {
  return {
    applicationTitle: 'SampleSvc Service Version 1.0',
    version: '1.0',
    doc: 'Sample service.',
    grammarPaths: ['xsd0.xsd'],
    ...overrides,
  };
}

function makeOperation(overrides: Partial<WadlOperation> = {}): WadlOperation {
  return {
    compositeId: 'GET /items',
    methodId: 'getItems',
    httpMethod: 'GET',
    path: '/items',
    baseUrl: 'http://example.invalid/api/',
    params: [],
    request: { representations: [] },
    response: { representations: [] },
    doc: null,
    ...overrides,
  };
}

function makeParseResult(overrides: Partial<WadlParseResult> = {}): WadlParseResult {
  return {
    interfaces: [makeInterface()],
    operations: [],
    missingGrammars: [],
    missingSchemaElements: [],
    ...overrides,
  };
}

const CONTEXT = {
  sourceFilePath: 'src/main/resources/sample.wadl',
  runId: 'run-1',
  projectId: 'proj-1',
  architectureId: 'arch-1',
};

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('wadlEndpointEmitter -- happy path', () => {
  test('emits one interface_definition + N endpoint findings in document order', () => {
    const parseResult = makeParseResult({
      operations: [
        makeOperation({ compositeId: 'GET /items', methodId: 'getItems' }),
        makeOperation({
          compositeId: 'POST /items',
          methodId: 'createItem',
          httpMethod: 'POST',
          path: '/items',
        }),
        makeOperation({
          compositeId: 'GET /items/{itemId}',
          methodId: 'getItem',
          httpMethod: 'GET',
          path: '/items/{itemId}',
        }),
      ],
    });

    const findings = emitWadlFindings(parseResult, CONTEXT);

    expect(findings).toHaveLength(4);
    expect(findings[0].findingType).toBe('interface_definition');
    expect(findings[1].findingType).toBe('endpoint');
    expect(findings[2].findingType).toBe('endpoint');
    expect(findings[3].findingType).toBe('endpoint');
    expect(findings[1].title).toBe('GET /items');
    expect(findings[2].title).toBe('POST /items');
    expect(findings[3].title).toBe('GET /items/{itemId}');
  });
});

describe('wadlEndpointEmitter -- parseError handling', () => {
  test('skips structural emission entirely when parseError is set', () => {
    const parseResult = makeParseResult({
      parseError: 'malformed_xml',
      interfaces: [],
      operations: [],
    });

    const findings = emitWadlFindings(parseResult, CONTEXT);

    expect(findings).toHaveLength(0);
  });

  test('skips structural emission when parseError is set even if interfaces array is populated', () => {
    // Defensive: parse result with `parseError` set must not leak an
    // interface finding even if the parser populated `interfaces` for some
    // reason. The gap emitter owns the failure surface.
    const parseResult = makeParseResult({
      parseError: 'unsupported_wadl_namespace',
      interfaces: [makeInterface()],
      operations: [makeOperation()],
    });

    const findings = emitWadlFindings(parseResult, CONTEXT);

    expect(findings).toHaveLength(0);
  });
});

describe('wadlEndpointEmitter -- description carry-through', () => {
  test('operation doc flows into the endpoint finding summary', () => {
    const parseResult = makeParseResult({
      operations: [
        makeOperation({
          compositeId: 'POST /items',
          doc: 'fetches X',
        }),
      ],
    });

    const findings = emitWadlFindings(parseResult, CONTEXT);

    const endpointFinding = findings.find((f) => f.findingType === 'endpoint');
    expect(endpointFinding).toBeDefined();
    expect(endpointFinding!.summary).toBe('fetches X');
  });

  test('interface doc flows into the interface_definition finding summary', () => {
    const parseResult = makeParseResult({
      interfaces: [
        makeInterface({ doc: 'sample interface description text' }),
      ],
    });

    const findings = emitWadlFindings(parseResult, CONTEXT);

    const interfaceFinding = findings.find(
      (f) => f.findingType === 'interface_definition',
    );
    expect(interfaceFinding).toBeDefined();
    expect(interfaceFinding!.summary).toBe('sample interface description text');
  });
});

describe('wadlEndpointEmitter -- payload shape', () => {
  test('interface_definition detailJson carries format/version/grammarPaths/sourceFilePath', () => {
    const parseResult = makeParseResult({
      interfaces: [
        makeInterface({
          applicationTitle: 'SampleSvc',
          version: '2.5',
          grammarPaths: ['xsd0.xsd', 'xsd1.xsd'],
        }),
      ],
    });

    const findings = emitWadlFindings(parseResult, CONTEXT);

    const iface = findings[0];
    expect(iface.findingType).toBe('interface_definition');
    expect(iface.title).toBe('SampleSvc');
    expect(iface.detailJson).toMatchObject({
      format: 'wadl',
      version: '2.5',
      grammarPaths: ['xsd0.xsd', 'xsd1.xsd'],
      sourceFilePath: CONTEXT.sourceFilePath,
    });
  });

  test('endpoint detailJson carries the documented envelope keys', () => {
    const params = [
      { name: 'grdOrgId', style: 'template' as const, type: 'xs:string', required: true },
      { name: 'system', style: 'header' as const, type: 'xs:string', required: false },
    ];
    const requestRep = {
      mediaType: 'application/json',
      schemaElementRef: 'filteredHierarchyRequestInfo',
      resolvedSchemaElementName: 'filteredHierarchyRequestInfo',
    };
    const responseRep = {
      mediaType: 'application/json',
      schemaElementRef: 'nodeResponse',
      resolvedSchemaElementName: null,
    };
    const parseResult = makeParseResult({
      operations: [
        makeOperation({
          compositeId: 'POST /hierarchynodes/{grdOrgId}',
          methodId: 'getHierarchyForOrgId',
          httpMethod: 'POST',
          path: '/hierarchynodes/{grdOrgId}',
          baseUrl: 'http://localhost:8080/samplesvc/',
          params,
          request: { representations: [requestRep] },
          response: { representations: [responseRep] },
          sourceLine: 42,
        }),
      ],
    });

    const findings = emitWadlFindings(parseResult, CONTEXT);

    const ep = findings.find((f) => f.findingType === 'endpoint');
    expect(ep).toBeDefined();
    expect(ep!.title).toBe('POST /hierarchynodes/{grdOrgId}');
    const dj = ep!.detailJson as Record<string, unknown>;
    expect(dj.protocol).toBe('rest');
    expect(dj.method).toBe('POST');
    expect(dj.path).toBe('/hierarchynodes/{grdOrgId}');
    expect(dj.baseUrl).toBe('http://localhost:8080/samplesvc/');
    expect(dj.methodId).toBe('getHierarchyForOrgId');
    expect(dj.params).toEqual(params);
    expect(dj.request).toEqual({ representations: [requestRep] });
    expect(dj.response).toEqual({ representations: [responseRep] });
    expect(dj.sourceFilePath).toBe(CONTEXT.sourceFilePath);
    expect(dj.sourceLine).toBe(42);
  });
});

describe('wadlEndpointEmitter -- null description tolerance', () => {
  test('operation with doc=null produces a finding whose summary is undefined (key omitted)', () => {
    const parseResult = makeParseResult({
      operations: [makeOperation({ doc: null })],
    });

    const findings = emitWadlFindings(parseResult, CONTEXT);

    const ep = findings.find((f) => f.findingType === 'endpoint');
    expect(ep).toBeDefined();
    // The emitter passes `doc ?? undefined`, so `summary` is omitted from the
    // input object rather than carrying an explicit null.
    expect(ep!.summary).toBeUndefined();
  });
});

describe('wadlEndpointEmitter -- empty operations list', () => {
  test('1 interface + 0 operations -> only the interface_definition finding', () => {
    const parseResult = makeParseResult({ operations: [] });

    const findings = emitWadlFindings(parseResult, CONTEXT);

    expect(findings).toHaveLength(1);
    expect(findings[0].findingType).toBe('interface_definition');
  });

  test('falls back to filename without extension when applicationTitle is missing', () => {
    const parseResult = makeParseResult({
      interfaces: [makeInterface({ applicationTitle: null })],
    });

    const findings = emitWadlFindings(parseResult, CONTEXT);

    expect(findings[0].findingType).toBe('interface_definition');
    expect(findings[0].title).toBe('sample');
  });
});
