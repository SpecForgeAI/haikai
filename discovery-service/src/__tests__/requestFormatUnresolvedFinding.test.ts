/**
 * Tests for the Signal-#1 detect-or-flag of custom (de)serializers
 * (`@JsonSerialize` / `@JsonDeserialize(using=SomeSerializer.class)`), which hide
 * the wire format inside a separate class.
 *
 * Spec: 2026-06-22 Spring Classic code-evidence format extraction -- Task Group 3.
 *
 * Two surfaces:
 *   (a) the pure detector `detectCustomSerializerFields` (in requestContractScanner)
 *       finds a `@JsonSerialize`/`@JsonDeserialize(using=Class)` field, carries the
 *       field name + endpoint + referenced serializer class, and NEVER invents a
 *       `param_formats` `format`/`pattern` from it;
 *   (b) the Finding builder `buildRequestFormatUnresolvedFinding` (in
 *       emissionSources) emits an `evidence_gap` Finding with
 *       `gapType: 'request_format_unresolved'`, severity `info`, carrying the
 *       same detail.
 */

import { extractJavaIR } from '../services/extensionPacks/languageExtractors/java';
import type { SourceFileIR } from '../services/extensionPacks/languageIR';
import {
  scanRequestContracts,
  detectCustomSerializerFields,
} from '../services/extensionPacks/frameworkAdapters/springClassic/requestContractScanner';
import { buildRequestFormatUnresolvedFinding } from '../services/findings/emissionSources';

function ir(path: string, src: string): SourceFileIR {
  const parsed = extractJavaIR(path, src);
  if (!parsed) throw new Error(`parse fail for ${path}`);
  return parsed;
}

// A request DTO whose money + date fields use CUSTOM (de)serializers (format is
// hidden in MoneySerializer / FunkyDateDeserializer, NOT on the field).
const CUSTOM_SER_REQUEST = `
package com.foo.dto;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;

public class CustomSerRequest {
  @JsonSerialize(using = MoneySerializer.class)
  private java.math.BigDecimal amount;

  @JsonDeserialize(using = FunkyDateDeserializer.class)
  private java.time.LocalDate businessDate;

  // A plain field with NO custom (de)serializer -> NOT flagged.
  private String currency;
}
`;

const CUSTOM_SER_CONTROLLER = `
package com.foo.web;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import com.foo.dto.CustomSerRequest;

@RestController
@RequestMapping("/cs")
public class CustomSerController {
  @PostMapping("/run")
  public String run(@RequestBody CustomSerRequest req) {
    return "ok";
  }
}
`;

function files() {
  return [
    ir('CustomSerRequest.java', CUSTOM_SER_REQUEST),
    ir('CustomSerController.java', CUSTOM_SER_CONTROLLER),
  ];
}

// ---------------------------------------------------------------------------
// (a) The pure detector.
// ---------------------------------------------------------------------------

describe('detectCustomSerializerFields', () => {
  const hits = detectCustomSerializerFields(files());

  it('flags a @JsonSerialize(using=Class) field with field + endpoint + serializer class', () => {
    const amount = hits.find((h) => h.field === 'amount')!;
    expect(amount).toBeDefined();
    expect(amount.endpoint).toBe('POST /cs/run');
    expect(amount.serializerClass).toBe('MoneySerializer');
  });

  it('flags a @JsonDeserialize(using=Class) field too', () => {
    const date = hits.find((h) => h.field === 'businessDate')!;
    expect(date).toBeDefined();
    expect(date.endpoint).toBe('POST /cs/run');
    expect(date.serializerClass).toBe('FunkyDateDeserializer');
  });

  it('does NOT flag a plain field with no custom (de)serializer', () => {
    expect(hits.find((h) => h.field === 'currency')).toBeUndefined();
  });

  it('guesses NO format -- the custom-(de)serializer fields produce no concrete param_formats format/pattern', () => {
    const contract = scanRequestContracts(files()).contractsByEndpointName.get('POST /cs/run')!;
    const amount = contract.param_formats.find((p) => p.name === 'amount');
    const date = contract.param_formats.find((p) => p.name === 'businessDate');
    // BigDecimal/LocalDate still emit a TYPE-ONLY entry (Signal #1), but NEVER a
    // concrete format/pattern invented from the serializer class.
    if (amount) {
      expect(amount.format).toBeNull();
      expect(amount.pattern).toBeNull();
    }
    if (date) {
      expect(date.format).toBeNull();
      expect(date.pattern).toBeNull();
    }
    // And no entry anywhere references the serializer-class names as a format.
    const anySerializerLeak = contract.param_formats.some(
      (p) => p.format === 'MoneySerializer' || p.format === 'FunkyDateDeserializer',
    );
    expect(anySerializerLeak).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (b) The Finding builder.
// ---------------------------------------------------------------------------

describe('buildRequestFormatUnresolvedFinding', () => {
  it('emits an evidence_gap Finding (gapType request_format_unresolved, severity info) carrying the detail', () => {
    const f = buildRequestFormatUnresolvedFinding({
      field: 'amount',
      endpoint: 'POST /cs/run',
      serializerClass: 'MoneySerializer',
    });
    expect(f.findingType).toBe('evidence_gap');
    expect(f.category).toBe('evidence_gap');
    expect(f.severity).toBe('info');
    const detail = f.detailJson as Record<string, unknown>;
    expect(detail.gapType).toBe('request_format_unresolved');
    expect(detail.field).toBe('amount');
    expect(detail.endpoint).toBe('POST /cs/run');
    expect(detail.serializerClass).toBe('MoneySerializer');
  });
});
