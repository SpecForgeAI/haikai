/**
 * Tests for `wadlParser.ts` (Spec 2026-05-21 WADL Deterministic Parser,
 * Task Group 2).
 *
 * Coverage (per tasks.md 2.1):
 *  1. parsesAnonymisedJerseyFixture           -- end-to-end happy path on the
 *                                                anonymised Jersey 1.16 sample,
 *                                                with sibling XSD wired into
 *                                                `opts.relatedFiles`.
 *  2. unsupportedNamespaceReturnsParseError   -- namespace gate rejects non-WADL
 *                                                root namespaces cleanly.
 *  3. malformedXmlSoftFails                   -- `fast-xml-parser` throws are
 *                                                caught; result carries
 *                                                `parseError: 'malformed_xml'`.
 *  4. allFourParamStylesParsed                -- template / query / header /
 *                                                matrix all surface with their
 *                                                correct `style` value.
 *  5. nestedResourceFlattening                -- synthetic `/a/b/c` nesting
 *                                                flattens correctly against
 *                                                the outer `<resources base>`.
 *  6. grammarMissEmitsMissingGrammar          -- unresolved `<include href>`
 *                                                lands on `missingGrammars`.
 *  7. representationRefMissEmitsMissingSchemaElement
 *                                             -- unresolved `element=` ref
 *                                                lands on
 *                                                `missingSchemaElements`.
 *  8. docCarryThrough                         -- application-level + method-
 *                                                level `<doc>` flow into
 *                                                interface.doc + operation.doc;
 *                                                also exercises the
 *                                                param-type fallback rules.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseWadl } from '../wadlParser';
import {
  WRONG_NAMESPACE_WADL,
  MALFORMED_XML,
  WADL_WITH_PARAM_STYLES_ALL_FOUR,
} from '../../../../../__tests__/fixtures/wadl/edgeCases';

const FIXTURE_WADL_PATH = path.resolve(
  __dirname,
  '../../../../../__tests__/fixtures/wadl/samplesvc.wadl',
);
const FIXTURE_XSD_PATH = path.resolve(
  __dirname,
  '../../../../../__tests__/fixtures/wadl/xsd0.xsd',
);

describe('wadlParser -- anonymised Jersey fixture', () => {
  it('parses the anonymised Jersey fixture with sibling XSD resolution', () => {
    const source = fs.readFileSync(FIXTURE_WADL_PATH, 'utf8');
    const xsd = fs.readFileSync(FIXTURE_XSD_PATH, 'utf8');
    const relatedFiles = new Map<string, string>();
    relatedFiles.set('xsd0.xsd', xsd);

    const result = parseWadl(source, {
      sourceFilePath: 'src/main/resources/samplesvc.wadl',
      relatedFiles,
    });

    expect(result.parseError).toBeUndefined();
    expect(result.interfaces).toHaveLength(1);
    expect(result.interfaces[0].applicationTitle).toBe('SampleSvc Service Version');
    expect(result.interfaces[0].version).toBe('1.6.4');
    expect(result.interfaces[0].grammarPaths).toEqual(['xsd0.xsd']);

    // Four methods across two nested resource trees.
    expect(result.operations.length).toBeGreaterThanOrEqual(4);

    const compositeIds = result.operations.map((o) => o.compositeId);
    expect(compositeIds).toContain('POST /hierarchynodes/{grdOrgId}');
    expect(compositeIds).toContain('GET /hierarchynodes/{grdOrgId}');
    expect(compositeIds).toContain('GET /refdata/{lookupKey}');
    expect(compositeIds).toContain('PUT /refdata/{lookupKey}');

    // The POST operation should carry the template-param (inherited from the
    // parent <resource>) plus the four header params on the <request>.
    const postOp = result.operations.find(
      (o) => o.compositeId === 'POST /hierarchynodes/{grdOrgId}',
    );
    expect(postOp).toBeDefined();
    const paramNames = postOp!.params.map((p) => p.name).sort();
    expect(paramNames).toContain('grdOrgId');
    expect(paramNames).toContain('system');
    expect(paramNames).toContain('userName');
    expect(postOp!.baseUrl).toBe('http://example.invalid:8080/samplesvc/');

    // Representations should be resolved against the sibling XSD index.
    const reqReps = postOp!.request.representations;
    expect(reqReps.length).toBeGreaterThanOrEqual(2);
    expect(reqReps[0].schemaElementRef).toBe('filteredHierarchyRequestInfo');
    expect(reqReps[0].resolvedSchemaElementName).toBe('filteredHierarchyRequestInfo');
    const respReps = postOp!.response.representations;
    expect(respReps.length).toBeGreaterThanOrEqual(2);
    expect(respReps[0].resolvedSchemaElementName).toBe('nodeResponse');

    // No missing schema elements when every ref resolves.
    expect(result.missingSchemaElements).toEqual([]);
    expect(result.missingGrammars).toEqual([]);
  });
});

describe('wadlParser -- namespace gating', () => {
  it('returns parseError "unsupported_wadl_namespace" for a non-WADL root namespace', () => {
    const result = parseWadl(WRONG_NAMESPACE_WADL);
    expect(result.parseError).toBe('unsupported_wadl_namespace');
    expect(result.operations).toEqual([]);
    expect(result.interfaces).toEqual([]);
  });
});

describe('wadlParser -- soft-fail behaviour', () => {
  it('returns parseError "malformed_xml" on broken XML and never throws', () => {
    let threw = false;
    let result;
    try {
      result = parseWadl(MALFORMED_XML);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(result).toBeDefined();
    expect(result!.parseError).toBe('malformed_xml');
    expect(result!.operations).toEqual([]);
  });
});

describe('wadlParser -- parameter styles', () => {
  it('parses all four <param> styles (template, query, header, matrix)', () => {
    const result = parseWadl(WADL_WITH_PARAM_STYLES_ALL_FOUR);
    expect(result.parseError).toBeUndefined();
    expect(result.operations).toHaveLength(1);
    const styles = result.operations[0].params.map((p) => p.style).sort();
    expect(styles).toEqual(['header', 'matrix', 'query', 'template']);
  });
});

describe('wadlParser -- nested resource flattening', () => {
  it('concatenates nested <resource> paths into the operation path', () => {
    const wadl = `<?xml version="1.0" encoding="UTF-8"?>
<application xmlns="http://wadl.dev.java.net/2009/02">
    <resources base="http://example.invalid/api/">
        <resource path="/a">
            <resource path="/b">
                <resource path="/c">
                    <method id="getABC" name="GET"/>
                </resource>
            </resource>
        </resource>
    </resources>
</application>`;
    const result = parseWadl(wadl);
    expect(result.parseError).toBeUndefined();
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].path).toBe('/a/b/c');
    expect(result.operations[0].compositeId).toBe('GET /a/b/c');
    expect(result.operations[0].baseUrl).toBe('http://example.invalid/api/');
  });
});

describe('wadlParser -- grammar resolution miss', () => {
  it('appends unresolved <include href> entries to missingGrammars', () => {
    const wadl = `<?xml version="1.0" encoding="UTF-8"?>
<application xmlns="http://wadl.dev.java.net/2009/02">
    <grammars>
        <include href="missing.xsd"/>
    </grammars>
    <resources base="http://example.invalid/api/">
        <resource path="/x">
            <method id="getX" name="GET"/>
        </resource>
    </resources>
</application>`;
    const result = parseWadl(wadl, { relatedFiles: new Map() });
    expect(result.parseError).toBeUndefined();
    expect(result.missingGrammars).toEqual(['missing.xsd']);
  });
});

describe('wadlParser -- representation ref miss', () => {
  it('appends unresolved element refs to missingSchemaElements', () => {
    const wadl = `<?xml version="1.0" encoding="UTF-8"?>
<application xmlns="http://wadl.dev.java.net/2009/02">
    <grammars>
        <include href="g.xsd"/>
    </grammars>
    <resources base="http://example.invalid/api/">
        <resource path="/x">
            <method id="getX" name="GET">
                <response>
                    <representation element="DoesNotExist" mediaType="application/xml"/>
                </response>
            </method>
        </resource>
    </resources>
</application>`;
    const xsd = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
    <xs:element name="SomethingElse" type="xs:string"/>
</xs:schema>`;
    const relatedFiles = new Map<string, string>();
    relatedFiles.set('g.xsd', xsd);
    const result = parseWadl(wadl, { relatedFiles });

    expect(result.parseError).toBeUndefined();
    expect(result.missingGrammars).toEqual([]);
    expect(result.missingSchemaElements).toHaveLength(1);
    expect(result.missingSchemaElements[0].ref).toBe('DoesNotExist');
    expect(result.missingSchemaElements[0].sourceOperationId).toBe('GET /x');
  });
});

describe('wadlParser -- doc carry-through and param-type fallback', () => {
  it('concatenates <doc> blocks; missing/blank type -> "unknown"; unrecognised type kept verbatim', () => {
    const wadl = `<?xml version="1.0" encoding="UTF-8"?>
<application xmlns="http://wadl.dev.java.net/2009/02">
    <doc title="DocSvc">App-level documentation text.</doc>
    <resources base="http://example.invalid/api/">
        <resource path="/x">
            <doc>Resource-level docs.</doc>
            <method id="getX" name="GET">
                <doc>Method-level docs.</doc>
                <request>
                    <param name="missingType" style="query"/>
                    <param name="blankType" style="query" type=""/>
                    <param name="customType" style="query" type="customNs:Foo"/>
                </request>
            </method>
        </resource>
    </resources>
</application>`;
    const result = parseWadl(wadl);
    expect(result.parseError).toBeUndefined();
    expect(result.interfaces[0].doc).toContain('DocSvc');
    expect(result.interfaces[0].doc).toContain('App-level documentation text.');
    const op = result.operations[0];
    expect(op.doc).toBeTruthy();
    expect(op.doc).toContain('Resource-level docs.');
    expect(op.doc).toContain('Method-level docs.');
    const byName = new Map(op.params.map((p) => [p.name, p]));
    expect(byName.get('missingType')!.type).toBe('unknown');
    expect(byName.get('blankType')!.type).toBe('unknown');
    expect(byName.get('customType')!.type).toBe('customNs:Foo');
  });
});
