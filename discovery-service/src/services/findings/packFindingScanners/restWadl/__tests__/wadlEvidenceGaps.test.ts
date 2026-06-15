/**
 * Tests for `wadlEvidenceGaps.ts` (Spec 2026-05-21 WADL Deterministic
 * Parser, Task Group 4).
 *
 * Coverage (per tasks.md 4.1):
 *  1. parseErrorMalformedXmlEmitsWadlParseFailed
 *  2. parseErrorUnsupportedNamespaceEmitsWadlUnsupportedNamespace
 *  3. missingGrammarsEmitOnePerEntry
 *  4. missingSchemaElementsEmitWithSourceOperationId
 *  5. emissionSourcesContainsAllFourNewGapKinds (content-match against
 *     the registry file)
 */

import * as fs from 'fs';
import * as path from 'path';
import { emitWadlEvidenceGaps } from '../wadlEvidenceGaps';
import type { WadlParseResult } from '../wadlParser';

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function makeParseResult(overrides: Partial<WadlParseResult> = {}): WadlParseResult {
  return {
    interfaces: [],
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

describe('wadlEvidenceGaps -- parseError sentinels', () => {
  test('parseError=malformed_xml emits exactly one wadl_parse_failed gap', () => {
    const parseResult = makeParseResult({ parseError: 'malformed_xml' });

    const findings = emitWadlEvidenceGaps(parseResult, CONTEXT);

    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.findingType).toBe('evidence_gap');
    const dj = f.detailJson as Record<string, unknown>;
    expect(dj.gapType).toBe('wadl_parse_failed');
    expect(dj.sourceFilePath).toBe(CONTEXT.sourceFilePath);
    expect(dj.reason).toBe('malformed_xml');
  });

  test('parseError=unsupported_wadl_namespace emits exactly one wadl_unsupported_namespace gap', () => {
    const parseResult = makeParseResult({
      parseError: 'unsupported_wadl_namespace',
    });

    const findings = emitWadlEvidenceGaps(parseResult, CONTEXT);

    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.findingType).toBe('evidence_gap');
    const dj = f.detailJson as Record<string, unknown>;
    expect(dj.gapType).toBe('wadl_unsupported_namespace');
    expect(dj.sourceFilePath).toBe(CONTEXT.sourceFilePath);
  });
});

describe('wadlEvidenceGaps -- missingGrammars', () => {
  test('missingGrammars=[a.xsd, b.xsd] emits two wadl_missing_grammar findings (one per entry)', () => {
    const parseResult = makeParseResult({
      missingGrammars: ['a.xsd', 'b.xsd'],
    });

    const findings = emitWadlEvidenceGaps(parseResult, CONTEXT);

    expect(findings).toHaveLength(2);
    for (const f of findings) {
      expect(f.findingType).toBe('evidence_gap');
      const dj = f.detailJson as Record<string, unknown>;
      expect(dj.gapType).toBe('wadl_missing_grammar');
    }
    const refs = findings.map((f) => (f.detailJson as Record<string, unknown>).ref);
    expect(refs).toEqual(['a.xsd', 'b.xsd']);
  });
});

describe('wadlEvidenceGaps -- missingSchemaElements', () => {
  test('missingSchemaElements emits wadl_missing_schema_element with sourceOperationId carried through', () => {
    const parseResult = makeParseResult({
      missingSchemaElements: [
        { ref: 'missingElementA', sourceOperationId: 'POST /items' },
        { ref: 'missingElementB', sourceOperationId: 'GET /items/{id}' },
      ],
    });

    const findings = emitWadlEvidenceGaps(parseResult, CONTEXT);

    expect(findings).toHaveLength(2);
    const a = findings[0].detailJson as Record<string, unknown>;
    expect(a.gapType).toBe('wadl_missing_schema_element');
    expect(a.ref).toBe('missingElementA');
    expect(a.sourceOperationId).toBe('POST /items');
    const b = findings[1].detailJson as Record<string, unknown>;
    expect(b.gapType).toBe('wadl_missing_schema_element');
    expect(b.ref).toBe('missingElementB');
    expect(b.sourceOperationId).toBe('GET /items/{id}');
  });

  test('empty parse result -> zero findings (no spurious emissions)', () => {
    const parseResult = makeParseResult();

    const findings = emitWadlEvidenceGaps(parseResult, CONTEXT);

    expect(findings).toHaveLength(0);
  });
});

describe('emissionSources.ts gap-kind registration', () => {
  test('contains all four new WADL gap kinds in the EvidenceGapType union', () => {
    const emissionSourcesPath = path.resolve(
      __dirname,
      '../../../emissionSources.ts',
    );
    const content = fs.readFileSync(emissionSourcesPath, 'utf-8');

    // Each sentinel must appear in the type union exactly once. We assert
    // presence in the union by checking the `| '<sentinel>'` form is
    // present (the union prefixes each value with a pipe).
    expect(content).toMatch(/\|\s*'wadl_parse_failed'/);
    expect(content).toMatch(/\|\s*'wadl_unsupported_namespace'/);
    expect(content).toMatch(/\|\s*'wadl_missing_grammar'/);
    expect(content).toMatch(/\|\s*'wadl_missing_schema_element'/);

    // Sanity check: the centralised builder is exported.
    expect(content).toContain('export function buildWadlEvidenceGapFinding');
  });
});
