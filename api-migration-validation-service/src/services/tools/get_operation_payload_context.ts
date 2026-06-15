import { ToolHandler, ToolRegistryEntry, ToolValidationError } from './toolTypes';
import { discoveryServiceClient as defaultDiscoveryServiceClient } from '../discoveryServiceClient';
import type {
  DiscoveryServiceClient,
  FetchSourceResult,
} from '../discoveryServiceClient';
import { recordAndCheck } from '../tokenBudget';

/**
 * Tool: `get_operation_payload_context`
 *
 * Per-operation payload context for the capture-loop LLM so it can build a
 * syntactically-valid SOAP envelope. Returns an inline single response
 * (no pagination -- W-14) carrying:
 *
 *   - WSDL message metadata pulled from the operation's `protocol_metadata_json`
 *     blob (Phase 1 SOAP discovery -- `request_root_element`,
 *     `request_namespace`, `response_root_element`).
 *   - JAXB DTO source code for `request_dto_class` / `response_dto_class`
 *     FQNs. The FQN is mapped to a repo-relative Java path
 *     (`com.foo.Bar` -> `src/main/java/com/foo/Bar.java`) and fetched from
 *     discovery-service via the run-scoped source endpoint (Task Group 1).
 *   - At `depth=2`, the source for direct non-primitive field types
 *     referenced by the request/response DTOs (one extra layer; transitive
 *     refs beyond depth 2 are NOT followed -- W-6).
 *   - Optional sibling-operation sample payload from the same parent
 *     service if one is available in the in-memory inventory.
 *   - Per-file 8 KB byte cap; truncated files end with the marker
 *     `// ...truncated, N more bytes` (W-6).
 *
 * Token-budget enforcement (W-7) via the shared `tokenBudget` helper with
 * kind `'payload'`, env caps `AMVS_PAYLOAD_CTX_CALL_TOKEN_CAP` (8 K) and
 * `AMVS_PAYLOAD_CTX_SESSION_TOKEN_CAP` (50 K). On overflow the response is
 * truncated and a structured `notes` entry is added so the LLM knows the
 * context is incomplete.
 *
 * Graceful fallback paths (the tool NEVER throws on these):
 *   - FQN unresolvable (404 Not Found from the source endpoint) -> the
 *     affected DTO source slot is replaced with the single string
 *     `"DTO source unavailable"`; other fields still populated.
 *   - 410 Gone (cached clone evicted) -> ALL DTO source slots are
 *     replaced with `"DTO source unavailable"`; `notes` gets the entry
 *     `"clone evicted; DTO sources unavailable"`; WSDL metadata is
 *     still returned so the LLM falls back to WSDL-types-only payload
 *     construction (W-17).
 *
 * Registered as a SIBLING of `list_oas_operations` (NOT an extension --
 * W-5 keeps the listing tool cheap and listing-only).
 *
 * Spec: 2026-05-17 SOAP LLM Extraction and Payload Enrichment (Phase 2)
 * -- Task Group 8.
 * Spec path: `agent-os/specs/2026-05-17-soap-llm-extraction-and-payload-enrichment-phase-2/spec.md`
 */

/** Per-file source byte cap (W-6). */
const PER_FILE_BYTE_CAP = 8 * 1024;

/**
 * The seven SOAP fields written by Phase 1's
 * `candidateSaveBackService.ts` into `protocol_metadata_json` and mirrored
 * into the synthesised inventory via the SOAP pre-pop layer under
 * `oasOperation['x-amvs-soap']`. We only read the three WSDL message fields
 * + the two DTO FQNs here; `wsdl_source` is surfaced in the response so
 * the LLM can correlate but is not used for source resolution.
 */
interface SoapMetadataBlock {
  soap_action?: string;
  request_root_element?: string;
  request_namespace?: string;
  response_root_element?: string;
  request_dto_class?: string;
  response_dto_class?: string;
  wsdl_source?: string;
}

interface PayloadContextResponse {
  operationId: string;
  request_root_element?: string;
  request_namespace?: string;
  response_root_element?: string;
  request_dto_class?: string;
  response_dto_class?: string;
  request_dto_source?: string;
  response_dto_source?: string;
  /** depth=2 only -- keyed by FQN. */
  nested_dto_sources?: Record<string, string>;
  /** Sibling-operation sample payload when one is available. */
  sibling_sample_payload?: string;
  truncations?: Array<{ dto_class: string; dropped_bytes: number }>;
  notes?: string[];
}

const STR_DTO_UNAVAILABLE = 'DTO source unavailable';

/**
 * Heuristic token count. Tokens are roughly ~4 bytes of English / Java
 * source on average. The token-budget helper's caps are denominated in
 * tokens so we approximate with `Math.ceil(byteLength / 4)`.
 */
function approxTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

/**
 * Map a Java FQN (`com.foo.Bar` or `com.foo.Bar$Inner`) to the canonical
 * Maven src layout repo-relative path (`src/main/java/com/foo/Bar.java`).
 * Inner classes resolve to their declaring class's file.
 *
 * Returns null for empty / obviously invalid input.
 */
export function fqnToRepoPath(fqn: string | null | undefined): string | null {
  if (!fqn || typeof fqn !== 'string') return null;
  const trimmed = fqn.trim();
  if (trimmed.length === 0) return null;
  // Strip inner-class suffix; only the outer class has a `.java` file.
  const outer = trimmed.split('$')[0];
  if (!/^[A-Za-z_][\w.]*$/.test(outer)) return null;
  const slashed = outer.replace(/\./g, '/');
  return `src/main/java/${slashed}.java`;
}

/**
 * Apply the 8 KB per-file byte cap. Returns the (possibly truncated)
 * content and the number of bytes dropped. Truncation appends the
 * documented marker `// ...truncated, N more bytes`.
 */
export function applyPerFileByteCap(content: string): {
  content: string;
  dropped: number;
} {
  if (content.length <= PER_FILE_BYTE_CAP) {
    return { content, dropped: 0 };
  }
  const dropped = content.length - PER_FILE_BYTE_CAP;
  const head = content.slice(0, PER_FILE_BYTE_CAP);
  return {
    content: `${head}\n// ...truncated, ${dropped} more bytes`,
    dropped,
  };
}

/**
 * Naïve field-type extractor for depth-2 resolution. Matches lines of the
 * form `private <Type> name;`, `protected <Type> name;`, or
 * `<Type> name;` (whitespace-tolerant). Skips Java primitives and the
 * common JDK wrapper / collection types that have no source we want to
 * inline.
 *
 * We mirror the Phase 1 scanner's "regex-style" approach (per Group 8
 * task spec) rather than parsing the file -- the LLM tolerates noisy
 * input and we never want to bring a full Java parser into AMVS.
 */
const PRIMITIVE_OR_JDK = new Set<string>([
  'boolean', 'byte', 'short', 'int', 'long', 'float', 'double', 'char',
  'void',
  'Boolean', 'Byte', 'Short', 'Integer', 'Long', 'Float', 'Double', 'Character',
  'String', 'Object', 'Date', 'BigDecimal', 'BigInteger',
  'List', 'ArrayList', 'LinkedList', 'Set', 'HashSet', 'Map', 'HashMap',
  'Optional', 'UUID',
  'LocalDate', 'LocalDateTime', 'OffsetDateTime', 'ZonedDateTime', 'Instant',
]);

/**
 * Build the canonical-package prefix for FQN reconstruction. If the
 * outer DTO sits in `com.foo.bar.OuterDto`, sibling references like
 * `BazDto` are presumed to live in the same package `com.foo.bar`.
 *
 * Returns null when no `package <name>;` line is found.
 */
function readPackageFromSource(source: string): string | null {
  const m = /^\s*package\s+([\w.]+)\s*;/m.exec(source);
  return m ? m[1] : null;
}

/**
 * Read all `import com.foo.Bar;` lines so a referenced bare-type-name
 * like `OrderDto` can be resolved to the imported FQN.
 *
 * Wildcard imports (`import com.foo.*;`) are intentionally skipped --
 * we never guess.
 */
function readImportsFromSource(source: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /^\s*import\s+(?:static\s+)?([\w.]+)\s*;/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const fqn = m[1];
    if (fqn.endsWith('.*')) continue;
    const idx = fqn.lastIndexOf('.');
    if (idx <= 0) continue;
    const simple = fqn.slice(idx + 1);
    out.set(simple, fqn);
  }
  return out;
}

/**
 * Extract simple type names that look like field declarations, e.g.
 * `private OrderDto order;`. Returns the set of distinct simple names.
 *
 * NOTE: we intentionally over-match here (the regex catches method
 * params too in poorly-formatted source) -- the downstream FQN
 * resolution filters anything we cannot map to an import or same-package
 * FQN.
 */
function extractCandidateFieldTypes(source: string): Set<string> {
  const out = new Set<string>();
  const re = /(?:^|\n)\s*(?:public|private|protected)?\s*(?:final\s+|static\s+)*([A-Z][A-Za-z0-9_]+)(?:<[^>]+>)?\s+[a-z_][A-Za-z0-9_]*\s*[;=]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const name = m[1];
    if (PRIMITIVE_OR_JDK.has(name)) continue;
    out.add(name);
  }
  return out;
}

/**
 * Resolve a referenced simple type name to a FQN using (1) explicit
 * imports, (2) same-package presumption. Returns null when neither
 * yields a candidate.
 */
function resolveFqn(
  simpleName: string,
  imports: Map<string, string>,
  samePackage: string | null,
): string | null {
  const fromImports = imports.get(simpleName);
  if (fromImports) return fromImports;
  if (samePackage) return `${samePackage}.${simpleName}`;
  return null;
}

/**
 * Find one sibling operation in the same parent service as `op` that
 * carries a recorded sample payload. v1 just picks the first
 * alphabetically-by-operationId sibling that has a non-empty
 * `request_root_element` and a `sample_payload` blob in its SOAP
 * metadata.
 *
 * The notion of "sibling" is operationally fuzzy in v1: we group by
 * the parent service via the `request_namespace` field (operations in
 * the same SOAP service share a namespace). This avoids a fresh AMS
 * round-trip and works against the in-memory inventory.
 */
function findSiblingSamplePayload(
  ctx: { oasInventory: { operations: Array<{ operationId: string; oasOperation: unknown }> } },
  targetOperationId: string,
  targetNamespace: string | undefined,
): string | undefined {
  if (!targetNamespace) return undefined;
  const candidates: Array<{ operationId: string; sample: string }> = [];
  for (const op of ctx.oasInventory.operations) {
    if (op.operationId === targetOperationId) continue;
    const meta = readSoapMetadata(op.oasOperation);
    if (meta.request_namespace !== targetNamespace) continue;
    // `sample_payload` is a forward-looking field that this tool MAY
    // surface in future; in v1 we just look it up opportunistically.
    const opObj = op.oasOperation as Record<string, unknown> | null | undefined;
    const samplePayload = opObj
      ? readStringField(opObj, 'x-amvs-sample-payload') ??
        readStringField(meta as unknown as Record<string, unknown>, 'sample_payload')
      : undefined;
    if (samplePayload && samplePayload.length > 0) {
      candidates.push({ operationId: op.operationId, sample: samplePayload });
    }
  }
  if (candidates.length === 0) return undefined;
  candidates.sort((a, b) => a.operationId.localeCompare(b.operationId));
  return candidates[0].sample;
}

function readStringField(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * Read the SOAP metadata block from an `oasOperation` object. Phase 1's
 * SOAP pre-pop layer copies the seven `protocol_metadata_json` fields
 * onto `oasOperation['x-amvs-soap']` so the in-memory inventory carries
 * everything the tool needs without an AMS round-trip.
 */
export function readSoapMetadata(oasOperation: unknown): SoapMetadataBlock {
  if (!oasOperation || typeof oasOperation !== 'object') return {};
  const obj = oasOperation as Record<string, unknown>;
  const block = obj['x-amvs-soap'];
  if (!block || typeof block !== 'object') return {};
  const src = block as Record<string, unknown>;
  const out: SoapMetadataBlock = {};
  for (const key of [
    'soap_action',
    'request_root_element',
    'request_namespace',
    'response_root_element',
    'request_dto_class',
    'response_dto_class',
    'wsdl_source',
  ] as const) {
    const v = src[key];
    if (typeof v === 'string' && v.length > 0) {
      (out as Record<string, string>)[key] = v;
    }
  }
  return out;
}

/**
 * Internal fetch wrapper that classifies the discovery-service response
 * into one of the small set of outcomes the handler cares about. Any
 * unrecognised error mode is mapped to `kind: 'error'` (logged as a
 * `dto_unresolved` event by the caller).
 */
async function fetchOne(
  client: DiscoveryServiceClient,
  projectId: string,
  architectureId: string,
  runId: string,
  fqn: string,
): Promise<{ result: FetchSourceResult; repoPath: string | null }> {
  const repoPath = fqnToRepoPath(fqn);
  if (!repoPath) {
    return {
      result: { kind: 'not_found' },
      repoPath: null,
    };
  }
  const result = await client.fetchSourceFile({
    projectId,
    architectureId,
    runId,
    repoPath,
  });
  return { result, repoPath };
}

const handler: ToolHandler = async (args, ctx) => {
  const operationId = typeof args.operationId === 'string' ? args.operationId : null;
  if (!operationId) {
    throw new ToolValidationError(
      'get_operation_payload_context',
      'missing_operation_id',
      '`operationId` is required and must be a string.',
    );
  }
  const depthArg = args.depth;
  const depth: 1 | 2 =
    depthArg === 2 || depthArg === '2' ? 2 : 1;

  console.log(
    `[diag-amvs] payload_context start operationId=${operationId} depth=${depth}`,
  );

  // Look up the operation in the in-memory inventory.
  const op = ctx.oasInventory.operations.find((o) => o.operationId === operationId);
  if (!op) {
    return {
      operationId,
      notes: [`Operation ${operationId} not present in the parsed inventory.`],
    } satisfies PayloadContextResponse;
  }

  const soap = readSoapMetadata(op.oasOperation);
  const response: PayloadContextResponse = { operationId };
  const notes: string[] = [];
  const truncations: Array<{ dto_class: string; dropped_bytes: number }> = [];

  // WSDL metadata round-trip (Test 1).
  if (soap.request_root_element) response.request_root_element = soap.request_root_element;
  if (soap.request_namespace) response.request_namespace = soap.request_namespace;
  if (soap.response_root_element) response.response_root_element = soap.response_root_element;
  if (soap.request_dto_class) response.request_dto_class = soap.request_dto_class;
  if (soap.response_dto_class) response.response_dto_class = soap.response_dto_class;

  const discoveryClient: DiscoveryServiceClient =
    ctx.discoveryServiceClient ?? defaultDiscoveryServiceClient;
  const runId = ctx.discoveryRunId ?? null;
  const projectId = ctx.session.projectId;
  const architectureId = ctx.session.architectureId;

  // If no DTO classes are listed at all, this is the WSDL-only path
  // (e.g. NumberConversion-style services). Return the WSDL metadata
  // and skip the source endpoint entirely. No `notes` entry -- this is
  // a valid steady state, not a degraded one.
  const hasAnyDto = Boolean(soap.request_dto_class || soap.response_dto_class);

  if (hasAnyDto) {
    // Even when DTO classes are listed, we need a runId to fetch source.
    if (!runId) {
      notes.push(
        'DTO source unavailable; capture session has no bound discovery runId',
      );
      if (soap.request_dto_class) response.request_dto_source = STR_DTO_UNAVAILABLE;
      if (soap.response_dto_class) response.response_dto_source = STR_DTO_UNAVAILABLE;
    } else {
      // Fetch request DTO source.
      let cloneEvicted = false;
      const fetched: Array<{
        slot: 'request' | 'response';
        fqn: string;
        result: FetchSourceResult;
      }> = [];

      for (const slot of ['request', 'response'] as const) {
        const fqn = slot === 'request' ? soap.request_dto_class : soap.response_dto_class;
        if (!fqn) continue;
        const { result } = await fetchOne(
          discoveryClient,
          projectId,
          architectureId,
          runId,
          fqn,
        );
        fetched.push({ slot, fqn, result });
        if (result.kind === 'evicted') cloneEvicted = true;
      }

      if (cloneEvicted) {
        console.log(
          `[diag-amvs] payload_context result=clone_evicted operationId=${operationId}`,
        );
        notes.push('clone evicted; DTO sources unavailable');
        if (soap.request_dto_class) response.request_dto_source = STR_DTO_UNAVAILABLE;
        if (soap.response_dto_class) response.response_dto_source = STR_DTO_UNAVAILABLE;
      } else {
        // Apply per-file byte cap to each successful fetch.
        for (const f of fetched) {
          if (f.result.kind === 'ok') {
            const { content, dropped } = applyPerFileByteCap(f.result.content);
            if (dropped > 0) {
              truncations.push({ dto_class: f.fqn, dropped_bytes: dropped });
            }
            if (f.slot === 'request') response.request_dto_source = content;
            else response.response_dto_source = content;
          } else {
            // `not_found` or `error` -> "DTO source unavailable" for that slot.
            console.log(
              `[diag-amvs] payload_context dto_unresolved operationId=${operationId} fqn=${f.fqn}`,
            );
            if (f.slot === 'request') response.request_dto_source = STR_DTO_UNAVAILABLE;
            else response.response_dto_source = STR_DTO_UNAVAILABLE;
          }
        }

        // Depth-2 resolution: parse the request/response DTOs we fetched
        // successfully, harvest non-primitive field types, fetch one level
        // of those from the source endpoint, apply the byte cap. We do NOT
        // recurse further.
        if (depth === 2) {
          const nested: Record<string, string> = {};
          const seen = new Set<string>();
          for (const f of fetched) {
            if (f.result.kind !== 'ok') continue;
            const source = f.result.content;
            const pkg = readPackageFromSource(source);
            const imports = readImportsFromSource(source);
            const candidates = extractCandidateFieldTypes(source);
            for (const simple of candidates) {
              const fqn = resolveFqn(simple, imports, pkg);
              if (!fqn) continue;
              if (fqn === soap.request_dto_class || fqn === soap.response_dto_class) {
                continue;
              }
              if (seen.has(fqn)) continue;
              seen.add(fqn);
              const { result } = await fetchOne(
                discoveryClient,
                projectId,
                architectureId,
                runId,
                fqn,
              );
              if (result.kind === 'evicted') {
                nested[fqn] = STR_DTO_UNAVAILABLE;
                if (!notes.includes('clone evicted; DTO sources unavailable')) {
                  notes.push('clone evicted; DTO sources unavailable');
                }
                continue;
              }
              if (result.kind !== 'ok') {
                console.log(
                  `[diag-amvs] payload_context dto_unresolved operationId=${operationId} fqn=${fqn}`,
                );
                nested[fqn] = STR_DTO_UNAVAILABLE;
                continue;
              }
              const { content, dropped } = applyPerFileByteCap(result.content);
              if (dropped > 0) {
                truncations.push({ dto_class: fqn, dropped_bytes: dropped });
              }
              nested[fqn] = content;
            }
          }
          if (Object.keys(nested).length > 0) {
            response.nested_dto_sources = nested;
          }
        }
      }
    }
  }

  // Sibling-operation sample payload (best-effort; safe when absent).
  const sibling = findSiblingSamplePayload(
    ctx,
    operationId,
    soap.request_namespace,
  );
  if (sibling) {
    response.sibling_sample_payload = sibling;
  }

  // Token-budget enforcement (W-7). Serialise the response so far, count
  // approx tokens, and surface a truncation note if we are over budget.
  const serialised = JSON.stringify(response);
  const requestedTokens = approxTokens(serialised);
  const budget = recordAndCheck(ctx.session.id, 'payload', requestedTokens);

  if (budget.allow === 'truncate') {
    // Hard truncate the JSON-serialised payload at the allowed token
    // budget (converted back to a char count via the same ~4-byte
    // approximation). We never throw; the LLM is told via `notes` that
    // context was clipped.
    const maxChars = Math.max(0, budget.maxAllowedTokens * 4);
    const truncatedSource = serialised.length > maxChars
      ? serialised.slice(0, maxChars)
      : serialised;
    // We cannot return a partial JSON string to the LLM (it would fail
    // to parse), so the strategy is to drop the heavy source fields
    // until we fit, then attach a truncation note.
    const slim: PayloadContextResponse = {
      operationId: response.operationId,
      request_root_element: response.request_root_element,
      request_namespace: response.request_namespace,
      response_root_element: response.response_root_element,
      request_dto_class: response.request_dto_class,
      response_dto_class: response.response_dto_class,
      notes: [...notes],
    };
    slim.notes = slim.notes ?? [];
    slim.notes.push(
      `token_cap action=truncate kind=payload maxAllowedTokens=${budget.maxAllowedTokens}`,
    );
    if (truncations.length > 0) slim.truncations = truncations;
    console.warn(budget.warning);
    console.log(
      `[diag-amvs] payload_context result=ok operationId=${operationId} ` +
        `dto_sources=0 truncations=${truncations.length} token_truncated=true ` +
        `originalChars=${serialised.length} keptChars=${truncatedSource.length}`,
    );
    return slim;
  }

  if (truncations.length > 0) response.truncations = truncations;
  if (notes.length > 0) response.notes = notes;

  const dtoSourcesCount =
    (response.request_dto_source && response.request_dto_source !== STR_DTO_UNAVAILABLE ? 1 : 0) +
    (response.response_dto_source && response.response_dto_source !== STR_DTO_UNAVAILABLE ? 1 : 0) +
    (response.nested_dto_sources ? Object.keys(response.nested_dto_sources).length : 0);

  console.log(
    `[diag-amvs] payload_context result=ok operationId=${operationId} ` +
      `dto_sources=${dtoSourcesCount} truncations=${truncations.length}`,
  );

  return response;
};

export const getOperationPayloadContextTool: ToolRegistryEntry = {
  name: 'get_operation_payload_context',
  description:
    'Return per-operation payload context (WSDL message metadata + JAXB DTO source) for a SOAP operationId. ' +
    'Use this to build a syntactically-valid SOAP envelope. Inline single response; pass `depth=2` to also ' +
    'inline direct field-type DTO sources (default depth=1).',
  parameters: {
    type: 'object',
    properties: {
      operationId: {
        type: 'string',
        description: 'The OAS operationId to fetch payload context for.',
      },
      depth: {
        type: 'number',
        enum: [1, 2],
        description:
          'Depth of DTO resolution. 1 = request/response DTOs only (default). ' +
          '2 = also inline direct field-type DTOs referenced by them.',
      },
    },
    required: ['operationId'],
    additionalProperties: false,
  },
  handler,
};
