/**
 * Baseline wire-format miner (2026-08-17) — deterministic extraction of
 * WIRE-LEVEL facts from the captured current-state API baseline, so generated
 * specs pin the legacy formats instead of letting an implementer default to
 * framework idioms.
 *
 * Born from a live reconcile with 0/470 operations matching, where three
 * exception classes in the target traced to spec gaps:
 *   - date path/query params generated as ISO (`@DateTimeFormat(iso=DATE)`)
 *     while the legacy wire speaks `dd-MMM-yyyy` ("31-Dec-9999");
 *   - identifiers generated as `Long` while captured values run to 34 digits
 *     (legacy numeric(38) sentinels);
 *   - responses unwritable under captured Accept headers (converter /
 *     content-negotiation posture never derived from observed behaviour).
 *
 * All of this is ALREADY in the pinned baseline — the miner walks the
 * captured items and produces {@link BaselineWireFacts}; two builders render
 * the facts as (a) a deterministic spec section appended to every
 * service-plane story spec and (b) scaffold-spec bootstrap requirements for
 * the app-wide seams. Everything cites its mined evidence; caps are stated
 * loudly (never silently truncated).
 */

import {
  ApiBehaviourBaselineItemWire,
  fetchActiveCurrentBaseline,
  fetchBaselineItems,
} from './migrationDriverAmsReads';

// ============================================================================
// Fact shapes
// ============================================================================

/** One observed non-ISO date wire format. */
export interface WireDateFact {
  /** Human name of the observed pattern, e.g. `dd-MMM-yyyy`. */
  pattern: string;
  /** The Java DateTimeFormatter pattern to pin, e.g. `dd-MMM-uuuu`. */
  javaPattern: string;
  /** Up to 3 verbatim example values. */
  examples: string[];
  /** Up to 5 `<METHOD> <path>` operations the values were seen on. */
  operations: string[];
  /** Total operations the pattern was seen on (may exceed operations.length). */
  operationCount: number;
  /** Seen in request material (path / query / request body). */
  inRequests: boolean;
  /** Seen in response bodies (drives the response-rendering requirement). */
  inResponses: boolean;
}

/** Numeric tokens wider than int64 (>18 digits) — the Long-overflow trap. */
export interface WireWideNumericFact {
  maxDigits: number;
  examples: string[];
  operations: string[];
  operationCount: number;
}

/** Observed request-Accept vs response-Content-Type posture. */
export interface WireMediaFact {
  /** Distinct request Accept values observed (raw, first 6). */
  requestAccepts: string[];
  /** Distinct response Content-Type base types observed (first 6). */
  responseContentTypes: string[];
  /**
   * TRUE when requests carried >1 distinct concrete Accept but every captured
   * response used ONE content type — the legacy "ignore the Accept header"
   * posture the target must mirror.
   */
  mixedAcceptSingleResponse: boolean;
}

export interface BaselineWireFacts {
  itemCount: number;
  dateFacts: WireDateFact[];
  wideNumeric: WireWideNumericFact | null;
  media: WireMediaFact | null;
  /** Non-standard request header names observed (first 8). */
  customHeaderNames: string[];
}

// ============================================================================
// Mining
// ============================================================================

/** The date shapes the miner recognises (conservative — no guessy formats). */
const DATE_MATCHERS: Array<{ pattern: string; javaPattern: string; re: RegExp }> = [
  {
    pattern: 'dd-MMM-yyyy',
    javaPattern: 'dd-MMM-uuuu',
    re: /^\d{1,2}-[A-Z][a-z]{2}-\d{4}$/,
  },
  {
    pattern: 'dd/MM/yyyy',
    javaPattern: 'dd/MM/uuuu',
    re: /^\d{2}\/\d{2}\/\d{4}$/,
  },
];

const STANDARD_HEADERS = new Set([
  'accept',
  'accept-encoding',
  'accept-language',
  'authorization',
  'cache-control',
  'connection',
  'content-length',
  'content-type',
  'cookie',
  'host',
  'keep-alive',
  'origin',
  'referer',
  'transfer-encoding',
  'user-agent',
]);

const WIDE_NUMERIC_RE = /^\d{19,}$/;
const MAX_STRINGS_PER_ITEM = 300;

/** Collect string values out of an arbitrary JSON value (depth/width capped). */
function collectStrings(value: unknown, out: string[], depth = 0): void {
  if (out.length >= MAX_STRINGS_PER_ITEM || depth > 8) return;
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out, depth + 1);
    return;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectStrings(v, out, depth + 1);
    }
  }
}

/** Case-insensitive single-header read off a captured headers record. */
function headerValue(
  headers: Record<string, unknown> | null | undefined,
  name: string
): string | null {
  if (!headers) return null;
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === name && typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

/** Mine {@link BaselineWireFacts} from the captured baseline items. Pure. */
export function mineBaselineWireFacts(
  items: readonly ApiBehaviourBaselineItemWire[]
): BaselineWireFacts {
  interface DateAcc {
    examples: Set<string>;
    operations: Set<string>;
    inRequests: boolean;
    inResponses: boolean;
  }
  const dateAcc = new Map<string, DateAcc>();
  const wideExamples = new Set<string>();
  const wideOperations = new Set<string>();
  let wideMax = 0;
  const accepts = new Set<string>();
  const responseTypes = new Set<string>();
  const customHeaders = new Set<string>();

  const recordDates = (tokens: string[], op: string, side: 'request' | 'response') => {
    for (const token of tokens) {
      for (const m of DATE_MATCHERS) {
        if (m.re.test(token)) {
          let acc = dateAcc.get(m.pattern);
          if (!acc) {
            acc = { examples: new Set(), operations: new Set(), inRequests: false, inResponses: false };
            dateAcc.set(m.pattern, acc);
          }
          acc.examples.add(token);
          acc.operations.add(op);
          if (side === 'request') acc.inRequests = true;
          else acc.inResponses = true;
        }
      }
    }
  };

  for (const item of items) {
    const op = `${(item.method ?? 'GET').toUpperCase()} ${item.path ?? '/'}`;

    // --- Request-side tokens: path segments + query values + body strings. --
    const requestTokens: string[] = [];
    for (const seg of (item.path ?? '').split('/')) {
      if (seg.length > 0) requestTokens.push(decodeURIComponentSafe(seg));
    }
    const query = item.request_json?.query ?? null;
    if (query) collectStrings(query, requestTokens);
    collectStrings(item.request_json?.body, requestTokens);
    recordDates(requestTokens, op, 'request');

    // Wide numerics only from ADDRESSING material (path + query) — a wide
    // digit string inside a body could be anything; path/query is where the
    // Long-typed binding breaks.
    const addressingTokens: string[] = [];
    for (const seg of (item.path ?? '').split('/')) {
      if (seg.length > 0) addressingTokens.push(decodeURIComponentSafe(seg));
    }
    if (query) collectStrings(query, addressingTokens);
    for (const token of addressingTokens) {
      if (WIDE_NUMERIC_RE.test(token)) {
        wideExamples.add(token);
        wideOperations.add(op);
        if (token.length > wideMax) wideMax = token.length;
      }
    }

    // --- Response-side tokens (rendering fidelity). ------------------------
    const responseTokens: string[] = [];
    collectStrings(item.response_json?.body, responseTokens);
    recordDates(responseTokens, op, 'response');

    // --- Media posture + custom headers. -----------------------------------
    const reqHeaders = item.request_json?.headers ?? null;
    const accept = headerValue(reqHeaders, 'accept');
    if (accept && accept !== '*/*') accepts.add(accept);
    const respType = headerValue(item.response_json?.headers ?? null, 'content-type');
    if (respType) responseTypes.add(respType.split(';')[0].trim().toLowerCase());
    if (reqHeaders) {
      for (const name of Object.keys(reqHeaders)) {
        if (!STANDARD_HEADERS.has(name.toLowerCase())) customHeaders.add(name);
      }
    }
  }

  const dateFacts: WireDateFact[] = [];
  for (const [pattern, acc] of dateAcc.entries()) {
    const matcher = DATE_MATCHERS.find((m) => m.pattern === pattern);
    dateFacts.push({
      pattern,
      javaPattern: matcher?.javaPattern ?? pattern,
      examples: [...acc.examples].slice(0, 3),
      operations: [...acc.operations].slice(0, 5),
      operationCount: acc.operations.size,
      inRequests: acc.inRequests,
      inResponses: acc.inResponses,
    });
  }

  const media: WireMediaFact | null =
    accepts.size > 0 || responseTypes.size > 0
      ? {
          requestAccepts: [...accepts].slice(0, 6),
          responseContentTypes: [...responseTypes].slice(0, 6),
          mixedAcceptSingleResponse: accepts.size > 1 && responseTypes.size === 1,
        }
      : null;

  return {
    itemCount: items.length,
    dateFacts,
    wideNumeric:
      wideExamples.size > 0
        ? {
            maxDigits: wideMax,
            examples: [...wideExamples].slice(0, 3),
            operations: [...wideOperations].slice(0, 5),
            operationCount: wideOperations.size,
          }
        : null,
    media,
    customHeaderNames: [...customHeaders].slice(0, 8),
  };
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// ============================================================================
// Spec section (interface / service-plane stories)
// ============================================================================

const WIRE_SECTION_MARKER = '## Wire-format fidelity (mined from the captured API baseline)';

/**
 * Render the mined facts as the deterministic spec section every
 * service-plane story carries. Null when there is nothing to pin (no facts).
 */
export function buildWireFidelitySpecSection(
  facts: BaselineWireFacts | null | undefined
): string | null {
  if (!facts) return null;
  const hasAny =
    facts.dateFacts.length > 0 ||
    facts.wideNumeric !== null ||
    (facts.media !== null &&
      (facts.media.mixedAcceptSingleResponse || facts.media.requestAccepts.length > 1)) ||
    facts.customHeaderNames.length > 0;
  if (!hasAny) return null;

  const lines: string[] = [];
  lines.push(WIRE_SECTION_MARKER);
  lines.push('');
  lines.push(
    `These facts were mined DETERMINISTICALLY from the ${facts.itemCount} captured ` +
      'operations of the pinned current-state baseline. They are the WIRE CONTRACT — ' +
      'derive parameter parsing, identifier types, and response rendering from the ' +
      'captured examples below; NEVER default to a framework idiom (ISO dates, Long ' +
      'ids, Accept-driven negotiation) that the examples contradict.'
  );
  lines.push('');

  for (const f of facts.dateFacts) {
    lines.push(
      `- **Dates ride as \`${f.pattern}\`** (examples: ${f.examples.map((e) => `\`${e}\``).join(', ')}; ` +
        `seen on ${f.operationCount} operation(s), e.g. ${f.operations.map((o) => `\`${o}\``).join(', ')}). ` +
        `Parse ALL date parameters with this pattern (Java: \`${f.javaPattern}\`, pinned to ` +
        '`Locale.ENGLISH`). Do NOT annotate parameters with `@DateTimeFormat(iso = ...)` — a ' +
        'per-parameter ISO annotation OVERRIDES the application-wide converter the bootstrap ' +
        'story registers, and captured values like the examples above would 400.' +
        (f.inResponses
          ? ' The pattern also appears in RESPONSE bodies — rendered dates must serialize in ' +
            'this same format, not ISO.'
          : '')
    );
  }

  if (facts.wideNumeric) {
    lines.push(
      `- **Identifiers exceed int64**: captured path/query values run to ` +
        `${facts.wideNumeric.maxDigits} digits (examples: ` +
        `${facts.wideNumeric.examples.map((e) => `\`${e}\``).join(', ')}; ` +
        `${facts.wideNumeric.operationCount} operation(s), e.g. ` +
        `${facts.wideNumeric.operations.map((o) => `\`${o}\``).join(', ')}). ` +
        'Type these identifiers `BigInteger` (or `String` for pass-through) — NEVER `Long`/' +
        '`Integer`, which reject the captured values with a binding 400.'
    );
  }

  if (facts.media) {
    if (facts.media.mixedAcceptSingleResponse) {
      lines.push(
        `- **Content negotiation mirrors legacy, not the Accept header**: requests carried ` +
          `${facts.media.requestAccepts.length} distinct Accept values (` +
          `${facts.media.requestAccepts.map((a) => `\`${a}\``).join(', ')}) yet every captured ` +
          `response is \`${facts.media.responseContentTypes[0]}\`. Endpoints must answer in that ` +
          'one captured type regardless of Accept (never a 406/500 from negotiation).'
      );
    } else if (facts.media.responseContentTypes.length > 1) {
      lines.push(
        `- **Multiple response formats are live** (` +
          `${facts.media.responseContentTypes.map((t) => `\`${t}\``).join(', ')}). Every ` +
          'captured Accept must be answerable — the converters for EACH format must be ' +
          'registered, or serialization fails at runtime (`HttpMessageNotWritableException`).'
      );
    }
  }

  if (facts.customHeaderNames.length > 0) {
    lines.push(
      `- **Non-standard request headers are part of the contract**: ` +
        `${facts.customHeaderNames.map((h) => `\`${h}\``).join(', ')}. Endpoints must accept ` +
        'them (read or ignore — never reject).'
    );
  }

  lines.push('');
  lines.push(
    '**Acceptance criterion (wire replay):** for EVERY endpoint this story implements, ' +
      'add a `@WebMvcTest` slice test that replays a captured concrete request — the ' +
      'CONCRETE captured path values (not the template), captured query params and ' +
      'headers, service layer mocked. The request must reach the handler (no binding ' +
      '400) and the response must carry the captured Content-Type. The captured ' +
      'operations are in the focused context refs / API baseline for this story.'
  );

  return lines.join('\n');
}

/** Idempotently append the wire-fidelity section (mirrors appendTargetStackSection). */
export function appendWireFidelitySection(
  specText: string,
  sectionText: string | null
): string {
  if (!sectionText || sectionText.trim().length === 0) return specText;
  if (specText.includes(WIRE_SECTION_MARKER)) return specText;
  return `${specText.trimEnd()}\n\n${sectionText}\n`;
}

// ============================================================================
// Scaffold bootstrap requirements (app-wide seams)
// ============================================================================

/**
 * Render the mined facts as APP-WIDE bootstrap requirement lines for the
 * deterministic scaffold spec. Empty when there is nothing to require.
 */
export function buildScaffoldWireFormatRequirements(
  facts: BaselineWireFacts | null | undefined
): string[] {
  if (!facts) return [];
  const out: string[] = [];

  for (const f of facts.dateFacts) {
    out.push(
      `Register ONE application-wide \`Converter<String, LocalDate>\` parsing the ` +
        `captured wire date format \`${f.pattern}\` (Java pattern \`${f.javaPattern}\`, ` +
        `pinned to \`Locale.ENGLISH\` — month tokens are locale-sensitive), with an ISO ` +
        `fallback. FORBID per-parameter \`@DateTimeFormat(iso = ...)\` annotations — they ` +
        `override the global converter and reject captured values. ` +
        (f.inResponses
          ? `Also configure the JSON serializer to RENDER dates as \`${f.pattern}\` ` +
            `(the captured response bodies use it). `
          : '') +
        `[mined: ${f.examples[0] ?? f.pattern} on ${f.operationCount} operation(s), ` +
        `e.g. ${f.operations[0] ?? '-'}]`
    );
  }

  if (facts.wideNumeric) {
    out.push(
      `Identifier binding policy: numeric identifiers must be typed \`BigInteger\` ` +
        `(or \`String\` for pass-through) — NEVER \`Long\`/\`Integer\`. Captured ` +
        `identifier values run to ${facts.wideNumeric.maxDigits} digits, beyond int64. ` +
        `[mined: ${facts.wideNumeric.examples[0] ?? ''} on ` +
        `${facts.wideNumeric.operationCount} operation(s), e.g. ${facts.wideNumeric.operations[0] ?? '-'}]`
    );
  }

  if (facts.media?.mixedAcceptSingleResponse) {
    out.push(
      `Content negotiation must mirror the CAPTURED posture, not framework default: ` +
        `requests carried ${facts.media.requestAccepts.length} distinct Accept values but ` +
        `every captured response is \`${facts.media.responseContentTypes[0]}\` — configure ` +
        `\`ContentNegotiationConfigurer\` to ignore the Accept header and default to that ` +
        `type, so no captured request can 406/500 on negotiation. ` +
        `[mined: accepts ${facts.media.requestAccepts.slice(0, 3).join(', ')}]`
    );
  } else if (facts.media && facts.media.responseContentTypes.length > 1) {
    out.push(
      `Register message converters for EVERY captured response format ` +
        `(${facts.media.responseContentTypes.join(', ')}) — a captured Accept with no ` +
        `registered converter fails serialization at runtime. ` +
        `[mined: ${facts.media.responseContentTypes.join(', ')}]`
    );
  }

  return out;
}

// ============================================================================
// Default production fetch (fail-soft composition over the AMS reads)
// ============================================================================

/**
 * Fetch the active current-state baseline's captured items for the wire-facts
 * miner. Returns [] when no active baseline exists. Throws on transport
 * problems — the caller wraps fail-soft.
 */
export async function defaultFetchBaselineWireItems(
  projectId: string,
  currentArchitectureId: string
): Promise<ApiBehaviourBaselineItemWire[]> {
  const baseline = await fetchActiveCurrentBaseline(projectId, currentArchitectureId);
  if (!baseline?.id) return [];
  return fetchBaselineItems(projectId, baseline.id);
}
