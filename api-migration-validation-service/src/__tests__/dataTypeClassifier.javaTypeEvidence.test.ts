/**
 * Focused unit tests for the Spring-Classic code-evidence type wiring + global
 * date-format application in the data-type classifier.
 *
 * Spec: 2026-06-22 Spring Classic code-evidence format extraction -- Task Group 5
 * (amvs `dataTypeClassifier` type wiring + global-format application).
 *
 * The discovery Spring-Classic pack now emits TYPE-ONLY `param_formats[]` entries
 * (a `java_type`, no `format`/`pattern`) and ONE top-level `inferred_date_format`
 * per endpoint `request_contract`. amvs must:
 *   - supply the Java type to `evidenceFromCode` (instead of the hard-coded
 *     `oasType: null`) so `classifyField` buckets the field from CODE: temporal
 *     types route via `oasFormat` (date/date-time/time), `UUID` via `oasFormat`,
 *     a Java enum via `hasEnum`, and ONLY numeric/decimal/boolean via `oasType`
 *     (a bare numeric/string token must NEVER mis-bucket a date);
 *   - apply the global `inferred_date_format` to a TYPE-ONLY date/datetime entry:
 *     Col-2 (code) DISPLAYS the global format when present (else the bare type
 *     token, display-only), and Col-4 SEEDS only off a CONCRETE global format (a
 *     bare type token never seeds -- it falls to the per-category standard guess).
 *
 * The annotation-beats-type ordering still holds (a concrete code format wins
 * classification + seed over the bare type).
 */

import { classifyDataTypes, type ClassifyInput } from '../services/dataTypeClassifier';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build an AMS endpoint row carrying a `request_contract` with type-only and/or
 * concrete `param_formats[]` entries, plus an optional top-level
 * `inferred_date_format`.
 */
function endpoint(opts: {
  paramFormats: Array<{
    name: string;
    location?: string;
    format?: string | null;
    pattern?: string | null;
    javaType?: string | null;
    source?: string;
  }>;
  inferredDateFormat?: { format: string; source?: string; confidence?: string } | null;
}): Record<string, unknown> {
  const contract: Record<string, unknown> = {
    param_formats: opts.paramFormats.map((p) => ({
      name: p.name,
      location: p.location ?? 'query',
      format: p.format ?? null,
      pattern: p.pattern ?? null,
      ...(p.javaType !== undefined ? { java_type: p.javaType } : {}),
      source: p.source ?? 'java-type',
    })),
  };
  if (opts.inferredDateFormat) {
    contract.inferred_date_format = opts.inferredDateFormat;
  }
  return {
    id: `ep-${Math.random().toString(36).slice(2, 8)}`,
    operation_verb: 'GET',
    path_or_address: '/things',
    request_contract: contract,
  };
}

function classify(input: Partial<ClassifyInput>): ReturnType<typeof classifyDataTypes> {
  return classifyDataTypes({
    endpoints: input.endpoints ?? [],
    oasOperations: input.oasOperations ?? [],
  });
}

function rowFor(
  rows: ReturnType<typeof classifyDataTypes>,
  category: string,
): ReturnType<typeof classifyDataTypes>[number] | undefined {
  return rows.find((r) => r.category === category);
}

// ---------------------------------------------------------------------------
// 1. HEADLINE: an un-annotated LocalDate + global `dd-MMM-yyyy` -> date; Col-2
//    DISPLAYS the global format; Col-4 SEEDS it.
// ---------------------------------------------------------------------------
test('un-annotated LocalDate + global inferred_date_format -> date, Col-2 shows the global format, Col-4 seeds it', () => {
  const rows = classify({
    endpoints: [
      endpoint({
        paramFormats: [{ name: 'businessDate', javaType: 'LocalDate' }],
        inferredDateFormat: { format: 'dd-MMM-yyyy', source: 'spring.jackson.date-format', confidence: 'high' },
      }),
    ],
  });

  const date = rowFor(rows, 'date');
  expect(date).toBeDefined();
  // Col-2 (code) DISPLAY shows the global format, not the bare type token.
  expect(date!.codeFormats).toContain('dd-MMM-yyyy');
  expect(date!.codeFormats).not.toContain('LocalDate');
  // Col-4 SEED is the concrete global format.
  expect(date!.defaultFormat).toBe('dd-MMM-yyyy');
});

// ---------------------------------------------------------------------------
// 2. numeric_id (Long), decimal (BigDecimal), boolean -> each classifies purely
//    from CODE (no annotation, no OAS). These are UNAFFECTED by any global date
//    format.
// ---------------------------------------------------------------------------
test('Long/BigDecimal/boolean type-only entries classify from CODE', () => {
  const rows = classify({
    endpoints: [
      endpoint({
        paramFormats: [
          { name: 'customerId', javaType: 'Long' },
          { name: 'amount', javaType: 'BigDecimal' },
          { name: 'active', javaType: 'boolean' },
        ],
      }),
    ],
  });

  expect(rowFor(rows, 'numeric_id')).toBeDefined();
  expect(rowFor(rows, 'decimal')).toBeDefined();
  expect(rowFor(rows, 'boolean')).toBeDefined();
  // A bare numeric/string token never mis-buckets a date.
  expect(rowFor(rows, 'date')).toBeUndefined();
});

// ---------------------------------------------------------------------------
// 3. UUID -> uuid; a Java enum type-only entry -> enum (via hasEnum-equivalent
//    routing, NOT oasType).
// ---------------------------------------------------------------------------
test('UUID -> uuid and a Java enum type -> enum', () => {
  const uuidRows = classify({
    endpoints: [endpoint({ paramFormats: [{ name: 'recordId', javaType: 'UUID' }] })],
  });
  expect(rowFor(uuidRows, 'uuid')).toBeDefined();

  const enumRows = classify({
    endpoints: [endpoint({ paramFormats: [{ name: 'status', javaType: 'OrderStatus<enum>' }] })],
  });
  expect(rowFor(enumRows, 'enum')).toBeDefined();
});

// ---------------------------------------------------------------------------
// 4. A type-only DATE field with NO global format: Col-2 DISPLAYS the type token
//    (display-only), Col-4 SEEDS the STANDARD guess (NOT the bare type token).
// ---------------------------------------------------------------------------
test('type-only date with NO global format shows the type token but seeds the standard guess', () => {
  const rows = classify({
    endpoints: [endpoint({ paramFormats: [{ name: 'effectiveDate', javaType: 'LocalDate' }] })],
  });

  const date = rowFor(rows, 'date');
  expect(date).toBeDefined();
  // Col-2 DISPLAY shows the bare type token (no global format present).
  expect(date!.codeFormats).toContain('LocalDate');
  // Col-4 SEED is the per-category standard guess, NOT the bare type token.
  expect(date!.defaultFormat).toBe('yyyy-MM-dd');
  expect(date!.defaultFormat).not.toBe('LocalDate');
});

// ---------------------------------------------------------------------------
// 5. A type-only DATETIME entry (LocalDateTime/Instant) with a global format ->
//    datetime; Col-2 shows the global format; Col-4 seeds it. The global format
//    feeds BOTH temporal categories.
// ---------------------------------------------------------------------------
test('type-only LocalDateTime + global format -> datetime, Col-2 shows + Col-4 seeds the global format', () => {
  const rows = classify({
    endpoints: [
      endpoint({
        paramFormats: [{ name: 'createdAt', javaType: 'LocalDateTime' }],
        inferredDateFormat: { format: 'dd-MMM-yyyy HH:mm', source: 'SimpleDateFormat', confidence: 'low' },
      }),
    ],
  });

  const datetime = rowFor(rows, 'datetime');
  expect(datetime).toBeDefined();
  expect(datetime!.codeFormats).toContain('dd-MMM-yyyy HH:mm');
  expect(datetime!.defaultFormat).toBe('dd-MMM-yyyy HH:mm');
  // It classified as datetime (not date) -- the type drives the category.
  expect(rowFor(rows, 'date')).toBeUndefined();
});

// ---------------------------------------------------------------------------
// 6. ANNOTATION BEATS TYPE: a concrete code `format`/`pattern` (annotation-
//    derived) on the SAME field wins classification + seed over the bare type
//    AND over the global date format.
// ---------------------------------------------------------------------------
test('a concrete annotation format beats the type and the global date format', () => {
  const rows = classify({
    endpoints: [
      endpoint({
        // Annotation supplied a concrete pattern; the type is also carried, and a
        // (different) global format exists. The concrete annotation pattern wins.
        paramFormats: [{ name: 'tradeDate', javaType: 'LocalDate', pattern: 'yyyy/MM/dd' }],
        inferredDateFormat: { format: 'dd-MMM-yyyy', source: 'spring.jackson.date-format' },
      }),
    ],
  });

  const date = rowFor(rows, 'date');
  expect(date).toBeDefined();
  // The concrete annotation pattern is displayed + seeded -- NOT the global format,
  // NOT the bare type token.
  expect(date!.codeFormats).toContain('yyyy/MM/dd');
  expect(date!.codeFormats).not.toContain('dd-MMM-yyyy');
  expect(date!.codeFormats).not.toContain('LocalDate');
  expect(date!.defaultFormat).toBe('yyyy/MM/dd');
});

// ---------------------------------------------------------------------------
// 7. List<LocalDate> / fully-qualified java.time.LocalDate still classify as
//    date (the producer unwraps + strips packages; amvs maps the simple name).
// ---------------------------------------------------------------------------
test('fully-qualified java.time types and unwrapped collection element types map by simple name', () => {
  const rows = classify({
    endpoints: [
      endpoint({
        paramFormats: [
          { name: 'fromDate', javaType: 'java.time.LocalDate' },
          { name: 'price', javaType: 'java.math.BigDecimal' },
        ],
      }),
    ],
  });
  expect(rowFor(rows, 'date')).toBeDefined();
  expect(rowFor(rows, 'decimal')).toBeDefined();
});
