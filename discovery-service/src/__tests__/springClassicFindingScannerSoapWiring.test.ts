/**
 * Integration tests for the Spring Classic scanner's SOAP wiring (Spec
 * 2026-05-17 SOAP Discovery -- Spring Classic Phase 1, Task Group 5).
 *
 * Coverage (3 focused cases):
 *  1. Mixed file set -- REST controllers + Spring-WS endpoints + WSDL --
 *     both REST findings AND SOAP candidates surface in a single scanner
 *     run; the REST emit path is unchanged (back-compat).
 *  2. REST-only sources -- the SOAP peer pass returns empty arrays cleanly
 *     while the REST emit path still emits its normal evidence-gap
 *     findings.
 *  3. SOAP-only sources -- SOAP candidates surface; zero REST endpoint
 *     candidates are produced and zero REST evidence-gap findings are
 *     emitted.
 *
 * The combined entry point `runSpringClassicScannerWithSoap` invokes
 * `runSpringClassicFindingScanner` (REST emit path -- unchanged) plus
 * `runSpringClassicSoapPass` (SOAP peer pass) and returns the merged
 * result.
 */

import type { SourceFileIR } from '../services/extensionPacks';
import {
  runSpringClassicScannerWithSoap,
} from '../services/findings/packFindingScanners/springClassicFindingScanner';

const RUN_ID = 'run-soap-wiring-001';

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function makeJavaIr(
  filePath: string,
  rawContent: string,
  classes: SourceFileIR['classes'] = [],
  imports: SourceFileIR['imports'] = [],
): SourceFileIR {
  return {
    filePath,
    language: 'java',
    packageOrNamespace: 'com.example',
    imports,
    classes,
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

// REST controller fixture -- the existing scanner's REST emit path picks up
// the missing `@RequestBody` and emits a `endpoint_missing_request_schema`
// evidence-gap finding. We use this to verify the REST behaviour is
// unchanged by the SOAP wiring.
const REST_CONTROLLER_SOURCE =
  'package com.example;\n' +
  '@RestController\n' +
  'public class OrderController {\n' +
  '  @PostMapping("/orders") public void create() {}\n' +
  '}\n';

function makeRestControllerIr(): SourceFileIR {
  return makeJavaIr('src/main/java/com/example/OrderController.java', REST_CONTROLLER_SOURCE, [
    {
      name: 'OrderController',
      annotations: [{ name: 'RestController', args: {}, line: 1 }],
      extends: null,
      implements: [],
      isInterface: false,
      isAbstract: false,
      modifiers: ['public'],
      fields: [],
      methods: [
        {
          name: 'create',
          returnType: 'void',
          parameters: [],
          annotations: [{ name: 'PostMapping', args: { value: '/orders' }, line: 3 }],
          modifiers: ['public'],
          line: 3,
        },
      ],
      line: 1,
    },
  ]);
}

// Spring-WS @Endpoint fixture -- Signal A. The orchestrator routes raw
// source strings to `scanSpringWsSources`, which detects @Endpoint +
// @PayloadRoot via regex (no AST needed -- raw content is sufficient).
const SPRING_WS_SOURCE = `
package com.example.svc;

import org.springframework.ws.server.endpoint.annotation.Endpoint;
import org.springframework.ws.server.endpoint.annotation.PayloadRoot;
import com.example.dto.GetCountryRequest;
import com.example.dto.GetCountryResponse;

@Endpoint
public class CountryEndpoint {
  @PayloadRoot(namespace = "https://spring.io/guides/gs-producing-web-service", localPart = "getCountryRequest")
  public GetCountryResponse getCountry(GetCountryRequest req) { return null; }
}
`;

function makeSpringWsIr(): SourceFileIR {
  // The annotation scanners read `rawContent` directly. The classes array
  // is not used by the SOAP pass (the scanners do raw-string regex work);
  // leave it empty so the REST emit path doesn't misclassify the class
  // as a controller.
  return makeJavaIr(
    'src/main/java/com/example/svc/CountryEndpoint.java',
    SPRING_WS_SOURCE,
    [],
  );
}

// Minimal WSDL fixture -- Signal C. Single portType with one operation.
const COUNTRIES_WSDL = `<?xml version="1.0" encoding="UTF-8"?>
<wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"
                  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                  xmlns:tns="https://spring.io/guides/gs-producing-web-service"
                  targetNamespace="https://spring.io/guides/gs-producing-web-service">
  <wsdl:types>
    <xsd:schema targetNamespace="https://spring.io/guides/gs-producing-web-service" elementFormDefault="qualified">
      <xsd:element name="getCountryRequest">
        <xsd:complexType>
          <xsd:sequence>
            <xsd:element name="name" type="xsd:string"/>
          </xsd:sequence>
        </xsd:complexType>
      </xsd:element>
      <xsd:element name="getCountryResponse">
        <xsd:complexType>
          <xsd:sequence>
            <xsd:element name="country" type="xsd:string"/>
          </xsd:sequence>
        </xsd:complexType>
      </xsd:element>
    </xsd:schema>
  </wsdl:types>
  <wsdl:message name="getCountryRequest">
    <wsdl:part name="parameters" element="tns:getCountryRequest"/>
  </wsdl:message>
  <wsdl:message name="getCountryResponse">
    <wsdl:part name="parameters" element="tns:getCountryResponse"/>
  </wsdl:message>
  <wsdl:portType name="CountriesPortType">
    <wsdl:operation name="getCountry">
      <wsdl:input message="tns:getCountryRequest"/>
      <wsdl:output message="tns:getCountryResponse"/>
    </wsdl:operation>
  </wsdl:portType>
  <wsdl:binding name="CountriesBinding" type="tns:CountriesPortType">
    <wsdl:operation name="getCountry">
      <wsdl:input/>
      <wsdl:output/>
    </wsdl:operation>
  </wsdl:binding>
  <wsdl:service name="CountriesService">
    <wsdl:port name="CountriesPort" binding="tns:CountriesBinding"/>
  </wsdl:service>
</wsdl:definitions>
`;

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('runSpringClassicScannerWithSoap -- SOAP wiring', () => {
  it('Test 1: mixed file set emits BOTH REST findings AND SOAP candidates; REST emit path is unchanged', () => {
    const restIr = makeRestControllerIr();
    const soapIr = makeSpringWsIr();
    const wsdlIr = makeWsdlIr('src/main/resources/wsdl/countries.wsdl', COUNTRIES_WSDL);

    const irFiles = new Map<string, SourceFileIR>([
      [restIr.filePath, restIr],
      [soapIr.filePath, soapIr],
      [wsdlIr.filePath, wsdlIr],
    ]);

    const result = runSpringClassicScannerWithSoap({
      runId: RUN_ID,
      irFiles,
      packCandidates: [],
    });

    // REST emit path (unchanged) -- evidence_gap for the @PostMapping
    // controller missing @RequestBody. This is byte-identical to the
    // standalone scanner's output for this fixture.
    const restGaps = result.findings.filter((f) => {
      const d = f.detailJson as Record<string, unknown> | undefined;
      return f.findingType === 'evidence_gap' && d?.gapType === 'endpoint_missing_request_schema';
    });
    expect(restGaps.length).toBeGreaterThanOrEqual(1);
    const restDetail = restGaps[0].detailJson as Record<string, unknown>;
    expect(restDetail.controllerClass).toBe('OrderController');

    // SOAP peer pass -- candidates surface alongside REST findings. The
    // Spring-WS @Endpoint annotation in `CountryEndpoint.java` AND the
    // WSDL `CountriesPortType` both describe the `getCountry` operation;
    // D-2 precedence merges them into a single endpoint candidate per
    // operation (no duplicates).
    expect(result.soapInterfaceCandidates.length).toBeGreaterThanOrEqual(1);
    expect(result.soapEndpointCandidates.length).toBeGreaterThanOrEqual(1);
    expect(
      result.soapInterfaceCandidates.every(
        (c) => c.candidateType === 'interfaces' && c.data.interface_type === 'SOAP_API',
      ),
    ).toBe(true);
    expect(
      result.soapEndpointCandidates.every((c) => c.candidateType === 'endpoints'),
    ).toBe(true);
    // Endpoint's parent interface candidate exists and is linked.
    const interfaceIds = new Set(result.soapInterfaceCandidates.map((c) => c.id));
    expect(
      result.soapEndpointCandidates.every((c) =>
        interfaceIds.has(c.data.interface_id as string),
      ),
    ).toBe(true);
    // D-3: SOAP-over-HTTP is POST on the wire.
    expect(
      result.soapEndpointCandidates.every((c) => c.data.operation_verb === 'POST'),
    ).toBe(true);

    // Diagnostics from the SOAP emitter are forwarded to the wiring caller
    // (Group 6 translates these into [diag-pack] log lines).
    expect(Array.isArray(result.soapDiagnostics)).toBe(true);
    expect(result.soapDiagnostics.length).toBeGreaterThan(0);
  });

  it('Test 2: REST-only sources produce empty SOAP arrays cleanly while REST emit path still works', () => {
    const restIr = makeRestControllerIr();
    const irFiles = new Map<string, SourceFileIR>([[restIr.filePath, restIr]]);

    const result = runSpringClassicScannerWithSoap({
      runId: RUN_ID,
      irFiles,
      packCandidates: [],
    });

    // REST emit path still produces the evidence_gap finding for the
    // controller -- the SOAP wiring did not regress it.
    const restGaps = result.findings.filter((f) => {
      const d = f.detailJson as Record<string, unknown> | undefined;
      return f.findingType === 'evidence_gap' && d?.gapType === 'endpoint_missing_request_schema';
    });
    expect(restGaps.length).toBeGreaterThanOrEqual(1);

    // SOAP peer pass returns empty arrays cleanly -- no signals, no
    // candidates, no diagnostics. The orchestrator did not throw on
    // non-SOAP inputs.
    expect(result.soapInterfaceCandidates).toEqual([]);
    expect(result.soapEndpointCandidates).toEqual([]);
    expect(result.soapDiagnostics).toEqual([]);
  });

  it('Test 3: SOAP-only sources emit SOAP candidates and produce zero REST endpoint findings', () => {
    const soapIr = makeSpringWsIr();
    const wsdlIr = makeWsdlIr('src/main/resources/wsdl/countries.wsdl', COUNTRIES_WSDL);

    const irFiles = new Map<string, SourceFileIR>([
      [soapIr.filePath, soapIr],
      [wsdlIr.filePath, wsdlIr],
    ]);

    const result = runSpringClassicScannerWithSoap({
      runId: RUN_ID,
      irFiles,
      packCandidates: [],
    });

    // SOAP candidates surface.
    expect(result.soapInterfaceCandidates.length).toBeGreaterThanOrEqual(1);
    expect(result.soapEndpointCandidates.length).toBeGreaterThanOrEqual(1);
    expect(result.soapInterfaceCandidates[0].data.interface_type).toBe('SOAP_API');

    // Zero REST endpoint findings -- the source set has no
    // @Controller / @RestController, so the REST emit path produces no
    // `endpoint_missing_request_schema` / `endpoint_partial_path_variables`
    // evidence_gap findings.
    const restEndpointFindings = result.findings.filter((f) => {
      const d = f.detailJson as Record<string, unknown> | undefined;
      const gapType = d?.gapType as string | undefined;
      return (
        f.findingType === 'evidence_gap' &&
        (gapType === 'endpoint_missing_request_schema' ||
          gapType === 'endpoint_partial_path_variables')
      );
    });
    expect(restEndpointFindings).toEqual([]);
  });
});
