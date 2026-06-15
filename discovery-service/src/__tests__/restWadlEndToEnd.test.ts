/**
 * End-to-end fixture tests for the REST WADL pack (Spec 2026-05-21 WADL
 * Deterministic Parser, Task Group 6).
 *
 * Mirrors the convention of `springClassicSoapEndToEndFixtures.test.ts`:
 * sits at the top-level `__tests__/` directory, loads canonical fixtures
 * from `__tests__/fixtures/wadl/`, and drives the pack end-to-end through
 * the public orchestrator (`runRestWadlPass`) plus the scanner-level wrapper
 * (`runSpringClassicScannerWithSoap`) so coexistence with the SOAP peer
 * pass is verified at the integration boundary.
 *
 * Test coverage (per tasks.md 6.1):
 *  1. `runRestWadlPass` end-to-end on the canonical Jersey fixture
 *     (samplesvc.wadl + xsd0.xsd):
 *       - one `interface_definition` finding,
 *       - >=4 `endpoint` findings (4 ops in the fixture),
 *       - each endpoint carries the documented `compositeId` shape,
 *       - representations resolve against the sibling XSD (no
 *         `wadl_missing_schema_element` gap),
 *       - emission order: interface first -> endpoints in document order
 *         -> no gap findings (fixture is clean).
 *  2. Same fixture driven through `runSpringClassicScannerWithSoap` to
 *     prove peer-pass coexistence: WADL findings land in `wadlFindings`,
 *     SOAP candidates / SOAP findings remain empty (no SOAP signals in the
 *     fixture), both passes run side-by-side without cross-talk.
 *  3. Missing-grammar end-to-end: WADL present, sibling XSD NOT in the IR
 *     map -> exactly one `wadl_missing_grammar` gap finding emitted,
 *     plus a `wadl_missing_schema_element` gap per unresolved
 *     representation ref (the parser cannot index any element without the
 *     grammar source).
 *
 * Task Group 7 -- Strategic gap-fill tests (10 tests appended below).
 * These cover real coverage gaps identified during the Group 7 cross-layer
 * review (see `agent-os/specs/2026-05-21-wadl-deterministic-parser/
 * verifications/cross-layer-coverage.md`). Each test targets a specific
 * behaviour NOT exercised by the 27 unit / 3 e2e tests above.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SourceFileIR } from '../services/extensionPacks';
import type { PackFindingScannerInput } from '../services/findings/packFindingScanners';
import { runRestWadlPass } from '../services/findings/packFindingScanners/restWadl';
import { runSpringClassicScannerWithSoap } from '../services/findings/packFindingScanners/springClassicFindingScanner';
import { parseWadl } from '../services/findings/packFindingScanners/restWadl/wadlParser';
import { WADL_DOC_ONLY } from './fixtures/wadl/edgeCases';

const RUN_ID = 'run-wadl-e2e-001';

// ----------------------------------------------------------------------------
// Fixture paths (resolved from the test file's __dirname)
// ----------------------------------------------------------------------------

const FIXTURE_WADL_PATH = path.resolve(
  __dirname,
  './fixtures/wadl/samplesvc.wadl',
);
const FIXTURE_XSD_PATH = path.resolve(
  __dirname,
  './fixtures/wadl/xsd0.xsd',
);

// Repo-relative paths used as the IR `filePath` so the orchestrator's
// sibling-resolution variants find the XSD by basename.
const REPO_REL_WADL = 'src/main/resources/api/samplesvc.wadl';
const REPO_REL_XSD = 'src/main/resources/api/xsd0.xsd';

// ----------------------------------------------------------------------------
// IR helpers (mirror the SOAP end-to-end test's shape exactly)
// ----------------------------------------------------------------------------

function makeWadlIr(filePath: string, rawContent: string): SourceFileIR {
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

function makeInput(irs: SourceFileIR[]): PackFindingScannerInput {
  const irFiles = new Map<string, SourceFileIR>();
  for (const ir of irs) irFiles.set(ir.filePath, ir);
  return {
    runId: RUN_ID,
    irFiles,
    packCandidates: [],
  };
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('REST WADL pass -- end-to-end reference fixtures (Group 6)', () => {
  // =========================================================================
  // Fixture 1: full pipeline on the canonical Jersey fixture
  // =========================================================================
  it('drives the canonical fixture through runRestWadlPass: one interface + 4 endpoints in document order, no gaps', () => {
    const wadlSource = fs.readFileSync(FIXTURE_WADL_PATH, 'utf8');
    const xsdSource = fs.readFileSync(FIXTURE_XSD_PATH, 'utf8');
    const wadlIr = makeWadlIr(REPO_REL_WADL, wadlSource);
    const xsdIr = makeXsdIr(REPO_REL_XSD, xsdSource);

    const result = runRestWadlPass(makeInput([wadlIr, xsdIr]));

    // Findings partition by type.
    const interfaceFindings = result.findings.filter(
      (f) => f.findingType === 'interface_definition',
    );
    const endpointFindings = result.findings.filter(
      (f) => f.findingType === 'endpoint',
    );
    const gapFindings = result.findings.filter(
      (f) => f.findingType === 'evidence_gap',
    );

    expect(interfaceFindings).toHaveLength(1);
    expect(endpointFindings.length).toBeGreaterThanOrEqual(4);

    // Each endpoint carries the documented `compositeId` shape
    // (`<METHOD> <path>` -- space-separated).
    const compositeIds = endpointFindings.map((f) => f.title);
    expect(compositeIds).toContain('POST /hierarchynodes/{grdOrgId}');
    expect(compositeIds).toContain('GET /hierarchynodes/{grdOrgId}');
    expect(compositeIds).toContain('GET /refdata/{lookupKey}');
    expect(compositeIds).toContain('PUT /refdata/{lookupKey}');

    // Representations resolved against the sibling XSD -- no
    // `wadl_missing_schema_element` gap should be emitted (the fixture's
    // XSD declares every referenced element).
    const missingElementGaps = gapFindings.filter((f) => {
      const d = f.detailJson as Record<string, unknown> | undefined;
      return d?.gapType === 'wadl_missing_schema_element';
    });
    expect(missingElementGaps).toEqual([]);

    // Likewise no `wadl_missing_grammar` gap (the sibling XSD is in the
    // IR map and resolves cleanly).
    const missingGrammarGaps = gapFindings.filter((f) => {
      const d = f.detailJson as Record<string, unknown> | undefined;
      return d?.gapType === 'wadl_missing_grammar';
    });
    expect(missingGrammarGaps).toEqual([]);

    // Fixture is clean: no gap findings at all.
    expect(gapFindings).toEqual([]);

    // At least one resolved representation surfaces on the endpoint detail
    // (proves the relatedFiles map was wired through to the parser).
    const anyResolved = endpointFindings.some((f) => {
      const detail = f.detailJson as
        | {
            request?: {
              representations?: Array<{ resolvedSchemaElementName: string | null }>;
            };
            response?: {
              representations?: Array<{ resolvedSchemaElementName: string | null }>;
            };
          }
        | undefined;
      const reqReps = detail?.request?.representations ?? [];
      const respReps = detail?.response?.representations ?? [];
      const allReps = [...reqReps, ...respReps];
      return allReps.some((r) => r.resolvedSchemaElementName != null);
    });
    expect(anyResolved).toBe(true);

    // Emission ordering (spec Q9): the FIRST finding for this file is the
    // interface_definition; the next N are endpoints; no gap interleaving.
    expect(result.findings[0].findingType).toBe('interface_definition');
    for (let i = 1; i <= endpointFindings.length; i += 1) {
      expect(result.findings[i].findingType).toBe('endpoint');
    }

    // Endpoint document order within the file: the first endpoint after
    // the interface should be the `POST /hierarchynodes/{grdOrgId}` (the
    // canonical fixture's first method element). The remaining order is
    // tested only by presence above, since the spec only mandates
    // document order, not a specific operation sort.
    expect(result.findings[1].title).toBe('POST /hierarchynodes/{grdOrgId}');
  });

  // =========================================================================
  // Fixture 2: scanner-level coexistence with the SOAP peer pass
  // =========================================================================
  it('drives the canonical fixture through runSpringClassicScannerWithSoap: WADL findings populate, SOAP outputs remain empty (no cross-talk)', () => {
    const wadlSource = fs.readFileSync(FIXTURE_WADL_PATH, 'utf8');
    const xsdSource = fs.readFileSync(FIXTURE_XSD_PATH, 'utf8');
    const wadlIr = makeWadlIr(REPO_REL_WADL, wadlSource);
    const xsdIr = makeXsdIr(REPO_REL_XSD, xsdSource);

    const result = runSpringClassicScannerWithSoap(makeInput([wadlIr, xsdIr]));

    // wadlFindings stream is populated (carries interface + endpoints).
    expect(result.wadlFindings.length).toBeGreaterThanOrEqual(5);
    const wadlInterfaces = result.wadlFindings.filter(
      (f) => f.findingType === 'interface_definition',
    );
    const wadlEndpoints = result.wadlFindings.filter(
      (f) => f.findingType === 'endpoint',
    );
    expect(wadlInterfaces).toHaveLength(1);
    expect(wadlEndpoints.length).toBeGreaterThanOrEqual(4);

    // SOAP outputs remain empty -- the WADL fixture exercises NO SOAP
    // signals (no .wsdl IR entries, no Java @WebService / @Endpoint
    // annotations), so the SOAP peer pass produces zero candidates and
    // zero SOAP findings. This proves the two passes run side-by-side
    // without cross-talk.
    expect(result.soapInterfaceCandidates).toEqual([]);
    expect(result.soapEndpointCandidates).toEqual([]);

    // The main `findings` stream (the REST + Spring-Classic emit path)
    // also produces no findings against a WADL-only IR -- the IR has no
    // Java sources, so no Java/Spring detection fires.
    expect(result.findings).toEqual([]);

    // SOAP diagnostics stream is also empty (no WSDL parse events).
    expect(result.soapDiagnostics).toEqual([]);
  });

  // =========================================================================
  // Fixture 3: missing-grammar end-to-end
  // =========================================================================
  it('emits wadl_missing_grammar AND wadl_missing_schema_element gaps when sibling XSD is absent from the IR map', () => {
    const wadlSource = fs.readFileSync(FIXTURE_WADL_PATH, 'utf8');
    // Deliberately omit the XSD IR entry so the parser cannot resolve
    // the `<include href="xsd0.xsd"/>` reference.
    const wadlIr = makeWadlIr(REPO_REL_WADL, wadlSource);

    const result = runRestWadlPass(makeInput([wadlIr]));

    const gapFindings = result.findings.filter(
      (f) => f.findingType === 'evidence_gap',
    );

    const missingGrammarGaps = gapFindings.filter((f) => {
      const d = f.detailJson as Record<string, unknown> | undefined;
      return d?.gapType === 'wadl_missing_grammar';
    });
    // Exactly one missing-grammar gap (one `<include href>` in the fixture).
    expect(missingGrammarGaps).toHaveLength(1);
    const gd = missingGrammarGaps[0].detailJson as Record<string, unknown>;
    expect(gd.ref).toBe('xsd0.xsd');
    expect(gd.sourceFilePath).toBe(REPO_REL_WADL);

    // Without a resolved grammar, every <representation element="..."> ref
    // in the WADL surfaces as a missing-element gap. The fixture has
    // multiple representations across 4 operations, so we expect AT LEAST
    // one such gap (exact count = sum of representations across all ops,
    // which is implementation-detail; presence is the contract).
    const missingElementGaps = gapFindings.filter((f) => {
      const d = f.detailJson as Record<string, unknown> | undefined;
      return d?.gapType === 'wadl_missing_schema_element';
    });
    expect(missingElementGaps.length).toBeGreaterThanOrEqual(1);

    // Each missing-element gap should carry a non-empty `ref` (the element
    // name) and a non-empty `sourceOperationId` (the operation that
    // referenced the element).
    for (const f of missingElementGaps) {
      const d = f.detailJson as Record<string, unknown>;
      expect(typeof d.ref).toBe('string');
      expect((d.ref as string).length).toBeGreaterThan(0);
      expect(typeof d.sourceOperationId).toBe('string');
      expect((d.sourceOperationId as string).length).toBeGreaterThan(0);
    }

    // Structural findings still emit (the parse itself succeeded -- the
    // missing grammar only impacts ref-resolution, not the WADL walk).
    const interfaceFindings = result.findings.filter(
      (f) => f.findingType === 'interface_definition',
    );
    const endpointFindings = result.findings.filter(
      (f) => f.findingType === 'endpoint',
    );
    expect(interfaceFindings).toHaveLength(1);
    expect(endpointFindings.length).toBeGreaterThanOrEqual(4);

    // Ordering (spec Q9): structural first, gaps last. Since the parser
    // emits one interface + N endpoints per file, gap findings should sit
    // strictly after all structural findings in the array.
    const lastStructuralIdx = result.findings.findIndex(
      (f) =>
        f.findingType !== 'interface_definition' &&
        f.findingType !== 'endpoint',
    );
    // The first non-structural finding (if any) must be at index >=
    // 1 + endpointCount (interface + all endpoints came first).
    if (lastStructuralIdx >= 0) {
      expect(lastStructuralIdx).toBeGreaterThanOrEqual(
        interfaceFindings.length + endpointFindings.length,
      );
    }
  });
});

// ============================================================================
// Task Group 7 -- Strategic gap-fill tests
// ============================================================================
// Coverage gaps identified during the Group 7 cross-layer review:
//   G7-1  Param `style` attribute missing entirely -> parser default behaviour
//   G7-2  Param `required` attribute parsing edge cases (true / false / absent)
//   G7-3  <resource> with NO <method> children -> interface + 0 endpoints
//   G7-4  <method> with NO <request>/<response> -> empty params/representations
//   G7-5  Multiple top-level <resources base="..."> blocks -> per-op baseUrl
//   G7-6  <doc> with nested elements -> text content folded; no crash
//   G7-7  Application-level <param> (shared across resources) -> v1 ignores
//   G7-8  <representation> without `element` -> schemaElementRef:null; no gap
//   G7-9  WADL_DOC_ONLY fixture (interface-only) -> 1 interface, 0 endpoints
//   G7-10 Scanner-level pack registration -- empty IR (no .wadl) produces
//         empty wadlFindings without disturbing SOAP / REST outputs.

describe('REST WADL pass -- Group 7 strategic gap-fill', () => {
  // =========================================================================
  // G7-1: param missing `style` attribute -> parser default to 'query'
  // =========================================================================
  it('G7-1: <param> with NO style attribute defaults to style="query" (parser fallback)', () => {
    const wadl = `<?xml version="1.0" encoding="UTF-8"?>
<application xmlns="http://wadl.dev.java.net/2009/02">
    <resources base="http://example.invalid/api/">
        <resource path="/items">
            <method id="getItems" name="GET">
                <request>
                    <param name="filter"/>
                </request>
            </method>
        </resource>
    </resources>
</application>`;
    const result = parseWadl(wadl);
    expect(result.parseError).toBeUndefined();
    expect(result.operations).toHaveLength(1);
    const params = result.operations[0].params;
    expect(params).toHaveLength(1);
    expect(params[0].name).toBe('filter');
    // The parser falls back to 'query' for missing / unrecognised style values
    // (see `readParams` in wadlParser.ts). This is a documented v1 behaviour;
    // a future spec change would surface unknown styles separately.
    expect(params[0].style).toBe('query');
  });

  // =========================================================================
  // G7-2: param required attribute parsing
  // =========================================================================
  it('G7-2: <param required="true|false|absent"> parses to boolean required field correctly', () => {
    const wadl = `<?xml version="1.0" encoding="UTF-8"?>
<application xmlns="http://wadl.dev.java.net/2009/02">
    <resources base="http://example.invalid/api/">
        <resource path="/items">
            <method id="getItems" name="GET">
                <request>
                    <param name="explicitTrue" style="query" required="true"/>
                    <param name="explicitFalse" style="query" required="false"/>
                    <param name="absent" style="query"/>
                </request>
            </method>
        </resource>
    </resources>
</application>`;
    const result = parseWadl(wadl);
    expect(result.parseError).toBeUndefined();
    const byName = new Map(result.operations[0].params.map((p) => [p.name, p]));
    expect(byName.get('explicitTrue')!.required).toBe(true);
    // Per the parser's `getAttr(p, 'required') === 'true'` check, ANY value
    // other than the literal string "true" yields `false`. This is the v1
    // contract -- `required="false"` is parsed as false, and missing
    // `required` is parsed as false (same behaviour).
    expect(byName.get('explicitFalse')!.required).toBe(false);
    expect(byName.get('absent')!.required).toBe(false);
  });

  // =========================================================================
  // G7-3: <resource> with NO <method> children
  // =========================================================================
  it('G7-3: <resource> with NO <method> children emits interface_definition but zero endpoints (no crash)', () => {
    const wadl = `<?xml version="1.0" encoding="UTF-8"?>
<application xmlns="http://wadl.dev.java.net/2009/02">
    <doc title="MethodlessSvc">Service with resources but no methods.</doc>
    <resources base="http://example.invalid/api/">
        <resource path="/orphan-a"/>
        <resource path="/orphan-b">
            <doc>This resource has docs but no methods.</doc>
        </resource>
    </resources>
</application>`;
    const wadlIr = makeWadlIr('src/main/resources/methodless.wadl', wadl);
    const result = runRestWadlPass(makeInput([wadlIr]));

    const interfaceFindings = result.findings.filter(
      (f) => f.findingType === 'interface_definition',
    );
    const endpointFindings = result.findings.filter(
      (f) => f.findingType === 'endpoint',
    );
    expect(interfaceFindings).toHaveLength(1);
    expect(endpointFindings).toEqual([]);
    // No spurious gap findings either -- a method-less resource is not an error.
    const gapFindings = result.findings.filter(
      (f) => f.findingType === 'evidence_gap',
    );
    expect(gapFindings).toEqual([]);
  });

  // =========================================================================
  // G7-4: <method> with NO <request> or <response>
  // =========================================================================
  it('G7-4: <method> with NO <request>/<response> emits endpoint with empty params/representations (no crash)', () => {
    const wadl = `<?xml version="1.0" encoding="UTF-8"?>
<application xmlns="http://wadl.dev.java.net/2009/02">
    <resources base="http://example.invalid/api/">
        <resource path="/health">
            <method id="ping" name="GET"/>
        </resource>
    </resources>
</application>`;
    const result = parseWadl(wadl);
    expect(result.parseError).toBeUndefined();
    expect(result.operations).toHaveLength(1);
    const op = result.operations[0];
    expect(op.compositeId).toBe('GET /health');
    expect(op.params).toEqual([]);
    expect(op.request.representations).toEqual([]);
    expect(op.response.representations).toEqual([]);
  });

  // =========================================================================
  // G7-5: multiple top-level <resources base="..."> blocks
  // =========================================================================
  it('G7-5: multi-<resources base> blocks emit endpoints with per-op baseUrl (spec Q6)', () => {
    const wadl = `<?xml version="1.0" encoding="UTF-8"?>
<application xmlns="http://wadl.dev.java.net/2009/02">
    <resources base="http://api-a.example.invalid/v1/">
        <resource path="/alpha">
            <method id="getAlpha" name="GET"/>
        </resource>
    </resources>
    <resources base="http://api-b.example.invalid/v2/">
        <resource path="/beta">
            <method id="getBeta" name="GET"/>
        </resource>
    </resources>
</application>`;
    const result = parseWadl(wadl);
    expect(result.parseError).toBeUndefined();
    expect(result.operations).toHaveLength(2);
    const byId = new Map(
      result.operations.map((o) => [o.compositeId, o]),
    );
    expect(byId.get('GET /alpha')!.baseUrl).toBe('http://api-a.example.invalid/v1/');
    expect(byId.get('GET /beta')!.baseUrl).toBe('http://api-b.example.invalid/v2/');
    // Spec Q6: one interface_definition per WADL file regardless of block
    // count -- the emitter test in `wadlEndpointEmitter.test.ts` covers that
    // path; here we confirm the parser still produces a single interface
    // entry for a multi-block file.
    expect(result.interfaces).toHaveLength(1);
  });

  // =========================================================================
  // G7-6: <doc> with nested elements (mixed content)
  // =========================================================================
  it('G7-6: <doc> with nested elements folds text content recursively; no crash', () => {
    // The parser's `collectTextContent` walks `#text` nodes recursively, so
    // nested elements inside <doc> contribute their text (without the
    // surrounding markup) to the interface/operation doc string.
    const wadl = `<?xml version="1.0" encoding="UTF-8"?>
<application xmlns="http://wadl.dev.java.net/2009/02">
    <doc title="NestedDocSvc">This is <em>important</em> text with <strong>emphasis</strong>.</doc>
    <resources base="http://example.invalid/api/">
        <resource path="/x">
            <method id="getX" name="GET">
                <doc>Method-level note <span>with span</span> tail.</doc>
            </method>
        </resource>
    </resources>
</application>`;
    const result = parseWadl(wadl);
    expect(result.parseError).toBeUndefined();
    expect(result.interfaces[0].doc).toBeTruthy();
    // The doc string must contain the leading text of the <doc> body even
    // when nested elements split the text run.
    expect(result.interfaces[0].doc).toContain('This is');
    expect(result.interfaces[0].doc).toContain('text with');
    // Method-level doc folds through similarly.
    const op = result.operations[0];
    expect(op.doc).toBeTruthy();
    expect(op.doc).toContain('Method-level note');
  });

  // =========================================================================
  // G7-7: application-level <param> (shared across resources) -- v1 ignores
  // =========================================================================
  it('G7-7: application-level <param> (shared) is NOT propagated to operations in v1', () => {
    // Per the WADL spec, `<application><param>` declares a parameter that
    // applies to every operation. The v1 parser's walker only reads <param>
    // under <resource>/<request> bodies, so the application-level param is
    // silently ignored. This test pins the v1 contract -- a future spec
    // change would broaden the walker; if so, this assertion needs an
    // update + spec amendment.
    const wadl = `<?xml version="1.0" encoding="UTF-8"?>
<application xmlns="http://wadl.dev.java.net/2009/02">
    <param name="apiKey" style="header" type="xs:string" required="true"/>
    <resources base="http://example.invalid/api/">
        <resource path="/x">
            <method id="getX" name="GET"/>
        </resource>
    </resources>
</application>`;
    const result = parseWadl(wadl);
    expect(result.parseError).toBeUndefined();
    expect(result.operations).toHaveLength(1);
    // No `apiKey` param should appear on the operation's params list --
    // confirms v1 ignores application-level <param>.
    const paramNames = result.operations[0].params.map((p) => p.name);
    expect(paramNames).not.toContain('apiKey');
  });

  // =========================================================================
  // G7-8: <representation> without `element` attribute
  // =========================================================================
  it('G7-8: <representation> with NO element attribute -> schemaElementRef=null; no missing-element gap', () => {
    const wadl = `<?xml version="1.0" encoding="UTF-8"?>
<application xmlns="http://wadl.dev.java.net/2009/02">
    <resources base="http://example.invalid/api/">
        <resource path="/x">
            <method id="getX" name="GET">
                <response>
                    <representation mediaType="text/plain"/>
                </response>
            </method>
        </resource>
    </resources>
</application>`;
    const result = parseWadl(wadl);
    expect(result.parseError).toBeUndefined();
    expect(result.operations).toHaveLength(1);
    const reps = result.operations[0].response.representations;
    expect(reps).toHaveLength(1);
    expect(reps[0].mediaType).toBe('text/plain');
    expect(reps[0].schemaElementRef).toBeNull();
    expect(reps[0].resolvedSchemaElementName).toBeNull();
    // No missing-element gap -- the parser only records a miss when a ref
    // exists but is unresolved. Absence-of-ref is not a gap.
    expect(result.missingSchemaElements).toEqual([]);
  });

  // =========================================================================
  // G7-9: WADL_DOC_ONLY edge-case fixture -- interface-only WADL
  // =========================================================================
  it('G7-9: WADL_DOC_ONLY (interface-only, no <resources>) emits exactly 1 interface_definition and 0 endpoints', () => {
    const wadlIr = makeWadlIr('src/main/resources/doc-only.wadl', WADL_DOC_ONLY);
    const result = runRestWadlPass(makeInput([wadlIr]));

    const interfaceFindings = result.findings.filter(
      (f) => f.findingType === 'interface_definition',
    );
    const endpointFindings = result.findings.filter(
      (f) => f.findingType === 'endpoint',
    );
    const gapFindings = result.findings.filter(
      (f) => f.findingType === 'evidence_gap',
    );
    expect(interfaceFindings).toHaveLength(1);
    expect(endpointFindings).toEqual([]);
    expect(gapFindings).toEqual([]);
    // The interface finding's title comes from `applicationTitle` -- the
    // fixture sets it to "DocOnly Service".
    expect(interfaceFindings[0].title).toBe('DocOnly Service');
  });

  // =========================================================================
  // G7-10: scanner-level pack registration -- empty IR
  // =========================================================================
  it('G7-10: runSpringClassicScannerWithSoap on an IR with NO .wadl files returns empty wadlFindings without disturbing peer passes', () => {
    // Empty IR: the WADL pack should run, log the `start files=0` line,
    // and return zero findings -- without disturbing the SOAP / REST peers.
    const result = runSpringClassicScannerWithSoap({
      runId: RUN_ID,
      irFiles: new Map<string, SourceFileIR>(),
      packCandidates: [],
    });
    expect(result.wadlFindings).toEqual([]);
    expect(result.soapInterfaceCandidates).toEqual([]);
    expect(result.soapEndpointCandidates).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.soapDiagnostics).toEqual([]);
  });
});
