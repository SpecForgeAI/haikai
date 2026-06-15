/**
 * Tests for the SOAP evidence-gap helper (Spec 2026-05-17 SOAP Discovery --
 * Spring Classic Phase 1, Task Group 7 / Q-9).
 *
 * Test coverage (per tasks.md 7.1):
 *  1. SOAP candidate emitted with `path_or_address === null` because the
 *     servlet path could not be inferred -> `evidence_gap` finding with
 *     `gapType='soap_endpoint_url_unknown'` and a `discovery_candidate`
 *     link pointing at the parent SOAP interface candidate short-id.
 *  2. Malformed WSDL -> `evidence_gap` finding with
 *     `gapType='wsdl_parse_failed'`, carrying the parser's `reason` and
 *     `sourcePath` from `WsdlParseResult.parseError` inside `detail_json`.
 *  3. Both sentinels appear in the centralised `EvidenceGapType` union
 *     exported from `emissionSources.ts` -- i.e. the central vocabulary
 *     was updated, not just the SOAP-side builder.
 */

import { emitSoapCandidates } from '../services/findings/packFindingScanners/springClassicSoap/soapEndpointEmitter';
import { buildSoapEvidenceGapFindings } from '../services/findings/packFindingScanners/springClassicSoap/soapEvidenceGaps';
import type { SpringWsSignal } from '../services/findings/packFindingScanners/springClassicSoap/springWsScanner';
import type { WsdlParseResult } from '../services/findings/packFindingScanners/springClassicSoap/wsdlParser';
import type { EvidenceGapType } from '../services/findings/emissionSources';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSpringWsSignal(over: Partial<SpringWsSignal> = {}): SpringWsSignal {
  return {
    sourcePath: 'src/main/java/com/example/svc/CountryEndpoint.java',
    simpleClassName: 'CountryEndpoint',
    packageName: 'com.example.svc',
    webServiceNameAttribute: null,
    operations: [
      {
        methodName: 'getCountry',
        namespace: 'https://spring.io/guides/gs-producing-web-service',
        localPart: 'getCountryRequest',
        requestDtoClass: 'com.example.dto.GetCountryRequest',
        responseDtoClass: 'com.example.dto.GetCountryResponse',
      },
    ],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('soapEvidenceGaps', () => {
  // =========================================================================
  // Test 1: soap_endpoint_url_unknown
  // =========================================================================
  it('Test 1: SOAP candidate with path_or_address=null produces a soap_endpoint_url_unknown finding linked to the interface short-id', () => {
    // Run the emitter against a Spring-WS signal with NO servletPaths
    // entry, so every emitted endpoint candidate has `path_or_address=null`.
    const emitterOutput = emitSoapCandidates({
      springWs: [makeSpringWsSignal()],
      jaxWs: [],
      wsdl: [],
      servletPaths: new Map(), // empty -- no servlet path resolved
    });

    // Sanity: one interface candidate, one endpoint, endpoint has null path.
    expect(emitterOutput.interfaceCandidates).toHaveLength(1);
    expect(emitterOutput.endpointCandidates).toHaveLength(1);
    expect(emitterOutput.endpointCandidates[0].data.path_or_address).toBeNull();

    const findings = buildSoapEvidenceGapFindings({
      emitterOutput,
      wsdlResults: [],
    });

    // Exactly one URL-unknown finding for the one interface.
    const urlUnknown = findings.filter(
      (f) =>
        (f.detailJson as Record<string, unknown> | undefined)?.gapType ===
        'soap_endpoint_url_unknown',
    );
    expect(urlUnknown).toHaveLength(1);

    const f = urlUnknown[0];
    // Shape audit.
    expect(f.findingType).toBe('evidence_gap');
    expect(f.category).toBe('evidence_gap');
    expect(f.severity).toBe('medium');
    expect(f.createdByStage).toBe('findings.soapScanner');

    // The link MUST point at the parent SOAP interface candidate's short id.
    expect(f.links).toHaveLength(1);
    expect(f.links?.[0].linkType).toBe('supports');
    expect(f.links?.[0].targetType).toBe('discovery_candidate');
    expect(f.links?.[0].targetId).toBe(emitterOutput.interfaceCandidates[0].id);

    // The finding title carries the interface display name (used as a
    // human-readable handle for the Findings tab).
    expect(f.title).toContain(emitterOutput.interfaceCandidates[0].name);
    expect(f.title).toContain('soap_endpoint_url_unknown');
  });

  // =========================================================================
  // Test 2: wsdl_parse_failed carrying reason + sourcePath from parseError
  // =========================================================================
  it('Test 2: malformed WSDL produces a wsdl_parse_failed finding with reason + sourcePath from parseError', () => {
    const malformedWsdl: WsdlParseResult = {
      sourcePath: 'src/main/resources/wsdl/broken.wsdl',
      targetNamespace: null,
      ports: [],
      portTypes: [],
      operations: [],
      embeddedSchemas: [],
      messageTypes: [],
      fieldDepthFindings: [],
      parseError: {
        reason: 'Unexpected close tag at line 42',
        sourcePath: 'src/main/resources/wsdl/broken.wsdl',
      },
    };

    // Empty emitter output (no candidates produced from the broken WSDL).
    const emitterOutput = emitSoapCandidates({
      springWs: [],
      jaxWs: [],
      wsdl: [], // emitter sees no successful WSDL results
      servletPaths: new Map(),
    });

    const findings = buildSoapEvidenceGapFindings({
      emitterOutput,
      wsdlResults: [malformedWsdl],
    });

    // Exactly one parse-failed finding.
    const parseFails = findings.filter(
      (f) =>
        (f.detailJson as Record<string, unknown> | undefined)?.gapType ===
        'wsdl_parse_failed',
    );
    expect(parseFails).toHaveLength(1);

    const f = parseFails[0];
    expect(f.findingType).toBe('evidence_gap');
    expect(f.category).toBe('evidence_gap');
    expect(f.severity).toBe('medium');
    expect(f.createdByStage).toBe('findings.soapScanner');

    // No candidate link -- a parse failure produces NO candidate.
    expect(f.links ?? []).toHaveLength(0);

    // detailJson carries the parser's reason + sourcePath.
    const detail = f.detailJson as Record<string, unknown>;
    expect(detail.gapType).toBe('wsdl_parse_failed');
    expect(detail.reason).toBe('Unexpected close tag at line 42');
    expect(detail.sourcePath).toBe('src/main/resources/wsdl/broken.wsdl');

    // Title carries the WSDL source path for human-readable reference.
    expect(f.title).toContain('src/main/resources/wsdl/broken.wsdl');
    expect(f.title).toContain('wsdl_parse_failed');

    // No URL-unknown findings (we didn't emit any SOAP candidates).
    const urlUnknown = findings.filter(
      (x) =>
        (x.detailJson as Record<string, unknown> | undefined)?.gapType ===
        'soap_endpoint_url_unknown',
    );
    expect(urlUnknown).toHaveLength(0);
  });

  // =========================================================================
  // Test 3: both sentinels appear in the centralised EvidenceGapType union
  // =========================================================================
  it('Test 3: both new sentinels are members of the centralised EvidenceGapType union', () => {
    // Compile-time check: any value of the union literal type below is a
    // legal `EvidenceGapType`. If a sentinel is removed from the central
    // vocabulary, this assignment fails to typecheck. We also assert the
    // runtime equality so the test is meaningful at runtime, not just
    // compile-time.
    const urlUnknown: EvidenceGapType = 'soap_endpoint_url_unknown';
    const wsdlFailed: EvidenceGapType = 'wsdl_parse_failed';

    expect(urlUnknown).toBe('soap_endpoint_url_unknown');
    expect(wsdlFailed).toBe('wsdl_parse_failed');

    // Also verify the original four sentinels are still members of the
    // union (we expanded the type, never replaced it).
    const original1: EvidenceGapType = 'endpoint_missing_response_schema';
    const original2: EvidenceGapType = 'interface_missing_contract_detail';
    const original3: EvidenceGapType = 'service_missing_owner';
    const original4: EvidenceGapType = 'data_entity_missing_attributes';
    expect([original1, original2, original3, original4]).toEqual([
      'endpoint_missing_response_schema',
      'interface_missing_contract_detail',
      'service_missing_owner',
      'data_entity_missing_attributes',
    ]);
  });
});
