/**
 * Tests for the Signal-#1 Java-TYPE capture in the request-contract scanner
 * (`extensionPacks/frameworkAdapters/springClassic/requestContractScanner.ts`).
 *
 * Spec: 2026-06-22 Spring Classic code-evidence format extraction -- Task Group 1.
 *
 * Focused per the discovery test conventions: real Java source through
 * `extractJavaIR`, NO LLM call (the scanner is pure). Covers:
 *   (a) an un-annotated `LocalDate` / `BigDecimal` / `Long` / `UUID` / Java enum
 *       field -> a type-only `param_formats` entry carrying `javaType`
 *       (`source: 'java-type'`, NO `format`/`pattern`);
 *   (b) `List<LocalDate>` / `LocalDate[]` -> unwrap ONE level (entry carries the
 *       unwrapped type);
 *   (c) a `String` field AND an unrecognised/unknown type -> NO entry emitted;
 *   (d) an annotated field (`@JsonFormat` / `@DateTimeFormat`) keeps its
 *       `format`/`pattern`/`source` (NOT `source: 'java-type'`).
 */

import { extractJavaIR } from '../services/extensionPacks/languageExtractors/java';
import type { SourceFileIR } from '../services/extensionPacks/languageIR';
import {
  scanRequestContracts,
  javaTypeCategory,
} from '../services/extensionPacks/frameworkAdapters/springClassic/requestContractScanner';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// A request DTO with a SPREAD of un-annotated types (the Signal-#1 surface) plus
// one annotated field (the high-confidence path that must stay unchanged) and a
// String + an unknown type (which must produce NO entry).
const TYPES_REQUEST = `
package com.foo.dto;
import com.fasterxml.jackson.annotation.JsonFormat;
import java.time.LocalDate;
import java.math.BigDecimal;
import java.util.UUID;
import java.util.List;

public class TypesRequest {
  // Un-annotated temporal/decimal/numeric/uuid/enum -> type-only entries.
  private LocalDate businessDate;
  private BigDecimal amount;
  private Long id;
  private UUID correlationId;
  private Status status;

  // List<X> / X[] -> unwrap ONE level.
  private List<LocalDate> holidays;
  private LocalDate[] settlementDates;

  // String + unknown -> NO entry.
  private String currency;
  private SomeOpaqueThing widget;

  // Annotated -> UNCHANGED (keeps format/pattern + @JsonFormat source).
  @JsonFormat(pattern = "dd-MMM-yyyy")
  private LocalDate maturityDate;
}
`;

const STATUS_ENUM = `
package com.foo.dto;
public enum Status { ACTIVE, CLOSED }
`;

const TYPES_CONTROLLER = `
package com.foo.web;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.PathVariable;
import com.foo.dto.TypesRequest;

@RestController
@RequestMapping("/types")
public class TypesController {

  @PostMapping(value = "/run", consumes = "application/json")
  public String run(@RequestBody TypesRequest req) {
    return "ok";
  }

  // Un-annotated path/query params carry their Java types too.
  @GetMapping("/by/{businessDate}")
  public String by(
      @PathVariable LocalDate businessDate,
      @RequestParam Long page,
      @RequestParam String note) {
    return "ok";
  }
}
`;

function ir(path: string, src: string): SourceFileIR {
  const parsed = extractJavaIR(path, src);
  if (!parsed) throw new Error(`parse fail for ${path}`);
  return parsed;
}

function scan() {
  return scanRequestContracts([
    ir('Status.java', STATUS_ENUM),
    ir('TypesRequest.java', TYPES_REQUEST),
    ir('TypesController.java', TYPES_CONTROLLER),
  ]);
}

// ---------------------------------------------------------------------------
// (1) The pure type->category mapping helper.
// ---------------------------------------------------------------------------

describe('javaTypeCategory (deterministic mapping)', () => {
  const enums = new Set<string>(['Status']);

  it('maps temporal/decimal/numeric/uuid types by simple name (FQ-tolerant)', () => {
    expect(javaTypeCategory('LocalDate', enums)).toBe('date');
    expect(javaTypeCategory('java.time.LocalDate', enums)).toBe('date');
    expect(javaTypeCategory('LocalDateTime', enums)).toBe('datetime');
    expect(javaTypeCategory('java.time.Instant', enums)).toBe('datetime');
    expect(javaTypeCategory('LocalTime', enums)).toBe('time');
    expect(javaTypeCategory('BigDecimal', enums)).toBe('decimal');
    expect(javaTypeCategory('double', enums)).toBe('decimal');
    expect(javaTypeCategory('Long', enums)).toBe('numeric_id');
    expect(javaTypeCategory('int', enums)).toBe('numeric_id');
    expect(javaTypeCategory('boolean', enums)).toBe('boolean');
    expect(javaTypeCategory('UUID', enums)).toBe('uuid');
  });

  it('maps a known Java enum to enum and unwraps List<X> / X[] one level', () => {
    expect(javaTypeCategory('Status', enums)).toBe('enum');
    expect(javaTypeCategory('List<LocalDate>', enums)).toBe('date');
    expect(javaTypeCategory('LocalDate[]', enums)).toBe('date');
    expect(javaTypeCategory('java.util.List<java.math.BigDecimal>', enums)).toBe('decimal');
  });

  it('SKIPS String, Object, and unknown/non-enum types (returns null)', () => {
    expect(javaTypeCategory('String', enums)).toBeNull();
    expect(javaTypeCategory('Object', enums)).toBeNull();
    expect(javaTypeCategory('SomeOpaqueThing', enums)).toBeNull();
    expect(javaTypeCategory('List<String>', enums)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (2) Type-only param_formats entries off un-annotated DTO fields.
// ---------------------------------------------------------------------------

describe('requestContractScanner -- type-only param_formats (body DTO fields)', () => {
  const contract = scan().contractsByEndpointName.get('POST /types/run')!;

  function bodyEntry(name: string) {
    return contract.param_formats.find((p) => p.name === name && p.location === 'body');
  }

  it('emits a type-only entry carrying javaType for an un-annotated LocalDate (no format/pattern)', () => {
    const e = bodyEntry('businessDate')!;
    expect(e).toBeDefined();
    expect(e.source).toBe('java-type');
    expect(e.format).toBeNull();
    expect(e.pattern).toBeNull();
    expect(javaTypeCategory(e.javaType!, new Set())).toBe('date');
  });

  it('carries the resolved javaType for BigDecimal / Long / UUID / enum (-> decimal/numeric_id/uuid/enum)', () => {
    expect(javaTypeCategory(bodyEntry('amount')!.javaType!, new Set())).toBe('decimal');
    expect(javaTypeCategory(bodyEntry('id')!.javaType!, new Set())).toBe('numeric_id');
    expect(javaTypeCategory(bodyEntry('correlationId')!.javaType!, new Set())).toBe('uuid');
    // Status is a Java enum (resolved from the enum index built off rawContent).
    const status = bodyEntry('status')!;
    expect(status.source).toBe('java-type');
    expect(javaTypeCategory(status.javaType!, new Set(['Status']))).toBe('enum');
  });

  it('unwraps List<LocalDate> and LocalDate[] one level (still classifies as date)', () => {
    expect(javaTypeCategory(bodyEntry('holidays')!.javaType!, new Set())).toBe('date');
    expect(javaTypeCategory(bodyEntry('settlementDates')!.javaType!, new Set())).toBe('date');
  });

  it('emits NO entry for a String field or an unrecognised type', () => {
    expect(bodyEntry('currency')).toBeUndefined();
    expect(bodyEntry('widget')).toBeUndefined();
  });

  it('leaves the @JsonFormat-annotated field UNCHANGED (keeps format/pattern + @JsonFormat source)', () => {
    const e = bodyEntry('maturityDate')!;
    expect(e).toBeDefined();
    expect(e.format).toBe('dd-MMM-yyyy');
    expect(e.pattern).toBe('dd-MMM-yyyy');
    expect(e.source).toBe('@JsonFormat');
    expect(e.source).not.toBe('java-type');
  });
});

// ---------------------------------------------------------------------------
// (3) Type-only entries off un-annotated path/query params.
// ---------------------------------------------------------------------------

describe('requestContractScanner -- type-only param_formats (path/query params)', () => {
  const contract = scan().contractsByEndpointName.get('GET /types/by/{businessDate}')!;

  it('emits a path-located type-only entry for an un-annotated @PathVariable LocalDate', () => {
    const e = contract.param_formats.find((p) => p.name === 'businessDate' && p.location === 'path')!;
    expect(e).toBeDefined();
    expect(e.source).toBe('java-type');
    expect(e.format).toBeNull();
    expect(javaTypeCategory(e.javaType!, new Set())).toBe('date');
  });

  it('emits a query-located type-only entry for an un-annotated @RequestParam Long; skips the String param', () => {
    const page = contract.param_formats.find((p) => p.name === 'page' && p.location === 'query')!;
    expect(page).toBeDefined();
    expect(javaTypeCategory(page.javaType!, new Set())).toBe('numeric_id');
    expect(contract.param_formats.find((p) => p.name === 'note')).toBeUndefined();
  });
});
