/**
 * Code-story verbatim spec carriage (Spec 2026-07-06-h — Verbatim Code-Spec
 * Carriage, Code-Tier Oracle Program).
 *
 * Stories the deterministic code planner (Spec -g) stamped with
 * `provenance:plan-deterministic` + `apiEndpointIds` carry, embedded in their
 * generated spec text, EVERY relevant fact the committed model holds about
 * their endpoints — reproduced with content fidelity (canonical JSON, never
 * paraphrased, never truncated silently):
 *
 *   1. endpoint identity (verb, path, type, protocol, interface)
 *   2. request_contract  (committed JSONB, canonical-serialized, fenced)
 *   3. response_contract (same)
 *   4. protocol_metadata_json (SOAP)
 *   5. data effects: access mode, transactional flag, hop path, and the
 *      VERBATIM query_text with its query_kind
 *   6. behaviour blocks of the business_logics on those data-effect paths
 *   7. captured request/response examples from the ACTIVE current baseline —
 *      one canonical example per DISTINCT captured response status
 *      (approximation of the rubric canonical set until Spec K persists
 *      per-dimension scores), happy-path statuses first
 *   8. attached findings
 *   9. the parity obligation (byte-equivalent responses; state deltas for
 *      mutating endpoints once Spec N lands — explicitly marked
 *      "not captured" until then; NOTHING silent)
 *
 * The LLM is NEVER called on any carriage path. Manual-gate stories
 * (baseline-capture / closure sweeps) get deterministic PROCEDURE text so
 * their spec rows exist honestly even though the driver never dispatches
 * them.
 *
 * Honesty rules (Spec C idiom):
 *   - No committed contracts on ANY endpoint  -> `insufficient_context`
 *     (`no_committed_contracts`).
 *   - Unflagged story with zero baseline examples -> `insufficient_context`
 *     (`no_baseline_examples`) — flagged `missing_baseline` stories proceed
 *     (their JOB is to exist before capture completes).
 *   - Over budget -> deterministic trim ladder (extra examples first, then
 *     read-only non-transactional behaviour blocks; NEVER contracts, SQL, or
 *     protocol metadata), every drop listed in an omission manifest ->
 *     `generated_with_warnings`.
 */

import { getConfig } from '../config';
import type {
  LoadedBookOfWorkItem,
  MigrationStorySpecGenerationDto,
} from './migrationShapeSpecGenerationHandler';
import { SPEC_TEXT_REQUIRED_PREFIX } from './specGenerationResponseValidator';
import { fenceFor } from './migrationDbPackSpecCarriage';
import { MANUAL_GATE_TAG, CODE_PROVENANCE_TAG } from './migrationCodeStreamPlanner';

// ---------------------------------------------------------------------------
// Markers on the book-of-work item blob (stamped by Spec -g)
// ---------------------------------------------------------------------------

export interface CodeCarriageMarkers {
  codeStoryKind: string | null;
  apiInterfaceId: string | null;
  apiEndpointIds: string[] | null;
  baselineByEndpointId: Record<string, string | null> | null;
  flagReason: string | null;
  findingIds: string[] | null;
  protocol: string | null;
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) ? value.map((v) => String(v)) : null;
}

/**
 * Pure extras mapping (snake_case + camelCase tolerated, like the DB pack
 * markers). Exported so the loader mapping is unit-testable without the
 * batch scaffolding.
 */
export function codeCarriageMarkersFromBlob(obj: Record<string, unknown>): CodeCarriageMarkers {
  const record = (value: unknown): Record<string, string | null> | null =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, string | null>)
      : null;
  return {
    codeStoryKind:
      (obj.codeStoryKind as string | undefined) ??
      (obj.code_story_kind as string | undefined) ??
      null,
    apiInterfaceId:
      (obj.apiInterfaceId as string | undefined) ??
      (obj.api_interface_id as string | undefined) ??
      null,
    apiEndpointIds: stringArray(obj.apiEndpointIds ?? obj.api_endpoint_ids),
    baselineByEndpointId: record(obj.baselineByEndpointId ?? obj.baseline_by_endpoint_id),
    flagReason:
      (obj.flagReason as string | undefined) ?? (obj.flag_reason as string | undefined) ?? null,
    findingIds: stringArray(obj.findingIds ?? obj.finding_ids),
    protocol: (obj.protocol as string | undefined) ?? null,
  };
}

type CarriedStory = LoadedBookOfWorkItem & Partial<CodeCarriageMarkers>;

/** Fact-carriage stories: deterministic code stories WITH endpoints. */
export function isCodeFactCarriageStory(story: CarriedStory): boolean {
  return (
    (story.tags ?? []).includes(CODE_PROVENANCE_TAG) &&
    !(story.tags ?? []).includes(MANUAL_GATE_TAG) &&
    (story.apiEndpointIds?.length ?? 0) > 0
  );
}

/** Manual-gate carriage stories: deterministic procedure text, no facts fetch. */
export function isManualGateCarriageStory(story: CarriedStory): boolean {
  return (
    (story.tags ?? []).includes(CODE_PROVENANCE_TAG) &&
    (story.tags ?? []).includes(MANUAL_GATE_TAG)
  );
}

export function isCodeCarriageStory(story: CarriedStory): boolean {
  return isCodeFactCarriageStory(story) || isManualGateCarriageStory(story);
}

// ---------------------------------------------------------------------------
// Canonical JSON (content fidelity without byte-order ambiguity)
// ---------------------------------------------------------------------------

/**
 * Deterministic serialization: object keys sorted at every depth, 2-space
 * indent. Content equality with the AMS JSONB is what matters (round-trip
 * parse deep-equality is test-pinned); the stored JSONB has no canonical
 * text form to be byte-faithful to.
 */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(v as Record<string, unknown>).sort()) {
        out[key] = sort((v as Record<string, unknown>)[key]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(sort(value), null, 2);
}

// ---------------------------------------------------------------------------
// Facts: types + default AMS reads
// ---------------------------------------------------------------------------

export interface CarriageEndpointFacts {
  id: string;
  name: string;
  verb: string | null;
  path: string | null;
  endpointType: string;
  protocol: string;
  interfaceName: string;
  requestContract: unknown | null;
  responseContract: unknown | null;
  protocolMetadata: unknown | null;
}

export interface CarriageDataEffect {
  endpointId: string;
  accessMode: string | null;
  pathMetadata: unknown | null;
}

export interface CarriageBehaviourBlock {
  name: string;
  behavior: unknown;
}

export interface CarriageBaselineExample {
  endpointId: string;
  scenarioName: string;
  method: string;
  path: string;
  requestJson: unknown;
  responseStatus: number | null;
  responseJson: unknown;
}

export interface CodeSpecFacts {
  endpoints: CarriageEndpointFacts[];
  dataEffects: CarriageDataEffect[];
  behaviours: CarriageBehaviourBlock[];
  examples: CarriageBaselineExample[];
}

export type FetchCodeSpecFactsFn = (args: {
  projectId: string;
  currentArchitectureId: string;
  endpointIds: string[];
  baselineIds: string[];
}) => Promise<CodeSpecFacts>;

interface RawModelEndpoint {
  id?: string;
  name?: string;
  interface_id?: string;
  endpoint_type?: string;
  path_or_address?: string;
  protocol?: string;
  operation_verb?: string;
  request_contract?: unknown;
  response_contract?: unknown;
  protocol_metadata_json?: unknown;
}

async function amsGetJson<T>(url: string, label: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${label} failed: HTTP ${response.status} ${text}`);
  }
  return (await response.json()) as T;
}

/** Concrete captured path vs committed template (`/owners/{id}`). */
export function pathMatchesTemplate(concrete: string, template: string): boolean {
  if (concrete === template) return true;
  const stripQuery = (p: string) => p.split('?')[0];
  const c = stripQuery(concrete).replace(/\/+$/, '');
  const t = stripQuery(template).replace(/\/+$/, '');
  if (c === t) return true;
  const pattern = t
    .split('/')
    .map((seg) => (/^\{.+\}$/.test(seg) ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`^${pattern}$`).test(c);
}

/**
 * Default facts read. ONE existing AMS full-model read supplies everything
 * model-side: endpoints (the DTOs carry the contract JSONB blobs), interfaces,
 * business logics (with `behavior`), AND `relationships.endpoint_data_effects`
 * (verified: `ModelService` maps `findByModelFileId` into the model DTO).
 * Baseline examples come from the EXISTING
 * `/api-behaviour/baseline-items?baselineId=` read, matched to endpoints by
 * method + path template. Behaviour blocks are selected by
 * `behavior.method_id` membership in the data-effect hop method ids.
 */
export const defaultFetchCodeSpecFacts: FetchCodeSpecFactsFn = async ({
  projectId,
  currentArchitectureId,
  endpointIds,
  baselineIds,
}) => {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const wanted = new Set(endpointIds);

  // 1) Full model: endpoints (with contracts) + interfaces + business logics
  //    + endpoint_data_effects relationships.
  const model = await amsGetJson<{
    metaModel?: {
      entities?: {
        interfaces?: Array<{ id?: string; name?: string }>;
        endpoints?: RawModelEndpoint[];
        business_logics?: Array<{ name?: string; behavior?: unknown }>;
      };
      relationships?: {
        endpoint_data_effects?: Array<{
          endpoint_id?: string;
          access_mode?: string;
          path_metadata_json?: unknown;
        }>;
      };
    };
  }>(
    `${baseUrl}/api/model/projects/${encodeURIComponent(projectId)}` +
      `/architectures/${encodeURIComponent(currentArchitectureId)}`,
    'AMS full-model read'
  );
  const ifaceName = new Map<string, string>();
  for (const iface of model.metaModel?.entities?.interfaces ?? []) {
    if (iface.id) ifaceName.set(iface.id, iface.name ?? '');
  }
  const endpoints: CarriageEndpointFacts[] = [];
  for (const raw of model.metaModel?.entities?.endpoints ?? []) {
    if (!raw.id || !wanted.has(raw.id)) continue;
    endpoints.push({
      id: raw.id,
      name: raw.name ?? '',
      verb: raw.operation_verb ?? null,
      path: raw.path_or_address ?? null,
      endpointType: raw.endpoint_type ?? '',
      protocol: raw.protocol ?? '',
      interfaceName: raw.interface_id ? (ifaceName.get(raw.interface_id) ?? '') : '',
      requestContract: raw.request_contract ?? null,
      responseContract: raw.response_contract ?? null,
      protocolMetadata: raw.protocol_metadata_json ?? null,
    });
  }

  // 2) Data effects: same model response, relationships block.
  const dataEffects: CarriageDataEffect[] = (
    model.metaModel?.relationships?.endpoint_data_effects ?? []
  )
    .filter((r) => r.endpoint_id && wanted.has(r.endpoint_id))
    .map((r) => ({
      endpointId: r.endpoint_id as string,
      accessMode: r.access_mode ?? null,
      pathMetadata: r.path_metadata_json ?? null,
    }));

  // 3) Behaviour blocks on the effect paths.
  const hopMethodIds = new Set<string>();
  for (const effect of dataEffects) {
    const meta = effect.pathMetadata as { path?: Array<{ method_id?: string }> } | null;
    for (const hop of meta?.path ?? []) {
      if (hop?.method_id) hopMethodIds.add(hop.method_id);
    }
  }
  const behaviours: CarriageBehaviourBlock[] = [];
  for (const bl of model.metaModel?.entities?.business_logics ?? []) {
    const behavior = bl.behavior as { method_id?: string } | null | undefined;
    if (behavior && behavior.method_id && hopMethodIds.has(behavior.method_id)) {
      behaviours.push({ name: bl.name ?? '', behavior });
    }
  }

  // 4) Baseline examples (one read per distinct baseline id).
  const examples: CarriageBaselineExample[] = [];
  const distinctBaselines = [...new Set(baselineIds.filter((b) => b && b.length > 0))];
  for (const baselineId of distinctBaselines) {
    const items = await amsGetJson<Array<Record<string, unknown>>>(
      `${baseUrl}/api/projects/${encodeURIComponent(projectId)}` +
        `/api-behaviour/baseline-items?baselineId=${encodeURIComponent(baselineId)}`,
      'AMS baseline-items read'
    );
    for (const item of items ?? []) {
      const method = String(item.method ?? '').toUpperCase();
      const path = String(item.path ?? '');
      const endpoint = endpoints.find(
        (e) =>
          (e.verb ?? '').toUpperCase() === method &&
          e.path !== null &&
          pathMatchesTemplate(path, e.path)
      );
      if (!endpoint) continue;
      const status = item.response_status ?? item.responseStatus;
      examples.push({
        endpointId: endpoint.id,
        scenarioName: String(item.scenario_name ?? item.scenarioName ?? ''),
        method,
        path,
        requestJson: item.request_json ?? item.requestJson ?? null,
        responseStatus: typeof status === 'number' ? status : null,
        responseJson: item.response_json ?? item.responseJson ?? null,
      });
    }
  }

  return { endpoints, dataEffects, behaviours, examples };
};

// ---------------------------------------------------------------------------
// Example selection: one canonical example per distinct response status
// ---------------------------------------------------------------------------

/**
 * Canonical-set approximation (build-log decision H-4): one example per
 * DISTINCT captured response status per endpoint, 2xx statuses first, then
 * ascending; within a status the first by (scenarioName, insertion) order.
 * Spec K upgrades this to the persisted rubric-dimension set.
 */
export function selectCanonicalExamples(
  all: CarriageBaselineExample[],
  endpointId: string
): CarriageBaselineExample[] {
  const mine = all
    .filter((e) => e.endpointId === endpointId)
    .sort((a, b) => a.scenarioName.localeCompare(b.scenarioName));
  const byStatus = new Map<number, CarriageBaselineExample>();
  for (const example of mine) {
    const status = example.responseStatus ?? -1;
    if (!byStatus.has(status)) byStatus.set(status, example);
  }
  const statuses = [...byStatus.keys()].sort((a, b) => {
    const aHappy = a >= 200 && a < 300 ? 0 : 1;
    const bHappy = b >= 200 && b < 300 ? 0 : 1;
    return aHappy - bHappy || a - b;
  });
  return statuses.map((s) => byStatus.get(s) as CarriageBaselineExample);
}

// ---------------------------------------------------------------------------
// Spec text assembly (pure, deterministic)
// ---------------------------------------------------------------------------

function fencedJson(lines: string[], value: unknown): void {
  const body = canonicalJson(value);
  const fence = fenceFor(body);
  lines.push(`${fence}json`);
  lines.push(body);
  lines.push(fence);
}

function fencedText(lines: string[], label: string, body: string): void {
  const fence = fenceFor(body);
  lines.push(`${fence}${label}`);
  lines.push(body.replace(/\r\n/g, '\n').replace(/\n$/, ''));
  lines.push(fence);
}

export interface BuildCodeSpecTextArgs {
  story: CarriedStory;
  facts: CodeSpecFacts;
  /** endpointId -> canonical examples INCLUDED after the trim ladder. */
  examplesByEndpoint: Map<string, CarriageBaselineExample[]>;
  /** Behaviour blocks INCLUDED after the trim ladder. */
  behaviours: CarriageBehaviourBlock[];
  omissions: string[];
}

export function buildCodeSpecText(args: BuildCodeSpecTextArgs): string {
  const { story, facts, examplesByEndpoint, behaviours, omissions } = args;
  const lines: string[] = [];
  lines.push(`${SPEC_TEXT_REQUIRED_PREFIX} ${story.title}`);
  lines.push('');
  lines.push('## Context');
  lines.push('');
  lines.push(
    'This spec was assembled DETERMINISTICALLY from the committed architecture ' +
      'model and the captured current-state API behaviour baseline. Every fact ' +
      'below is authoritative — reproduce it, never re-derive or improve it. ' +
      'The implementation goal is LIKE-FOR-LIKE: the same request to the new ' +
      'implementation must produce the exact same response the current system ' +
      'produced.'
  );
  if (story.description) {
    lines.push('');
    lines.push(story.description);
  }
  if (story.flagReason) {
    lines.push('');
    lines.push(`**Flagged endpoint** — reason: \`${story.flagReason}\`.`);
  }

  for (const endpoint of facts.endpoints) {
    lines.push('');
    lines.push(`## Endpoint: ${endpoint.verb ?? ''} ${endpoint.path ?? endpoint.name}`.trim());
    lines.push('');
    lines.push(
      `Interface: ${endpoint.interfaceName || '(unassigned)'} · type: ` +
        `${endpoint.endpointType || 'n/a'} · protocol: ${endpoint.protocol || 'n/a'}`
    );

    lines.push('');
    lines.push('### Request contract (committed, verbatim)');
    lines.push('');
    if (endpoint.requestContract != null) {
      fencedJson(lines, endpoint.requestContract);
    } else {
      lines.push('_No committed request contract._');
    }

    lines.push('');
    lines.push('### Response contract (committed, verbatim)');
    lines.push('');
    if (endpoint.responseContract != null) {
      fencedJson(lines, endpoint.responseContract);
    } else {
      lines.push('_No committed response contract._');
    }

    if (endpoint.protocolMetadata != null) {
      lines.push('');
      lines.push('### SOAP protocol metadata (committed, verbatim)');
      lines.push('');
      fencedJson(lines, endpoint.protocolMetadata);
    }

    const effects = facts.dataEffects.filter((e) => e.endpointId === endpoint.id);
    lines.push('');
    lines.push(`### Data effects (${effects.length})`);
    if (effects.length === 0) {
      lines.push('');
      lines.push('_No committed data-effect edges for this endpoint._');
    }
    for (const effect of effects) {
      lines.push('');
      lines.push(`- access mode: \`${effect.accessMode ?? 'unknown'}\``);
      if (effect.pathMetadata != null) {
        fencedJson(lines, effect.pathMetadata);
      }
    }

    const examples = examplesByEndpoint.get(endpoint.id) ?? [];
    lines.push('');
    lines.push(`### Captured examples from the current system (${examples.length})`);
    for (const example of examples) {
      lines.push('');
      lines.push(
        `#### ${example.method} ${example.path} → ${example.responseStatus ?? 'n/a'} ` +
          `(scenario: ${example.scenarioName || 'unnamed'})`
      );
      lines.push('');
      lines.push('Request (as captured, redacted):');
      fencedJson(lines, example.requestJson);
      lines.push('');
      lines.push('Response body (as captured — the target must reproduce this):');
      fencedJson(lines, example.responseJson);
      lines.push('');
      lines.push('State delta: not captured (Spec N pending).');
    }
  }

  if (behaviours.length > 0) {
    lines.push('');
    lines.push(`## Behaviour blocks on the data-effect paths (${behaviours.length})`);
    for (const block of behaviours) {
      lines.push('');
      lines.push(`### \`${block.name}\``);
      lines.push('');
      fencedJson(lines, block.behavior);
    }
  }

  if ((story.findingIds?.length ?? 0) > 0) {
    lines.push('');
    lines.push('## Attached findings');
    lines.push('');
    for (const id of story.findingIds ?? []) lines.push(`- ${id}`);
  }

  lines.push('');
  lines.push('## Parity obligation');
  lines.push('');
  lines.push(
    '1. For every captured example above, the SAME request against the new ' +
      'implementation must produce a byte-equivalent response (status, ' +
      'declared headers, body) — verified by the parity replay loop.'
  );
  lines.push(
    '2. Honour every committed contract fact verbatim: parameter names and ' +
      'types, validation constraints, date formats, error-status mappings, ' +
      'serialization settings.'
  );
  lines.push(
    '3. Reproduce the data effects: the same tables touched with the same ' +
      'access modes; embedded SQL semantics preserved.'
  );

  if (omissions.length > 0) {
    lines.push('');
    lines.push('## Omitted for size (trim ladder — nothing else was dropped)');
    lines.push('');
    for (const omission of omissions) lines.push(`- ${omission}`);
  }

  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Manual-gate procedure text
// ---------------------------------------------------------------------------

export function buildManualGateSpecText(story: CarriedStory): string {
  const lines: string[] = [];
  lines.push(`${SPEC_TEXT_REQUIRED_PREFIX} ${story.title}`);
  lines.push('');
  lines.push('## Manual-gate work item');
  lines.push('');
  lines.push(
    'This story is HUMAN/WIZARD work — the execution driver never dispatches ' +
      'it to the implement-verify service. It completes when its gate ' +
      'condition holds.'
  );
  lines.push('');
  if (story.codeStoryKind === 'capture') {
    lines.push('## Procedure');
    lines.push('');
    lines.push(
      '1. Open the API Behaviour capture wizard against the CURRENT system.'
    );
    lines.push(
      `2. Capture scenarios for the ${story.apiEndpointIds?.length ?? 0} uncovered ` +
        'endpoint(s) listed on this story until each has accepted canonical captures.'
    );
    lines.push('3. Promote the captures to the active current baseline.');
    lines.push('');
    lines.push('## Gate condition');
    lines.push('');
    lines.push('Coverage floor met for every endpoint on this story.');
  } else {
    lines.push('## Procedure');
    lines.push('');
    lines.push(story.description || 'Run the closure parity sweep for this stream.');
    lines.push('');
    lines.push('## Gate condition');
    lines.push('');
    lines.push(
      'An UNSCOPED clean parity result over the full stream surface (or explicit ' +
        'waivers for every remaining difference).'
    );
  }
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// The carriage runner
// ---------------------------------------------------------------------------

/** Char budget above which the trim ladder engages (Spec C parity). */
export const CODE_CARRIAGE_MAX_CHARS = 300_000;

export interface RunCodeSpecCarriageDeps {
  fetchCodeSpecFacts: FetchCodeSpecFactsFn;
  maxChars?: number;
}

/**
 * Produce the per-story spec-generation row for a code carriage story.
 * NEVER calls the LLM. NEVER throws for content reasons — read failures and
 * missing facts land as honest per-story statuses.
 */
export async function runCodeSpecCarriage(args: {
  projectId: string;
  currentArchitectureId: string;
  story: CarriedStory;
  baseRow: MigrationStorySpecGenerationDto;
  deps: RunCodeSpecCarriageDeps;
}): Promise<MigrationStorySpecGenerationDto> {
  const { projectId, currentArchitectureId, story, baseRow, deps } = args;

  if (isManualGateCarriageStory(story)) {
    const specText = buildManualGateSpecText(story);
    return {
      ...baseRow,
      status: 'generated',
      confidence: 'high',
      generatedSpecText: specText,
      warningsJson: null,
      missingInputsJson: null,
      focusedContextRefsJson: { source: 'code_plan_manual_gate' },
      generatedAt: new Date().toISOString(),
      errorMessage: null,
    };
  }

  const endpointIds = story.apiEndpointIds ?? [];
  const baselineIds = Object.values(story.baselineByEndpointId ?? {}).filter(
    (b): b is string => typeof b === 'string' && b.length > 0
  );

  let facts: CodeSpecFacts;
  try {
    facts = await deps.fetchCodeSpecFacts({
      projectId,
      currentArchitectureId,
      endpointIds,
      baselineIds,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...baseRow,
      status: 'failed',
      errorMessage: `Code spec facts read failed: ${message}`,
    };
  }

  // Missing endpoints on the model = plan drift (regenerate) — honest failure.
  const foundIds = new Set(facts.endpoints.map((e) => e.id));
  const missingEndpoints = endpointIds.filter((id) => !foundIds.has(id));
  if (missingEndpoints.length > 0) {
    return {
      ...baseRow,
      status: 'insufficient_context',
      missingInputsJson: missingEndpoints.map((id) => ({
        input: `committed endpoint ${id}`,
        reason:
          'Listed on the story but absent from the committed model — the model ' +
          'changed since the plan was expanded; regenerate the migration plan.',
      })),
      errorMessage: null,
    };
  }

  const anyContract = facts.endpoints.some(
    (e) => e.requestContract != null || e.responseContract != null
  );
  if (!anyContract) {
    return {
      ...baseRow,
      status: 'insufficient_context',
      missingInputsJson: [
        {
          input: 'no_committed_contracts',
          reason:
            'None of this story\'s endpoints carry a committed request or response ' +
            'contract — re-run code discovery (contract capture) and commit, then ' +
            'regenerate the spec.',
        },
      ],
      errorMessage: null,
    };
  }

  const canonicalByEndpoint = new Map<string, CarriageBaselineExample[]>();
  for (const endpoint of facts.endpoints) {
    canonicalByEndpoint.set(endpoint.id, selectCanonicalExamples(facts.examples, endpoint.id));
  }
  const totalExamples = [...canonicalByEndpoint.values()].reduce((n, v) => n + v.length, 0);
  const isFlaggedMissingBaseline = (story.flagReason ?? '').includes('missing_baseline');
  if (totalExamples === 0 && !isFlaggedMissingBaseline) {
    return {
      ...baseRow,
      status: 'insufficient_context',
      missingInputsJson: [
        {
          input: 'no_baseline_examples',
          reason:
            'No accepted baseline captures matched this story\'s endpoints — run the ' +
            'capture story for this interface first, then regenerate the spec.',
        },
      ],
      errorMessage: null,
    };
  }

  // ----- Trim ladder (deterministic; nothing silent) -----
  const maxChars = deps.maxChars ?? CODE_CARRIAGE_MAX_CHARS;
  const omissions: string[] = [];
  let behaviours = [...facts.behaviours];
  let specText = buildCodeSpecText({
    story,
    facts,
    examplesByEndpoint: canonicalByEndpoint,
    behaviours,
    omissions,
  });

  // Rung (a): reduce examples beyond happy + declared error statuses (keep
  // the first TWO per endpoint: happy-first ordering means [happy, first
  // error] survive; further variants are named in the manifest).
  if (specText.length > maxChars) {
    for (const [endpointId, examples] of canonicalByEndpoint) {
      if (examples.length > 2) {
        for (const dropped of examples.slice(2)) {
          omissions.push(
            `captured example ${dropped.method} ${dropped.path} → ${dropped.responseStatus} ` +
              `(endpoint ${endpointId}, scenario ${dropped.scenarioName || 'unnamed'})`
          );
        }
        canonicalByEndpoint.set(endpointId, examples.slice(0, 2));
      }
    }
    specText = buildCodeSpecText({
      story,
      facts,
      examplesByEndpoint: canonicalByEndpoint,
      behaviours,
      omissions,
    });
  }

  // Rung (b): drop behaviour blocks whose data_effects claim read-only and
  // no transactional flag (the least response-shaping blocks).
  if (specText.length > maxChars && behaviours.length > 0) {
    const keep: CarriageBehaviourBlock[] = [];
    for (const block of behaviours) {
      const b = block.behavior as { data_effects?: unknown; transactional?: unknown } | null;
      const claims = JSON.stringify(b?.data_effects ?? '').toLowerCase();
      const readOnly = claims.includes('read') && !claims.includes('write');
      if (readOnly) {
        omissions.push(`behaviour block ${block.name} (read-only path)`);
      } else {
        keep.push(block);
      }
    }
    behaviours = keep;
    specText = buildCodeSpecText({
      story,
      facts,
      examplesByEndpoint: canonicalByEndpoint,
      behaviours,
      omissions,
    });
  }

  const warnings: Array<Record<string, unknown>> = [];
  if (omissions.length > 0) {
    warnings.push({
      code: 'code_carriage_trimmed',
      message: `${omissions.length} item(s) omitted for size — see the omission manifest in the spec.`,
    });
  }
  if (specText.length > maxChars) {
    warnings.push({
      code: 'code_carriage_large',
      message:
        `Verbatim carriage is ${specText.length.toLocaleString('en-GB')} chars after the ` +
        'trim ladder — contracts, SQL and protocol metadata are never dropped.',
    });
  }

  console.log(
    `[diag-gateway] pm_migration_shape_spec_generation code_carriage ` +
      `workItemId=${baseRow.workItemId} endpoints=${facts.endpoints.length} ` +
      `examples=${totalExamples} behaviours=${behaviours.length} chars=${specText.length}`
  );

  return {
    ...baseRow,
    status: warnings.length > 0 ? 'generated_with_warnings' : 'generated',
    confidence: 'high',
    generatedSpecText: specText,
    warningsJson: warnings.length > 0 ? warnings : null,
    missingInputsJson: null,
    focusedContextRefsJson: {
      source: 'committed_model_code_carriage',
      endpointIds,
      baselineIds,
    },
    generatedAt: new Date().toISOString(),
    errorMessage: null,
  };
}
