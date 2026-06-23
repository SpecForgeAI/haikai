/**
 * SCAN-LEVEL wiring test for the `request_format_unresolved` Finding.
 *
 * Spec: 2026-06-22 Spring Classic code-evidence format extraction --
 * Task Group 3 / follow-up wiring.
 *
 * `detectCustomSerializerFields` (the pure detector) and
 * `buildRequestFormatUnresolvedFinding` (the Finding builder) were unit-tested in
 * `requestFormatUnresolvedFinding.test.ts`, but nothing CALLED the detector during
 * a live scan -- so in production the Finding never fired. This test runs the REAL
 * Spring-Classic pack finding scanner (`runSpringClassicFindingScanner`) over a
 * controller whose @RequestBody DTO carries a custom Jackson (de)serializer and
 * asserts the scan EMITS a `request_format_unresolved` info Finding carrying the
 * field + endpoint + serializer class (and guesses NO format).
 */

import { extractJavaIR } from '../services/extensionPacks/languageExtractors/java';
import type { SourceFileIR } from '../services/extensionPacks/languageIR';
import { runSpringClassicFindingScanner } from '../services/findings/packFindingScanners/springClassicFindingScanner';
import type { PackFindingScannerInput } from '../services/findings/packFindingScanners';

function ir(path: string, src: string): SourceFileIR {
  const parsed = extractJavaIR(path, src);
  if (!parsed) throw new Error(`parse fail for ${path}`);
  return parsed;
}

const CUSTOM_SER_REQUEST = `
package com.foo.dto;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;

public class CustomSerRequest {
  @JsonSerialize(using = MoneySerializer.class)
  private java.math.BigDecimal amount;

  @JsonDeserialize(using = FunkyDateDeserializer.class)
  private java.time.LocalDate businessDate;

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

function scannerInput(): PackFindingScannerInput {
  const irFiles = new Map<string, SourceFileIR>([
    ['CustomSerRequest.java', ir('CustomSerRequest.java', CUSTOM_SER_REQUEST)],
    ['CustomSerController.java', ir('CustomSerController.java', CUSTOM_SER_CONTROLLER)],
  ]);
  return { runId: 'rfu-scan-run', irFiles, packCandidates: [] };
}

describe('runSpringClassicFindingScanner -- request_format_unresolved emission (scan-level)', () => {
  const findings = runSpringClassicFindingScanner(scannerInput());
  const rfu = findings.filter(
    (f) =>
      f.findingType === 'evidence_gap' &&
      (f.detailJson as Record<string, unknown>)?.gapType === 'request_format_unresolved',
  );

  it('EMITS a request_format_unresolved Finding during the scan (not just the unit detector)', () => {
    expect(rfu.length).toBeGreaterThanOrEqual(2);
  });

  it('the @JsonSerialize field emits an info Finding with field + endpoint + serializer class', () => {
    const amount = rfu.find(
      (f) => (f.detailJson as Record<string, unknown>).field === 'amount',
    );
    expect(amount).toBeDefined();
    expect(amount!.severity).toBe('info');
    const detail = amount!.detailJson as Record<string, unknown>;
    expect(detail.endpoint).toBe('POST /cs/run');
    expect(detail.serializerClass).toBe('MoneySerializer');
  });

  it('the @JsonDeserialize field emits its own Finding too', () => {
    const date = rfu.find(
      (f) => (f.detailJson as Record<string, unknown>).field === 'businessDate',
    );
    expect(date).toBeDefined();
    const detail = date!.detailJson as Record<string, unknown>;
    expect(detail.endpoint).toBe('POST /cs/run');
    expect(detail.serializerClass).toBe('FunkyDateDeserializer');
  });

  it('a plain field (no custom (de)serializer) emits NO such Finding', () => {
    expect(
      rfu.find((f) => (f.detailJson as Record<string, unknown>).field === 'currency'),
    ).toBeUndefined();
  });

  it('guesses NO format -- no serializer-class name leaks into a format-like field', () => {
    for (const f of rfu) {
      const detail = f.detailJson as Record<string, unknown>;
      // detail carries the serializerClass for review, NEVER a guessed format/pattern.
      expect('format' in detail).toBe(false);
      expect('pattern' in detail).toBe(false);
    }
  });
});
