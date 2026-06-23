/**
 * CROSS-PROCESS WIRE-CONTRACT tests for the Spring-Classic code-evidence format
 * extraction feature (spec 2026-06-22) -- Task Group 6 (test review & gap fill).
 *
 * WHY THIS FILE EXISTS (the gap the per-group tests structurally cannot close):
 * the Task-Group 1-5 tests each pass IN ISOLATION but stub the process boundary
 * on one side -- the discovery (producer) tests stop at the emitted
 * `request_contract` blob, and the amvs (consumer) tests HAND-BUILD that blob
 * with literals (e.g. `java_type: 'LocalDate'`, `javaType: 'OrderStatus<enum>'`,
 * a top-level `inferred_date_format`). If the producer's emitted wire shape ever
 * drifted from what the consumer matches (exactly the parallel-build seam bug
 * caught when the enum marker was reconciled), BOTH sides' isolated suites would
 * still be green while production silently broke.
 *
 * These tests run the REAL discovery producer (real Java through tree-sitter ->
 * `scanRequestContracts` / `runSpringClassicAdapter`) and feed its REAL emitted
 * blob straight into the REAL amvs consumer (`readRequestContractFacts` ->
 * `classifyDataTypes`, and `enrichInventoryWithRequestContracts`). Both services'
 * pure modules are imported into this one file so the wire contract
 * (`java_type`, the `Name<enum>` enum marker, the top-level `inferred_date_format`)
 * is asserted END-TO-END and cannot drift again undetected.
 *
 * (The cross-`src` imports into the sibling amvs package transpile per-file under
 * ts-jest; the amvs consumer modules are pure and dependency-light, and the
 * native tree-sitter producer must run in discovery's custom jest environment,
 * so this project is the correct host for the seam.)
 *
 * FOLLOW-UP NOW WIRED (2026-06-23 -- the limitation this header previously
 * documented is RESOLVED): `application[-profile].{properties,yml,yaml}` config
 * files ARE now admitted to the discovery IR (via `filterConfigFiles` in
 * `languagePacks/javaLangPack/index.ts`), so the rank-1
 * `spring.jackson.date-format` rung of the global-date-format precedence ladder
 * now fires end-to-end in production too (`resolveGlobalDateFormat` reads the
 * admitted config file). End-to-end admission proof lives in
 * `springConfigFileAdmission.test.ts`. The `.java` rungs (rank 2
 * `@Configuration setDateFormat` / `Jackson2ObjectMapperBuilder`, rank 3
 * `@InitBinder`+`CustomDateEditor`, rank 4 bare `SimpleDateFormat`/`ofPattern`)
 * flow end-to-end as well. The HEADLINE end-to-end test below still sources its
 * global `dd-MMM-yyyy` from a rank-2 `.java` `@Configuration` (kept as-is --
 * exercising the rank-2 rung is still a valid wire-contract seam; the rank-1
 * config-admission path is covered separately by the admission test above).
 */

import { extractJavaIR } from '../services/extensionPacks/languageExtractors/java';
import type { SourceFileIR } from '../services/extensionPacks/languageIR';
import {
  scanRequestContracts,
} from '../services/extensionPacks/frameworkAdapters/springClassic/requestContractScanner';
import { runSpringClassicAdapter } from '../services/extensionPacks/frameworkAdapters/springClassic';
import type { DiscoveryCandidate } from '../types/candidate';

// REAL amvs consumer code (imported across the monorepo so the producer's output
// shape is exercised against the consumer's actual readers, not a re-spec).
import {
  classifyDataTypes,
} from '../../../api-migration-validation-service/src/services/dataTypeClassifier';
import {
  readRequestContractFacts,
  enrichInventoryWithRequestContracts,
} from '../../../api-migration-validation-service/src/services/requestContractEnrichment';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ir(path: string, src: string): SourceFileIR {
  const parsed = extractJavaIR(path, src);
  if (!parsed) throw new Error(`parse fail for ${path}`);
  return parsed;
}

/** The emitted `request_contract` blob off the REAL adapter, for one endpoint. */
function adapterContractFor(
  files: SourceFileIR[],
  runId: string,
  endpointName: string,
): Record<string, unknown> {
  const candidates = runSpringClassicAdapter(files, runId);
  const ep = candidates.find(
    (c: DiscoveryCandidate) => c.candidateType === 'endpoints' && c.name === endpointName,
  );
  if (!ep) throw new Error(`no endpoint candidate ${endpointName}`);
  const data = ep.data as Record<string, unknown>;
  const contract = data.request_contract as Record<string, unknown>;
  if (!contract) throw new Error(`no request_contract on ${endpointName}`);
  return contract;
}

/** Wrap a real producer contract as an AMS endpoint row (the consumer's input). */
function endpointRow(
  contract: Record<string, unknown>,
  verb = 'GET',
  path = '/things',
): Record<string, unknown> {
  return {
    id: 'ep-1',
    operation_verb: verb,
    path_or_address: path,
    request_contract: contract,
  };
}

// ===========================================================================
// SEAM 1 (HIGHEST VALUE) -- the just-fixed enum marker.
//
// The REAL producer emits a Java enum field's wire `javaType` as `Name<enum>`;
// the REAL amvs consumer (`readRequestContractFacts` -> `classifyDataTypes`)
// must detect that EXACT marker string and classify the field as `enum`. This
// asserts the producer-emitted marker IS the string the consumer's `<enum>`
// detector matches -- the contract that a parallel build previously broke.
// ===========================================================================

const ENUM_DECL = `
package com.foo.dto;
public enum OrderStatus { NEW, SETTLED, CANCELLED }
`;

const ENUM_DTO = `
package com.foo.dto;
public class OrderRequest {
  private OrderStatus status;   // un-annotated Java enum -> Name<enum> on the wire
}
`;

const ENUM_CONTROLLER = `
package com.foo.web;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import com.foo.dto.OrderRequest;

@RestController
@RequestMapping("/orders")
public class OrderController {
  @PostMapping("/place")
  public String place(@RequestBody OrderRequest req) { return "ok"; }
}
`;

describe('enum-marker wire seam: producer emits Name<enum>, consumer routes it to enum', () => {
  const files = [
    ir('OrderStatus.java', ENUM_DECL),
    ir('OrderRequest.java', ENUM_DTO),
    ir('OrderController.java', ENUM_CONTROLLER),
  ];

  it('the REAL producer emits the enum field javaType as exactly `OrderStatus<enum>`', () => {
    const contract = scanRequestContracts(files).contractsByEndpointName.get('POST /orders/place')!;
    const statusEntry = contract.param_formats.find((p) => p.name === 'status')!;
    expect(statusEntry).toBeDefined();
    // Type-only: no concrete format/pattern was invented.
    expect(statusEntry.format).toBeNull();
    expect(statusEntry.pattern).toBeNull();
    // The LOAD-BEARING wire string: the marker the amvs detector matches. If this
    // literal ever drifts, the consumer assertion below breaks in the same file.
    expect(statusEntry.javaType).toBe('OrderStatus<enum>');
  });

  it('the REAL consumer reads that exact producer marker through to an `enum` row', () => {
    const contract = scanRequestContracts(files).contractsByEndpointName.get('POST /orders/place')!;
    // Confirm `readRequestContractFacts` carries the producer's marker verbatim.
    const facts = readRequestContractFacts(endpointRow(contract as unknown as Record<string, unknown>))!;
    const statusFact = facts.paramFormats.find((p) => p.name === 'status')!;
    expect(statusFact.javaType).toBe('OrderStatus<enum>');
    // And the classifier's `<enum>`-marker detector routes it to the enum row.
    const rows = classifyDataTypes({
      endpoints: [endpointRow(contract as unknown as Record<string, unknown>)],
      oasOperations: [],
    });
    expect(rows.find((r) => r.category === 'enum')).toBeDefined();
    // A bare enum token must NEVER mis-bucket as a date/numeric row.
    expect(rows.find((r) => r.category === 'date')).toBeUndefined();
  });
});

// ===========================================================================
// SEAM 2 (HEADLINE) -- un-annotated LocalDate + a project global date format
// (sourced from a `.java` rung that actually flows end-to-end) -> the REAL
// producer's request_contract (`param_formats` java_type + top-level
// `inferred_date_format`) -> REAL amvs classifier -> Col-2 shows `dd-MMM-yyyy`
// and Col-4 seeds it.
// ===========================================================================

// Rank-2 `.java` source for the global date format (see KNOWN LIMITATION above:
// the rank-1 properties rung is inert end-to-end today, so the headline uses a
// `.java` rung to mirror production).
const JACKSON_CONFIG_DDMMMYYYY = `
package com.foo.config;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.text.SimpleDateFormat;

@Configuration
public class JacksonConfig {
  @Bean
  public ObjectMapper objectMapper() {
    ObjectMapper mapper = new ObjectMapper();
    mapper.setDateFormat(new SimpleDateFormat("dd-MMM-yyyy"));
    return mapper;
  }
}
`;

const BUSINESS_DATE_CONTROLLER = `
package com.foo.web;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import java.time.LocalDate;

@RestController
@RequestMapping("/views")
public class ViewController {
  // Un-annotated LocalDate -> a type-only param_formats entry; its wire format
  // comes from the project global converter (dd-MMM-yyyy), not an annotation.
  @GetMapping("/at")
  public String at(@RequestParam LocalDate businessDate) { return "ok"; }
}
`;

describe('HEADLINE wire seam: un-annotated LocalDate + global dd-MMM-yyyy -> Code column end-to-end', () => {
  const files = [
    ir('JacksonConfig.java', JACKSON_CONFIG_DDMMMYYYY),
    ir('ViewController.java', BUSINESS_DATE_CONTROLLER),
  ];

  it('the REAL adapter stamps a type-only entry + a top-level inferred_date_format the consumer can read', () => {
    const contract = adapterContractFor(files, 'headline-run', 'GET /views/at');
    // Type-only entry carrying the Java type (no annotation format).
    const entry = (contract.param_formats as Array<Record<string, unknown>>).find(
      (p) => p.name === 'businessDate',
    )!;
    expect(entry).toBeDefined();
    expect(entry.source).toBe('java-type');
    expect(entry.format).toBeNull();
    expect(entry.javaType).toBe('LocalDate');
    // Exactly ONE top-level inferred_date_format under the snake-case wire key the
    // consumer's `readInferredDateFormat` reads.
    const idf = contract.inferred_date_format as { format: string; source: string };
    expect(idf).toBeDefined();
    expect(idf.format).toBe('dd-MMM-yyyy');
  });

  it('the REAL consumer surfaces dd-MMM-yyyy in Col-2 and SEEDS it in Col-4', () => {
    const contract = adapterContractFor(files, 'headline-run-2', 'GET /views/at');
    const rows = classifyDataTypes({
      endpoints: [endpointRow(contract, 'GET', '/views/at')],
      oasOperations: [],
    });
    const date = rows.find((r) => r.category === 'date');
    expect(date).toBeDefined();
    // Col-2 (code) DISPLAY shows the global format, not the bare type token.
    expect(date!.codeFormats).toContain('dd-MMM-yyyy');
    expect(date!.codeFormats).not.toContain('LocalDate');
    // Col-4 SEED is the concrete global format.
    expect(date!.defaultFormat).toBe('dd-MMM-yyyy');
  });
});

// ===========================================================================
// SEAM 3 (REGRESSION GUARD, end-to-end) -- the REAL producer's type-only entry
// feeds the classifier (Col-2/Col-4) BUT does NOT override a real OAS
// `format: date` through `enrichInventoryWithRequestContracts`. Both halves are
// driven from one REAL producer blob so the seed/display path and the
// OAS-override path are proven separable on the actual wire shape.
// ===========================================================================

describe('REGRESSION GUARD wire seam: a real type-only entry seeds the classifier but is an OAS-override no-op', () => {
  const files = [ir('ViewController.java', BUSINESS_DATE_CONTROLLER)]; // NO global format

  it('classifies/displays the type token but leaves a real OAS format:date untouched (no provenance stamp)', () => {
    // The REAL producer blob: a type-only LocalDate entry, NO inferred_date_format
    // (no global converter in this file set).
    const contract = scanRequestContracts(files).contractsByEndpointName.get('GET /views/at')!;
    const entry = contract.param_formats.find((p) => p.name === 'businessDate')!;
    expect(entry.format).toBeNull();
    expect(entry.javaType).toBe('LocalDate');
    expect((contract as unknown as Record<string, unknown>).inferred_date_format).toBeUndefined();

    // (a) Classifier: with no global format the type token shows (display-only) and
    //     the SEED is the per-category standard guess -- a bare type NEVER seeds.
    const rows = classifyDataTypes({
      endpoints: [endpointRow(contract as unknown as Record<string, unknown>, 'GET', '/views/at')],
      oasOperations: [],
    });
    const date = rows.find((r) => r.category === 'date')!;
    expect(date).toBeDefined();
    expect(date.codeFormats).toContain('LocalDate'); // display-only token
    expect(date.defaultFormat).toBe('yyyy-MM-dd'); // standard guess, NOT the token

    // (b) OAS-override path: feed the SAME real blob through
    //     `enrichInventoryWithRequestContracts` against a real OAS `format: date`.
    //     The type-only entry must be a NO-OP (no clobber, no x-amvs-source stamp).
    const oasOperation = {
      operationId: 'viewAt',
      parameters: [
        { name: 'businessDate', in: 'query', required: true, schema: { type: 'string', format: 'date' } },
      ],
      responses: {},
    } as unknown as Record<string, unknown>;
    const inventory = {
      title: 'T',
      version: '1.0.0',
      operations: [
        {
          operationId: 'viewAt',
          method: 'get',
          path: '/views/at',
          summary: null,
          description: null,
          requestSchema: null,
          responseSchema: null,
          oasOperation,
        },
      ],
    } as unknown as Parameters<typeof enrichInventoryWithRequestContracts>[0];

    enrichInventoryWithRequestContracts(inventory, [
      endpointRow(contract as unknown as Record<string, unknown>, 'GET', '/views/at'),
    ]);

    const params = oasOperation.parameters as Array<Record<string, unknown>>;
    const schema = params.find((p) => p.name === 'businessDate')!.schema as Record<string, unknown>;
    // The real OAS format:date is UNTOUCHED; the bare type token never wins here.
    expect(schema.format).toBe('date');
    expect(schema.pattern).toBeUndefined();
    expect(schema['x-amvs-source']).toBeUndefined();
    expect(oasOperation['x-amvs-source']).toBeUndefined();
  });
});
