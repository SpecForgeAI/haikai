import { Router, Request, Response } from 'express';
import multer from 'multer';
import { archModelClient as defaultArchModelClient } from '../services/archModelClient';
import type {
  CaptureSessionDto,
  InterfaceDto,
  InventoryReconciliationResponse,
  MigrationDiscoveryContextDto,
  OperationDto,
} from '../services/archModelClient';
import { secretsStore } from '../services/secretsStore';
import { runManager } from '../services/runManager';
import { oasInventoryStore } from '../services/oasInventoryStore';
import {
  parseOasFromFile,
  parseOasFromObject,
  parseSpecText,
  SpecLinkCloneEvictedError,
} from '../services/oasParser';
import { parseWadl } from '../services/wadlParser';
import { wadlToInventory } from '../services/wadlToInventory';
import {
  classifyUploadedFiles,
  type ClassifiedUpload,
} from '../services/contractFormatDetector';
import type { ParsedOasInventory, ParsedOasOperation } from '../types/oas';
import { NON_MUTATING_METHODS } from '../types/oas';
import type { OpenAPIV3 } from 'openapi-types';
import { createSessionHttpExecutor } from '../services/httpExecutor';
import { createDbAdapter } from '../services/db/dbAdapterFactory';
import { orchestrateCaptureSession } from '../services/captureSessionOrchestrator';
import { toCaptureSession } from '../services/archModelClient';
import type { ApiAuthSecret, SecretsBundle } from '../types/secrets';
import {
  proposeEndpointsFromCode as defaultProposeEndpointsFromCode,
  type ProposeEndpointsArgs,
  type ProposeEndpointsResult,
} from '../services/tools/propose_endpoints_from_code';
import { discoveryServiceClient as defaultDiscoveryServiceClient } from '../services/discoveryServiceClient';
import type { DiscoveryServiceClient } from '../services/discoveryServiceClient';

/**
 * Capture-session action endpoints. These are the HTTP entry points the
 * gateway proxies into; the new microservice owns secrets-in-process,
 * orchestrator spawn, and the live runManager handle.
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 6.
 * Spec: 2026-05-16 Migration Discovery Context Integration -- Task Group 3
 * adds the fail-soft Migration Discovery Context fetch to /start, surfacing
 * `context_unavailable` in the 202 response warnings array when AMS is
 * unreachable / errors out.
 * Spec: 2026-05-17 SOAP LLM Extraction and Payload Enrichment (Phase 2)
 * -- Task Group 6 adds `/extract-endpoints` for the Workstream A explicit
 * "Extract endpoints with LLM" button.
 * Spec: 2026-05-17 Spec File Auto-Linking (Phase 3) -- Task Group 6
 * extends the `/parse-oas` action so that when the body carries a
 * `discoveryRunId` (typically threaded through from the wizard alongside
 * the selected interface ids), repo-relative `spec_link` values resolved
 * by Workstream A's `specFileLinker` scanner are fetched via Phase 2's
 * discovery-service source endpoint. Absolute paths continue to use
 * SwaggerParser's local-read code path for back-compat with legacy
 * manual-upload values.
 *
 * Routes (all `POST`, all under this router which is mounted at
 * `/api-migration-validation/api/capture-sessions/:id/...`):
 *
 *   - `parse-oas`            -- read selected `Interface` rows from AMS OR
 *                                accept ad-hoc multipart upload, parse +
 *                                dereference, write inventory rows to AMS,
 *                                cache the in-memory inventory keyed by
 *                                sessionId for `/start` to consume.
 *   - `test-api-connection`  -- one redacted-logged probe call using the
 *                                in-memory secrets bundle for the session.
 *   - `test-db-connection`   -- `DbAdapter.testConnection()` via the
 *                                dbAdapterFactory; pulls the password from the
 *                                in-memory secrets bundle.
 *   - `start`                -- guards on `status='configured' AND secrets
 *                                present AND OAS inventory present`. Patches
 *                                session to `running`, optionally fetches the
 *                                Migration Discovery Context fail-soft, fires
 *                                the orchestrator fire-and-forget, returns 202
 *                                with the running session row plus a
 *                                `warnings[]` array (carries
 *                                `context_unavailable` on AMS aggregation
 *                                failure).
 *   - `cancel`               -- patches session to `cancelled`, signals abort
 *                                to the live runManager entry, purges secrets
 *                                AND the cached OAS inventory.
 *   - `secrets`              -- populates the in-memory `secretsStore` bundle.
 *                                NEVER touches AMS.
 *   - `extract-endpoints`    -- synchronous (W-15) Workstream A entry point:
 *                                invokes `propose_endpoints_from_code` against
 *                                the supplied (interfaceId, discoveryRunId)
 *                                pair and returns the structured operation
 *                                list. Returns 202 with `{ status: 'still_working' }`
 *                                when the tool call exceeds the server-side
 *                                60-second deadline -- the candidates land
 *                                asynchronously and the frontend re-opens to
 *                                pick them up. Returns the structured
 *                                `clone_evicted` / `malformed` envelope on the
 *                                two failure paths so the Step 4 UI can
 *                                disable the button / surface the toast.
 *                                Group 7 will swap the no-op finding emit +
 *                                bulkSaveCandidates persistence into this
 *                                route; Group 6 lands the wire shape only.
 *   - `reconcile-inventory`  -- configure-time inventory reconciliation
 *                                (Model-Seeded Capture Inventory spec,
 *                                2026-06-11, Task Group 2): loads the session
 *                                then returns the AMS reconciliation payload
 *                                VERBATIM (unaccounted endpoints, discovery
 *                                gaps, excluded-by-scope, both coverage
 *                                figures). The reconciliation KEY/comparison
 *                                live ONLY in the AMS Java calculator.
 *   - `account-endpoints`    -- bulk include / exclude-with-reason
 *                                accounting action: INCLUDE auto-creates a
 *                                schema-less operation row from the model
 *                                endpoint's metadata (reusing the
 *                                synthesiseInventoryFromEndpoints mapping);
 *                                EXCLUDE persists the same identity row with
 *                                `included=false` + `exclusion_reason`.
 *                                Persistence IS the accounting record the
 *                                /start hard gate reads.
 *
 * `projectId` and `architectureId` always travel as query params on these
 * routes -- the URL path is `:id` (the session id) only, matching the spec
 * route shape (`POST /api/capture-sessions/{id}/parse-oas`). The gateway
 * proxy strips the `:projectId` + `:architectureId` URL safety segments off
 * its inbound URL and injects them onto the query string when forwarding,
 * mirroring the AMS CRUD proxy pattern in `apiMigrationValidation.ts`.
 */

export interface CaptureSessionActionsDeps {
  archModelClient?: typeof defaultArchModelClient;
  /**
   * Override for the orchestrator spawn -- tests inject a stub so they can
   * assert /start fires the orchestrator without actually executing the
   * loop. Production callers leave this as the default.
   */
  spawnOrchestrator?: typeof orchestrateCaptureSession;
  /**
   * Optional probe override for `test-api-connection`. Production uses a
   * GET on the session's `apiBaseUrl`; tests inject a fake to avoid a real
   * network call without having to mock axios at the module level.
   */
  probeApiConnection?: (args: {
    baseUrl: string;
    auth: ApiAuthSecret;
    defaultHeaders: Record<string, string>;
  }) => Promise<{ status: number; durationMs: number }>;
  /**
   * Optional override for the DB adapter factory. Tests inject a stub adapter
   * exposing a fake `testConnection` so the path can be exercised without
   * spinning up a real pg pool.
   */
  createDbAdapter?: typeof createDbAdapter;
  /**
   * Override for the Workstream A LLM endpoint extraction call. Tests inject
   * a deterministic stub returning a pre-shaped {@link ProposeEndpointsResult}
   * (or a deliberately-slow promise to exercise the 60-second timeout path).
   */
  proposeEndpointsFromCode?: (
    args: ProposeEndpointsArgs,
  ) => Promise<ProposeEndpointsResult>;
  /**
   * Override for the server-side extract-endpoints deadline. Defaults to the
   * 60-second spec value; tests pass a small value (e.g. 50ms) so the timeout
   * path is exercised without holding the suite open. Per W-15.
   */
  extractEndpointsTimeoutMs?: number;
  /**
   * Override for the discovery-service client used by the `/parse-oas`
   * repo-relative `spec_link` resolution path (spec 2026-05-17 Spec File
   * Auto-Linking Phase 3 -- Task Group 6). Tests inject a stub asserting
   * the source-fetch URL shape and returning canned bodies. Production
   * callers leave this undefined; the singleton from
   * `discoveryServiceClient.ts` is used.
   */
  discoveryServiceClient?: DiscoveryServiceClient;
}

/**
 * Multipart upload setup for the ad-hoc OAS path. Memory storage only --
 * the spec is explicit that raw OAS bytes are NOT persisted; the file is
 * parsed in-process and discarded once the inventory rows are written.
 *
 * 5 MB cap matches the spec's `MAX_OAS_BYTES` posture and is generous for
 * realistic OAS docs (most real-world specs land well under 1 MB).
 */
const MAX_OAS_UPLOAD_BYTES = 5 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  // Spec 2026-06-03 (OAS-YAML + WADL/XSD): the wizard step-1 may now upload a
  // WADL together with one OR more sibling `.xsd` grammar files, so the single-
  // file cap is lifted to a small multi-file cap. The OAS path still uploads a
  // single file; the WADL path uploads the contract + its grammars together.
  limits: { fileSize: MAX_OAS_UPLOAD_BYTES, files: 12 },
});

/**
 * Extract `projectId` from a request -- query param OR body field. The
 * gateway proxy puts it on the query string (mirrors the CRUD proxy
 * pattern); direct callers may put it in the JSON body. Either way, this
 * is REQUIRED -- the AMS controllers are project-scoped, and the new
 * service has no way to discover a session's project from just the
 * session id without first querying AMS.
 */
function extractProjectId(req: Request): string | null {
  const fromQuery = req.query.projectId;
  if (typeof fromQuery === 'string' && fromQuery.length > 0) return fromQuery;
  const fromBody = (req.body as Record<string, unknown> | undefined)?.projectId;
  if (typeof fromBody === 'string' && fromBody.length > 0) return fromBody;
  return null;
}

/**
 * Mirror of {@link extractProjectId} for the `architectureId` URL safety
 * segment. The gateway proxy moves it from the path to the query string
 * before forwarding; Workstream A's extract-endpoints route needs it to
 * compose the discovery-service source-fetch URL inside the propose tool.
 */
function extractArchitectureId(req: Request): string | null {
  const fromQuery = req.query.architectureId;
  if (typeof fromQuery === 'string' && fromQuery.length > 0) return fromQuery;
  const fromBody = (req.body as Record<string, unknown> | undefined)?.architectureId;
  if (typeof fromBody === 'string' && fromBody.length > 0) return fromBody;
  return null;
}

function fail(res: Response, status: number, message: string, extra?: Record<string, unknown>): void {
  res.status(status).json({ error: { code: status, message, ...(extra || {}) } });
}

/**
 * Normalize whatever method string came back from the OAS parser into the
 * uppercase wire form persisted on the operation row.
 */
function methodUpper(m: string): string {
  return m.toUpperCase();
}

/**
 * Whether an HTTP verb is non-mutating (safe to execute regardless of the
 * mutating-call confirmation toggle). Pulled from the shared OAS types so
 * the wizard, the loop runner, and the parse step all agree.
 */
function isNonMutatingMethod(method: string): boolean {
  const lower = method.toLowerCase();
  return (NON_MUTATING_METHODS as ReadonlyArray<string>).includes(lower);
}

/**
 * Build a lookup of `"<METHOD> <path>"` -> seed-set `safeToExecute` (boolean)
 * from the discovery context, when present. Only seed sets that carry a
 * boolean `safeToExecute` participate; everything else falls back to verb
 * logic at the call site.
 */
function buildSeedSafetyMap(
  discoveryContext?: MigrationDiscoveryContextDto,
): Map<string, boolean> {
  const map = new Map<string, boolean>();
  for (const set of discoveryContext?.scenarioSeeds ?? []) {
    if (typeof set.safeToExecute === 'boolean') {
      map.set(set.operationKey, set.safeToExecute);
    }
  }
  return map;
}

/**
 * Persist the parsed inventory into AMS as one operation row per operation.
 * Exported additively for unit testing of the safe_to_execute / included
 * derivation.
 *
 * When a discovery context with a matching seed set is supplied, its
 * access-mode-derived `safeToExecute` (a boolean) takes precedence over the
 * HTTP-verb heuristic -- so e.g. a `POST` whose discovery seed says
 * `safeToExecute=true` is treated as safe, and a non-mutating verb whose seed
 * says `false` is treated as unsafe. Absent / non-boolean seed values fall
 * back to {@link isNonMutatingMethod}.
 */
export async function persistInventory(
  archModelClient: typeof defaultArchModelClient,
  projectId: string,
  session: CaptureSessionDto,
  inventory: ParsedOasInventory,
  discoveryContext?: MigrationDiscoveryContextDto,
): Promise<OperationDto[]> {
  const mutatingConfirmed = session.mutating_calls_confirmed === true;
  const seedSafety = buildSeedSafetyMap(discoveryContext);
  const written: OperationDto[] = [];
  for (const op of inventory.operations) {
    const opKey = `${op.method.toUpperCase()} ${op.path}`;
    const seededSafe = seedSafety.get(opKey);
    const isSafe =
      typeof seededSafe === 'boolean' ? seededSafe : isNonMutatingMethod(op.method);
    const includedDefault = mutatingConfirmed || isSafe;
    const created = await archModelClient.createOperation(projectId, {
      session_id: session.id,
      operation_id: op.operationId,
      method: methodUpper(op.method),
      path: op.path,
      summary: op.summary ?? null,
      description: op.description ?? null,
      included: includedDefault,
      safe_to_execute: isSafe,
      request_schema_json: op.requestSchema as unknown,
      response_schema_json: op.responseSchema as unknown,
      oas_operation_json: op.oasOperation as unknown,
    });
    written.push(created);
  }
  return written;
}

/**
 * Phase A pre-population (Bug fix 2026-05-17): synthesise a
 * `ParsedOasInventory` from the model's `endpoints` entities that belong to
 * a non-OAS interface (typically SOAP / legacy REST without a spec). The
 * shape lets the existing {@link persistInventory} write them as
 * operation rows so they appear in Step 4 of the wizard alongside any
 * OAS-derived ops -- the user can review + edit before Start.
 *
 * Field synthesis:
 *   - `method`        -- lowercased `operation_verb`; defaults to `'post'`
 *                        when the verb isn't a valid HTTP method (SOAP is
 *                        always POST).
 *   - `path`          -- `path_or_address`; empty when the entity didn't
 *                        carry one (e.g. partial scan).
 *   - `operationId`   -- entity `name`, or the slug `${method}_${path}`.
 *   - request/response schemas + `oasOperation` -- intentionally null /
 *                        minimal stub. The LLM tools tolerate missing
 *                        schemas; the row still surfaces in Step 4.
 *
 * Phase B (LLM-driven endpoint extraction for SOAP services where the
 * code scan emitted no endpoints) is its own spec; that case lands here
 * with zero rows synthesised and the wizard's Step 4 stays empty for
 * manual entry.
 */
const VALID_METHODS = new Set([
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
]);

/**
 * The seven SOAP `data` fields persisted to the AMS endpoint row's
 * `protocol_metadata_json` JSONB blob by the discovery-side save-back path
 * (see Group 10 of the SOAP Discovery Spring Classic Phase 1 spec). Mirrored
 * here so the wizard's Step 4 pre-population layer surfaces meaningful values
 * for each -- the candidate-side enumeration in
 * `mcp-server/src/services/candidateSaveBackService.ts` and this list MUST
 * match exactly. New SOAP fields added there MUST be added here in the same
 * pass.
 */
const SOAP_METADATA_KEYS = [
  'soap_action',
  'request_root_element',
  'request_namespace',
  'response_root_element',
  'request_dto_class',
  'response_dto_class',
  'wsdl_source',
] as const;

type SoapMetadataKey = (typeof SOAP_METADATA_KEYS)[number];

/**
 * Narrow read of a string field on the parent interface row. The wider
 * `InterfaceDto` type in this service only exposes the fields the wizard
 * needs (id, name, spec_link, ...), but the wire payload also carries
 * `interface_type` (snake_case JSON property on the AMS `InterfaceDto`),
 * which we read opportunistically for SOAP-aware pre-population.
 */
function readInterfaceType(
  iface: Record<string, unknown> | undefined,
): string | null {
  if (!iface) return null;
  const t = iface.interface_type;
  return typeof t === 'string' && t.length > 0 ? t : null;
}

/**
 * Extract the present SOAP keys off an endpoint row's `protocol_metadata_json`
 * blob. Returns a partial Record -- absent keys are NOT included (mirrors
 * the absent-key semantics enforced on the save-back side, Group 10 Test 3).
 * The blob arrives over the wire under the snake-case
 * `protocol_metadata_json` key per AMS `EndpointDto`'s `@JsonProperty`
 * mapping.
 */
function readSoapMetadata(
  endpoint: Record<string, unknown>,
): Partial<Record<SoapMetadataKey, string>> {
  const blob = endpoint.protocol_metadata_json;
  if (!blob || typeof blob !== 'object') return {};
  const out: Partial<Record<SoapMetadataKey, string>> = {};
  const obj = blob as Record<string, unknown>;
  for (const key of SOAP_METADATA_KEYS) {
    const v = obj[key];
    if (typeof v === 'string' && v.length > 0) {
      out[key] = v;
    }
  }
  return out;
}

/**
 * Single-endpoint variant of {@link synthesiseInventoryFromEndpoints}
 * (Model-Seeded Capture Inventory spec, 2026-06-11, Task Group 2): maps ONE
 * model endpoint row -> a schema-less {@link ParsedOasOperation}. The
 * `parse-oas` Phase A pre-population path and the `account-endpoints`
 * include/exclude accounting action share this mapping -- refactored out so
 * the reconciliation INCLUDE never reinvents the field synthesis.
 *
 * `opts.sourceMarker` overrides the `x-amvs-source` stamp on the synthesised
 * `oasOperation` stub (the accounting action passes
 * `'model-endpoint-reconciliation'`); when omitted, the legacy
 * discovery-endpoint-candidate markers apply -- byte-identical to the
 * pre-refactor behaviour.
 */
function synthesiseOperationFromEndpoint(
  e: Record<string, unknown>,
  opts: { isSoap: boolean; sourceMarker?: string },
): ParsedOasOperation {
  const { isSoap } = opts;
  const rawVerb = typeof e.operation_verb === 'string' ? e.operation_verb.toLowerCase() : '';
  const method = (VALID_METHODS.has(rawVerb) ? rawVerb : 'post') as ParsedOasOperation['method'];
  const path = typeof e.path_or_address === 'string' && e.path_or_address.length > 0
    ? e.path_or_address
    : '';
  const entityName = typeof e.name === 'string' && e.name.length > 0 ? e.name : null;
  const entityDescription = typeof e.description === 'string' ? e.description : null;

  // SOAP-aware mapping (Group 11): when the parent interface is a SOAP
  // service, read the seven SOAP fields off the endpoint row's
  // `protocol_metadata_json` and layer them into the operation row so
  // the wizard's Step 4 renders meaningfully without manual entry. The
  // mapping mirrors the contract enumeration in spec.md:
  //   soap_action            -> operation name (summary / operationId)
  //   request_root_element   -> request shape preview (oasOperation stub)
  //   request_namespace      -> XML namespace badge (description)
  //   response_root_element  -> response shape preview (oasOperation stub)
  //   request_dto_class      -> "open in IDE" affordance (oasOperation stub)
  //   response_dto_class     -> "open in IDE" affordance (oasOperation stub)
  //   wsdl_source            -> "Source: <repo-relative path>" row footer
  //                            (oasOperation stub)
  // Absent SOAP keys do NOT produce undefined / null string artefacts --
  // the operation row falls back to the existing endpoint-row fields.
  const soap = isSoap ? readSoapMetadata(e) : {};
  const soapKeys = Object.keys(soap) as SoapMetadataKey[];

  const summary = soap.soap_action ?? entityName;
  const operationId = summary ?? `${method.toUpperCase()}_${path || 'unknown'}`;

  // Description carries the XML namespace badge when present; falls back
  // to the entity's existing description so REST rows stay unchanged.
  const description = soap.request_namespace
    ? (entityDescription
        ? `${entityDescription} (namespace: ${soap.request_namespace})`
        : `XML namespace: ${soap.request_namespace}`)
    : entityDescription;

  // Build the OAS-shaped stub. For SOAP rows we attach a custom
  // `x-amvs-soap` block carrying the remaining SOAP fields so the wizard
  // can render shape-preview / DTO-class / WSDL-source affordances
  // without new top-level columns. Only keys actually present on the
  // candidate are forwarded -- absent keys are omitted (no `undefined`).
  const oasOperation: Record<string, unknown> = {
    operationId,
    summary: summary ?? undefined,
    description: description ?? undefined,
    'x-amvs-source':
      opts.sourceMarker ??
      (isSoap && soapKeys.length > 0
        ? 'discovery-endpoint-candidate-soap'
        : 'discovery-endpoint-candidate'),
    responses: {},
  };
  if (isSoap && soapKeys.length > 0) {
    const soapBlock: Partial<Record<SoapMetadataKey, string>> = {};
    for (const k of soapKeys) {
      soapBlock[k] = soap[k];
    }
    oasOperation['x-amvs-soap'] = soapBlock;
  }

  // SOAP rows have no real JSON schema, but we can project a minimal
  // placeholder schema carrying the request/response root element name so
  // downstream consumers (diff/comparator) have a non-null shape to anchor
  // on instead of an empty null. REST rows keep their null schemas.
  const requestSchema: OpenAPIV3.SchemaObject | null = soap.request_root_element
    ? ({ type: 'object', 'x-amvs-soap-root': soap.request_root_element } as unknown as OpenAPIV3.SchemaObject)
    : null;
  const responseSchema: OpenAPIV3.SchemaObject | null = soap.response_root_element
    ? ({ type: 'object', 'x-amvs-soap-root': soap.response_root_element } as unknown as OpenAPIV3.SchemaObject)
    : null;

  return {
    operationId,
    method,
    path,
    summary,
    description,
    requestSchema,
    responseSchema,
    // Minimal OAS-shaped stub so downstream callers (`oas_operation_json`
    // persistence) get a non-null payload they can serialise. We mark
    // the source so a future diagnostic / migration tool can spot
    // candidate-derived rows; SOAP rows additionally carry the SOAP
    // field block under `x-amvs-soap` for Step 4 rendering.
    oasOperation: oasOperation as unknown as ParsedOasOperation['oasOperation'],
  };
}

function synthesiseInventoryFromEndpoints(
  endpoints: Array<Record<string, unknown>>,
  parentInterface?: Record<string, unknown>,
): ParsedOasInventory {
  const isSoap = readInterfaceType(parentInterface) === 'SOAP_API';
  const operations: ParsedOasOperation[] = endpoints.map((e) =>
    synthesiseOperationFromEndpoint(e, { isSoap }),
  );
  return { operations, title: null, version: null };
}

/**
 * Combine multiple parsed inventories into one. Used when the wizard
 * selected several `Interface` rows -- each spec parses independently and
 * the combined inventory is persisted as a single contiguous block.
 */
function mergeInventories(parts: ParsedOasInventory[]): ParsedOasInventory {
  const operations: ParsedOasOperation[] = [];
  for (const p of parts) operations.push(...p.operations);
  return {
    operations,
    title: parts.map((p) => p.title).filter((t): t is string => !!t).join(' + ') || null,
    version: parts.map((p) => p.version).filter((v): v is string => !!v).join(', ') || null,
  };
}

/**
 * Body shape accepted by `POST /api/capture-sessions/:id/start`.
 *
 * `discoveryRunIds` and `includeDiscoveryContext` were added by the 2026-05-16
 * Migration Discovery Context Integration spec (Task Group 3). All fields are
 * optional -- when omitted, the route defaults to `includeDiscoveryContext=true`
 * and lets AMS resolve the latest completed discovery runs for the current
 * architecture (the documented "no runIds -> latest relevant" fallback).
 */
interface StartCaptureBody {
  projectId?: string;
  discoveryRunIds?: string[];
  includeDiscoveryContext?: boolean;
  maxFindings?: number;
  maxEvidenceItems?: number;
  /**
   * Model-Seeded Capture Inventory (2026-06-11): justified override for the
   * fail-closed inventory-coverage gate. When present and non-empty, the
   * handler PATCHes the session's coverage-override trio (justification,
   * unaccounted count at override time, timestamp) and proceeds to start
   * despite unaccounted in-scope endpoints. CamelCase, matching the
   * existing `includeDiscoveryContext` / `discoveryRunIds` body fields.
   */
  coverageOverrideJustification?: string;
}

/**
 * Body shape for `POST /api/capture-sessions/:id/parse-oas`.
 *
 * `discoveryRunId` was added by spec 2026-05-17 Spec File Auto-Linking
 * (Phase 3) -- Task Group 6. When present (and the selected interfaces
 * carry repo-relative `spec_link` values set by Workstream A's
 * `specFileLinker` scanner), the route resolves those spec files via the
 * discovery-service source endpoint instead of `fs.readFile`. When absent,
 * the route still works for absolute `spec_link` values via the legacy
 * local-read path.
 */
interface ParseOasBody {
  projectId?: string;
  architectureId?: string;
  discoveryRunId?: string;
  interfaceIds?: string[];
}

/**
 * Body shape for `POST /api/capture-sessions/:id/reconcile-inventory`
 * (Model-Seeded Capture Inventory spec, 2026-06-11, Task Group 2).
 *
 * CamelCase body fields matching the other action bodies (`interfaceIds`,
 * `includeDiscoveryContext`); the route maps them onto the AMS endpoint's
 * snake_case `InventoryReconciliationRequest`. The snake_case spellings are
 * tolerated too so callers typed straight off the AMS wire keep working.
 */
interface ReconcileInventoryBody {
  projectId?: string;
  scopeInterfaceIds?: string[] | null;
  scope_interface_ids?: string[] | null;
  persistScope?: boolean;
  persist_scope?: boolean;
  refreshFindings?: boolean;
  refresh_findings?: boolean;
}

/**
 * Body shape for `POST /api/capture-sessions/:id/account-endpoints`
 * (Model-Seeded Capture Inventory spec, 2026-06-11, Task Group 2).
 * Bulk-capable so "Include all" is one round trip. `exclude` REQUIRES a
 * non-empty `reason` (400 otherwise).
 */
interface AccountEndpointsItem {
  endpoint_id: string;
  action: 'include' | 'exclude';
  reason?: string;
}

interface AccountEndpointsBody {
  projectId?: string;
  items?: AccountEndpointsItem[];
}

/**
 * Cap on the unaccounted-endpoint refs embedded in the /start 409 body
 * (`INVENTORY_UNACCOUNTED_ENDPOINTS`). The full count always travels
 * alongside as `unaccountedTotalCount`.
 */
const UNACCOUNTED_EMBED_CAP = 50;

/**
 * Body shape for `POST /api/capture-sessions/:id/extract-endpoints` (W-3, W-15).
 *
 * The wizard's Step 4 empty-state button supplies the parent `interfaceId`
 * and the `discoveryRunId` whose cached clone holds the source files.
 * `sourceFilePaths` is the curated set of controllers / dispatchers /
 * hand-rolled-servlet paths the LLM should read -- Group 7 will compute the
 * default set from Phase 1's pack-source-walk results, but for Group 6 we
 * accept it on the wire so tests + early callers can drive the path
 * deterministically. `parentServiceName` is informational; if omitted the
 * route falls back to a placeholder.
 */
interface ExtractEndpointsBody {
  projectId?: string;
  architectureId?: string;
  interfaceId: string;
  discoveryRunId: string;
  sourceFilePaths?: string[];
  parentServiceId?: string;
  parentServiceName?: string;
  parentInterfaceName?: string;
}

/**
 * Server-side deadline for the synchronous extract-endpoints call (W-15).
 * Mirrors the 60-second client-side timeout in the Step 4 button so a
 * runaway LLM call doesn't pin the worker thread indefinitely.
 */
const DEFAULT_EXTRACT_ENDPOINTS_TIMEOUT_MS = 60_000;

/**
 * The clear "SOAP not supported yet" 400 message. Surfaced ONLY for an actual
 * WSDL / SOAP definition -- a plain `.xsd` is the WADL's grammar and is fully
 * supported. Spec 2026-06-03, Task Group 3.
 */
const SOAP_NOT_SUPPORTED_MESSAGE =
  "SOAP/WSDL services aren't supported for capture yet (the SOAP-envelope " +
  'execution path is a planned follow-on). REST contracts -- OAS (JSON/YAML) ' +
  'and WADL+XSD -- work today.';

/**
 * The friendly "you uploaded an XSD on its own" 400 message. An XSD defines
 * types, not endpoints, so it cannot drive capture without its WADL.
 * Spec 2026-06-03, Task Group 3.
 */
const LONE_XSD_MESSAGE =
  'You uploaded an XSD on its own -- upload the WADL too. An XSD alone defines ' +
  'types, not endpoints, so the capture harness has no operations to drive ' +
  'from it.';

/**
 * Parse a multipart contract upload (one OR more files) into a single
 * `ParsedOasInventory`, dispatching on the detected contract format
 * (spec 2026-06-03 OAS-YAML + WADL/XSD Contract Support, Task Groups 1-3):
 *
 *   - OAS (JSON or YAML)  -> `parseSpecText` (JSON-or-YAML tolerant) ->
 *                            `parseOasFromObject`.
 *   - WADL (+ sibling XSD grammars) -> `parseWadl` (XSD grammars supplied as
 *                            `relatedFiles`) -> `wadlToInventory` (XSD field-
 *                            walk -> JSON Schema on each operation's request /
 *                            response). When the WADL declares grammars that
 *                            were NOT uploaded, returns a 400 naming the XSD(s)
 *                            to add (`missingGrammars`).
 *   - WSDL / SOAP         -> clear "not supported yet" 400 (the SOAP-envelope
 *                            execution path is a planned follow-on).
 *   - lone XSD (no WADL)  -> friendly "upload the WADL too" 400.
 *
 * Returns the parsed inventory on success, or `null` when it has ALREADY
 * written a 4xx response onto `res` (the caller returns immediately in that
 * case). Never throws for the routine guard paths; a genuinely-malformed OAS
 * doc surfaces as a 400 here rather than bubbling to the route's 500 envelope.
 */
async function parseUploadedContract(
  files: Array<{ buffer: Buffer; originalname?: string; mimetype?: string }>,
  res: Response,
): Promise<ParsedOasInventory | null> {
  const classified: ClassifiedUpload = classifyUploadedFiles(
    files.map((f) => ({
      name: f.originalname ?? 'upload',
      content: f.buffer.toString('utf8'),
    })),
  );

  // --- WSDL / SOAP guard (true SOAP only; an .xsd is NOT SOAP) -------------
  if (classified.contractFormat === 'wsdl') {
    fail(res, 400, SOAP_NOT_SUPPORTED_MESSAGE, { code: 'SOAP_NOT_SUPPORTED' });
    return null;
  }

  // --- Lone-XSD guard (an XSD with no accompanying WADL) -------------------
  if (classified.contractFormat === 'xsd') {
    fail(res, 400, LONE_XSD_MESSAGE, { code: 'XSD_WITHOUT_WADL' });
    return null;
  }

  // --- WADL + XSD -> typed REST operations ---------------------------------
  if (classified.contractFormat === 'wadl' && classified.contractContent) {
    const result = parseWadl(classified.contractContent, {
      relatedFiles: classified.xsdGrammars,
      sourceFilePath: classified.contractName ?? undefined,
    });
    if (result.parseError) {
      fail(
        res,
        400,
        `The uploaded WADL could not be parsed (${result.parseError}). ` +
          'Confirm it is a WADL document in the ' +
          'http://wadl.dev.java.net/2009/02 namespace.',
        { code: 'WADL_PARSE_FAILED' },
      );
      return null;
    }
    // Grammar resolution: the WADL declared `<grammars><include href>` entries
    // that were not all uploaded. Surface the missing names so the wizard can
    // tell the user exactly which XSD to add.
    if (result.missingGrammars.length > 0) {
      fail(
        res,
        400,
        `The WADL references grammar file(s) that were not uploaded: ` +
          `${result.missingGrammars.join(', ')}. Upload the WADL together with ` +
          'its XSD grammar file(s) so request / response body types can be ' +
          'resolved.',
        { code: 'WADL_MISSING_GRAMMARS', missingGrammars: result.missingGrammars },
      );
      return null;
    }
    return wadlToInventory(result, classified.xsdGrammars);
  }

  // --- OAS (JSON or YAML) --------------------------------------------------
  // Default / 'oas' / 'unknown': try the JSON-or-YAML OAS path. A genuinely
  // invalid spec (neither JSON nor YAML, or not OAS v3) surfaces as a 400.
  const oasName = classified.contractName ?? files[0]?.originalname ?? 'upload';
  const oasContent =
    classified.contractContent ?? files[0]?.buffer.toString('utf8') ?? '';
  let parsedObj: object;
  try {
    parsedObj = parseSpecText(oasContent, oasName);
  } catch {
    fail(
      res,
      400,
      'Uploaded OAS file is not valid JSON or YAML. Upload an OpenAPI v3 ' +
        'document (.json/.yaml/.yml) or a WADL + its XSD grammar file(s).',
      { code: 'OAS_PARSE_FAILED' },
    );
    return null;
  }
  try {
    return await parseOasFromObject(parsedObj);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'OAS validation failed';
    fail(res, 400, message, { code: 'OAS_VALIDATION_FAILED' });
    return null;
  }
}

/** A WADL spec_link is detected by a `.wadl` extension on the stored path. */
function specLinkLooksLikeWadl(specLink: string): boolean {
  return specLink.toLowerCase().endsWith('.wadl');
}

/**
 * Resolve a relative grammar href against the WADL's own repo-relative
 * directory, using POSIX-style segments (pure; no fs). `..` / `.` are honoured.
 * Mirrors the discovery-service resolver so sibling-XSD paths line up with the
 * cached clone layout.
 */
function resolveGrammarRepoPath(wadlRepoPath: string, href: string): string {
  const baseDir = wadlRepoPath.replace(/\\/g, '/').replace(/\/[^/]*$/, '');
  const parts = (baseDir ? baseDir.split('/') : []).filter((p) => p.length > 0);
  for (const seg of href.replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

/**
 * Result of the spec-link WADL parse path. `missingGrammars` is non-empty when
 * one or more declared grammar files could not be fetched from the cached
 * clone (so the route can surface a clear message naming them).
 */
interface SpecLinkWadlResult {
  inventory: ParsedOasInventory | null;
  missingGrammars: string[];
}

/**
 * Parse a WADL referenced by an Interface `spec_link` (spec 2026-06-03
 * OAS-YAML + WADL/XSD Contract Support, Task Group 3 -- spec-link path).
 *
 * Steps:
 *   1. Fetch the WADL source via the discovery-service source endpoint (the
 *      file lives in the cached clone, NOT on the worker's disk).
 *   2. Parse once to read the declared `<grammars><include href>` paths.
 *   3. For each RELATIVE href, resolve it against the WADL's repo directory and
 *      fetch the sibling XSD via the same source endpoint, keying the
 *      `relatedFiles` map by the ORIGINAL href (that is what `parseWadl` looks
 *      up). Absolute-URL grammars are skipped (no network).
 *   4. Re-parse WITH the grammars and adapt via `wadlToInventory`.
 *
 * Surfaces unresolved grammars on `missingGrammars`. Re-throws
 * {@link SpecLinkCloneEvictedError} so the existing 409 handler fires.
 */
async function parseWadlFromSpecLink(
  specLink: string,
  client: DiscoveryServiceClient,
  fetchCtx: { projectId: string; architectureId: string; discoveryRunId: string },
): Promise<SpecLinkWadlResult> {
  const fetchOne = async (repoPath: string): Promise<string | null> => {
    const fetched = await client.fetchSourceFile({
      projectId: fetchCtx.projectId,
      architectureId: fetchCtx.architectureId,
      runId: fetchCtx.discoveryRunId,
      repoPath,
    });
    if (fetched.kind === 'evicted') {
      throw new SpecLinkCloneEvictedError(specLink, fetchCtx.discoveryRunId);
    }
    return fetched.kind === 'ok' ? fetched.content : null;
  };

  const wadlSource = await fetchOne(specLink);
  if (wadlSource == null) {
    throw new Error(
      `parseWadlFromSpecLink: WADL spec_link '${specLink}' not found on run '${fetchCtx.discoveryRunId}'.`,
    );
  }

  // First pass with no grammars -- just to read the declared grammar paths.
  const firstPass = parseWadl(wadlSource, { sourceFilePath: specLink });
  const iface = firstPass.interfaces[0];
  const declaredGrammars = iface?.grammarPaths ?? [];

  // Fetch each relative grammar; key by the original href for parseWadl.
  const relatedFiles = new Map<string, string>();
  const missingGrammars: string[] = [];
  for (const href of declaredGrammars) {
    if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(href)) continue; // absolute URL: skip
    const repoPath = resolveGrammarRepoPath(specLink, href);
    const content = await fetchOne(repoPath);
    if (content == null) {
      missingGrammars.push(href);
      continue;
    }
    relatedFiles.set(href, content);
  }

  // Second pass WITH the resolved grammars.
  const result = parseWadl(wadlSource, { relatedFiles, sourceFilePath: specLink });
  // Combine first-pass-declared misses with any parse-reported misses.
  for (const g of result.missingGrammars) {
    if (!missingGrammars.includes(g)) missingGrammars.push(g);
  }
  if (result.parseError) {
    return { inventory: null, missingGrammars };
  }
  return { inventory: wadlToInventory(result, relatedFiles), missingGrammars };
}

/**
 * Build the router. Accepts injectable deps so the test suite can
 * exercise routes without standing up real AMS / orchestrator / DB.
 */
export function buildCaptureSessionActionsRouter(
  deps: CaptureSessionActionsDeps = {},
): Router {
  const router = Router({ mergeParams: true });
  const archModelClient = deps.archModelClient ?? defaultArchModelClient;
  const spawnOrchestrator = deps.spawnOrchestrator ?? orchestrateCaptureSession;
  const dbAdapterFactory = deps.createDbAdapter ?? createDbAdapter;
  const proposeEndpointsFromCode =
    deps.proposeEndpointsFromCode ?? defaultProposeEndpointsFromCode;
  const extractEndpointsTimeoutMs =
    typeof deps.extractEndpointsTimeoutMs === 'number'
      ? deps.extractEndpointsTimeoutMs
      : DEFAULT_EXTRACT_ENDPOINTS_TIMEOUT_MS;
  const discoveryServiceClient =
    deps.discoveryServiceClient ?? defaultDiscoveryServiceClient;

  // ----------------------------------------------------------------------
  // POST /api/capture-sessions/:id/parse-oas
  // ----------------------------------------------------------------------
  router.post(
    '/api/capture-sessions/:id/parse-oas',
    upload.array('file'),
    async (req: Request, res: Response) => {
      const sessionId = req.params.id;
      const projectId = extractProjectId(req);
      if (!projectId) {
        return fail(res, 400, 'projectId is required (query param or body field)');
      }
      // Optional architectureId / discoveryRunId for the repo-relative
      // `spec_link` resolution branch (spec 2026-05-17 Phase 3, Task
      // Group 6). When either is missing OR every selected interface's
      // `spec_link` is absolute, the route falls through to the legacy
      // local-read path inside `parseOasFromFile` with no behaviour change.
      const architectureId = extractArchitectureId(req);
      const body = (req.body || {}) as ParseOasBody;
      const discoveryRunId =
        typeof body.discoveryRunId === 'string' && body.discoveryRunId.length > 0
          ? body.discoveryRunId
          : undefined;

      try {
        const session = await archModelClient.getCaptureSession(projectId, sessionId);

        // Ad-hoc upload path: one OR MORE files came in as multipart `file`
        // fields (spec 2026-06-03). Parse in-process; raw bytes are never
        // written to disk. The wizard may upload a single OAS doc, OR a WADL
        // together with one-or-more sibling `.xsd` grammar files.
        const uploadedFiles =
          (req as Request & { files?: Array<{ buffer: Buffer; originalname?: string; mimetype?: string }> })
            .files ?? [];
        const inventories: ParsedOasInventory[] = [];
        // Interfaces from `body.interfaceIds` that had no `spec_link` and
        // were skipped without failing the request (Bug fix 2026-05-17;
        // SOAP / non-OAS support).
        const skippedInterfaceIds: string[] = [];

        if (uploadedFiles.length > 0) {
          const inv = await parseUploadedContract(uploadedFiles, res);
          // parseUploadedContract returns null when it has already written a
          // 4xx response (WSDL/SOAP guard, lone-XSD guard, missing grammars,
          // or an unparseable spec). In that case we stop here.
          if (inv === null) return;
          inventories.push(inv);
        } else {
          // Interface-selected path: body carries `interfaceIds: string[]`.
          // Each is resolved via the architecture's interface list, then the
          // file behind `spec_link` is parsed.
          const interfaceIds = Array.isArray(body.interfaceIds) ? body.interfaceIds : [];
          if (interfaceIds.length === 0) {
            return fail(
              res,
              400,
              'parse-oas requires either a multipart `file` upload OR a body with `interfaceIds: string[]`.',
            );
          }
          const allInterfaces = await archModelClient.listInterfacesForArchitecture(
            projectId,
            session.architecture_id,
          );
          const byId = new Map<string, InterfaceDto>(allInterfaces.map((i) => [i.id, i]));
          // Bug fix (2026-05-17): SOAP / non-OAS interfaces have no OpenAPI
          // spec to parse. Previously this loop hard-failed with a 400 on the
          // first such interface, blocking the wizard for any service whose
          // interface mix included a non-OAS one. The behaviour is now: log
          // a `[diag-amvs]` skip line, continue, and surface the skipped
          // count to the caller so the UI can guide the user to define
          // those operations manually in Step 4. Interfaces missing from
          // the architecture still 404 -- that's a config error, not a
          // routine SOAP scenario.
          //
          // Phase 3 (2026-05-17): the `parseOasFromFile` call now threads
          // a `ctx` through so repo-relative `spec_link` values set by
          // Workstream A's scanner are fetched via the discovery-service
          // source endpoint. Absolute paths still resolve locally. When
          // `discoveryRunId` / `architectureId` are unavailable we pass
          // `ctx = undefined`, preserving the legacy fall-through.
          const ctxForParse =
            discoveryRunId && architectureId
              ? {
                  discoveryRunId,
                  projectId,
                  architectureId,
                  discoveryServiceClient,
                }
              : undefined;
          for (const id of interfaceIds) {
            const iface = byId.get(id);
            if (!iface) {
              return fail(res, 404, `Interface ${id} not found in architecture ${session.architecture_id}`);
            }
            if (!iface.spec_link || iface.spec_link.length === 0) {
              console.warn(
                `[diag-amvs] op=parse_oas action=skip iface=${id.slice(0, 8)} reason=no_spec_link`,
              );
              skippedInterfaceIds.push(id);
              continue;
            }
            try {
              // WADL spec_link (spec 2026-06-03): a `.wadl` reference is parsed
              // via the WADL path -- fetch the WADL + its sibling XSD grammars
              // from the cached clone and adapt to the same inventory shape.
              // Requires the discovery ctx (runId + architectureId); without it
              // we cannot reach the cached clone, so we skip to manual entry.
              if (specLinkLooksLikeWadl(iface.spec_link) && ctxForParse) {
                const wadlOut = await parseWadlFromSpecLink(
                  iface.spec_link,
                  discoveryServiceClient,
                  {
                    projectId,
                    architectureId: architectureId as string,
                    discoveryRunId: discoveryRunId as string,
                  },
                );
                if (wadlOut.missingGrammars.length > 0) {
                  return fail(
                    res,
                    400,
                    `The WADL '${iface.spec_link}' references grammar file(s) ` +
                      `that could not be resolved from the discovered source: ` +
                      `${wadlOut.missingGrammars.join(', ')}. Ensure the XSD ` +
                      'grammar file(s) are present alongside the WADL in the ' +
                      'discovered repository.',
                    {
                      code: 'WADL_MISSING_GRAMMARS',
                      interfaceId: id,
                      specLink: iface.spec_link,
                      missingGrammars: wadlOut.missingGrammars,
                    },
                  );
                }
                if (wadlOut.inventory) {
                  inventories.push(wadlOut.inventory);
                } else {
                  // Parse failed with grammars present -- skip to manual entry.
                  skippedInterfaceIds.push(id);
                }
                continue;
              }
              const inv = await parseOasFromFile(iface.spec_link, ctxForParse);
              inventories.push(inv);
            } catch (err) {
              // Phase 3 (2026-05-17): the discovery-service source endpoint
              // can surface a 410 Gone when the cached clone has been
              // garbage-collected. The parser raises a structured
              // `SpecLinkCloneEvictedError` for that case; we surface it to
              // the wizard as a 409 with a stable error code so the UI can
              // show "Source no longer cached" without parsing message
              // strings. All other parser errors fall through to the
              // existing 500 envelope below.
              if (err instanceof SpecLinkCloneEvictedError) {
                return fail(
                  res,
                  409,
                  'Source no longer cached -- re-run discovery and try again.',
                  {
                    code: 'SPEC_LINK_CLONE_EVICTED',
                    interfaceId: id,
                    specLink: iface.spec_link,
                    discoveryRunId: err.discoveryRunId ?? null,
                  },
                );
              }
              throw err;
            }
          }
          // Phase A pre-population (Bug fix 2026-05-17): for every
          // interface skipped above (no OAS spec), pull any `endpoints`
          // entities that already exist in the architecture model and
          // synthesise operation rows from them. This lets non-OAS
          // interfaces (legacy REST controllers discovered by the
          // framework adapter, etc.) skip manual entry on Step 4. SOAP
          // services whose code scan emitted zero endpoints fall through
          // to manual entry (Phase B LLM extraction is a future spec).
          for (const id of skippedInterfaceIds) {
            try {
              const endpoints = await archModelClient.listEndpointsForInterface(
                projectId,
                session.architecture_id,
                id,
              );
              if (endpoints.length === 0) {
                console.warn(
                  `[diag-amvs] op=parse_oas action=prepopulate iface=${id.slice(0, 8)} ` +
                    `endpoints=0 (manual entry required)`,
                );
                continue;
              }
              const synthInv = synthesiseInventoryFromEndpoints(
                endpoints,
                byId.get(id) as Record<string, unknown> | undefined,
              );
              inventories.push(synthInv);
              console.log(
                `[diag-amvs] op=parse_oas action=prepopulate iface=${id.slice(0, 8)} ` +
                  `endpoints=${endpoints.length}`,
              );
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              console.warn(
                `[diag-amvs] op=parse_oas action=prepopulate iface=${id.slice(0, 8)} ` +
                  `result=fail reason=${msg.slice(0, 80)}`,
              );
              // Fall through; user can still fill in Step 4 manually.
            }
          }

          // Persist the selected interface scope onto the session row
          // (Model-Seeded Capture Inventory spec, 2026-06-11, Task Group 2):
          // the Start-time reconciliation gate and the configure-time
          // `reconcile-inventory` action fall back to this persisted
          // `scope_interface_ids_json` so "selected interfaces" remains the
          // coverage contract after the wizard moves past Step 4. The ad-hoc
          // upload branch persists nothing -- null scope = whole-architecture
          // scope, nothing silently absent.
          await archModelClient.patchCaptureSession(projectId, sessionId, {
            scope_interface_ids_json: interfaceIds,
          });
        }

        const merged = mergeInventories(inventories);
        const persisted = await persistInventory(archModelClient, projectId, session, merged);

        // Cache the parsed inventory keyed by sessionId so /start can hand it
        // straight to the orchestrator without re-parsing.
        oasInventoryStore.set(sessionId, merged);

        return res.status(200).json({
          sessionId,
          operationCount: persisted.length,
          mutatingExcluded:
            session.mutating_calls_confirmed === true
              ? 0
              : persisted.filter((op) => op.included !== true).length,
          title: merged.title,
          version: merged.version,
          // New (2026-05-17): non-zero when one or more selected interfaces
          // had no spec_link. The UI uses this to display a "N interfaces
          // need their operations defined manually" hint on Step 4.
          skippedInterfaceCount: skippedInterfaceIds.length,
          skippedInterfaceIds,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'parse-oas failed';
        return fail(res, 500, message);
      }
    },
  );

  // ----------------------------------------------------------------------
  // POST /api/capture-sessions/:id/reconcile-inventory
  // ----------------------------------------------------------------------
  // Configure-time reconciliation action (Model-Seeded Capture Inventory
  // spec, 2026-06-11, Task Group 2). Loads the session, calls the AMS
  // inventory-reconciliation endpoint, and returns the AMS payload VERBATIM
  // -- the wizard's Step 4 sections, the coverage figures, and the baseline
  // display all render this payload without reshaping. The reconciliation
  // key + comparison live ONLY in the AMS Java calculator; no TypeScript
  // reimplementation exists anywhere.
  router.post(
    '/api/capture-sessions/:id/reconcile-inventory',
    async (req: Request, res: Response) => {
      const sessionId = req.params.id;
      const projectId = extractProjectId(req);
      if (!projectId) {
        return fail(res, 400, 'projectId is required (query param or body field)');
      }
      const body = (req.body || {}) as ReconcileInventoryBody;
      const rawScope = body.scopeInterfaceIds ?? body.scope_interface_ids;
      const scopeInterfaceIds = Array.isArray(rawScope)
        ? rawScope.filter((id) => typeof id === 'string' && id.length > 0)
        : null;
      const persistScope = (body.persistScope ?? body.persist_scope) === true;
      const rawRefresh = body.refreshFindings ?? body.refresh_findings;
      const refreshFindings = typeof rawRefresh === 'boolean' ? rawRefresh : null;

      try {
        // Load the session first so a bad session id surfaces as a clear
        // client error from AMS rather than an opaque reconciliation failure.
        await archModelClient.getCaptureSession(projectId, sessionId);
        const payload = await archModelClient.reconcileCaptureSessionInventory(
          projectId,
          sessionId,
          {
            scope_interface_ids: scopeInterfaceIds,
            persist_scope: persistScope,
            // Null lets the AMS default (true) apply; display-only callers
            // pass false explicitly.
            refresh_findings: refreshFindings,
          },
        );
        // VERBATIM passthrough -- the wire contract is defined once, in AMS.
        return res.status(200).json(payload);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'reconcile-inventory failed';
        return fail(res, 502, message);
      }
    },
  );

  // ----------------------------------------------------------------------
  // POST /api/capture-sessions/:id/account-endpoints
  // ----------------------------------------------------------------------
  // Bulk include / exclude-with-reason accounting action (Model-Seeded
  // Capture Inventory spec, 2026-06-11, Task Group 2).
  //
  //   - INCLUDE auto-creates a schema-less operation row from the model
  //     endpoint's metadata via the shared synthesiseOperationFromEndpoint
  //     mapping (`included=true`, `safe_to_execute=null`, null schemas
  //     except the SOAP `x-amvs-soap-root` placeholders,
  //     `x-amvs-source: 'model-endpoint-reconciliation'`). Included rows
  //     are ALSO appended to the session's cached oasInventoryStore
  //     inventory so the orchestrator's scenario generation sees them at
  //     /start (it only reads method/path/operation_id off the persisted
  //     rows, so schema-less rows are tolerated -- the Phase A SOAP
  //     pre-population path already exercises this).
  //   - EXCLUDE creates the same identity-mapped row with `included=false`
  //     + `exclusion_reason` -- persistence IS the accounting record, so
  //     the /start gate (which reads persisted operation rows via the AMS
  //     calculator) sees both verdicts with zero extra state.
  //
  // Responds with the created operation rows so the wizard can refresh its
  // Step 4 table without a separate list call.
  router.post(
    '/api/capture-sessions/:id/account-endpoints',
    async (req: Request, res: Response) => {
      const sessionId = req.params.id;
      const projectId = extractProjectId(req);
      if (!projectId) {
        return fail(res, 400, 'projectId is required (query param or body field)');
      }
      const body = (req.body || {}) as AccountEndpointsBody;
      const items = Array.isArray(body.items) ? body.items : [];
      if (items.length === 0) {
        return fail(
          res,
          400,
          'account-endpoints requires a non-empty `items` array of ' +
            "{ endpoint_id, action: 'include' | 'exclude', reason? } entries.",
        );
      }
      for (const item of items) {
        if (!item || typeof item.endpoint_id !== 'string' || item.endpoint_id.length === 0) {
          return fail(res, 400, 'Every account-endpoints item requires an `endpoint_id`.');
        }
        if (item.action !== 'include' && item.action !== 'exclude') {
          return fail(
            res,
            400,
            `Invalid action '${String((item as { action?: unknown }).action)}' for endpoint ` +
              `${item.endpoint_id} -- must be 'include' or 'exclude'.`,
          );
        }
        if (
          item.action === 'exclude' &&
          (typeof item.reason !== 'string' || item.reason.trim().length === 0)
        ) {
          return fail(
            res,
            400,
            `Excluding endpoint ${item.endpoint_id} requires a non-empty reason -- ` +
              'the exclusion-with-reason IS the accounting record.',
          );
        }
      }

      try {
        const session = await archModelClient.getCaptureSession(projectId, sessionId);
        const [allInterfaces, allEndpoints] = await Promise.all([
          archModelClient.listInterfacesForArchitecture(projectId, session.architecture_id),
          archModelClient.listEndpointsForArchitecture(projectId, session.architecture_id),
        ]);
        const interfacesById = new Map<string, InterfaceDto>(
          allInterfaces.map((i) => [i.id, i]),
        );
        const endpointsById = new Map<string, Record<string, unknown>>();
        for (const e of allEndpoints) {
          if (typeof e.id === 'string') endpointsById.set(e.id, e);
        }

        // Resolve EVERY endpoint id before writing anything, so a bad id
        // 404s without leaving a partial bulk write behind.
        const resolved: Array<{ item: AccountEndpointsItem; endpoint: Record<string, unknown> }> = [];
        for (const item of items) {
          const endpoint = endpointsById.get(item.endpoint_id);
          if (!endpoint) {
            return fail(
              res,
              404,
              `Endpoint ${item.endpoint_id} not found in architecture ${session.architecture_id}`,
            );
          }
          resolved.push({ item, endpoint });
        }

        const written: OperationDto[] = [];
        const includedOps: ParsedOasOperation[] = [];
        for (const { item, endpoint } of resolved) {
          const parentInterface =
            typeof endpoint.interface_id === 'string'
              ? interfacesById.get(endpoint.interface_id)
              : undefined;
          const isSoap =
            readInterfaceType(parentInterface as unknown as Record<string, unknown> | undefined) ===
            'SOAP_API';
          const op = synthesiseOperationFromEndpoint(endpoint, {
            isSoap,
            sourceMarker: 'model-endpoint-reconciliation',
          });
          const created = await archModelClient.createOperation(projectId, {
            session_id: sessionId,
            operation_id: op.operationId,
            method: methodUpper(op.method),
            path: op.path,
            summary: op.summary ?? null,
            description: op.description ?? null,
            included: item.action === 'include',
            // Auto-created accounting rows carry NO safety verdict -- the
            // user reviews them in the Step 4 table like any other row.
            safe_to_execute: null,
            request_schema_json: op.requestSchema as unknown,
            response_schema_json: op.responseSchema as unknown,
            oas_operation_json: op.oasOperation as unknown,
            exclusion_reason:
              item.action === 'exclude' ? (item.reason as string).trim() : null,
          });
          written.push(created);
          if (item.action === 'include') includedOps.push(op);
        }

        // Append included rows to the cached inventory so /start's
        // orchestrator hand-off sees them without a re-parse. Excluded rows
        // are accounting-only and never enter the inventory.
        if (includedOps.length > 0) {
          const cached = oasInventoryStore.get(sessionId);
          if (cached) {
            oasInventoryStore.set(sessionId, {
              ...cached,
              operations: [...cached.operations, ...includedOps],
            });
          } else {
            oasInventoryStore.set(sessionId, {
              operations: includedOps,
              title: null,
              version: null,
            });
          }
        }

        return res.status(200).json({ sessionId, operations: written });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'account-endpoints failed';
        return fail(res, 500, message);
      }
    },
  );

  // ----------------------------------------------------------------------
  // POST /api/capture-sessions/:id/test-api-connection
  // ----------------------------------------------------------------------
  router.post('/api/capture-sessions/:id/test-api-connection', async (req: Request, res: Response) => {
    const sessionId = req.params.id;
    const projectId = extractProjectId(req);
    if (!projectId) return fail(res, 400, 'projectId is required (query param or body field)');

    try {
      const session = await archModelClient.getCaptureSession(projectId, sessionId);
      const secrets = secretsStore.get(sessionId);
      if (!secrets) {
        return fail(res, 409, 'Secrets not loaded for this session. Submit /secrets before testing.', {
          code: 'SECRETS_NOT_LOADED',
        });
      }
      if (!session.api_base_url) {
        return fail(res, 400, 'Session has no api_base_url configured.');
      }

      const probe =
        deps.probeApiConnection ??
        (async (args) => {
          const exec = createSessionHttpExecutor({
            auth: args.auth,
            baseURL: args.baseUrl,
            timeoutMs: 10_000,
            defaultHeaders: args.defaultHeaders,
          });
          const t0 = Date.now();
          try {
            // A simple GET on the base URL is the minimal redacted-logged
            // probe call described in the spec. We tolerate any 2xx-5xx
            // status -- the goal is to confirm reachability + auth wiring.
            const resp = await exec.request({ method: 'GET', url: '/' });
            return { status: resp.status, durationMs: Date.now() - t0 };
          } finally {
            exec.dispose();
          }
        });

      const result = await probe({
        baseUrl: session.api_base_url,
        auth: secrets.api,
        defaultHeaders: session.default_headers_redacted_json ?? {},
      });

      return res.status(200).json({
        sessionId,
        success: result.status >= 200 && result.status < 500,
        status: result.status,
        durationMs: result.durationMs,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'test-api-connection failed';
      return fail(res, 502, message);
    }
  });

  // ----------------------------------------------------------------------
  // POST /api/capture-sessions/:id/test-db-connection
  // ----------------------------------------------------------------------
  router.post('/api/capture-sessions/:id/test-db-connection', async (req: Request, res: Response) => {
    const sessionId = req.params.id;
    const projectId = extractProjectId(req);
    if (!projectId) return fail(res, 400, 'projectId is required (query param or body field)');

    try {
      const session = await archModelClient.getCaptureSession(projectId, sessionId);
      const secrets = secretsStore.get(sessionId);
      if (!secrets) {
        return fail(res, 409, 'Secrets not loaded for this session. Submit /secrets before testing.', {
          code: 'SECRETS_NOT_LOADED',
        });
      }
      const cfg = session.db_config_redacted_json as
        | { dbType?: string; host?: string; port?: number; database?: string; schema?: string; username?: string }
        | null;
      if (!cfg || !cfg.dbType || !cfg.host || !cfg.port || !cfg.database || !cfg.username) {
        return fail(res, 400, 'Session has no DB configuration -- DB sampling is optional and was not configured.');
      }
      if (!secrets.db?.password) {
        return fail(res, 400, 'DB password missing from in-memory secrets bundle.');
      }
      if (cfg.dbType !== 'postgres' && cfg.dbType !== 'sybase') {
        return fail(res, 400, `Unsupported dbType: ${String(cfg.dbType)}`);
      }

      const adapter = dbAdapterFactory({
        dbType: cfg.dbType,
        host: cfg.host,
        port: cfg.port,
        database: cfg.database,
        schema: cfg.schema ?? null,
        username: cfg.username,
        password: secrets.db.password,
      });
      try {
        const result = await adapter.testConnection();
        return res.status(200).json({
          sessionId,
          success: result.success,
          serverVersion: result.serverVersion ?? null,
        });
      } finally {
        try {
          await adapter.dispose();
        } catch {
          // Pool teardown errors must not derail the response.
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'test-db-connection failed';
      return fail(res, 502, message);
    }
  });

  // ----------------------------------------------------------------------
  // POST /api/capture-sessions/:id/start
  // ----------------------------------------------------------------------
  router.post('/api/capture-sessions/:id/start', async (req: Request, res: Response) => {
    const sessionId = req.params.id;
    const projectId = extractProjectId(req);
    if (!projectId) return fail(res, 400, 'projectId is required (query param or body field)');

    const body = (req.body || {}) as StartCaptureBody;
    // Default: include discovery context when the field is omitted. The
    // wizard can pass `false` to opt out (e.g. when the user unchecks the
    // "include discovery context" checkbox in Step 1). AMS is the authority
    // on whether useful findings actually exist -- if not, the readiness
    // assessment surfaces gaps and the prompt block is degenerate but
    // present.
    const includeDiscoveryContext =
      body.includeDiscoveryContext === undefined ? true : body.includeDiscoveryContext === true;
    const discoveryRunIds = Array.isArray(body.discoveryRunIds) ? body.discoveryRunIds : undefined;
    const maxFindings = typeof body.maxFindings === 'number' ? body.maxFindings : undefined;
    const maxEvidenceItems =
      typeof body.maxEvidenceItems === 'number' ? body.maxEvidenceItems : undefined;

    try {
      const session = await archModelClient.getCaptureSession(projectId, sessionId);

      // Hard guard: status MUST be `configured`. Anything else is a stale
      // re-issue from the UI and we refuse rather than spawning a duplicate
      // orchestrator on top of an already-running (or terminal) session.
      if (session.status !== 'configured') {
        return fail(
          res,
          409,
          `Cannot start session in status '${session.status}'. Status must be 'configured'.`,
          { currentStatus: session.status },
        );
      }
      if (!secretsStore.has(sessionId)) {
        return fail(res, 409, 'Secrets not loaded for this session. Submit /secrets before /start.', {
          code: 'SECRETS_NOT_LOADED',
        });
      }
      const inventory = oasInventoryStore.get(sessionId);
      if (!inventory) {
        return fail(res, 409, 'Parsed OAS inventory not loaded for this session. Run /parse-oas before /start.', {
          code: 'INVENTORY_NOT_LOADED',
        });
      }

      // ----------------------------------------------------------------
      // Inventory-coverage hard gate (Model-Seeded Capture Inventory spec,
      // 2026-06-11, Task Group 2 / D8). Reconciliation RE-RUNS here --
      // catching model drift since configure -- with `refresh_findings:
      // true` so session-linked reconciliation findings stay current. The
      // scope is the session's persisted `scope_interface_ids_json` (null =
      // whole architecture), resolved AMS-side.
      //
      // The gate FAILS CLOSED: if the AMS reconciliation call errors we
      // refuse to start with a 502-style failure rather than silently
      // skipping coverage verification (unlike the deliberately fail-soft
      // discovery-context fetch below). No retroactive gating exists --
      // completed/active sessions are never re-gated; only this /start
      // transition runs the check.
      // ----------------------------------------------------------------
      let reconciliation: InventoryReconciliationResponse;
      try {
        reconciliation = await archModelClient.reconcileCaptureSessionInventory(
          projectId,
          sessionId,
          {
            scope_interface_ids: null,
            persist_scope: false,
            refresh_findings: true,
          },
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[diag-amvs] op=start_gate result=fail_closed session=${sessionId.slice(0, 8)} ` +
            `reason=${msg.slice(0, 80)}`,
        );
        return fail(
          res,
          502,
          'Inventory reconciliation is unavailable -- cannot verify that every ' +
            'in-scope committed endpoint is accounted for, so the session will ' +
            'not start (the coverage gate fails closed). Retry once the ' +
            `architecture-model-service is reachable. Upstream error: ${msg}`,
          { code: 'INVENTORY_RECONCILIATION_UNAVAILABLE' },
        );
      }
      const unaccounted = Array.isArray(reconciliation.in_scope_unaccounted_endpoints)
        ? reconciliation.in_scope_unaccounted_endpoints
        : [];
      if (unaccounted.length > 0) {
        const justification =
          typeof body.coverageOverrideJustification === 'string'
            ? body.coverageOverrideJustification.trim()
            : '';
        if (justification.length === 0) {
          console.warn(
            `[diag-amvs] op=start_gate result=blocked session=${sessionId.slice(0, 8)} ` +
              `unaccounted=${unaccounted.length}`,
          );
          return fail(
            res,
            409,
            `Cannot start: ${unaccounted.length} in-scope committed endpoint(s) have ` +
              'no operation row and no exclusion. Include or exclude each in the ' +
              'wizard, or re-submit with `coverageOverrideJustification` to ' +
              'override with a persisted justification.',
            {
              code: 'INVENTORY_UNACCOUNTED_ENDPOINTS',
              unaccountedCount: unaccounted.length,
              unaccounted: unaccounted.slice(0, UNACCOUNTED_EMBED_CAP),
              unaccountedTotalCount: unaccounted.length,
            },
          );
        }
        // Justified override: persist the audit trio BEFORE proceeding so
        // the override is durable even if the run later fails.
        await archModelClient.patchCaptureSession(projectId, sessionId, {
          coverage_override_justification: justification,
          coverage_override_unaccounted_count: unaccounted.length,
          coverage_override_at: new Date().toISOString(),
        });
        console.warn(
          `[diag-amvs] op=start_gate result=overridden session=${sessionId.slice(0, 8)} ` +
            `unaccounted=${unaccounted.length}`,
        );
      }

      const persistedOperations = await archModelClient.listOperationsBySession(projectId, sessionId);

      // ----------------------------------------------------------------
      // Migration Discovery Context fetch (fail-soft).
      //
      // Per spec 2026-05-16 Migration Discovery Context Integration (D3):
      // fetch happens BEFORE orchestrator spawn so the 202 response can
      // surface a `context_unavailable` warning to the wizard if AMS is
      // unreachable. ANY error -- transport failure, HTTP 4xx/5xx, malformed
      // body -- is caught, logged, and downgraded to a warning. The
      // orchestrator is spawned unchanged with no discovery context attached
      // so the existing capture flow continues working when discovery has
      // not run yet.
      // ----------------------------------------------------------------
      const warnings: string[] = [];
      let discoveryContext: MigrationDiscoveryContextDto | undefined;
      console.log(
        `[diag-amvs] op=start session=${sessionId.slice(0, 8)} ` +
          `fetch_context=${includeDiscoveryContext} include=${includeDiscoveryContext}`,
      );
      if (includeDiscoveryContext) {
        const ctxFetchStart = Date.now();
        try {
          discoveryContext = await archModelClient.getMigrationDiscoveryContext(projectId, {
            currentArchitectureId: session.architecture_id,
            discoveryRunIds,
            maxFindings,
            maxEvidenceItems,
          });
          // Forward any AMS-emitted context warnings up to the 202 response so
          // the wizard can surface "high_severity_unreviewed_findings",
          // "no_database_discovery_findings", etc. alongside the local
          // fail-soft warnings.
          if (Array.isArray(discoveryContext.contextWarnings)) {
            for (const w of discoveryContext.contextWarnings) {
              if (typeof w === 'string' && w.length > 0 && !warnings.includes(w)) {
                warnings.push(w);
              }
            }
          }
          // Counts only -- never finding titles or content.
          const findingsCount = Array.isArray(discoveryContext.highPriorityFindings)
            ? discoveryContext.highPriorityFindings.length
            : 0;
          const evidenceCount = Array.isArray(discoveryContext.evidenceHighlights)
            ? discoveryContext.evidenceHighlights.length
            : 0;
          console.log(
            `[diag-amvs] op=context_fetch result=ok ` +
              `elapsed_ms=${Date.now() - ctxFetchStart} ` +
              `findings=${findingsCount} evidence=${evidenceCount}`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(
            `[captureSessionActions] migration-discovery-context fetch failed for session ${sessionId}: ${msg} -- continuing without context`,
          );
          // Category-only diag log -- never the AMS error body.
          const anyErr = err as { response?: { status?: number }; code?: string };
          const status = anyErr?.response?.status;
          let reason = 'unknown';
          if (typeof status === 'number') {
            if (status >= 500) reason = 'ams_5xx';
            else if (status === 404) reason = 'ams_not_found';
            else if (status >= 400) reason = 'ams_4xx';
          } else if (anyErr?.code === 'ECONNREFUSED' || anyErr?.code === 'ECONNRESET') {
            reason = 'ams_unreachable';
          } else if (anyErr?.code === 'ETIMEDOUT') {
            reason = 'ams_timeout';
          } else if (typeof anyErr?.code === 'string') {
            reason = 'network_error';
          }
          console.warn(
            `[diag-amvs] op=context_fetch result=fail reason=${reason} warning_emitted=true`,
          );
          warnings.push('context_unavailable');
          discoveryContext = undefined;
        }
      }

      // Transition to `running` BEFORE spawning the orchestrator so any
      // concurrent /start hits us with the new status and trip the guard
      // above. We capture the patched row to return as the 202 body.
      const running = await archModelClient.patchCaptureSession(projectId, sessionId, {
        status: 'running',
        started_at: new Date().toISOString(),
        error_message: null,
      });

      // Fire-and-forget orchestrator spawn. Handled in-loop errors already
      // self-patch the session to `failed` and RESOLVE, so this `.catch` only
      // fires when an error escapes the orchestrator setup (e.g. a throw before
      // its internal try/catch). When that happens we MUST flip the session to
      // terminal `failed` here -- otherwise it sits stuck in RUNNING forever
      // (the original zombie bug). The patch is itself wrapped so a patch
      // failure can never crash the process.
      spawnOrchestrator(toCaptureSession(running), {
        oasInventory: inventory,
        persistedOperations,
        discoveryContext,
        // Group 9 (Phase 2 spec): pass the first linked discovery run id
        // into the orchestrator so per-scenario tool contexts carry a
        // runId for the get_operation_payload_context tool. When
        // discoveryRunIds is empty/undefined the orchestrator leaves the
        // field null and the tool degrades gracefully to WSDL-only.
        discoveryRunId:
          Array.isArray(discoveryRunIds) && discoveryRunIds.length > 0
            ? discoveryRunIds[0]
            : null,
      }).catch(async (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[captureSessionActions] orchestrator failed for session ${sessionId}: ${msg}`);
        // No-zombie guarantee: an error that escapes the orchestrator means the
        // session was never patched to a terminal state. Flip it to `failed`
        // here so it cannot sit in RUNNING indefinitely. Wrapped so a patch
        // failure (AMS down, etc.) only logs -- it must never crash the process.
        try {
          await archModelClient.patchCaptureSession(projectId, sessionId, {
            status: 'failed',
            error_message: msg,
            completed_at: new Date().toISOString(),
          });
        } catch (patchErr) {
          const patchMsg = patchErr instanceof Error ? patchErr.message : String(patchErr);
          console.error(
            `[captureSessionActions] failed to mark session ${sessionId} as failed after orchestrator error: ${patchMsg}`,
          );
        }
      });

      // Response body: the running session row, augmented with `warnings[]`.
      // The capture flow without discovery context still works -- callers
      // that don't read `warnings` see the same payload they did before.
      return res.status(202).json({ ...running, warnings });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'start failed';
      return fail(res, 500, message);
    }
  });

  // ----------------------------------------------------------------------
  // POST /api/capture-sessions/:id/cancel
  // ----------------------------------------------------------------------
  router.post('/api/capture-sessions/:id/cancel', async (req: Request, res: Response) => {
    const sessionId = req.params.id;
    const projectId = extractProjectId(req);
    if (!projectId) return fail(res, 400, 'projectId is required (query param or body field)');

    try {
      const session = await archModelClient.getCaptureSession(projectId, sessionId);
      // Cancel is permitted from `configured` (user backed out before /start)
      // or `running` (mid-run abort). Refusing it from terminal states avoids
      // spurious patches.
      if (session.status !== 'configured' && session.status !== 'running') {
        return fail(
          res,
          409,
          `Cannot cancel session in status '${session.status}'. Status must be 'configured' or 'running'.`,
          { currentStatus: session.status },
        );
      }

      // Signal abort to any live tool calls before patching status. The
      // orchestrator cleans up its own runManager entry on terminal status,
      // but we call cancel() here to interrupt any in-flight tool call so
      // it doesn't write a capture row after we've patched cancelled.
      runManager.cancel(sessionId);
      // Cached secrets + inventory are gone on cancel -- no resume path
      // exists in v1, only the clone-config CTA from the detail view.
      secretsStore.purge(sessionId);
      oasInventoryStore.purge(sessionId);

      const cancelled = await archModelClient.patchCaptureSession(projectId, sessionId, {
        status: 'cancelled',
        completed_at: new Date().toISOString(),
      });
      return res.status(200).json(cancelled);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'cancel failed';
      return fail(res, 500, message);
    }
  });

  // ----------------------------------------------------------------------
  // POST /api/capture-sessions/:id/secrets
  // ----------------------------------------------------------------------
  // NEVER writes to AMS. Only populates the in-memory secretsStore for the
  // session id. Used both as the wizard's "submit secrets" terminal step and
  // as the secret-loss UX re-entry path (idle session, no in-memory secrets).
  router.post('/api/capture-sessions/:id/secrets', (req: Request, res: Response) => {
    const sessionId = req.params.id;
    const body = (req.body || {}) as Partial<{
      api: ApiAuthSecret;
      db: { password: string } | null;
    }>;

    if (!body.api || typeof body.api !== 'object' || typeof body.api.type !== 'string') {
      return fail(res, 400, 'secrets body must include { api: { type, ... } }');
    }
    const validTypes: Array<ApiAuthSecret['type']> = [
      'none',
      'bearer',
      'api_key_header',
      'api_key_query',
      'basic',
      'custom_header',
    ];
    if (!validTypes.includes(body.api.type)) {
      return fail(res, 400, `Invalid auth type: ${String(body.api.type)}`);
    }

    const bundle: SecretsBundle = {
      sessionId,
      api: body.api,
      db: body.db && body.db.password ? { password: body.db.password } : undefined,
      loadedAt: Date.now(),
    };
    secretsStore.set(bundle);

    // NEVER echo back any secret material. Just confirm load.
    return res.status(200).json({
      sessionId,
      loaded: true,
      hasDbSecret: !!bundle.db,
    });
  });

  // ----------------------------------------------------------------------
  // POST /api/capture-sessions/:id/extract-endpoints
  // ----------------------------------------------------------------------
  // Workstream A entry point (spec 2026-05-17 SOAP LLM Extraction Phase 2,
  // Task Group 6). Synchronous (W-15) invocation of the Group 5 tool
  // `propose_endpoints_from_code`. The Step 4 "Extract endpoints with LLM"
  // button on the wizard surfaces this when the deterministic Spring Classic
  // SOAP scanner produced zero endpoint candidates.
  //
  // Wire shape (success):
  //   { sessionId, status: 'ok', operations: ProposedOperation[],
  //     warnings: string[] }
  // Wire shape (cached clone GC'd):
  //   { sessionId, status: 'clone_evicted', operations: [], warnings, runId }
  // Wire shape (malformed twice):
  //   { sessionId, status: 'malformed', operations: [], warnings }
  // Wire shape (server-side 60-second deadline hit):
  //   HTTP 202 { sessionId, status: 'still_working',
  //              message: 'Still working -- refresh in a minute' }
  //
  // Per W-15: the tool keeps running in the background after the 60-second
  // deadline; the frontend tells the user to reopen Step 4 later. We do NOT
  // surface an error in the deadline path -- the candidates land via the
  // tool's own emit path (Group 7) once it finishes.
  //
  // Group 7 will swap the route to (a) compute the curated source-file
  // path list from Phase 1's pack-source-walk results, (b) translate the
  // tool's `ProposedOperation[]` into endpoint candidates + bulk-save them
  // via the Phase 1 `bulkSaveCandidates` flow. Group 6 only lands the
  // wire shape and the timeout envelope.
  router.post(
    '/api/capture-sessions/:id/extract-endpoints',
    async (req: Request, res: Response) => {
      const sessionId = req.params.id;
      const projectId = extractProjectId(req);
      const architectureId = extractArchitectureId(req);
      if (!projectId) {
        return fail(res, 400, 'projectId is required (query param or body field)');
      }
      if (!architectureId) {
        return fail(res, 400, 'architectureId is required (query param or body field)');
      }

      const body = (req.body || {}) as ExtractEndpointsBody;
      if (typeof body.interfaceId !== 'string' || body.interfaceId.length === 0) {
        return fail(res, 400, 'interfaceId is required in the request body');
      }
      if (typeof body.discoveryRunId !== 'string' || body.discoveryRunId.length === 0) {
        return fail(res, 400, 'discoveryRunId is required in the request body');
      }

      const sourceFilePaths = Array.isArray(body.sourceFilePaths)
        ? body.sourceFilePaths.filter((p) => typeof p === 'string' && p.length > 0)
        : [];

      console.log(
        `[diag-amvs] op=extract_endpoints session=${sessionId.slice(0, 8)} ` +
          `iface=${body.interfaceId.slice(0, 8)} runId=${body.discoveryRunId.slice(0, 8)} ` +
          `files=${sourceFilePaths.length}`,
      );

      // Build the tool args. The wizard supplies `parentServiceName` +
      // `parentInterfaceName` when it has them (the model already holds the
      // display strings); the route falls back to placeholders so the tool
      // can still run when callers only pass the minimum (interfaceId +
      // runId). Group 7 will tighten this with a real AMS lookup.
      const toolArgs: ProposeEndpointsArgs = {
        interfaceCandidateId: body.interfaceId,
        parentServiceId: body.parentServiceId ?? '',
        parentServiceName: body.parentServiceName ?? 'unknown-service',
        parentInterfaceName: body.parentInterfaceName ?? body.interfaceId,
        runId: body.discoveryRunId,
        projectId,
        architectureId,
        sessionId,
        sourceFilePaths,
      };

      // Race the tool invocation against the server-side deadline. The
      // `still_working` 202 envelope lets the tool keep going (Group 7's
      // emit-on-completion path handles the late landing); we just stop
      // holding the HTTP socket open.
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      const deadline = new Promise<{ timedOut: true }>((resolve) => {
        timeoutHandle = setTimeout(
          () => resolve({ timedOut: true }),
          extractEndpointsTimeoutMs,
        );
      });

      try {
        const raceResult = await Promise.race<
          { timedOut: false; result: ProposeEndpointsResult } | { timedOut: true }
        >([
          proposeEndpointsFromCode(toolArgs).then(
            (result) => ({ timedOut: false as const, result }),
          ),
          deadline,
        ]);

        if (raceResult.timedOut) {
          console.warn(
            `[diag-amvs] op=extract_endpoints result=still_working ` +
              `session=${sessionId.slice(0, 8)} iface=${body.interfaceId.slice(0, 8)} ` +
              `timeout_ms=${extractEndpointsTimeoutMs}`,
          );
          return res.status(202).json({
            sessionId,
            status: 'still_working',
            message: 'Still working -- refresh in a minute',
          });
        }

        const result = raceResult.result;

        if (result.cloneEvicted) {
          return res.status(200).json({
            sessionId,
            status: 'clone_evicted',
            operations: [],
            warnings: result.warnings,
            runId: body.discoveryRunId,
          });
        }

        if (result.malformed) {
          return res.status(200).json({
            sessionId,
            status: 'malformed',
            operations: [],
            warnings: result.warnings,
          });
        }

        return res.status(200).json({
          sessionId,
          status: 'ok',
          operations: result.operations,
          warnings: result.warnings,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'extract-endpoints failed';
        console.error(
          `[diag-amvs] op=extract_endpoints result=error ` +
            `session=${sessionId.slice(0, 8)} iface=${body.interfaceId.slice(0, 8)} ` +
            `error=${message.slice(0, 80)}`,
        );
        return fail(res, 500, message);
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      }
    },
  );

  return router;
}

/**
 * Default-deps router used by the production entry point. Tests build their
 * own with `buildCaptureSessionActionsRouter({ ...overrides })`.
 */
export const captureSessionActionsRouter = buildCaptureSessionActionsRouter();
