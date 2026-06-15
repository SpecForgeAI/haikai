/**
 * Tests for `restWadl/index.ts` orchestrator (Spec 2026-05-21 WADL
 * Deterministic Parser, Task Group 5).
 *
 * Coverage (per tasks.md 5.1, 3 focused cases):
 *  1. Empty IR (no `.wadl` files)        -- returns `{ findings: [] }`
 *                                            cleanly.
 *  2. Single WADL + sibling XSD          -- structural emissions land
 *                                            (interface + N endpoints with
 *                                            `resolvedSchemaElementName`
 *                                            populated) and NO
 *                                            `wadl_missing_schema_element`
 *                                            gaps.
 *  3. Two WADL files in same input       -- each produces its own interface
 *                                            and endpoints (no cross-file
 *                                            dedup -- spec Q5).
 *
 * The orchestrator is also exercised indirectly by the existing SOAP-wiring
 * integration tests (which now run the WADL pack alongside the SOAP pass
 * because `runSpringClassicScannerWithSoap` invokes both). The tests below
 * exercise `runRestWadlPass` directly to keep failure attribution clean.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SourceFileIR } from '../../../../extensionPacks';
import { runRestWadlPass } from '../index';

const RUN_ID = 'run-restWadl-index-001';

const FIXTURE_WADL_PATH = path.resolve(
  __dirname,
  '../../../../../__tests__/fixtures/wadl/samplesvc.wadl',
);
const FIXTURE_XSD_PATH = path.resolve(
  __dirname,
  '../../../../../__tests__/fixtures/wadl/xsd0.xsd',
);

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function makeWadlIr(filePath: string, rawContent: string): SourceFileIR {
  return {
    filePath,
    // `.wadl` IR entries are not produced by any language pack today; the
    // orchestrator picks them up by extension + rawContent presence.
    language: 'xml',
    packageOrNamespace: null,
    imports: [],
    classes: [],
    functions: [],
    rawContent,
  };
}

function makeXsdIr(filePath: string, rawContent: string): SourceFileIR {
  return {
    filePath,
    language: 'xml',
    packageOrNamespace: null,
    imports: [],
    classes: [],
    functions: [],
    rawContent,
  };
}

function makeJavaIr(filePath: string): SourceFileIR {
  // A minimal Java IR entry -- the WADL pack must IGNORE it cleanly.
  return {
    filePath,
    language: 'java',
    packageOrNamespace: 'com.example',
    imports: [],
    classes: [],
    functions: [],
    rawContent: 'package com.example; public class Foo {}\n',
  };
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('runRestWadlPass -- empty IR', () => {
  test('returns no findings when no .wadl files are present (Java-only IR)', () => {
    const javaIr = makeJavaIr('src/main/java/com/example/Foo.java');
    const irFiles = new Map<string, SourceFileIR>([
      [javaIr.filePath, javaIr],
    ]);

    const result = runRestWadlPass({
      runId: RUN_ID,
      irFiles,
      packCandidates: [],
    });

    expect(result.findings).toEqual([]);
  });
});

describe('runRestWadlPass -- single WADL with sibling XSD', () => {
  test('emits one interface_definition + N endpoint findings; representations resolve via sibling XSD', () => {
    const wadlSource = fs.readFileSync(FIXTURE_WADL_PATH, 'utf8');
    const xsdSource = fs.readFileSync(FIXTURE_XSD_PATH, 'utf8');

    // Place WADL + XSD in the same directory so the orchestrator's
    // sibling-resolution variants find the XSD by basename.
    const wadlIr = makeWadlIr(
      'src/main/resources/api/samplesvc.wadl',
      wadlSource,
    );
    const xsdIr = makeXsdIr(
      'src/main/resources/api/xsd0.xsd',
      xsdSource,
    );

    const irFiles = new Map<string, SourceFileIR>([
      [wadlIr.filePath, wadlIr],
      [xsdIr.filePath, xsdIr],
    ]);

    const result = runRestWadlPass({
      runId: RUN_ID,
      irFiles,
      packCandidates: [],
    });

    // One interface + at least four endpoints (the canonical Jersey fixture
    // ships POST + GET on /hierarchynodes/{grdOrgId} and GET + PUT on
    // /refdata/{lookupKey}).
    const interfaceFindings = result.findings.filter(
      (f) => f.findingType === 'interface_definition',
    );
    const endpointFindings = result.findings.filter(
      (f) => f.findingType === 'endpoint',
    );
    expect(interfaceFindings).toHaveLength(1);
    expect(endpointFindings.length).toBeGreaterThanOrEqual(4);

    // Ordering check (spec Q9): interface_definition first within the file's
    // block, then endpoints. Find the index range covering this file.
    const fileFindings = result.findings.filter((f) => {
      const d = f.detailJson as Record<string, unknown> | undefined;
      return d?.sourceFilePath === wadlIr.filePath;
    });
    expect(fileFindings[0]?.findingType).toBe('interface_definition');
    expect(fileFindings[1]?.findingType).toBe('endpoint');

    // Sibling XSD resolution: at least one `endpoint` finding should carry
    // a representation with `resolvedSchemaElementName` populated -- proves
    // the orchestrator's relatedFiles map was wired to the parser correctly.
    const anyResolved = endpointFindings.some((f) => {
      const detail = f.detailJson as
        | { request?: { representations?: Array<{ resolvedSchemaElementName: string | null }> } }
        | undefined;
      const reps = detail?.request?.representations ?? [];
      return reps.some((r) => r.resolvedSchemaElementName != null);
    });
    expect(anyResolved).toBe(true);

    // Conversely: NO `wadl_missing_schema_element` evidence_gap findings.
    const missingElementGaps = result.findings.filter((f) => {
      const d = f.detailJson as Record<string, unknown> | undefined;
      return f.findingType === 'evidence_gap' && d?.gapType === 'wadl_missing_schema_element';
    });
    expect(missingElementGaps).toEqual([]);

    // And NO `wadl_missing_grammar` gaps (the sibling XSD resolved cleanly).
    const missingGrammarGaps = result.findings.filter((f) => {
      const d = f.detailJson as Record<string, unknown> | undefined;
      return f.findingType === 'evidence_gap' && d?.gapType === 'wadl_missing_grammar';
    });
    expect(missingGrammarGaps).toEqual([]);
  });
});

describe('runRestWadlPass -- two WADL files in same input', () => {
  test('emits separate interface + endpoint findings per file (no cross-file dedup -- spec Q5)', () => {
    const wadlSource = fs.readFileSync(FIXTURE_WADL_PATH, 'utf8');
    const xsdSource = fs.readFileSync(FIXTURE_XSD_PATH, 'utf8');

    // Two WADL files at different paths, each with its own sibling XSD.
    const wadlAPath = 'src/main/resources/api-a/samplesvc.wadl';
    const wadlBPath = 'src/main/resources/api-b/samplesvc.wadl';
    const wadlA = makeWadlIr(wadlAPath, wadlSource);
    const wadlB = makeWadlIr(wadlBPath, wadlSource);
    const xsdA = makeXsdIr('src/main/resources/api-a/xsd0.xsd', xsdSource);
    const xsdB = makeXsdIr('src/main/resources/api-b/xsd0.xsd', xsdSource);

    const irFiles = new Map<string, SourceFileIR>([
      [wadlA.filePath, wadlA],
      [wadlB.filePath, wadlB],
      [xsdA.filePath, xsdA],
      [xsdB.filePath, xsdB],
    ]);

    const result = runRestWadlPass({
      runId: RUN_ID,
      irFiles,
      packCandidates: [],
    });

    // Two interface_definition findings, one per file.
    const interfaceFindings = result.findings.filter(
      (f) => f.findingType === 'interface_definition',
    );
    expect(interfaceFindings).toHaveLength(2);

    // Endpoints from each file land on distinct sourceFilePath values.
    const endpointFindings = result.findings.filter(
      (f) => f.findingType === 'endpoint',
    );
    const sourceFilePaths = new Set<string>();
    for (const f of endpointFindings) {
      const d = f.detailJson as { sourceFilePath?: string } | undefined;
      if (d?.sourceFilePath) sourceFilePaths.add(d.sourceFilePath);
    }
    expect(sourceFilePaths.has(wadlAPath)).toBe(true);
    expect(sourceFilePaths.has(wadlBPath)).toBe(true);

    // Endpoint count = 2x single-file count (no cross-file dedup).
    expect(endpointFindings.length).toBeGreaterThanOrEqual(8);
  });
});
