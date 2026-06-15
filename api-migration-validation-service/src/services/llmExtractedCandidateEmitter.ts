/**
 * LLM-Extracted Candidate Emitter (Workstream A, Task Group 7).
 *
 * Spec: 2026-05-17 SOAP LLM Extraction and Payload Enrichment (Phase 2),
 *       Task Group 7 (LLM-Extracted Candidate Emit +
 *       `discovery_method='llm_extraction'`).
 *
 * --------------------------------------------------------------------------
 * Purpose
 * --------------------------------------------------------------------------
 * Converts the strict-schema output of the Group 5
 * `propose_endpoints_from_code` tool (a list of `ProposedOperation`s) into
 * Phase-1-shaped discovery candidates and persists them through the same
 * `bulkSaveCandidates` flow Phase 1 uses (per W-4 -- full candidate path, no
 * shortcuts). The emit is invoked by the Group 6 Step-4 wizard route
 * (`extractEndpointsWithLlm`) once `proposeEndpointsFromCode` returns.
 *
 * --------------------------------------------------------------------------
 * Candidate shape (mirrors Phase 1 `springClassicSoap/soapEndpointEmitter.ts`)
 * --------------------------------------------------------------------------
 * - Parent SOAP interface candidate:
 *     candidateType = 'interfaces'
 *     data.interface_type = 'SOAP_API'
 *     data.discovery_method = 'llm_extraction'
 * - Child endpoint candidates (one per operation):
 *     candidateType = 'endpoints'
 *     parentCandidateId -> parent interface candidate id
 *     data.interface_id -> same parent id (mirrors Phase 1 convention)
 *     data.operation_verb = 'POST' (D-3: SOAP-over-HTTP is POST on the wire)
 *     data.path_or_address = LLM-proposed `path` (when supplied) | null
 *     data.soap_action, data.request_root_element, data.request_namespace
 *       (always undefined for LLM extraction -- no WSDL ground truth),
 *       data.response_root_element, data.request_dto_class,
 *       data.response_dto_class, data.wsdl_source (always undefined for LLM
 *       extraction -- by construction the extractor reads code, not WSDL)
 *     data.discovery_method = 'llm_extraction'
 *     data.confidence_tier = 'low' | 'default' (W-8: 0.4 <= conf < 0.7 -> 'low',
 *       conf >= 0.7 -> 'default'). The Group 5 tool already filtered the
 *       <0.4 tier; this emitter trusts the input.
 *
 * --------------------------------------------------------------------------
 * Parent interface candidate sourcing (W-4)
 * --------------------------------------------------------------------------
 * - If the target architecture already contains an `interfaces` entity whose
 *   `name` matches `parentInterfaceName` AND `interface_type='SOAP_API'`,
 *   reuse its id and SKIP emitting a new interface candidate (just emit the
 *   endpoint candidates linking back to the existing interface id via
 *   `parentCandidateId` / `data.interface_id`).
 * - Otherwise emit a fresh parent interface candidate alongside the endpoint
 *   candidates; both ride through `bulkSaveCandidates` in one batch.
 *
 * --------------------------------------------------------------------------
 * Idempotency (W-4 follow-on, captured by the Group 7 task's Test 4)
 * --------------------------------------------------------------------------
 * Before emitting, the emitter reads the existing endpoint set for the
 * target interface (via the injected `archModelReader.listEndpointsForInterface`)
 * and skips any operation whose `soap_action` OR `name` already matches an
 * existing endpoint. Re-running the LLM extraction with the same inputs
 * produces zero net-new candidates on the second run.
 *
 * --------------------------------------------------------------------------
 * Persistence (W-4: full candidate path)
 * --------------------------------------------------------------------------
 * Routes through `bulkSaveCandidates(projectId, architectureId, runId, [...])`,
 * which mirrors the Phase 1 path. The save-back arm
 * (`mcp-server/src/services/candidateSaveBackService.ts -> case 'endpoints'`)
 * bundles the seven SOAP fields + `discovery_method` + `confidence_tier`
 * (when present on `data`) into the `protocol_metadata_json` JSONB column
 * with NO new switch arm. The contract on the read side
 * (`candidateSaveBackService.ts` SOAP_PROTOCOL_METADATA_FIELDS enumeration)
 * is the same one this emitter writes against.
 *
 * --------------------------------------------------------------------------
 * Dependency injection
 * --------------------------------------------------------------------------
 * Both the architecture-model read surface (`listInterfacesForArchitecture`,
 * `listEndpointsForInterface`) and the `bulkSaveCandidates` write surface
 * are injected via the `LlmExtractedEmitDeps` interface so unit tests can
 * stub both without an HTTP round-trip. The defaults wire to the
 * production `archModelClient` and a thin POST against the AMS
 * `discovery/runs/{runId}/candidates` endpoint (the same URL Phase 1
 * hits via discovery-service).
 *
 * Spec path:
 *   agent-os/specs/2026-05-17-soap-llm-extraction-and-payload-enrichment-phase-2/spec.md
 */

import axios from 'axios';
import { randomUUID } from 'crypto';

import {
  archModelClient as defaultArchModelClient,
} from './archModelClient';
import { ARCHITECTURE_MODEL_SERVICE_BASE_URL } from '../config';
import type { ProposedOperation } from './tools/propose_endpoints_from_code';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Subset of the architecture-model client surface the emitter reads from to
 * (a) detect whether the parent SOAP interface already exists in the model
 * and (b) detect whether any of the proposed operations would duplicate an
 * existing endpoint. Mirrors the same two `archModelClient` methods Phase 1's
 * pre-population path already consumes (see
 * `routes/captureSessionActions.ts` -- `synthesiseInventoryFromEndpoints`),
 * keeping the contract surface small and easy to mock.
 *
 * Returns loose `Record<string, unknown>` rows because the wire payload
 * (from `metaModel.entities.interfaces` / `.endpoints`) carries more fields
 * than the narrow TS DTOs declare -- notably `interface_type`,
 * `protocol_metadata_json`. The emitter reads those wire-only fields
 * opportunistically, mirroring the Phase 1 pre-population reader.
 */
export interface ArchModelReader {
  listInterfacesForArchitecture(
    projectId: string,
    architectureId: string,
  ): Promise<Array<Record<string, unknown>>>;
  listEndpointsForInterface(
    projectId: string,
    architectureId: string,
    interfaceId: string,
  ): Promise<Array<Record<string, unknown>>>;
}

/**
 * Save-back surface the emitter uses to persist the candidate batch. Mirrors
 * the discovery-service `archModelClient.bulkSaveCandidates` signature so the
 * Phase 1 contract is preserved verbatim (W-4). AMVS posts directly to AMS's
 * `/api/model/projects/{p}/architectures/{a}/discovery/runs/{r}/candidates`
 * endpoint -- the SAME endpoint discovery-service's client targets.
 */
export type BulkSaveCandidatesFn = (
  projectId: string,
  architectureId: string,
  runId: string,
  candidates: DiscoveryCandidateShape[],
) => Promise<void>;

/**
 * Minimal candidate shape this emitter writes. Mirrors
 * `discovery-service/src/types/candidate.ts -> DiscoveryCandidate` field-for-field
 * so consumers (the save-back service in particular) can treat both producers
 * identically. We keep a local declaration here rather than importing the
 * discovery-service type because cross-service TS imports across the monorepo
 * are not configured. The wire shape after `mapCandidateToBackend`
 * (snake_case `run_id`, `candidate_type`, ...) is generated inside
 * `defaultBulkSaveCandidates` below.
 */
export interface DiscoveryCandidateShape {
  id: string;
  runId: string;
  candidateType: 'interfaces' | 'endpoints';
  name: string;
  confidence: number;
  status: 'proposed';
  sourceClusterIds: string[];
  data: Record<string, unknown>;
  synthesizedAt: string;
  parentCandidateId?: string;
}

/**
 * Pluggable dependency surface. Tests inject in-memory stubs for both
 * methods; production wiring uses the singleton archModelClient + a thin
 * axios POST against the AMS candidate endpoint.
 */
export interface LlmExtractedEmitDeps {
  archModelReader?: ArchModelReader;
  bulkSaveCandidates?: BulkSaveCandidatesFn;
  /** Override the candidate id factory (tests use deterministic ids). */
  idFactory?: () => string;
  /** Override the synthesized-at timestamp (tests want a stable string). */
  nowIso?: () => string;
}

export interface LlmExtractedEmitArgs {
  projectId: string;
  architectureId: string;
  runId: string;
  /** Human-readable parent service display name -- folded into candidate name. */
  parentServiceName: string;
  /** Human-readable parent interface display name -- folded into candidate name. */
  parentInterfaceName: string;
  /**
   * Filtered list from Group 5 `propose_endpoints_from_code`. Each entry's
   * `confidence_tier` MUST be set (the Group 5 tool always tags
   * `'low' | 'default'` on every kept operation; the <0.4 tier was already
   * dropped upstream).
   */
  operations: ProposedOperation[];
}

export interface LlmExtractedEmitResult {
  /**
   * `null` when the parent interface was already present in the architecture
   * model (the emitter linked to the existing interface id). Otherwise the
   * freshly-emitted parent interface candidate.
   */
  parentInterfaceCandidate: DiscoveryCandidateShape | null;
  /** The endpoint candidates that were emitted on this call. */
  endpointCandidates: DiscoveryCandidateShape[];
  /** Number of operations skipped because they duplicated an existing endpoint. */
  skippedDuplicates: number;
  /** Number of operations tagged as 0.4 <= confidence < 0.7. */
  lowConfidenceCount: number;
  /**
   * The id used to thread parent -> endpoint via `parentCandidateId`. Equal
   * to the existing interface id when reusing; otherwise equal to the
   * newly-emitted parent interface candidate's id.
   */
  resolvedParentInterfaceId: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CANDIDATE_STATUS_PROPOSED = 'proposed' as const;
const CANDIDATE_CONFIDENCE_DEFAULT = 0.9; // Mirrors Phase 1 emitter.

// ---------------------------------------------------------------------------
// Default dependency implementations
// ---------------------------------------------------------------------------

/**
 * Production `bulkSaveCandidates` implementation -- POSTs straight to AMS
 * using the same URL Phase 1's discovery-service client uses (W-4 full
 * candidate path). The payload is snake_case to match AMS's Jackson naming
 * strategy; the camelCase -> snake_case mapping is inlined here rather than
 * pulled across service boundaries.
 */
async function defaultBulkSaveCandidates(
  projectId: string,
  architectureId: string,
  runId: string,
  candidates: DiscoveryCandidateShape[],
): Promise<void> {
  if (candidates.length === 0) return;
  const url =
    `${ARCHITECTURE_MODEL_SERVICE_BASE_URL.replace(/\/+$/, '')}` +
    `/api/model/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}` +
    `/discovery/runs/${encodeURIComponent(runId)}/candidates`;
  const payload = candidates.map((c) => ({
    id: c.id,
    run_id: c.runId,
    candidate_type: c.candidateType,
    name: c.name,
    confidence: c.confidence,
    status: c.status,
    source_cluster_ids: c.sourceClusterIds,
    data: c.data,
    synthesized_at: c.synthesizedAt,
    parent_candidate_id: c.parentCandidateId ?? null,
    log_enrichment: null,
  }));
  await axios.post(url, payload, {
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Adapter that wraps the singleton `archModelClient`'s narrow DTO returns
 * (`InterfaceDto[]`, etc.) into the loose `Record<string, unknown>[]` shape
 * the emitter consumes. The narrow DTOs declared in `archModelClient.ts`
 * do not carry an index signature, so the TS compiler refuses an implicit
 * widening; this adapter does the cast in one well-marked spot.
 */
function buildDefaultReader(): ArchModelReader {
  return {
    listInterfacesForArchitecture: async (projectId, architectureId) => {
      const ifaces = await defaultArchModelClient.listInterfacesForArchitecture(
        projectId,
        architectureId,
      );
      return ifaces as unknown as Array<Record<string, unknown>>;
    },
    listEndpointsForInterface: async (projectId, architectureId, interfaceId) => {
      return defaultArchModelClient.listEndpointsForInterface(
        projectId,
        architectureId,
        interfaceId,
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the existing SOAP_API interface in the target architecture whose
 * display name matches `parentInterfaceName`, or `null` when no match.
 * The match is case-sensitive (display-name semantics in the architecture
 * model are case-preserving).
 */
async function findExistingSoapInterface(
  reader: ArchModelReader,
  projectId: string,
  architectureId: string,
  parentInterfaceName: string,
): Promise<{ id: string } | null> {
  let interfaces: Array<Record<string, unknown>>;
  try {
    interfaces = await reader.listInterfacesForArchitecture(projectId, architectureId);
  } catch {
    // Fail-soft: if the read fails for any reason, fall through to emitting
    // a fresh interface candidate. The discovery run never cascade-fails on
    // a model-read error.
    return null;
  }
  for (const iface of interfaces) {
    const name = typeof iface.name === 'string' ? iface.name : null;
    const ifaceType =
      typeof iface.interface_type === 'string' ? iface.interface_type : null;
    const id = typeof iface.id === 'string' ? iface.id : null;
    if (
      name === parentInterfaceName &&
      ifaceType === 'SOAP_API' &&
      id !== null
    ) {
      return { id };
    }
  }
  return null;
}

/**
 * Build a deduplication key set for operations already present under the
 * target interface. We key on BOTH `soap_action` AND `name` so the emitter
 * skips a proposed operation if either signal matches an existing endpoint
 * (LLM-derived ops may not carry a `soapAction`; in that case the operation
 * name is the dedup key).
 */
function buildExistingEndpointKeys(
  endpoints: Array<Record<string, unknown>>,
): Set<string> {
  const keys = new Set<string>();
  for (const ep of endpoints) {
    if (typeof ep.name === 'string' && ep.name.length > 0) {
      keys.add(`name:${ep.name}`);
    }
    const blob = ep.protocol_metadata_json as Record<string, unknown> | undefined;
    if (blob && typeof blob === 'object') {
      const sa = blob.soap_action;
      if (typeof sa === 'string' && sa.length > 0) {
        keys.add(`soap_action:${sa}`);
      }
    }
  }
  return keys;
}

/**
 * `true` when an operation collides with an existing endpoint per the dedup
 * key rules above.
 */
function isDuplicateOperation(
  op: ProposedOperation,
  existingKeys: Set<string>,
): boolean {
  if (existingKeys.has(`name:${op.operationName}`)) return true;
  if (op.soapAction && existingKeys.has(`soap_action:${op.soapAction}`)) {
    return true;
  }
  return false;
}

/**
 * Build the `data` blob for an endpoint candidate. Mirrors Phase 1
 * `buildEndpointData` field-for-field but reads from the LLM-output schema
 * instead of the WSDL/annotation merge slots. WSDL-derived fields
 * (`request_namespace`, `wsdl_source`) are intentionally absent for LLM
 * extraction -- the upstream tool produces them from code, not WSDL.
 *
 * Optional fields the LLM did not produce are emitted as `undefined`.
 * The save-back service treats `undefined` as "key absent" (Group 10
 * absent-key semantics) so the JSONB blob stays minimal.
 */
function buildEndpointData(
  op: ProposedOperation,
  parentInterfaceId: string,
): Record<string, unknown> {
  return {
    interface_id: parentInterfaceId,
    operation_verb: 'POST', // D-3
    path_or_address: op.path ?? null,
    // Seven Phase 1 SOAP fields -- LLM extractor populates whatever it
    // could infer; the rest stay `undefined` (absent in the JSONB blob).
    soap_action: op.soapAction,
    request_root_element: op.requestRootElement,
    request_namespace: undefined, // not produced by the LLM tool
    response_root_element: op.responseRootElement,
    request_dto_class: op.requestDtoClass,
    response_dto_class: op.responseDtoClass,
    wsdl_source: undefined, // LLM extraction has no WSDL source by construction
    // Phase 2 Group 3 + Group 7: trace metadata.
    discovery_method: 'llm_extraction',
    // Phase 2 W-8: low-confidence chip signal for the frontend candidate
    // review UI. The Group 5 tool already filtered <0.4 and tagged each
    // surviving op with 'low' | 'default'.
    confidence_tier: op.confidence_tier,
    _addedBy: 'amvs-llm-endpoint-extract',
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Convert the Group-5 LLM tool's output into Phase-1-shaped discovery
 * candidates and persist them through `bulkSaveCandidates`. See module
 * header for the full contract.
 */
export async function emitLlmExtractedCandidates(
  args: LlmExtractedEmitArgs,
  deps: LlmExtractedEmitDeps = {},
): Promise<LlmExtractedEmitResult> {
  const reader: ArchModelReader = deps.archModelReader ?? buildDefaultReader();
  const bulkSave: BulkSaveCandidatesFn = deps.bulkSaveCandidates ?? defaultBulkSaveCandidates;
  const idFactory = deps.idFactory ?? randomUUID;
  const nowIso = deps.nowIso ?? (() => new Date().toISOString());

  const {
    projectId,
    architectureId,
    runId,
    parentServiceName,
    parentInterfaceName,
    operations,
  } = args;

  // -------------------------------------------------------------------------
  // Short-circuit on empty input: no candidates, no parent interface
  // candidate, no save-back POST. Test 2.
  // -------------------------------------------------------------------------
  if (operations.length === 0) {
    console.log(
      `[diag-amvs] llm_endpoint_extract emit_complete ` +
        `interface=${parentInterfaceName} persisted=0 low_confidence=0 ` +
        `skipped_duplicates=0 parent_reused=false`,
    );
    return {
      parentInterfaceCandidate: null,
      endpointCandidates: [],
      skippedDuplicates: 0,
      lowConfidenceCount: 0,
      // No-op id when nothing was emitted -- callers should not consult this
      // field when `endpointCandidates` is empty.
      resolvedParentInterfaceId: '',
    };
  }

  // -------------------------------------------------------------------------
  // Step 1: Resolve parent interface (reuse-or-emit).
  // -------------------------------------------------------------------------
  const existingIface = await findExistingSoapInterface(
    reader,
    projectId,
    architectureId,
    parentInterfaceName,
  );

  let parentCandidate: DiscoveryCandidateShape | null = null;
  let parentId: string;
  let existingEndpointKeys: Set<string> = new Set();

  if (existingIface) {
    parentId = existingIface.id;
    // Read existing endpoints to drive the idempotency dedup.
    try {
      const existing = await reader.listEndpointsForInterface(
        projectId,
        architectureId,
        parentId,
      );
      existingEndpointKeys = buildExistingEndpointKeys(existing);
    } catch {
      // Fail-soft: treat as no-existing-endpoints rather than aborting.
      existingEndpointKeys = new Set();
    }
  } else {
    parentId = idFactory();
    parentCandidate = {
      id: parentId,
      runId,
      candidateType: 'interfaces',
      name: parentInterfaceName,
      confidence: CANDIDATE_CONFIDENCE_DEFAULT,
      status: CANDIDATE_STATUS_PROPOSED,
      sourceClusterIds: [],
      data: {
        interface_type: 'SOAP_API',
        parentServiceName,
        discovery_method: 'llm_extraction',
        _addedBy: 'amvs-llm-endpoint-extract',
      },
      synthesizedAt: nowIso(),
    };
  }

  // -------------------------------------------------------------------------
  // Step 2: Filter out operations that duplicate existing endpoints
  // (idempotency).
  // -------------------------------------------------------------------------
  const filtered: ProposedOperation[] = [];
  let skippedDuplicates = 0;
  for (const op of operations) {
    if (isDuplicateOperation(op, existingEndpointKeys)) {
      skippedDuplicates += 1;
      console.log(
        `[diag-amvs] llm_endpoint_extract action=dropped reason=duplicate ` +
          `interface=${parentInterfaceName} operation=${op.operationName}`,
      );
      continue;
    }
    filtered.push(op);
  }

  // -------------------------------------------------------------------------
  // Step 3: Build endpoint candidates.
  // -------------------------------------------------------------------------
  const now = nowIso();
  const endpointCandidates: DiscoveryCandidateShape[] = filtered.map((op) => ({
    id: idFactory(),
    runId,
    candidateType: 'endpoints' as const,
    name: op.operationName,
    confidence: CANDIDATE_CONFIDENCE_DEFAULT,
    status: CANDIDATE_STATUS_PROPOSED,
    sourceClusterIds: [],
    data: buildEndpointData(op, parentId),
    synthesizedAt: now,
    parentCandidateId: parentId,
  }));

  const lowConfidenceCount = filtered.filter(
    (op) => op.confidence_tier === 'low',
  ).length;

  // -------------------------------------------------------------------------
  // Step 4: Persist through bulkSaveCandidates -- one batch carrying both
  // the (optional) parent interface candidate AND every endpoint candidate.
  // Phase 1 uses the same per-batch pattern.
  // -------------------------------------------------------------------------
  const batch: DiscoveryCandidateShape[] = [];
  if (parentCandidate) batch.push(parentCandidate);
  batch.push(...endpointCandidates);

  if (batch.length > 0) {
    await bulkSave(projectId, architectureId, runId, batch);
  }

  // -------------------------------------------------------------------------
  // Step 5: Diagnostic + return.
  // -------------------------------------------------------------------------
  console.log(
    `[diag-amvs] llm_endpoint_extract emit_complete ` +
      `interface=${parentInterfaceName} persisted=${endpointCandidates.length} ` +
      `low_confidence=${lowConfidenceCount} ` +
      `skipped_duplicates=${skippedDuplicates} ` +
      `parent_reused=${existingIface ? 'true' : 'false'}`,
  );

  return {
    parentInterfaceCandidate: parentCandidate,
    endpointCandidates,
    skippedDuplicates,
    lowConfidenceCount,
    resolvedParentInterfaceId: parentId,
  };
}

// ---------------------------------------------------------------------------
// Re-exports for test convenience
// ---------------------------------------------------------------------------

export {
  // Exposed so a future shape-compatibility audit can lock the contract
  // against `mcp-server/src/services/candidateSaveBackService.ts ->
  // SOAP_PROTOCOL_METADATA_FIELDS` from a single import site.
  buildEndpointData as _buildEndpointDataForTests,
};
