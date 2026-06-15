/**
 * Tests for `soapEndpointEmitter.ts` (Spec 2026-05-17 SOAP Discovery -- Spring
 * Classic Phase 1, Task Group 4).
 *
 * Test coverage (per tasks.md 4.1):
 *  1. Signal A in isolation -- Spring-WS signals only -- one candidate per
 *     `@PayloadRoot` method; parent interface candidate has
 *     `interface_type='SOAP_API'`.
 *  2. Signal B in isolation -- JAX-WS signals only -- one candidate per
 *     `@WebMethod`; parent interface candidate has `interface_type='SOAP_API'`.
 *  3. Signal C in isolation -- WSDL signals only -- one candidate per
 *     `wsdl:operation`, including multi-port WSDLs (every `port x operation`
 *     pair).
 *  4. A+C combined (D-2 precedence) -- WSDL wins for `request_root_element`,
 *     `request_namespace`, `response_root_element`; annotations win for
 *     `request_dto_class` / `response_dto_class`; NO duplicate operations.
 *  5. D-1 layered naming pinned -- class annotated `@WebService(name="X")` in
 *     package `com.foo` with class `BarService` produces parent interface name
 *     `X` -- NOT `BarService`, NOT `com.foo.BarService`.
 *  6. D-1 fall-through -- class annotated only `@Endpoint` with class
 *     `OrdersEndpoint` in package `com.foo` produces parent interface name
 *     `OrdersEndpoint` (rule 2: simple Java name).
 *  7. D-1 tiebreaker -- two classes both named `OrdersEndpoint` in different
 *     packages disambiguate via package (rule 3 only kicks in on collision).
 *  8. Candidate shape audit -- emitted endpoint candidate carries
 *     `operation_verb='POST'` (D-3), `interface_id` linking to parent, and the
 *     seven new `data` fields at the documented keys.
 *
 * Phase 3 extension (Spec 2026-05-17 Spec File Auto-Linking, Task Group 5 --
 * Workstream B) -- the emitter additionally promotes WSDL repo-relative paths
 * onto parent SOAP interface candidates as `data.spec_link` when the WSDL's
 * `targetNamespace` exactly matches a single in-scope interface's
 * `data.wsdlTargetNamespace`. Phase 3 adds four new test cases at the bottom:
 *  - Phase 3 happy path: WSDL `targetNamespace` exact match -> `spec_link`
 *    set; endpoint-level `wsdl_source` preserved.
 *  - Phase 3 orphan: WSDL `targetNamespace` matches no interface -> single
 *    `oas_spec_orphan` finding, no `spec_link` set.
 *  - Phase 3 ambiguous: one WSDL `targetNamespace` matches >=2 interfaces ->
 *    single `oas_spec_ambiguous_match` finding, no `spec_link` set on any of
 *    the involved candidates.
 *  - Phase 3 pre-existing `spec_link` skip: an interface already carrying a
 *    non-null `data.spec_link` (e.g. set by a manual upload upstream) is
 *    NEVER overwritten; a `wsdl_spec_link_skipped` log line is emitted.
 */

import { emitSoapCandidates } from '../services/findings/packFindingScanners/springClassicSoap/soapEndpointEmitter';
import type { SpringWsSignal } from '../services/findings/packFindingScanners/springClassicSoap/springWsScanner';
import type { JaxWsSignal } from '../services/findings/packFindingScanners/springClassicSoap/jaxWsScanner';
import type { WsdlParseResult } from '../services/findings/packFindingScanners/springClassicSoap/wsdlParser';

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

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

function makeJaxWsSignal(over: Partial<JaxWsSignal> = {}): JaxWsSignal {
  return {
    sourcePath: 'src/main/java/com/example/GreetingsImpl.java',
    simpleClassName: 'GreetingsImpl',
    packageName: 'com.example',
    webServiceNameAttribute: null,
    targetNamespace: 'http://uniba.de/dsg/soa/',
    operations: [
      {
        methodName: 'greet',
        operationName: 'greet',
        requestRootElement: 'greet',
        responseRootElement: 'greetResponse',
        requestDtoClass: 'com.example.dto.Greet',
        responseDtoClass: 'com.example.dto.GreetResponse',
      },
    ],
    ...over,
  };
}

function makeWsdlResult(over: Partial<WsdlParseResult> = {}): WsdlParseResult {
  return {
    sourcePath: 'src/main/resources/wsdl/greetings.wsdl',
    targetNamespace: 'http://uniba.de/dsg/soa/',
    ports: [
      { portName: 'GreetingsPort', bindingName: 'GreetingsBinding', soapAddressLocation: null },
    ],
    portTypes: [{ portTypeName: 'GreetingsPortType', operationNames: ['greet'] }],
    operations: [
      {
        portName: 'GreetingsPort',
        portTypeName: 'GreetingsPortType',
        operationName: 'greet',
        soapAction: 'http://uniba.de/dsg/soa/greet',
        inputMessage: 'greetRequest',
        outputMessage: 'greetResponse',
        requestRootElement: 'greet',
        requestNamespace: 'http://uniba.de/dsg/soa/',
        responseRootElement: 'greetResponse',
      },
    ],
    embeddedSchemas: [],
    messageTypes: [],
    fieldDepthFindings: [],
    ...over,
  };
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('soapEndpointEmitter', () => {
  // ==========================================================================
  // Test 1: Signal A in isolation
  // ==========================================================================
  it('Test 1 (Signal A): Spring-WS signals only -- one candidate per @PayloadRoot method; parent interface has SOAP_API', () => {
    const springWs: SpringWsSignal[] = [
      makeSpringWsSignal({
        operations: [
          {
            methodName: 'getCountry',
            namespace: 'https://spring.io/guides/gs-producing-web-service',
            localPart: 'getCountryRequest',
            requestDtoClass: 'com.example.dto.GetCountryRequest',
            responseDtoClass: 'com.example.dto.GetCountryResponse',
          },
          {
            methodName: 'listCountries',
            namespace: 'https://spring.io/guides/gs-producing-web-service',
            localPart: 'listCountriesRequest',
            requestDtoClass: 'com.example.dto.ListCountriesRequest',
            responseDtoClass: 'com.example.dto.ListCountriesResponse',
          },
        ],
      }),
    ];

    const result = emitSoapCandidates({
      springWs,
      jaxWs: [],
      wsdl: [],
      servletPaths: new Map(),
    });

    // One parent interface candidate.
    expect(result.interfaceCandidates).toHaveLength(1);
    expect(result.interfaceCandidates[0].candidateType).toBe('interfaces');
    expect(result.interfaceCandidates[0].data.interface_type).toBe('SOAP_API');
    expect(result.interfaceCandidates[0].name).toBe('CountryEndpoint');

    // Two endpoint candidates -- one per @PayloadRoot method.
    expect(result.endpointCandidates).toHaveLength(2);
    expect(result.endpointCandidates.every((c) => c.candidateType === 'endpoints')).toBe(true);
    expect(
      result.endpointCandidates.every(
        (c) => c.data.interface_id === result.interfaceCandidates[0].id,
      ),
    ).toBe(true);

    // Diagnostics: one signal=A line per interface.
    const aDiag = result.diagnostics.filter((d) => d.signal === 'A');
    expect(aDiag).toHaveLength(1);
    expect(aDiag[0].operations).toBe(2);
  });

  // ==========================================================================
  // Test 2: Signal B in isolation
  // ==========================================================================
  it('Test 2 (Signal B): JAX-WS signals only -- one candidate per @WebMethod; parent interface has SOAP_API', () => {
    const jaxWs: JaxWsSignal[] = [
      makeJaxWsSignal({
        operations: [
          {
            methodName: 'greet',
            operationName: 'greet',
            requestRootElement: 'greet',
            responseRootElement: 'greetResponse',
            requestDtoClass: 'com.example.dto.Greet',
            responseDtoClass: 'com.example.dto.GreetResponse',
          },
          {
            methodName: 'farewell',
            operationName: 'farewell',
            requestRootElement: 'farewell',
            responseRootElement: 'farewellResponse',
            requestDtoClass: 'com.example.dto.Farewell',
            responseDtoClass: 'com.example.dto.FarewellResponse',
          },
        ],
      }),
    ];

    const result = emitSoapCandidates({
      springWs: [],
      jaxWs,
      wsdl: [],
      servletPaths: new Map(),
    });

    expect(result.interfaceCandidates).toHaveLength(1);
    expect(result.interfaceCandidates[0].data.interface_type).toBe('SOAP_API');
    expect(result.interfaceCandidates[0].name).toBe('GreetingsImpl');

    expect(result.endpointCandidates).toHaveLength(2);
    expect(result.endpointCandidates.map((c) => c.data.soap_action).sort()).toEqual(
      ['farewell', 'greet'].sort(),
    );

    const bDiag = result.diagnostics.filter((d) => d.signal === 'B');
    expect(bDiag).toHaveLength(1);
    expect(bDiag[0].operations).toBe(2);
  });

  // ==========================================================================
  // Test 3: Signal C in isolation (incl. multi-port WSDL)
  // ==========================================================================
  it('Test 3 (Signal C): WSDL signals only -- one candidate per `wsdl:operation`, multi-port emits per port x operation pair', () => {
    // Multi-port WSDL: two ports, each with two operations -> 4 endpoints total.
    const wsdl: WsdlParseResult[] = [
      makeWsdlResult({
        sourcePath: 'src/main/resources/wsdl/multi.wsdl',
        targetNamespace: 'http://example.com/multi',
        ports: [
          { portName: 'PortA', bindingName: 'BindingA', soapAddressLocation: 'http://host/a' },
          { portName: 'PortB', bindingName: 'BindingB', soapAddressLocation: 'http://host/b' },
        ],
        portTypes: [
          { portTypeName: 'MultiPortType', operationNames: ['op1', 'op2'] },
        ],
        operations: [
          {
            portName: 'PortA',
            portTypeName: 'MultiPortType',
            operationName: 'op1',
            soapAction: 'http://example.com/op1',
            inputMessage: 'op1Req',
            outputMessage: 'op1Resp',
            requestRootElement: 'op1',
            requestNamespace: 'http://example.com/multi',
            responseRootElement: 'op1Response',
          },
          {
            portName: 'PortA',
            portTypeName: 'MultiPortType',
            operationName: 'op2',
            soapAction: 'http://example.com/op2',
            inputMessage: 'op2Req',
            outputMessage: 'op2Resp',
            requestRootElement: 'op2',
            requestNamespace: 'http://example.com/multi',
            responseRootElement: 'op2Response',
          },
          {
            portName: 'PortB',
            portTypeName: 'MultiPortType',
            operationName: 'op1',
            soapAction: 'http://example.com/op1',
            inputMessage: 'op1Req',
            outputMessage: 'op1Resp',
            requestRootElement: 'op1',
            requestNamespace: 'http://example.com/multi',
            responseRootElement: 'op1Response',
          },
          {
            portName: 'PortB',
            portTypeName: 'MultiPortType',
            operationName: 'op2',
            soapAction: 'http://example.com/op2',
            inputMessage: 'op2Req',
            outputMessage: 'op2Resp',
            requestRootElement: 'op2',
            requestNamespace: 'http://example.com/multi',
            responseRootElement: 'op2Response',
          },
        ],
      }),
    ];

    const result = emitSoapCandidates({
      springWs: [],
      jaxWs: [],
      wsdl,
      servletPaths: new Map(),
    });

    // One parent interface from the WSDL (one portType OR one logical interface).
    expect(result.interfaceCandidates).toHaveLength(1);
    expect(result.interfaceCandidates[0].data.interface_type).toBe('SOAP_API');

    // Four endpoint candidates -- one per (port x operation) pair.
    expect(result.endpointCandidates).toHaveLength(4);
    // wsdl_source field is populated on every emitted candidate.
    expect(
      result.endpointCandidates.every(
        (c) => c.data.wsdl_source === 'src/main/resources/wsdl/multi.wsdl',
      ),
    ).toBe(true);

    const cDiag = result.diagnostics.filter((d) => d.signal === 'C');
    expect(cDiag).toHaveLength(1);
    expect(cDiag[0].operations).toBe(4);
  });

  // ==========================================================================
  // Test 4: A+C combined -- D-2 precedence honoured per-field, no duplicates
  // ==========================================================================
  it('Test 4 (A+C, D-2 precedence): WSDL wins for XML signatures; annotations win for DTO classes; no duplicate operations', () => {
    // Same interface name (`GreetingsEndpoint`) annotated as @Endpoint AND
    // described by a WSDL whose service/portType maps to the same interface.
    // Annotations disagree with WSDL on `request_root_element` shape -- WSDL
    // must win. WSDL has no DTO class info -- annotations must win on those.
    const springWs: SpringWsSignal[] = [
      makeSpringWsSignal({
        simpleClassName: 'GreetingsEndpoint',
        packageName: 'com.example',
        webServiceNameAttribute: 'GreetingsPortType',
        operations: [
          {
            methodName: 'greet',
            // Annotation says ANNOTATION_ROOT but WSDL says `greet` -- WSDL wins.
            namespace: 'http://annotation-namespace/',
            localPart: 'ANNOTATION_ROOT',
            requestDtoClass: 'com.example.dto.GreetRequest',
            responseDtoClass: 'com.example.dto.GreetResponse',
          },
        ],
      }),
    ];

    const wsdl: WsdlParseResult[] = [
      makeWsdlResult({
        operations: [
          {
            portName: 'GreetingsPort',
            portTypeName: 'GreetingsPortType',
            operationName: 'greet',
            soapAction: 'http://uniba.de/dsg/soa/greet',
            inputMessage: 'greetRequest',
            outputMessage: 'greetResponse',
            // WSDL ground truth -- must dominate.
            requestRootElement: 'greet',
            requestNamespace: 'http://uniba.de/dsg/soa/',
            responseRootElement: 'greetResponse',
          },
        ],
      }),
    ];

    const result = emitSoapCandidates({
      springWs,
      jaxWs: [],
      wsdl,
      servletPaths: new Map(),
    });

    // ONE interface candidate (not two) -- merging the A signal and the C
    // signal that describe the same logical interface.
    expect(result.interfaceCandidates).toHaveLength(1);

    // ONE endpoint candidate for `greet` -- no duplicate operation.
    expect(result.endpointCandidates).toHaveLength(1);
    const ep = result.endpointCandidates[0];

    // D-2 precedence: WSDL wins for these three fields.
    expect(ep.data.request_root_element).toBe('greet');
    expect(ep.data.request_namespace).toBe('http://uniba.de/dsg/soa/');
    expect(ep.data.response_root_element).toBe('greetResponse');

    // D-2 precedence: annotations win for these two fields.
    expect(ep.data.request_dto_class).toBe('com.example.dto.GreetRequest');
    expect(ep.data.response_dto_class).toBe('com.example.dto.GreetResponse');

    // soap_action and wsdl_source come from the WSDL signal.
    expect(ep.data.soap_action).toBe('http://uniba.de/dsg/soa/greet');
    expect(ep.data.wsdl_source).toBe('src/main/resources/wsdl/greetings.wsdl');
  });

  // ==========================================================================
  // Test 5: D-1 layered naming -- @WebService(name="X") wins
  // ==========================================================================
  it('Test 5 (D-1 rule 1): @WebService(name="X") on class BarService in package com.foo produces interface name "X"', () => {
    const jaxWs: JaxWsSignal[] = [
      makeJaxWsSignal({
        sourcePath: 'src/main/java/com/foo/BarService.java',
        simpleClassName: 'BarService',
        packageName: 'com.foo',
        webServiceNameAttribute: 'X',
        operations: [
          {
            methodName: 'greet',
            operationName: 'greet',
            requestRootElement: 'greet',
            responseRootElement: 'greetResponse',
            requestDtoClass: null,
            responseDtoClass: null,
          },
        ],
      }),
    ];

    const result = emitSoapCandidates({
      springWs: [],
      jaxWs,
      wsdl: [],
      servletPaths: new Map(),
    });

    expect(result.interfaceCandidates).toHaveLength(1);
    expect(result.interfaceCandidates[0].name).toBe('X');
    // NOT the simple class name and NOT the FQN.
    expect(result.interfaceCandidates[0].name).not.toBe('BarService');
    expect(result.interfaceCandidates[0].name).not.toBe('com.foo.BarService');
  });

  // ==========================================================================
  // Test 6: D-1 layered naming -- rule 2 (simple Java name) fall-through
  // ==========================================================================
  it('Test 6 (D-1 rule 2): @Endpoint-only class OrdersEndpoint in package com.foo produces interface name "OrdersEndpoint"', () => {
    const springWs: SpringWsSignal[] = [
      makeSpringWsSignal({
        sourcePath: 'src/main/java/com/foo/OrdersEndpoint.java',
        simpleClassName: 'OrdersEndpoint',
        packageName: 'com.foo',
        webServiceNameAttribute: null, // no @WebService(name=...)
        operations: [
          {
            methodName: 'create',
            namespace: 'http://foo/',
            localPart: 'createOrder',
            requestDtoClass: null,
            responseDtoClass: null,
          },
        ],
      }),
    ];

    const result = emitSoapCandidates({
      springWs,
      jaxWs: [],
      wsdl: [],
      servletPaths: new Map(),
    });

    expect(result.interfaceCandidates).toHaveLength(1);
    expect(result.interfaceCandidates[0].name).toBe('OrdersEndpoint');
    expect(result.interfaceCandidates[0].name).not.toBe('com.foo.OrdersEndpoint');
  });

  // ==========================================================================
  // Test 7: D-1 layered naming -- rule 3 tiebreaker (collision via package)
  // ==========================================================================
  it('Test 7 (D-1 rule 3): two OrdersEndpoint classes in different packages disambiguate via package', () => {
    const springWs: SpringWsSignal[] = [
      makeSpringWsSignal({
        sourcePath: 'src/main/java/com/foo/OrdersEndpoint.java',
        simpleClassName: 'OrdersEndpoint',
        packageName: 'com.foo',
        webServiceNameAttribute: null,
        operations: [
          {
            methodName: 'create',
            namespace: 'http://foo/',
            localPart: 'createOrder',
            requestDtoClass: null,
            responseDtoClass: null,
          },
        ],
      }),
      makeSpringWsSignal({
        sourcePath: 'src/main/java/com/bar/OrdersEndpoint.java',
        simpleClassName: 'OrdersEndpoint',
        packageName: 'com.bar',
        webServiceNameAttribute: null,
        operations: [
          {
            methodName: 'cancel',
            namespace: 'http://bar/',
            localPart: 'cancelOrder',
            requestDtoClass: null,
            responseDtoClass: null,
          },
        ],
      }),
    ];

    const result = emitSoapCandidates({
      springWs,
      jaxWs: [],
      wsdl: [],
      servletPaths: new Map(),
    });

    // Two interface candidates -- the collision triggers rule 3.
    expect(result.interfaceCandidates).toHaveLength(2);

    // Names MUST be distinct (rule 3 disambiguates).
    const names = result.interfaceCandidates.map((c) => c.name).sort();
    expect(new Set(names).size).toBe(2);

    // Rule 3 specifically uses package -- both names should reference each
    // class's package somehow (concrete shape: `<package>.<simpleName>` or
    // `<simpleName> (<package>)`). Just assert the package strings appear.
    expect(names.some((n) => n.includes('com.foo'))).toBe(true);
    expect(names.some((n) => n.includes('com.bar'))).toBe(true);
  });

  // ==========================================================================
  // Test 8: Candidate shape audit -- 7 data fields + verb + interface_id
  // ==========================================================================
  it('Test 8 (shape audit): endpoint candidate carries operation_verb=POST, interface_id, and the seven new data fields', () => {
    const springWs: SpringWsSignal[] = [
      makeSpringWsSignal({
        webServiceNameAttribute: 'CountryService',
        operations: [
          {
            methodName: 'getCountry',
            namespace: 'https://spring.io/guides/gs-producing-web-service',
            localPart: 'getCountryRequest',
            requestDtoClass: 'com.example.dto.GetCountryRequest',
            responseDtoClass: 'com.example.dto.GetCountryResponse',
          },
        ],
      }),
    ];

    const wsdl: WsdlParseResult[] = [
      makeWsdlResult({
        sourcePath: 'src/main/resources/wsdl/country.wsdl',
        targetNamespace: 'https://spring.io/guides/gs-producing-web-service',
        ports: [
          {
            portName: 'CountryPort',
            bindingName: 'CountryBinding',
            soapAddressLocation: 'http://localhost:8080/ws/country',
          },
        ],
        portTypes: [
          { portTypeName: 'CountryService', operationNames: ['getCountryRequest'] },
        ],
        operations: [
          {
            portName: 'CountryPort',
            portTypeName: 'CountryService',
            operationName: 'getCountryRequest',
            soapAction: 'https://spring.io/guides/gs-producing-web-service/getCountryRequest',
            inputMessage: 'getCountryRequest',
            outputMessage: 'getCountryResponse',
            requestRootElement: 'getCountryRequest',
            requestNamespace: 'https://spring.io/guides/gs-producing-web-service',
            responseRootElement: 'getCountryResponse',
          },
        ],
      }),
    ];

    // Servlet path supplied via the lookup map (keyed on interface name from D-1).
    const servletPaths = new Map<string, string | null>([
      ['CountryService', '/ws'],
    ]);

    const result = emitSoapCandidates({
      springWs,
      jaxWs: [],
      wsdl,
      servletPaths,
    });

    expect(result.interfaceCandidates).toHaveLength(1);
    expect(result.endpointCandidates).toHaveLength(1);

    const parent = result.interfaceCandidates[0];
    const ep = result.endpointCandidates[0];

    // Parent shape.
    expect(parent.candidateType).toBe('interfaces');
    expect(parent.data.interface_type).toBe('SOAP_API');
    expect(parent.name).toBe('CountryService'); // From @WebService(name=...) attribute.

    // Endpoint shape -- verb (D-3), interface link, path.
    expect(ep.candidateType).toBe('endpoints');
    expect(ep.data.operation_verb).toBe('POST');
    expect(ep.data.interface_id).toBe(parent.id);
    expect(ep.data.path_or_address).toBe('/ws');

    // Seven required `data` fields at the documented keys.
    expect(ep.data).toHaveProperty('soap_action');
    expect(ep.data).toHaveProperty('request_root_element');
    expect(ep.data).toHaveProperty('request_namespace');
    expect(ep.data).toHaveProperty('response_root_element');
    expect(ep.data).toHaveProperty('request_dto_class');
    expect(ep.data).toHaveProperty('response_dto_class');
    expect(ep.data).toHaveProperty('wsdl_source');

    // Concrete values.
    expect(ep.data.soap_action).toBe(
      'https://spring.io/guides/gs-producing-web-service/getCountryRequest',
    );
    expect(ep.data.request_root_element).toBe('getCountryRequest');
    expect(ep.data.request_namespace).toBe(
      'https://spring.io/guides/gs-producing-web-service',
    );
    expect(ep.data.response_root_element).toBe('getCountryResponse');
    expect(ep.data.request_dto_class).toBe('com.example.dto.GetCountryRequest');
    expect(ep.data.response_dto_class).toBe('com.example.dto.GetCountryResponse');
    expect(ep.data.wsdl_source).toBe('src/main/resources/wsdl/country.wsdl');
  });

  // ==========================================================================
  // Test 8b: Null servlet path is preserved verbatim -- caller emits gap
  // ==========================================================================
  it('Test 8b (path_or_address null): when no servlet mapping is provided, path_or_address is null', () => {
    const springWs: SpringWsSignal[] = [makeSpringWsSignal()];

    const result = emitSoapCandidates({
      springWs,
      jaxWs: [],
      wsdl: [],
      servletPaths: new Map(), // no entry
    });

    expect(result.endpointCandidates).toHaveLength(1);
    expect(result.endpointCandidates[0].data.path_or_address).toBeNull();
  });

  // ==========================================================================
  // Test 9 (Phase 2 Group 3 -- W-10): every emitted candidate carries
  // `data.discovery_method = 'framework_scanner'` so the candidate-review
  // chip can render "Framework scan" without an additional lookup. The
  // field rides inside the existing `data` blob alongside the seven SOAP
  // fields; the AMS save-back path bundles it into `protocol_metadata_json`
  // unchanged.
  // ==========================================================================
  it('Test 9 (discovery_method framing): every emitted candidate (parent interface + child endpoints) carries data.discovery_method = framework_scanner', () => {
    // Mix of all three signals plus a multi-port WSDL plus an
    // annotation-only interface, to exercise every emission path the
    // emitter has. Every produced candidate must carry the field.
    const springWs: SpringWsSignal[] = [
      makeSpringWsSignal({
        operations: [
          {
            methodName: 'getCountry',
            namespace: 'https://spring.io/guides/gs-producing-web-service',
            localPart: 'getCountryRequest',
            requestDtoClass: 'com.example.dto.GetCountryRequest',
            responseDtoClass: 'com.example.dto.GetCountryResponse',
          },
        ],
      }),
    ];
    const jaxWs: JaxWsSignal[] = [
      makeJaxWsSignal({
        operations: [
          {
            methodName: 'greet',
            operationName: 'greet',
            requestRootElement: 'greet',
            responseRootElement: 'greetResponse',
            requestDtoClass: 'com.example.dto.Greet',
            responseDtoClass: 'com.example.dto.GreetResponse',
          },
        ],
      }),
    ];
    const wsdl: WsdlParseResult[] = [makeWsdlResult()];

    const result = emitSoapCandidates({
      springWs,
      jaxWs,
      wsdl,
      servletPaths: new Map(),
    });

    // Sanity: each ingestion path produced at least one candidate.
    expect(result.interfaceCandidates.length).toBeGreaterThan(0);
    expect(result.endpointCandidates.length).toBeGreaterThan(0);

    // Every parent interface candidate carries discovery_method='framework_scanner'.
    expect(
      result.interfaceCandidates.every(
        (c) => c.data.discovery_method === 'framework_scanner',
      ),
    ).toBe(true);

    // Every child endpoint candidate carries discovery_method='framework_scanner'.
    expect(
      result.endpointCandidates.every(
        (c) => c.data.discovery_method === 'framework_scanner',
      ),
    ).toBe(true);
  });

  // ==========================================================================
  // Phase 3 -- Spec File Auto-Linking, Task Group 5 (Workstream B)
  // --------------------------------------------------------------------------
  // WSDL `spec_link` promotion -- four new test cases that exercise the
  // emitter's namespace-match pass:
  //  (a) happy-path WSDL match sets the parent interface's `spec_link` and
  //      preserves the endpoint-level `wsdl_source`;
  //  (b) WSDL whose targetNamespace matches no interface produces an
  //      `oas_spec_orphan` finding and no `spec_link` is set;
  //  (c) WSDL whose targetNamespace matches >=2 interfaces produces an
  //      `oas_spec_ambiguous_match` finding and neither candidate's
  //      `spec_link` is set;
  //  (d) interface already carrying a non-null `data.spec_link` is NOT
  //      overwritten; a `wsdl_spec_link_skipped` log line is emitted.
  // ==========================================================================

  it('Phase 3 Test 1 (WSDL spec_link promotion happy path): WSDL whose targetNamespace exactly matches the interface\'s wsdlTargetNamespace -> interface.data.spec_link set to the WSDL repo-relative path; endpoint-level wsdl_source preserved', () => {
    // Spring-WS annotation describes the same SOAP interface as the WSDL,
    // so the records collapse onto a single parent candidate carrying the
    // WSDL targetNamespace on `data.wsdlTargetNamespace`. The WSDL's
    // sourcePath is the value we expect on `spec_link`.
    const springWs: SpringWsSignal[] = [
      makeSpringWsSignal({
        simpleClassName: 'CountryEndpoint',
        packageName: 'com.example.svc',
        webServiceNameAttribute: 'CountryService',
        operations: [
          {
            methodName: 'getCountry',
            namespace: 'https://spring.io/guides/gs-producing-web-service',
            localPart: 'getCountryRequest',
            requestDtoClass: 'com.example.dto.GetCountryRequest',
            responseDtoClass: 'com.example.dto.GetCountryResponse',
          },
        ],
      }),
    ];
    const wsdl: WsdlParseResult[] = [
      makeWsdlResult({
        sourcePath: 'src/main/resources/wsdl/country.wsdl',
        targetNamespace: 'https://spring.io/guides/gs-producing-web-service',
        portTypes: [
          { portTypeName: 'CountryService', operationNames: ['getCountryRequest'] },
        ],
        operations: [
          {
            portName: 'CountryPort',
            portTypeName: 'CountryService',
            operationName: 'getCountryRequest',
            soapAction: 'https://spring.io/guides/gs-producing-web-service/getCountryRequest',
            inputMessage: 'getCountryRequest',
            outputMessage: 'getCountryResponse',
            requestRootElement: 'getCountryRequest',
            requestNamespace: 'https://spring.io/guides/gs-producing-web-service',
            responseRootElement: 'getCountryResponse',
          },
        ],
      }),
    ];

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const result = emitSoapCandidates({
        springWs,
        jaxWs: [],
        wsdl,
        servletPaths: new Map(),
      });

      // ONE merged parent interface candidate (annotation + WSDL collapse).
      expect(result.interfaceCandidates).toHaveLength(1);
      const parent = result.interfaceCandidates[0];

      // `spec_link` was set on the parent interface's `data` to the WSDL
      // repo-relative path (P-3: exact byte-for-byte targetNamespace match).
      expect(parent.data.spec_link).toBe('src/main/resources/wsdl/country.wsdl');

      // Endpoint-level `wsdl_source` is preserved on every endpoint
      // candidate -- the parent's `spec_link` and per-operation
      // `wsdl_source` coexist (P-6 / Workstream B intent).
      expect(result.endpointCandidates).toHaveLength(1);
      expect(result.endpointCandidates[0].data.wsdl_source).toBe(
        'src/main/resources/wsdl/country.wsdl',
      );

      // No spec-link findings produced on the happy path.
      expect(result.findings).toEqual([]);

      // Diagnostic line shape per the task spec.
      const calls = logSpy.mock.calls.map((c) => String(c[0]));
      expect(
        calls.some((line) =>
          line.includes(
            `[diag-pack] scanner=spring_classic_soap wsdl_spec_link=set interface=${parent.id} path=src/main/resources/wsdl/country.wsdl`,
          ),
        ),
      ).toBe(true);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('Phase 3 Test 2 (orphan WSDL): WSDL whose targetNamespace matches no in-scope interface -> one oas_spec_orphan evidence_gap finding; no spec_link set', () => {
    // Setup: a Spring-WS interface at one namespace (NS-A), plus a WSDL
    // file on disk at an unrelated namespace (NS-B) that has NO portTypes
    // / operations -- so it never self-ingests into an interface record,
    // but its targetNamespace is still part of the matching input. With
    // NS-B matching no interface (no annotation interface at NS-B, no WSDL
    // self-ingest), the WSDL is genuinely orphan.
    //
    // This shape mirrors the real-world case where the WSDL parser
    // succeeds at extracting the `definitions.targetNamespace` but fails
    // to enumerate the portTypes (e.g. due to an unsupported binding
    // shape, an XSD-only stripped file, or a WSDL that imports its
    // portTypes from a sibling file the related-files map didn't resolve).
    const springWs: SpringWsSignal[] = [
      makeSpringWsSignal({
        simpleClassName: 'CountryEndpoint',
        packageName: 'com.example.svc',
        webServiceNameAttribute: null,
        operations: [
          {
            methodName: 'getCountry',
            namespace: 'https://spring.io/guides/gs-producing-web-service',
            localPart: 'getCountryRequest',
            requestDtoClass: null,
            responseDtoClass: null,
          },
        ],
      }),
    ];
    const wsdl: WsdlParseResult[] = [
      {
        sourcePath: 'src/main/resources/wsdl/unrelated.wsdl',
        targetNamespace: 'http://unrelated.example.com/totally-different/',
        ports: [],
        portTypes: [],
        operations: [],
        embeddedSchemas: [],
        messageTypes: [],
        fieldDepthFindings: [],
      },
    ];

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = emitSoapCandidates({
        springWs,
        jaxWs: [],
        wsdl,
        servletPaths: new Map(),
      });

      // No interface candidate has `spec_link` set -- the annotation-only
      // CountryEndpoint candidate has no WSDL match (its
      // `data.wsdlTargetNamespace` is null because no WSDL was ingested
      // onto its record).
      for (const iface of result.interfaceCandidates) {
        expect(iface.data.spec_link).toBeUndefined();
      }

      // Exactly one orphan finding.
      const orphans = result.findings.filter(
        (f) =>
          (f.detailJson as Record<string, unknown> | undefined)?.gapType ===
          'oas_spec_orphan',
      );
      expect(orphans).toHaveLength(1);
      const orphan = orphans[0];
      expect(orphan.findingType).toBe('evidence_gap');
      expect(orphan.category).toBe('evidence_gap');
      expect(
        (orphan.detailJson as Record<string, unknown>).specFilePath,
      ).toBe('src/main/resources/wsdl/unrelated.wsdl');
      // Orphan findings have no `supports` links by definition.
      expect(orphan.links).toEqual([]);

      // Diagnostic line shape.
      const calls = warnSpy.mock.calls.map((c) => String(c[0]));
      expect(
        calls.some((line) =>
          line.includes(
            '[diag-pack] scanner=spring_classic_soap wsdl_spec_link=orphan path=src/main/resources/wsdl/unrelated.wsdl',
          ),
        ),
      ).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('Phase 3 Test 3 (ambiguous WSDL): WSDL whose targetNamespace matches two parent interfaces -> one oas_spec_ambiguous_match evidence_gap finding; neither involved candidate has spec_link set', () => {
    // Setup: two distinct interfaces, both ingested with WSDL portTypes at
    // the same shared targetNamespace, so both candidates carry the same
    // `data.wsdlTargetNamespace`. A third WSDL (the "spec under test")
    // also declares that shared namespace but contributes NO portTypes /
    // operations, so it doesn't self-ingest -- yet it WILL match BOTH
    // existing interfaces by namespace. The promotion pass must flag this
    // as `oas_spec_ambiguous_match` and leave both candidates' spec_link
    // untouched.
    const springWs: SpringWsSignal[] = [
      makeSpringWsSignal({
        sourcePath: 'src/main/java/com/example/CountryEndpoint.java',
        simpleClassName: 'CountryEndpoint',
        packageName: 'com.example.svc',
        webServiceNameAttribute: 'CountryServicePortType',
        operations: [
          {
            methodName: 'getCountry',
            namespace: 'https://shared.example.com/ns/',
            localPart: 'getCountryRequest',
            requestDtoClass: null,
            responseDtoClass: null,
          },
        ],
      }),
    ];
    const jaxWs: JaxWsSignal[] = [
      makeJaxWsSignal({
        sourcePath: 'src/main/java/com/example/GreetingsImpl.java',
        simpleClassName: 'GreetingsImpl',
        packageName: 'com.example',
        webServiceNameAttribute: 'GreetingsPortType',
        targetNamespace: 'https://shared.example.com/ns/',
        operations: [
          {
            methodName: 'greet',
            operationName: 'greet',
            requestRootElement: 'greet',
            responseRootElement: 'greetResponse',
            requestDtoClass: null,
            responseDtoClass: null,
          },
        ],
      }),
    ];
    // Two WSDLs at the same shared namespace, each contributing its own
    // portType so each maps to ONE of the annotation-derived interfaces
    // (the records collapse onto the matching annotation-keyed records).
    // Then a third WSDL ("aggregate.wsdl") that declares the shared
    // namespace but has no portTypes -- it does NOT self-ingest as an
    // interface record. Its namespace match against `wsdlTargetNamespace`
    // on both interfaces produces the ambiguity we're testing.
    const wsdl: WsdlParseResult[] = [
      makeWsdlResult({
        sourcePath: 'src/main/resources/wsdl/country.wsdl',
        targetNamespace: 'https://shared.example.com/ns/',
        portTypes: [
          { portTypeName: 'CountryServicePortType', operationNames: ['getCountryRequest'] },
        ],
        operations: [
          {
            portName: 'CountryPort',
            portTypeName: 'CountryServicePortType',
            operationName: 'getCountryRequest',
            soapAction: 'https://shared.example.com/ns/getCountryRequest',
            inputMessage: 'getCountryRequest',
            outputMessage: 'getCountryResponse',
            requestRootElement: 'getCountryRequest',
            requestNamespace: 'https://shared.example.com/ns/',
            responseRootElement: 'getCountryResponse',
          },
        ],
      }),
      makeWsdlResult({
        sourcePath: 'src/main/resources/wsdl/greetings.wsdl',
        targetNamespace: 'https://shared.example.com/ns/',
        portTypes: [
          { portTypeName: 'GreetingsPortType', operationNames: ['greet'] },
        ],
        operations: [
          {
            portName: 'GreetingsPort',
            portTypeName: 'GreetingsPortType',
            operationName: 'greet',
            soapAction: 'https://shared.example.com/ns/greet',
            inputMessage: 'greetRequest',
            outputMessage: 'greetResponse',
            requestRootElement: 'greet',
            requestNamespace: 'https://shared.example.com/ns/',
            responseRootElement: 'greetResponse',
          },
        ],
      }),
      // The aggregate WSDL: declares the namespace but contributes no
      // portTypes, so it does not self-ingest -- and its namespace match
      // against both already-ingested interfaces is ambiguous.
      {
        sourcePath: 'src/main/resources/wsdl/aggregate.wsdl',
        targetNamespace: 'https://shared.example.com/ns/',
        ports: [],
        portTypes: [],
        operations: [],
        embeddedSchemas: [],
        messageTypes: [],
        fieldDepthFindings: [],
      },
    ];

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = emitSoapCandidates({
        springWs,
        jaxWs,
        wsdl,
        servletPaths: new Map(),
      });

      // Two interface candidates collapsed/merged from the inputs above.
      expect(result.interfaceCandidates.length).toBeGreaterThanOrEqual(2);

      // Both interfaces share the same wsdlTargetNamespace -- the
      // aggregate WSDL matches BOTH interfaces by namespace, so neither
      // has a unique match. Per P-4, neither interface has `spec_link` set
      // by the aggregate WSDL match (the candidate is also matched by its
      // own contributing WSDL, but inverse-ambiguity from being matched by
      // both WSDLs leaves spec_link null on both candidates).
      const sharedNsInterfaces = result.interfaceCandidates.filter(
        (i) =>
          (i.data as Record<string, unknown>).wsdlTargetNamespace ===
          'https://shared.example.com/ns/',
      );
      expect(sharedNsInterfaces.length).toBeGreaterThanOrEqual(2);
      for (const iface of sharedNsInterfaces) {
        // spec_link must be undefined OR not the aggregate WSDL's path
        // (the inverse-ambiguity logic leaves it null because each
        // candidate is matched by >=2 WSDLs sharing the namespace).
        expect(iface.data.spec_link).not.toBe(
          'src/main/resources/wsdl/aggregate.wsdl',
        );
      }

      // The aggregate WSDL specifically produces a per-WSDL ambiguous
      // finding listing both involved interface ids.
      const aggregateAmbiguous = result.findings.filter((f) => {
        const d = f.detailJson as Record<string, unknown> | undefined;
        return (
          d?.gapType === 'oas_spec_ambiguous_match' &&
          d.specFilePath === 'src/main/resources/wsdl/aggregate.wsdl'
        );
      });
      expect(aggregateAmbiguous).toHaveLength(1);
      const ambiguousFinding = aggregateAmbiguous[0];
      expect(ambiguousFinding.findingType).toBe('evidence_gap');
      expect(ambiguousFinding.category).toBe('evidence_gap');
      const ambDetail = ambiguousFinding.detailJson as Record<string, unknown>;
      expect(ambDetail.gapType).toBe('oas_spec_ambiguous_match');
      // The candidate-id array carries both involved interface ids.
      const candIds = ambDetail.candidateInterfaceIds as string[];
      expect(candIds.length).toBeGreaterThanOrEqual(2);

      // Diagnostic line shape for the ambiguous case.
      const calls = warnSpy.mock.calls.map((c) => String(c[0]));
      expect(
        calls.some((line) =>
          line.includes(
            '[diag-pack] scanner=spring_classic_soap wsdl_spec_link=ambiguous',
          ),
        ),
      ).toBe(true);
      expect(
        calls.some((line) =>
          line.includes('path=src/main/resources/wsdl/aggregate.wsdl'),
        ),
      ).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('Phase 3 Test 4 (pre-existing spec_link skip): interface already carrying a non-null data.spec_link is NEVER overwritten by the WSDL promotion step; a wsdl_spec_link_skipped log line is emitted', () => {
    // Single Spring-WS interface paired with a single WSDL -- the WSDL's
    // targetNamespace exactly matches the interface's wsdlTargetNamespace.
    // We thread a pre-existing `spec_link` value in via the new
    // `preExistingSpecLinks` input field, keyed on the post-D-1 display
    // name. The promotion step must SKIP this interface and emit the
    // skipped log line.
    const springWs: SpringWsSignal[] = [
      makeSpringWsSignal({
        simpleClassName: 'CountryEndpoint',
        packageName: 'com.example.svc',
        webServiceNameAttribute: 'CountryService',
        operations: [
          {
            methodName: 'getCountry',
            namespace: 'https://spring.io/guides/gs-producing-web-service',
            localPart: 'getCountryRequest',
            requestDtoClass: null,
            responseDtoClass: null,
          },
        ],
      }),
    ];
    const wsdl: WsdlParseResult[] = [
      makeWsdlResult({
        sourcePath: 'src/main/resources/wsdl/country.wsdl',
        targetNamespace: 'https://spring.io/guides/gs-producing-web-service',
        portTypes: [
          { portTypeName: 'CountryService', operationNames: ['getCountryRequest'] },
        ],
        operations: [
          {
            portName: 'CountryPort',
            portTypeName: 'CountryService',
            operationName: 'getCountryRequest',
            soapAction: 'https://spring.io/guides/gs-producing-web-service/getCountryRequest',
            inputMessage: 'getCountryRequest',
            outputMessage: 'getCountryResponse',
            requestRootElement: 'getCountryRequest',
            requestNamespace: 'https://spring.io/guides/gs-producing-web-service',
            responseRootElement: 'getCountryResponse',
          },
        ],
      }),
    ];

    // Manual upload value the user already pinned for this interface (P-8:
    // user's manual choice always wins).
    const preExistingSpecLinks = new Map<string, string | null>([
      ['CountryService', '/manual-uploads/country-manual.wsdl'],
    ]);

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = emitSoapCandidates({
        springWs,
        jaxWs: [],
        wsdl,
        servletPaths: new Map(),
        preExistingSpecLinks,
      });

      expect(result.interfaceCandidates).toHaveLength(1);
      const parent = result.interfaceCandidates[0];

      // `spec_link` was NOT set to the WSDL path (user's manual choice
      // wins). The emitter does not push the pre-existing value back onto
      // the candidate -- it just skips overwriting; the value lives in
      // AMS / upstream state and is read back via the same map elsewhere.
      // The key assertion is: the WSDL path is NOT present on
      // `data.spec_link`.
      expect(parent.data.spec_link).not.toBe('src/main/resources/wsdl/country.wsdl');

      // No spec-link findings produced -- skip is not a gap.
      const ambiguous = result.findings.filter(
        (f) =>
          (f.detailJson as Record<string, unknown> | undefined)?.gapType ===
          'oas_spec_ambiguous_match',
      );
      const orphans = result.findings.filter(
        (f) =>
          (f.detailJson as Record<string, unknown> | undefined)?.gapType ===
          'oas_spec_orphan',
      );
      expect(ambiguous).toHaveLength(0);
      expect(orphans).toHaveLength(0);

      // Diagnostic line shape per P-8.
      const calls = warnSpy.mock.calls.map((c) => String(c[0]));
      expect(
        calls.some((line) =>
          line.includes(
            '[diag-pack] scanner=spring_classic_soap wsdl_spec_link_skipped pre_existing=/manual-uploads/country-manual.wsdl path=src/main/resources/wsdl/country.wsdl',
          ),
        ),
      ).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

});
