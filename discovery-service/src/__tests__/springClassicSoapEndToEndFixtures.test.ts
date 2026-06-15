/**
 * End-to-end fixture tests for the Spring Classic SOAP pass (Spec 2026-05-17
 * SOAP Discovery -- Spring Classic Phase 1, Task Group 12).
 *
 * Acceptance signal (per the raw idea): "the user's reference Spring Classic
 * SOAP service produces non-zero endpoint candidates that match the WSDL's
 * operation list 1:1 after this spec ships." Since the user has no local
 * service, the two public-reference fixtures stand in:
 *
 *  - `reference-jaxws-document-literal-wrapped.wsdl` -- JAX-WS document-
 *    literal-wrapped WSDL with one operation `greet`. Anchors Signal C and the
 *    Signal B + Signal C co-occurrence test.
 *  - `reference-spring-ws-countries.xsd` -- Spring-WS contract-first XSD with
 *    `getCountryRequest` / `getCountryResponse` top-level elements. Anchors
 *    Signal A paired with an inline `@Endpoint` Java fixture.
 *
 * Test coverage (per tasks.md 12.1, 6 fixtures):
 *  1. JAX-WS WSDL fixture -- single interface + endpoint candidate for `greet`,
 *     expected `request_root_element='greet'`, `response_root_element='greetResponse'`,
 *     `request_namespace='http://uniba.de/dsg/soa/'`, `wsdl_source` set.
 *  2. Spring-WS XSD + inline `@Endpoint` Java fixture -- interface + endpoint
 *     candidate with `request_root_element='getCountryRequest'`,
 *     `response_root_element='getCountryResponse'`,
 *     `request_namespace='https://spring.io/guides/gs-producing-web-service'`.
 *  3. Parent interface candidate carries `interface_type='SOAP_API'` in BOTH
 *     fixture tests.
 *  4. Servlet path unknown -- Spring-WS fixture WITHOUT `web.xml` ->
 *     `path_or_address=null` AND a paired `soap_endpoint_url_unknown`
 *     `evidence_gap` finding via `buildSoapEvidenceGapFindings`.
 *  5. Malformed WSDL (inline string) -- `wsdl_parse_failed` finding emitted
 *     via `buildSoapEvidenceGapFindings`, no candidate, scanner does NOT throw.
 *  6. A+C combined -- JAX-WS WSDL + matching `@WebService(name=...)` Java
 *     source -- D-2 precedence honoured end-to-end (no duplicate operations;
 *     WSDL wins for XML shapes; annotations win for DTO classes).
 *
 * Fixtures derived from public reference repos (per Q-6):
 *  - WSDL: `stefan-kolb/jaxws-samples` (document-literal-wrapped GreetingsService)
 *  - XSD: `spring-guides/gs-producing-web-service`
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SourceFileIR } from '../services/extensionPacks';
import type { PackFindingScannerInput } from '../services/findings/packFindingScanners';
import { runSpringClassicSoapPass } from '../services/findings/packFindingScanners/springClassicSoap';
import { buildSoapEvidenceGapFindings } from '../services/findings/packFindingScanners/springClassicSoap/soapEvidenceGaps';
import { parseWsdl } from '../services/findings/packFindingScanners/springClassicSoap/wsdlParser';

const RUN_ID = 'run-soap-e2e-fixtures-001';

// ----------------------------------------------------------------------------
// Fixture paths (resolved from the test file's __dirname)
// ----------------------------------------------------------------------------

const REFERENCE_WSDL_PATH = path.resolve(
  __dirname,
  '../../../agent-os/specs/2026-05-17-soap-discovery-spring-classic-phase-1/planning/visuals/reference-jaxws-document-literal-wrapped.wsdl',
);
const REFERENCE_XSD_PATH = path.resolve(
  __dirname,
  '../../../agent-os/specs/2026-05-17-soap-discovery-spring-classic-phase-1/planning/visuals/reference-spring-ws-countries.xsd',
);

// Repo-relative paths used as the WSDL/XSD fixture's `filePath` so the
// candidate's `wsdl_source` is a meaningful repo-relative path (not the
// absolute local-disk path).
const REPO_REL_WSDL = 'src/main/resources/wsdl/greetings.wsdl';
const REPO_REL_XSD = 'src/main/resources/xsd/countries.xsd';

// ----------------------------------------------------------------------------
// IR helpers
// ----------------------------------------------------------------------------

function makeJavaIr(filePath: string, rawContent: string): SourceFileIR {
  return {
    filePath,
    language: 'java',
    packageOrNamespace: 'com.example',
    imports: [],
    classes: [],
    functions: [],
    rawContent,
  };
}

function makeWsdlIr(filePath: string, rawContent: string): SourceFileIR {
  return {
    filePath,
    // `.wsdl` files are not produced by the Java language pack today; the
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
// Java fixtures
// ----------------------------------------------------------------------------

// Spring-WS @Endpoint paired with the reference XSD's namespace + localPart.
// Anchors Fixture 2.
const COUNTRY_ENDPOINT_JAVA = `
package com.example.svc;

import org.springframework.ws.server.endpoint.annotation.Endpoint;
import org.springframework.ws.server.endpoint.annotation.PayloadRoot;
import com.example.dto.GetCountryRequest;
import com.example.dto.GetCountryResponse;

@Endpoint
public class CountryEndpoint {
  @PayloadRoot(namespace = "https://spring.io/guides/gs-producing-web-service", localPart = "getCountryRequest")
  public GetCountryResponse getCountry(GetCountryRequest req) {
    return null;
  }
}
`;

// JAX-WS @WebService(name=...) matching the reference WSDL's portType name so
// the emitter's cross-merge collapses Signals B + C into a single record.
// Anchors Fixture 6 (A+C combined / D-2 precedence end-to-end).
const GREETINGS_SERVICE_JAVA = `
package com.example.greet;

import javax.jws.WebService;
import javax.jws.WebMethod;
import com.example.greet.dto.Greet;
import com.example.greet.dto.GreetResponse;

@WebService(name = "GreetingsPortType", targetNamespace = "http://uniba.de/dsg/soa/")
public class GreetingsServiceImpl {
  @WebMethod(operationName = "greet")
  public GreetResponse greet(Greet req) { return null; }
}
`;

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('Spring Classic SOAP pass -- end-to-end reference fixtures (Group 12)', () => {
  // =========================================================================
  // Fixture 1: JAX-WS WSDL in isolation -- Signal C only
  // =========================================================================
  it('Fixture 1: JAX-WS WSDL produces a single interface + a single endpoint candidate for `greet` with the documented field values', () => {
    const wsdlSource = fs.readFileSync(REFERENCE_WSDL_PATH, 'utf8');
    const wsdlIr = makeWsdlIr(REPO_REL_WSDL, wsdlSource);

    const result = runSpringClassicSoapPass(makeInput([wsdlIr]));

    // 1:1 mapping from the WSDL's single `greet` operation to a single
    // endpoint candidate.
    expect(result.interfaceCandidates).toHaveLength(1);
    expect(result.endpointCandidates).toHaveLength(1);

    const iface = result.interfaceCandidates[0];
    const ep = result.endpointCandidates[0];

    // Fixture 3 fold-in: parent interface is `SOAP_API` typed.
    expect(iface.candidateType).toBe('interfaces');
    expect(iface.data.interface_type).toBe('SOAP_API');

    // Endpoint shape audit.
    expect(ep.candidateType).toBe('endpoints');
    expect(ep.data.interface_id).toBe(iface.id);
    expect(ep.data.operation_verb).toBe('POST'); // D-3
    expect(ep.name).toBe('greet');

    // WSDL-derived XML signatures (D-2: WSDL wins for these fields).
    expect(ep.data.request_root_element).toBe('greet');
    expect(ep.data.response_root_element).toBe('greetResponse');
    expect(ep.data.request_namespace).toBe('http://uniba.de/dsg/soa/');
    expect(ep.data.soap_action).toBe('http://uniba.de/dsg/soa/greet');

    // wsdl_source set to the repo-relative fixture path.
    expect(ep.data.wsdl_source).toBe(REPO_REL_WSDL);

    // No annotations contributed, so the DTO classes are null.
    expect(ep.data.request_dto_class).toBeNull();
    expect(ep.data.response_dto_class).toBeNull();
  });

  // =========================================================================
  // Fixture 2: Spring-WS XSD + inline @Endpoint Java -- Signal A
  // =========================================================================
  it('Fixture 2: Spring-WS @Endpoint paired with the reference countries XSD produces an interface + endpoint candidate with the documented field values', () => {
    // Provenance sanity check on the XSD: it is the spring-guides reference
    // schema and exposes both top-level element wrappers as text. The
    // wsdlParser is WSDL-shaped (requires `<wsdl:definitions>`) so the XSD
    // is NOT directly parsed by the WSDL walker -- string matches anchor
    // the fixture provenance instead.
    const xsdSource = fs.readFileSync(REFERENCE_XSD_PATH, 'utf8');
    expect(xsdSource).toContain('getCountryRequest');
    expect(xsdSource).toContain('getCountryResponse');
    expect(xsdSource).toContain(
      'https://spring.io/guides/gs-producing-web-service',
    );

    const javaIr = makeJavaIr(
      'src/main/java/com/example/svc/CountryEndpoint.java',
      COUNTRY_ENDPOINT_JAVA,
    );
    // Ship the XSD into the IR alongside the Java fixture so a future emitter
    // pass that walks `embeddedSchemas` for response shapes can find it.
    const xsdIr = makeXsdIr(REPO_REL_XSD, xsdSource);

    const result = runSpringClassicSoapPass(makeInput([javaIr, xsdIr]));

    expect(result.interfaceCandidates).toHaveLength(1);
    expect(result.endpointCandidates).toHaveLength(1);

    const iface = result.interfaceCandidates[0];
    const ep = result.endpointCandidates[0];

    // Fixture 3 fold-in: parent interface is `SOAP_API` typed.
    expect(iface.data.interface_type).toBe('SOAP_API');
    // D-1 rule 2: simple Java class name when `@WebService(name=...)` absent.
    expect(iface.name).toBe('CountryEndpoint');

    // Endpoint candidate carries the @PayloadRoot localPart + namespace.
    expect(ep.candidateType).toBe('endpoints');
    expect(ep.data.interface_id).toBe(iface.id);
    expect(ep.data.operation_verb).toBe('POST'); // D-3
    expect(ep.data.request_root_element).toBe('getCountryRequest');
    expect(ep.data.request_namespace).toBe(
      'https://spring.io/guides/gs-producing-web-service',
    );
    // Annotations win for DTO classes (D-2). The import statements in the
    // fixture supply the FQNs.
    expect(ep.data.request_dto_class).toBe('com.example.dto.GetCountryRequest');
    expect(ep.data.response_dto_class).toBe('com.example.dto.GetCountryResponse');

    // No WSDL was supplied -- the wsdl_source field is null. The
    // response_root_element is also null because Spring-WS @PayloadRoot
    // does not carry a response shape (WSDL is the ground truth for that).
    expect(ep.data.wsdl_source).toBeNull();
  });

  // =========================================================================
  // Fixture 4: servlet path unknown -- soap_endpoint_url_unknown gap
  // =========================================================================
  it('Fixture 4: Spring-WS @Endpoint with NO web.xml -> path_or_address=null AND a paired soap_endpoint_url_unknown evidence_gap finding', () => {
    const javaIr = makeJavaIr(
      'src/main/java/com/example/svc/CountryEndpoint.java',
      COUNTRY_ENDPOINT_JAVA,
    );

    const passOutput = runSpringClassicSoapPass(makeInput([javaIr]));

    expect(passOutput.interfaceCandidates).toHaveLength(1);
    expect(passOutput.endpointCandidates).toHaveLength(1);

    // Servlet path could not be inferred (no web.xml in the IR set).
    expect(passOutput.endpointCandidates[0].data.path_or_address).toBeNull();

    // Build the paired evidence_gap finding (Group 7 helper).
    const findings = buildSoapEvidenceGapFindings({
      emitterOutput: {
        interfaceCandidates: passOutput.interfaceCandidates,
        endpointCandidates: passOutput.endpointCandidates,
        diagnostics: passOutput.diagnostics,
        findings: [],
      },
      wsdlResults: [],
    });

    const urlUnknown = findings.filter(
      (f) =>
        (f.detailJson as Record<string, unknown> | undefined)?.gapType ===
        'soap_endpoint_url_unknown',
    );
    expect(urlUnknown).toHaveLength(1);

    // The finding links to the parent SOAP interface candidate's short id.
    const ifaceId = passOutput.interfaceCandidates[0].id;
    expect(urlUnknown[0].links).toHaveLength(1);
    expect(urlUnknown[0].links?.[0].targetId).toBe(ifaceId);
    expect(urlUnknown[0].findingType).toBe('evidence_gap');
  });

  // =========================================================================
  // Fixture 5: malformed WSDL -- wsdl_parse_failed gap, no candidate, no throw
  // =========================================================================
  it('Fixture 5: malformed WSDL produces a wsdl_parse_failed evidence_gap finding, no candidate is emitted, and the scanner does NOT throw', () => {
    // Deliberately broken: unclosed tag, no closing `</definitions>`.
    const malformedWsdl =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<definitions xmlns="http://schemas.xmlsoap.org/wsdl/" name="Broken">\n' +
      '  <portType name="BrokenPortType">\n' +
      '    <operation name="bad"'; // truncated mid-tag
    const wsdlIr = makeWsdlIr('src/main/resources/wsdl/broken.wsdl', malformedWsdl);

    // Run must not throw.
    const passOutput = runSpringClassicSoapPass(makeInput([wsdlIr]));

    // No interface or endpoint candidates emitted from the broken WSDL --
    // the parser soft-failed and the emitter saw an empty operations list.
    expect(passOutput.interfaceCandidates).toEqual([]);
    expect(passOutput.endpointCandidates).toEqual([]);

    // Re-parse the WSDL via the public parser so we can hand the
    // `WsdlParseResult` (with `parseError`) to the evidence-gap helper.
    const wsdlResult = parseWsdl(malformedWsdl, {
      sourcePath: 'src/main/resources/wsdl/broken.wsdl',
      relatedFiles: new Map(),
    });
    expect(wsdlResult.parseError).toBeDefined();

    const findings = buildSoapEvidenceGapFindings({
      emitterOutput: {
        interfaceCandidates: passOutput.interfaceCandidates,
        endpointCandidates: passOutput.endpointCandidates,
        diagnostics: passOutput.diagnostics,
        findings: [],
      },
      wsdlResults: [wsdlResult],
    });

    const parseFails = findings.filter(
      (f) =>
        (f.detailJson as Record<string, unknown> | undefined)?.gapType ===
        'wsdl_parse_failed',
    );
    expect(parseFails).toHaveLength(1);
    const detail = parseFails[0].detailJson as Record<string, unknown>;
    expect(detail.gapType).toBe('wsdl_parse_failed');
    expect(detail.sourcePath).toBe('src/main/resources/wsdl/broken.wsdl');
    expect(typeof detail.reason).toBe('string');
  });

  // =========================================================================
  // Fixture 6: A+C combined -- D-2 precedence honoured end-to-end
  // =========================================================================
  it('Fixture 6: JAX-WS WSDL + matching @WebService(name="GreetingsPortType") Java -- D-2 precedence honoured; no duplicate operations', () => {
    const wsdlSource = fs.readFileSync(REFERENCE_WSDL_PATH, 'utf8');

    // The Java fixture's `@WebService(name="GreetingsPortType")` aligns
    // verbatim with the WSDL's `<wsdl:portType name="GreetingsPortType">`,
    // so the emitter collapses Signals B + C into a single InterfaceRecord
    // and a single endpoint candidate (no duplicate `greet` operation).
    const javaIr = makeJavaIr(
      'src/main/java/com/example/greet/GreetingsServiceImpl.java',
      GREETINGS_SERVICE_JAVA,
    );
    const wsdlIr = makeWsdlIr(REPO_REL_WSDL, wsdlSource);

    const result = runSpringClassicSoapPass(makeInput([javaIr, wsdlIr]));

    // D-2 precedence: a single interface + a single endpoint candidate
    // (no duplicate `greet` operation from the annotation side).
    expect(result.interfaceCandidates).toHaveLength(1);
    expect(result.endpointCandidates).toHaveLength(1);

    const iface = result.interfaceCandidates[0];
    const ep = result.endpointCandidates[0];

    // D-1 rule 1: `@WebService(name=...)` wins for the interface display name.
    expect(iface.data.interface_type).toBe('SOAP_API');
    expect(iface.name).toBe('GreetingsPortType');

    // D-2: WSDL wins for XML signatures.
    expect(ep.data.request_root_element).toBe('greet');
    expect(ep.data.response_root_element).toBe('greetResponse');
    expect(ep.data.request_namespace).toBe('http://uniba.de/dsg/soa/');
    expect(ep.data.soap_action).toBe('http://uniba.de/dsg/soa/greet');
    expect(ep.data.wsdl_source).toBe(REPO_REL_WSDL);

    // D-2: annotations win for DTO classes.
    expect(ep.data.request_dto_class).toBe('com.example.greet.dto.Greet');
    expect(ep.data.response_dto_class).toBe('com.example.greet.dto.GreetResponse');

    // D-3: operation_verb is the literal 'POST'.
    expect(ep.data.operation_verb).toBe('POST');
  });
});
