/**
 * Tests for the Spring Classic SOAP pass diagnostic logging (Spec
 * 2026-05-17 SOAP Discovery -- Spring Classic Phase 1, Task Group 6).
 *
 * Coverage (per tasks.md 6.1, 4 focused tests):
 *  1. A scanner run with N source files emits exactly one
 *     `[diag-pack] scanner=spring_classic_soap start files=<N>` line at the
 *     start.
 *  2. A signal A emit produces `[diag-pack] scanner=spring_classic_soap
 *     signal=A interface=<short-id> operations=<N>` (and similar for B / C).
 *  3. A successful WSDL parse produces `[diag-pack] scanner=spring_classic_soap
 *     wsdl_parse=ok path=<rel> operations=<N> ports=<N>`.
 *  4. A failed WSDL parse produces `[diag-pack] scanner=spring_classic_soap
 *     wsdl_parse=fail path=<rel> reason=<...>`.
 *
 * All assertions read `console.log` and `console.warn` captures so the line
 * shape is verified against the exact prefix + key=value enumeration spelled
 * out in spec.md.
 */

import type { SourceFileIR } from '../services/extensionPacks';
import type { PackFindingScannerInput } from '../services/findings/packFindingScanners';
import { runSpringClassicSoapPass } from '../services/findings/packFindingScanners/springClassicSoap';

const RUN_ID = 'run-soap-diag-001';

// ----------------------------------------------------------------------------
// IR helpers (kept tiny -- the diag tests only need rawContent + filePath +
// language so the orchestrator routes the file to the right scanner).
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
    language: 'xml',
    packageOrNamespace: null,
    imports: [],
    classes: [],
    functions: [],
    rawContent,
  };
}

// A Spring-WS @Endpoint source. The orchestrator routes raw content to
// `scanSpringWsSources`, which detects @Endpoint + @PayloadRoot via regex.
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

// Minimal well-formed WSDL with one portType + one operation + one port so
// `wsdl_parse=ok` lines carry deterministic operations / ports counts.
const WELL_FORMED_WSDL = `<?xml version="1.0" encoding="UTF-8"?>
<wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"
                  xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
                  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                  xmlns:tns="http://example.com/greet"
                  targetNamespace="http://example.com/greet">
  <wsdl:types>
    <xsd:schema targetNamespace="http://example.com/greet" elementFormDefault="qualified">
      <xsd:element name="greet" type="xsd:string"/>
      <xsd:element name="greetResponse" type="xsd:string"/>
    </xsd:schema>
  </wsdl:types>
  <wsdl:message name="greetRequest">
    <wsdl:part name="parameters" element="tns:greet"/>
  </wsdl:message>
  <wsdl:message name="greetResponseMsg">
    <wsdl:part name="parameters" element="tns:greetResponse"/>
  </wsdl:message>
  <wsdl:portType name="GreetingsPortType">
    <wsdl:operation name="greet">
      <wsdl:input message="tns:greetRequest"/>
      <wsdl:output message="tns:greetResponseMsg"/>
    </wsdl:operation>
  </wsdl:portType>
  <wsdl:binding name="GreetingsBinding" type="tns:GreetingsPortType">
    <soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
    <wsdl:operation name="greet">
      <soap:operation soapAction="http://example.com/greet/greet"/>
      <wsdl:input><soap:body use="literal"/></wsdl:input>
      <wsdl:output><soap:body use="literal"/></wsdl:output>
    </wsdl:operation>
  </wsdl:binding>
  <wsdl:service name="GreetingsService">
    <wsdl:port name="GreetingsPort" binding="tns:GreetingsBinding">
      <soap:address location="http://localhost:8080/greet"/>
    </wsdl:port>
  </wsdl:service>
</wsdl:definitions>`;

// Truncated WSDL -- `fast-xml-parser` raises a parse error.
const MALFORMED_WSDL = '<wsdl:definitions><wsdl:portType name="X"><wsdl:operation name="bad"';

// ----------------------------------------------------------------------------
// Test harness -- captures console.log / console.warn for assertion.
// ----------------------------------------------------------------------------

function buildInput(files: SourceFileIR[]): PackFindingScannerInput {
  const irFiles = new Map<string, SourceFileIR>();
  for (const ir of files) irFiles.set(ir.filePath, ir);
  return {
    runId: RUN_ID,
    irFiles,
    packCandidates: [],
  };
}

function withConsoleCapture<T>(fn: () => T): { value: T; logs: string[]; warns: string[] } {
  const logs: string[] = [];
  const warns: string[] = [];
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = (...args: unknown[]) => {
    logs.push(args.map((a) => String(a)).join(' '));
  };
  console.warn = (...args: unknown[]) => {
    warns.push(args.map((a) => String(a)).join(' '));
  };
  try {
    const value = fn();
    return { value, logs, warns };
  } finally {
    console.log = origLog;
    console.warn = origWarn;
  }
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('springClassicSoap diagnostic logging', () => {
  // ==========================================================================
  // Test 1: start line with file count
  // ==========================================================================
  it('Test 1: emits exactly one `start files=<N>` line at the start of the pass', () => {
    const input = buildInput([
      makeJavaIr('src/main/java/com/example/svc/CountryEndpoint.java', SPRING_WS_SOURCE),
      makeWsdlIr('src/main/resources/wsdl/greetings.wsdl', WELL_FORMED_WSDL),
    ]);

    const { logs } = withConsoleCapture(() => runSpringClassicSoapPass(input));

    const startLines = logs.filter((l) =>
      l.startsWith('[diag-pack] scanner=spring_classic_soap start files='),
    );
    expect(startLines).toHaveLength(1);
    // 1 java + 1 wsdl = 2 files.
    expect(startLines[0]).toBe('[diag-pack] scanner=spring_classic_soap start files=2');
  });

  // ==========================================================================
  // Test 2: per-signal lines (signal=A / signal=C in this run)
  // ==========================================================================
  it('Test 2: emits `signal=A|B|C interface=<short-id> operations=<N>` per signal contribution', () => {
    const input = buildInput([
      makeJavaIr('src/main/java/com/example/svc/CountryEndpoint.java', SPRING_WS_SOURCE),
      makeWsdlIr('src/main/resources/wsdl/greetings.wsdl', WELL_FORMED_WSDL),
    ]);

    const { value: out, logs } = withConsoleCapture(() => runSpringClassicSoapPass(input));

    // Cross-check against the structured diagnostics return value -- the
    // logger lines and the returned DiagLine array must agree per signal.
    const signalLineRegex =
      /^\[diag-pack\] scanner=spring_classic_soap signal=([ABC]) interface=(\S+) operations=(\d+)$/;
    const signalLines = logs.filter((l) => signalLineRegex.test(l));

    // At least one A line (Spring-WS contribution) and at least one C line
    // (WSDL contribution) must be present.
    const aLines = signalLines.filter((l) => l.includes(' signal=A '));
    const cLines = signalLines.filter((l) => l.includes(' signal=C '));
    expect(aLines.length).toBeGreaterThanOrEqual(1);
    expect(cLines.length).toBeGreaterThanOrEqual(1);

    // Each diagnostic entry returned on the structured stream has a matching
    // console.log line (1:1 correspondence per signal x interface).
    for (const diag of out.diagnostics) {
      const expected = `[diag-pack] scanner=spring_classic_soap signal=${diag.signal} interface=${diag.interface} operations=${diag.operations}`;
      expect(signalLines).toContain(expected);
    }
  });

  // ==========================================================================
  // Test 3: wsdl_parse=ok line
  // ==========================================================================
  it('Test 3: emits `wsdl_parse=ok path=<rel> operations=<N> ports=<N>` for a successful parse', () => {
    const input = buildInput([
      makeWsdlIr('src/main/resources/wsdl/greetings.wsdl', WELL_FORMED_WSDL),
    ]);

    const { logs } = withConsoleCapture(() => runSpringClassicSoapPass(input));

    const okLines = logs.filter((l) =>
      l.startsWith('[diag-pack] scanner=spring_classic_soap wsdl_parse=ok'),
    );
    expect(okLines).toHaveLength(1);
    // The well-formed fixture above declares exactly one operation in one
    // portType and one port in the service binding.
    expect(okLines[0]).toBe(
      '[diag-pack] scanner=spring_classic_soap wsdl_parse=ok path=src/main/resources/wsdl/greetings.wsdl operations=1 ports=1',
    );
  });

  // ==========================================================================
  // Test 4: wsdl_parse=fail line
  // ==========================================================================
  it('Test 4: emits `wsdl_parse=fail path=<rel> reason=<...>` for a malformed parse and never throws', () => {
    const input = buildInput([
      makeWsdlIr('src/main/resources/wsdl/broken.wsdl', MALFORMED_WSDL),
    ]);

    let threw = false;
    const { warns } = withConsoleCapture(() => {
      try {
        runSpringClassicSoapPass(input);
      } catch {
        threw = true;
      }
    });

    expect(threw).toBe(false);
    const failLines = warns.filter((l) =>
      l.startsWith('[diag-pack] scanner=spring_classic_soap wsdl_parse=fail'),
    );
    expect(failLines).toHaveLength(1);
    expect(failLines[0]).toMatch(
      /^\[diag-pack\] scanner=spring_classic_soap wsdl_parse=fail path=src\/main\/resources\/wsdl\/broken\.wsdl reason=.+/,
    );
  });
});
