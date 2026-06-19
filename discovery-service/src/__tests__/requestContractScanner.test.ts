/**
 * Tests for the deterministic per-endpoint request-contract scanner
 * (`extensionPacks/frameworkAdapters/springClassic/requestContractScanner.ts`).
 *
 * Spec: 2026-06-19 Request Contract from Code Evidence -- Task Group 5.1.
 *
 * Focused per the discovery test conventions: real Java source through
 * `extractJavaIR`, NO LLM call (the deterministic scanner is pure). Covers:
 *   (a) a `@JsonFormat(pattern="dd-MMM-yyyy")` request-body DTO field ->
 *       `param_formats[]` with that format (the #1 fix);
 *   (b) a `@DateTimeFormat` `@PathVariable` / `@RequestParam` -> `param_formats[]`
 *       with the right `location`;
 *   (c) `@NotNull`/`@Pattern` on the `@Valid` request bean -> `request_validation[]`
 *       (via the reused readValidation shape);
 *   (d) the blob also carries content_type + required_headers (a COMPLETE blob);
 *   (e) the blob rides on `candidate.data.request_contract` keyed by endpoint
 *       name (`${httpMethod} ${fullPath}` == candidate `name`);
 *   (f) an endpoint with NO request facts yields an ABSENT request_contract
 *       (no crash, additive + nullable).
 */

import { extractJavaIR } from '../services/extensionPacks/languageExtractors/java';
import type { SourceFileIR } from '../services/extensionPacks/languageIR';
import type { DiscoveryCandidate } from '../types/candidate';
import {
  scanRequestContracts,
  attachRequestContractsToCandidates,
  REQUEST_CONTRACT_SCHEMA_VERSION,
} from '../services/extensionPacks/frameworkAdapters/springClassic/requestContractScanner';

// ---------------------------------------------------------------------------
// Fixtures (reuse the responseContractScanner harness shape)
// ---------------------------------------------------------------------------

// Request DTO whose `businessDate` field carries the Joda-style format the
// WADL/XSD `xsd:date` MISLEADS the LLM about (`dd-MMM-yyyy` -> 17-JUN-2026).
const VIEW_REQUEST = `
package com.foo.dto;
import com.fasterxml.jackson.annotation.JsonFormat;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

public class ViewRequest {
  @JsonFormat(pattern = "dd-MMM-yyyy")
  @NotNull(message = "businessDate is required")
  private java.time.LocalDate businessDate;

  @Pattern(regexp = "[A-Z]{3}")
  private String currency;
}
`;

const VIEW_CONTROLLER = `
package com.foo.web;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.format.annotation.DateTimeFormat;
import jakarta.validation.Valid;
import com.foo.dto.ViewRequest;

@RestController
@RequestMapping("/views")
public class ViewController {

  // Request body DTO carries @JsonFormat + JSR-380 constraints; consumes +
  // a required @RequestHeader make the blob COMPLETE.
  @PostMapping(value = "/run", consumes = "application/json", headers = "X-Api-Version=2")
  public String run(@Valid @RequestBody ViewRequest req) {
    return "ok";
  }

  // @DateTimeFormat on a @PathVariable and a @RequestParam -> param_formats
  // with location path / query respectively.
  @GetMapping("/by-date/{businessDate}")
  public String byDate(
      @PathVariable @DateTimeFormat(pattern = "dd-MMM-yyyy") java.time.LocalDate businessDate,
      @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) java.time.LocalDate asOf) {
    return "ok";
  }
}
`;

// A controller method with NO request facts at all (no body, no consumes, no
// params, no formats, no validation) -> no request_contract emitted.
const PLAIN_CONTROLLER = `
package com.foo.web;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.GetMapping;

@RestController
@RequestMapping("/health")
public class HealthController {
  @GetMapping
  public String ping() {
    return "pong";
  }
}
`;

function ir(path: string, src: string): SourceFileIR {
  const parsed = extractJavaIR(path, src);
  if (!parsed) throw new Error(`parse fail for ${path}`);
  return parsed;
}

function endpointCandidate(name: string): DiscoveryCandidate {
  return {
    id: `cand-${name}`,
    runId: 'run-1',
    candidateType: 'endpoints',
    name,
    confidence: 0.9,
    status: 'proposed',
    sourceClusterIds: ['x.java'],
    data: { _addedBy: 'spring-classic-adapter' },
    synthesizedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// (a) request-body @JsonFormat -> param_formats (#1 fix)
// ---------------------------------------------------------------------------

describe('requestContractScanner -- request date-format (#1)', () => {
  const out = scanRequestContracts([
    ir('ViewRequest.java', VIEW_REQUEST),
    ir('ViewController.java', VIEW_CONTROLLER),
  ]);

  it('reads @JsonFormat(pattern="dd-MMM-yyyy") off a @RequestBody DTO field into param_formats[]', () => {
    const contract = out.contractsByEndpointName.get('POST /views/run')!;
    expect(contract).toBeDefined();
    const bd = contract.param_formats.find((p) => p.name === 'businessDate');
    expect(bd).toBeDefined();
    expect(bd!.format).toBe('dd-MMM-yyyy');
    expect(bd!.pattern).toBe('dd-MMM-yyyy');
    expect(bd!.location).toBe('body');
    expect(bd!.source).toContain('@JsonFormat');
  });

  it('stamps the internal schema_version, code-scan provenance, and a boxed confidence', () => {
    const contract = out.contractsByEndpointName.get('POST /views/run')!;
    expect(contract.schema_version).toBe(REQUEST_CONTRACT_SCHEMA_VERSION);
    expect(contract.provenance).toBe('code-scan');
    expect(typeof contract.confidence).toBe('number');
    expect(contract.confidence).toBeGreaterThan(0.5);
    expect(contract.provenance_detail.method_id).toContain('ViewController');
  });
});

// ---------------------------------------------------------------------------
// (b) @DateTimeFormat on @PathVariable / @RequestParam -> param_formats location
// ---------------------------------------------------------------------------

describe('requestContractScanner -- @DateTimeFormat path/query params', () => {
  const out = scanRequestContracts([ir('ViewController.java', VIEW_CONTROLLER)]);

  it('reads @DateTimeFormat(pattern=) on a @PathVariable into a path-located param_format', () => {
    const contract = out.contractsByEndpointName.get('GET /views/by-date/{businessDate}')!;
    expect(contract).toBeDefined();
    const path = contract.param_formats.find((p) => p.location === 'path');
    expect(path).toBeDefined();
    expect(path!.name).toBe('businessDate');
    expect(path!.pattern).toBe('dd-MMM-yyyy');
    expect(path!.source).toContain('@DateTimeFormat');
  });

  it('reads @DateTimeFormat(iso=) on a @RequestParam into a query-located param_format (no concrete pattern)', () => {
    const contract = out.contractsByEndpointName.get('GET /views/by-date/{businessDate}')!;
    const query = contract.param_formats.find((p) => p.location === 'query');
    expect(query).toBeDefined();
    expect(query!.name).toBe('asOf');
    expect(query!.pattern).toBeNull();
    expect(query!.format).toContain('ISO');
  });
});

// ---------------------------------------------------------------------------
// (c) request validation + (d) complete blob (content_type + required_headers)
// ---------------------------------------------------------------------------

describe('requestContractScanner -- validation + complete blob', () => {
  const out = scanRequestContracts([
    ir('ViewRequest.java', VIEW_REQUEST),
    ir('ViewController.java', VIEW_CONTROLLER),
  ]);

  it('reads @NotNull/@Pattern on the @Valid request bean into request_validation[]', () => {
    const contract = out.contractsByEndpointName.get('POST /views/run')!;
    const notNull = contract.request_validation.find((v) => v.field === 'businessDate');
    expect(notNull).toBeDefined();
    expect(notNull!.constraint).toContain('@NotNull');
    expect(notNull!.failure_status).toBe(400);
    expect(notNull!.message).toBe('businessDate is required');
    const pattern = contract.request_validation.find((v) => v.field === 'currency');
    expect(pattern!.constraint).toContain('@Pattern');
  });

  it('carries content_type (from consumes) and required_headers (from the mapping headers discriminator)', () => {
    const contract = out.contractsByEndpointName.get('POST /views/run')!;
    expect(contract.content_type).toBe('application/json');
    expect(contract.consumes).toContain('application/json');
    const hdr = contract.required_headers.find((h) => h.name.startsWith('X-Api-Version'));
    expect(hdr).toBeDefined();
    expect(hdr!.source).toBe('mapping-header');
  });
});

// ---------------------------------------------------------------------------
// (e) attachment by endpoint name + (f) absent contract for a plain endpoint
// ---------------------------------------------------------------------------

describe('requestContractScanner -- attachment + absent contract', () => {
  it('attaches request_contract to the matching candidate by name; leaves the no-fact endpoint untouched', () => {
    const out = scanRequestContracts([
      ir('ViewRequest.java', VIEW_REQUEST),
      ir('ViewController.java', VIEW_CONTROLLER),
      ir('HealthController.java', PLAIN_CONTROLLER),
    ]);

    // The plain GET /health endpoint produced no request facts -> no contract.
    expect(out.contractsByEndpointName.has('GET /health')).toBe(false);

    const candidates = [
      endpointCandidate('POST /views/run'),
      endpointCandidate('GET /health'), // no contract -> untouched
    ];
    const attached = attachRequestContractsToCandidates(candidates, out);
    expect(attached).toBe(1);

    const run = candidates.find((c) => c.name === 'POST /views/run')!;
    const blob = (run.data as Record<string, unknown>).request_contract as Record<string, unknown>;
    expect(blob).toBeDefined();
    expect(blob.schema_version).toBe(REQUEST_CONTRACT_SCHEMA_VERSION);

    // The no-fact endpoint is left untouched (additive + nullable; no crash).
    const health = candidates.find((c) => c.name === 'GET /health')!;
    expect((health.data as Record<string, unknown>).request_contract).toBeUndefined();
  });
});
