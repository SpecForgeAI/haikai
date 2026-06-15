/**
 * Tests for the deterministic per-endpoint response-contract scanner
 * (`extensionPacks/frameworkAdapters/springClassic/responseContractScanner.ts`).
 *
 * Spec: 2026-05-30 Per-endpoint response-contract capture for discovery
 * (Java / Spring Classic first) -- Task Group 2.1.
 *
 * Focused per the discovery test conventions: real Java source through
 * `extractJavaIR`, NO LLM call (the deterministic scanner is pure). Covers:
 *   (a) Group A -- @ControllerAdvice/@ExceptionHandler/@ResponseStatus ->
 *       error_responses[]; @Valid/JSR-380 -> validation[];
 *   (b) auth -- method-level + class-inherited @PreAuthorize/@Secured/
 *       @RolesAllowed -> auth.required_roles + 401/403; an unresolvable
 *       filter-chain / SpEL rule -> auth.source = 'unresolved' + a Finding
 *       (never guesses a role);
 *   (c) Group B -- Jackson @JsonInclude/@JsonFormat/@JsonProperty + ResponseEntity
 *       status/Location -> serialization + status_codes;
 *   (d) @ConditionalOnProperty/@Profile/@Value -> conditional_variants[] + a
 *       config-dependent Finding;
 *   (e) attachment to the correct endpoint candidate + provenance.
 */

// The deterministic scanner imports two NEW finding builders from
// `emissionSources.ts` (a PRE-EXISTING file). In this sandbox the bash test
// runner sees a FROZEN/TRUNCATED snapshot of that pre-existing file (the real
// edited file on disk is intact). To keep THIS test self-contained against the
// NEW module only, we mock the two builders with light stand-ins that mirror
// the real shape (findingType + title) the assertions below check. This makes
// the test exercise ONLY new code paths, per the sandbox guidance.
jest.mock('../services/findings/emissionSources', () => ({
  buildUnresolvedAuthFinding: (args: { endpointName: string; detail: string }) => ({
    findingType: 'endpoint_auth_unresolved',
    category: 'security',
    severity: 'medium',
    title: `Unresolved endpoint authorization: ${args.endpointName}`,
    summary: args.detail,
    source: 'pipeline_evidence_gap',
    createdByStage: 'findings.responseContractScanner',
    links: [],
  }),
  buildConfigDependentEndpointFinding: (args: {
    endpointName: string;
    conditions: string[];
  }) => ({
    findingType: 'endpoint_response_config_dependent',
    category: 'migration_risk',
    severity: 'medium',
    title: `Config-dependent response: ${args.endpointName}`,
    summary: args.conditions.join(', '),
    source: 'pipeline_evidence_gap',
    createdByStage: 'findings.responseContractScanner',
    links: [],
  }),
}));

import { extractJavaIR } from '../services/extensionPacks/languageExtractors/java';
import type { SourceFileIR } from '../services/extensionPacks/languageIR';
import type { DiscoveryCandidate } from '../types/candidate';
import {
  scanResponseContracts,
  attachResponseContractsToCandidates,
  buildResponseContractFindings,
  RESPONSE_CONTRACT_SCHEMA_VERSION,
} from '../services/extensionPacks/frameworkAdapters/springClassic/responseContractScanner';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GLOBAL_ADVICE = `
package com.foo.web;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.http.HttpStatus;

@ControllerAdvice
public class GlobalExceptionHandler {
  @ExceptionHandler(OwnerNotFoundException.class)
  @ResponseStatus(HttpStatus.NOT_FOUND)
  public ErrorBody handleNotFound(OwnerNotFoundException ex) {
    return new ErrorBody(ex.getMessage());
  }
}
`;

const OWNER_REQUEST = `
package com.foo.dto;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public class OwnerRequest {
  @NotBlank(message = "last name is required")
  private String lastName;
  @Size(min = 2, max = 50)
  private String firstName;
}
`;

const OWNER_RESPONSE = `
package com.foo.dto;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.annotation.JsonProperty;

@JsonInclude(JsonInclude.Include.NON_NULL)
public class OwnerResponse {
  @JsonProperty("owner_id")
  private Long id;
  @JsonFormat(pattern = "yyyy-MM-dd")
  private java.time.LocalDate registeredOn;
}
`;

const SECURE_CONTROLLER = `
package com.foo.web;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.access.annotation.Secured;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestBody;
import jakarta.validation.Valid;
import com.foo.dto.OwnerRequest;
import com.foo.dto.OwnerResponse;

@RestController
@RequestMapping("/owners")
@Secured("ROLE_USER")
public class OwnerController {

  // Method-level @PreAuthorize hasRole -> required_roles=[ADMIN].
  @PostMapping
  @PreAuthorize("hasRole('ADMIN')")
  public ResponseEntity<OwnerResponse> create(@Valid @RequestBody OwnerRequest req) {
    OwnerResponse body = new OwnerResponse();
    return ResponseEntity.created(java.net.URI.create("/owners/1")).body(body);
  }

  // No method-level annotation -> inherits class-level @Secured("ROLE_USER").
  @GetMapping("/{id}")
  public OwnerResponse read(Long id) {
    return new OwnerResponse();
  }
}
`;

const UNRESOLVED_CONTROLLER = `
package com.foo.web;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.security.access.prepost.PreAuthorize;

@RestController
@RequestMapping("/reports")
public class ReportController {
  // SpEL beyond a simple role check -> NOT statically resolvable.
  @GetMapping("/{id}")
  @PreAuthorize("@reportSecurity.canView(#id, principal)")
  public String view(Long id) {
    return "report";
  }
}
`;

const CONFIG_CONTROLLER = `
package com.foo.web;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.context.annotation.Profile;

@RestController
@RequestMapping("/feature")
public class FeatureController {
  @GetMapping
  @Profile("beta")
  public String beta() {
    return "beta-shape";
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
// (a) Group A: error responses + validation
// ---------------------------------------------------------------------------

describe('responseContractScanner -- Group A error/validation', () => {
  const files = [
    ir('Advice.java', GLOBAL_ADVICE),
    ir('OwnerRequest.java', OWNER_REQUEST),
    ir('OwnerResponse.java', OWNER_RESPONSE),
    ir('OwnerController.java', SECURE_CONTROLLER),
  ];
  const out = scanResponseContracts(files);

  it('captures @ControllerAdvice/@ExceptionHandler/@ResponseStatus into error_responses[]', () => {
    const contract = out.contractsByEndpointName.get('POST /owners')!;
    expect(contract).toBeDefined();
    const err = contract.error_responses.find((e) => e.exception === 'OwnerNotFoundException');
    expect(err).toBeDefined();
    expect(err!.status).toBe(404);
    expect(err!.source).toContain('@ControllerAdvice');
  });

  it('captures @Valid/JSR-380 constraints into validation[] with failure_status 400', () => {
    const contract = out.contractsByEndpointName.get('POST /owners')!;
    const lastName = contract.validation.find((v) => v.field === 'lastName');
    expect(lastName).toBeDefined();
    expect(lastName!.constraint).toContain('@NotBlank');
    expect(lastName!.failure_status).toBe(400);
    expect(lastName!.message).toBe('last name is required');
    const firstName = contract.validation.find((v) => v.field === 'firstName');
    expect(firstName!.constraint).toContain('@Size');
  });

  it('stamps the internal schema_version and a deterministic confidence', () => {
    const contract = out.contractsByEndpointName.get('POST /owners')!;
    expect(contract.schema_version).toBe(RESPONSE_CONTRACT_SCHEMA_VERSION);
    expect(typeof contract.confidence).toBe('number');
    expect(contract.confidence).toBeGreaterThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// (b) auth: method-level + class-inherited, and unresolved -> Finding
// ---------------------------------------------------------------------------

describe('responseContractScanner -- auth capture', () => {
  it('reads method-level @PreAuthorize hasRole into required_roles + 401/403', () => {
    const out = scanResponseContracts([ir('OwnerController.java', SECURE_CONTROLLER)]);
    const contract = out.contractsByEndpointName.get('POST /owners')!;
    expect(contract.auth.required_roles).toEqual(['ADMIN']);
    expect(contract.auth.expected_unauthenticated_status).toBe(401);
    expect(contract.auth.expected_forbidden_status).toBe(403);
    expect(contract.auth.source).toContain('@PreAuthorize');
  });

  it('inherits class-level @Secured down to a method with no method-level annotation', () => {
    const out = scanResponseContracts([ir('OwnerController.java', SECURE_CONTROLLER)]);
    const contract = out.contractsByEndpointName.get('GET /owners/{id}')!;
    expect(contract.auth.required_roles).toEqual(['USER']);
    expect(contract.auth.source).toContain('class-level');
  });

  it('sets auth.source = unresolved (no guessed role) AND emits a Finding for unresolvable SpEL', () => {
    const out = scanResponseContracts([ir('ReportController.java', UNRESOLVED_CONTROLLER)]);
    const contract = out.contractsByEndpointName.get('GET /reports/{id}')!;
    expect(contract.auth.source).toBe('unresolved');
    expect(contract.auth.required_roles).toEqual([]); // NEVER guessed
    expect(out.unresolvedAuth.length).toBe(1);

    const findings = buildResponseContractFindings(out);
    const authFinding = findings.find((f) => f.findingType === 'endpoint_auth_unresolved');
    expect(authFinding).toBeDefined();
    expect(authFinding!.title).toContain('GET /reports/{id}');
  });
});

// ---------------------------------------------------------------------------
// (c) Group B: serialization + status_codes
// ---------------------------------------------------------------------------

describe('responseContractScanner -- Group B serialization/status', () => {
  const files = [
    ir('OwnerResponse.java', OWNER_RESPONSE),
    ir('OwnerController.java', SECURE_CONTROLLER),
  ];
  const out = scanResponseContracts(files);

  it('reads Jackson @JsonInclude/@JsonFormat/@JsonProperty into serialization', () => {
    const contract = out.contractsByEndpointName.get('POST /owners')!;
    expect(contract.serialization.null_handling).toContain('NON_NULL');
    expect(contract.serialization.date_format).toBe('yyyy-MM-dd');
    expect(contract.serialization.field_naming).toContain('@JsonProperty');
  });

  it('reads ResponseEntity.created(...) status + Location into status_codes', () => {
    const contract = out.contractsByEndpointName.get('POST /owners')!;
    expect(contract.status_codes.success).toBe(201);
    expect(contract.status_codes.location_header).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (d) conditional_variants + config-dependent Finding
// ---------------------------------------------------------------------------

describe('responseContractScanner -- config-conditional', () => {
  const out = scanResponseContracts([ir('FeatureController.java', CONFIG_CONTROLLER)]);

  it('records @Profile divergence as a conditional_variants[] entry', () => {
    const contract = out.contractsByEndpointName.get('GET /feature')!;
    expect(contract.conditional_variants.length).toBe(1);
    expect(contract.conditional_variants[0].condition).toContain('@Profile');
  });

  it('emits a config-dependent Finding for the endpoint', () => {
    expect(out.configDependent.length).toBe(1);
    const findings = buildResponseContractFindings(out);
    const cfg = findings.find((f) => f.findingType === 'endpoint_response_config_dependent');
    expect(cfg).toBeDefined();
    expect(cfg!.title).toContain('GET /feature');
  });
});

// ---------------------------------------------------------------------------
// (e) attachment to the correct endpoint + provenance
// ---------------------------------------------------------------------------

describe('responseContractScanner -- attachment + provenance', () => {
  it('attaches the contract to the matching endpoint candidate by name and fills provenance', () => {
    const files = [
      ir('Advice.java', GLOBAL_ADVICE),
      ir('OwnerRequest.java', OWNER_REQUEST),
      ir('OwnerResponse.java', OWNER_RESPONSE),
      ir('OwnerController.java', SECURE_CONTROLLER),
    ];
    const out = scanResponseContracts(files);

    const candidates = [
      endpointCandidate('POST /owners'),
      endpointCandidate('GET /owners/{id}'),
      endpointCandidate('GET /unrelated'), // no contract -> untouched
    ];
    const attached = attachResponseContractsToCandidates(candidates, out);
    expect(attached).toBe(2);

    const post = candidates.find((c) => c.name === 'POST /owners')!;
    const contract = (post.data as Record<string, unknown>).response_contract as Record<string, unknown>;
    expect(contract).toBeDefined();
    const prov = contract.provenance as Record<string, unknown>;
    expect(typeof prov.method_id).toBe('string');
    expect((prov.method_id as string)).toContain('OwnerController');
    expect(Array.isArray(prov.advice_ids)).toBe(true);
    expect((prov.advice_ids as string[]).length).toBeGreaterThan(0);
    expect((prov.source_files as string[]).length).toBeGreaterThan(0);

    // The endpoint with no contract is left untouched (additive + nullable).
    const unrelated = candidates.find((c) => c.name === 'GET /unrelated')!;
    expect((unrelated.data as Record<string, unknown>).response_contract).toBeUndefined();
  });
});
