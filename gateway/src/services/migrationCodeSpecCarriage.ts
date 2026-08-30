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
 *   7. attached findings
 *   8. the parity obligation (byte-equivalent responses proven by the
 *      reconcile replay; state deltas for mutating endpoints once Spec N
 *      lands — explicitly marked "not captured" until then; NOTHING silent)
 *
 * CAPTURED EXAMPLES ARE REMOVED FROM SPEC CONSTRUCTION ENTIRELY (SCL pipeline
 * round-3 ruling, 2026-08-18: capture leaves the construction contract —
 * captures live ONLY in the reconcile oracle, the aggregate wire-facts miner,
 * and the extraction-time contradiction pass). This carriage previously
 * embedded per-endpoint captured request/response examples (a canonical set
 * per distinct response status) and blocked unflagged stories that had zero
 * captures (`no_baseline_examples`); both behaviours are deleted — the
 * committed model facts are the construction truth, and behavioural parity is
 * verified by the reconcile replay against the pinned baseline, never by
 * transcribed captures.
 *
 * The LLM is NEVER called on any carriage path. Manual-gate stories
 * (baseline-capture / closure sweeps) get deterministic PROCEDURE text so
 * their spec rows exist honestly even though the driver never dispatches
 * them.
 *
 * Honesty rules (Spec C idiom):
 *   - No committed contracts on ANY endpoint  -> `insufficient_context`
 *     (`no_committed_contracts`).
 *   - Over budget -> deterministic trim ladder (read-only non-transactional
 *     behaviour blocks; NEVER contracts, SQL, or protocol metadata), every
 *     drop listed in an omission manifest -> `generated_with_warnings`.
 */

import { getConfig } from '../config';
import type {
  LoadedBookOfWorkItem,
  MigrationStorySpecGenerationDto,
} from './migrationShapeSpecGenerationHandler';
import { SPEC_TEXT_REQUIRED_PREFIX } from './specGenerationResponseValidator';
import { fenceFor } from './migrationDbPackSpecCarriage';
import { MANUAL_GATE_TAG, CODE_PROVENANCE_TAG } from './migrationCodeStreamPlanner';
import { appendTargetStackSection } from './migrationTargetStackSpecSection';
import { createTracer } from '../trace';
import { loadPairRuleset } from '../migrationPairRules';

// SPEC-stage predicate emission (predicate run-judging batch — see
// docs/trace-logging.md §Predicate self-scoring layer). Emission only. A
// carriage-built story is by definition a zero-LLM spec (the design's
// PLAN.EXP.01 intent is folded into SPEC.CARRIAGE.01).
const trace = createTracer('gateway');

// Dialect guidance heading: pair-owned text from the migration-pair ruleset
// (Data-Tier Oracle Spec O) with a neutral fallback — this generic module
// names no engine; the pair file owns the words.
const DIALECT_GUIDANCE_HEADING: string = (() => {
  try {
    return loadPairRuleset()?.guidance_heading ?? 'SQL dialect rewrite guidance';
  } catch {
    return 'SQL dialect rewrite guidance';
  }
})();

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

/**
 * Planner-authored FOUNDATION stories (Spec 2026-07-23): code-provenance
 * tagged, not a manual gate, and carrying ZERO endpoint ids (cross-cutting
 * work — "Security & auth parity foundations" etc.). Pre-fix these matched no
 * route (isCodeFactCarriageStory fails on the endpoints condition) and fell
 * into the generic focused-context resolver, which blocked them on API-plane
 * inputs (SOAP findings / IaC refs / source capability) that do not exist for
 * a cross-cutting story. They generate DESCRIPTION-GROUNDED: the planner's
 * authored intent is the whole story.
 */
export function isCodeFoundationStory(story: CarriedStory): boolean {
  return (
    (story.tags ?? []).includes(CODE_PROVENANCE_TAG) &&
    !(story.tags ?? []).includes(MANUAL_GATE_TAG) &&
    (story.apiEndpointIds?.length ?? 0) === 0
  );
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

const HTTP_VERBS = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
  'TRACE',
]);

/**
 * INTERNAL (non-HTTP) endpoint fact — batch mains, scheduled jobs, message
 * listeners. These NEVER carry committed HTTP contracts or baseline captures,
 * so the code-facts contract/baseline gates must not dead-end on them
 * (2026-07-25 fix: the "Internal Processing" cluster story persisted
 * protocol 'rest' — interfaceKind() only knows rest|soap — and hit
 * no_committed_contracts, a remedy that cannot exist for batch mains).
 * Signals, any of: the formal endpoint type; a non-HTTP verb token
 * (e.g. BATCH_MAIN); the internal-block subtype in protocol metadata.
 */
export function isInternalEndpointFact(e: CarriageEndpointFacts): boolean {
  if ((e.endpointType ?? '').trim().toUpperCase() === 'INTERNAL_PROCESS') return true;
  const verb = (e.verb ?? '').trim().toUpperCase();
  if (verb.length > 0 && !HTTP_VERBS.has(verb)) return true;
  const meta = e.protocolMetadata as { endpoint_subtype?: unknown } | null;
  return meta != null && typeof meta === 'object' && meta.endpoint_subtype != null;
}

export interface CarriageDataEffect {
  endpointId: string;
  accessMode: string | null;
  pathMetadata: unknown | null;
  /** `dep_log_*` / `dep_phy_*` target ref — the internal-job recipe's effect scope. */
  dataEntityPointId: string | null;
}

export interface CarriageBehaviourBlock {
  name: string;
  behavior: unknown;
}

export interface CodeSpecFacts {
  endpoints: CarriageEndpointFacts[];
  dataEffects: CarriageDataEffect[];
  behaviours: CarriageBehaviourBlock[];
}

export type FetchCodeSpecFactsFn = (args: {
  projectId: string;
  currentArchitectureId: string;
  endpointIds: string[];
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
 * Behaviour blocks are selected by `behavior.method_id` membership in the
 * data-effect hop method ids. Captured baseline examples are NO LONGER read —
 * captures left spec construction entirely (round-3 ruling, 2026-08-18).
 */
export const defaultFetchCodeSpecFacts: FetchCodeSpecFactsFn = async ({
  projectId,
  currentArchitectureId,
  endpointIds,
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
          data_entity_point_id?: string;
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
      dataEntityPointId: r.data_entity_point_id ?? null,
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

  return { endpoints, dataEffects, behaviours };
};

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

/**
 * C3 (2026-08-30): name the KNOWN blind spots whenever an endpoint or
 * internal process resolves to ZERO data effects.
 *
 * "Data effects (0)" reads as "this writes nothing", and the downstream
 * DB-delta oracle consumes it as an EMPTY expected delta — so a process that
 * really does write either passes the oracle trivially or makes every real
 * write look like a regression.
 *
 * A live estate showed the failure at scale: every internal process reported
 * zero effects while a large minority demonstrably wrote. Two shapes
 * accounted for all of them — a batch main delegating to a DAO interface
 * whose INSERT/UPDATE lives in the `*Impl`, and a batch main invoking a
 * stored PROCEDURE through the project's own SQL-executor abstraction.
 *
 * Root cause: the walker recognises the JPA stored-procedure query API but
 * not a callable-statement invocation nor a project-specific SQL-executor
 * abstraction, and the procedure NAME is often assembled from a constant map
 * with token substitution, which no static walk folds today. So "re-scan and
 * commit" alone will report zero AGAIN — the operator has to know that
 * before trusting it.
 *
 * Engine-agnostic by design: naming a concrete engine or catalogue table
 * here would put engine knowledge in a generic module (see the engine-name
 * guard).
 *
 * This caveat does not pretend the traversal is fixed. It stops a false
 * negative from being read as a verified zero.
 */
function zeroDataEffectCaveat(kind: 'endpoint' | 'internal process'): string[] {
  return [
    `> **Zero data effects is NOT evidence that this ${kind} writes nothing.**`,
    '> The effect walk has known blind spots, and a re-scan will report zero,',
    '> again wherever they apply:',
    '>',
    '> 1. **Stored procedures.** Only the JPA stored-procedure query API is',
    '>    recognised. Invocations through a callable statement, a `{call ...}`',
    '>    escape, or a project-specific SQL-executor abstraction are not',
    '>    followed — and where the procedure name is assembled from a constant,',
    '>    map or string substitution it cannot be resolved statically at all.',
    '>    Everything those procedures write is invisible here.',
    '> 2. **DAO interface -> implementation delegation.** A call to an interface',
    '>    method whose SQL lives in the `*Impl` may not be joined up.',
    '>',
    `> Before trusting an empty effect scope, confirm by hand: list this ${kind}'s`,
    '> DAO / executor collaborators and read their SQL, then list the stored',
    "> procedures it reaches from the source database's own procedure catalogue.",
    '> If either shows writes, the DB-delta oracle for this story is unsafe',
    '> until the effects are captured or recorded manually.',
  ];
}

export interface BuildCodeSpecTextArgs {
  story: CarriedStory;
  facts: CodeSpecFacts;
  /** Behaviour blocks INCLUDED after the trim ladder. */
  behaviours: CarriageBehaviourBlock[];
  omissions: string[];
}

export function buildCodeSpecText(args: BuildCodeSpecTextArgs): string {
  const { story, facts, behaviours, omissions } = args;
  const lines: string[] = [];
  lines.push(`${SPEC_TEXT_REQUIRED_PREFIX} ${story.title}`);
  lines.push('');
  lines.push('## Context');
  lines.push('');
  lines.push(
    'This spec was assembled DETERMINISTICALLY from the committed architecture ' +
      'model. Every fact below is authoritative — reproduce it, never ' +
      're-derive or improve it. The implementation goal is LIKE-FOR-LIKE: the ' +
      'same request to the new implementation must produce the exact same ' +
      'response the current system produced (verified by the reconcile replay ' +
      'against the pinned current-state baseline — captured examples are ' +
      'deliberately NOT embedded here).'
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

    const internal = isInternalEndpointFact(endpoint);
    if (internal) {
      // Non-HTTP endpoint in a mixed story: no contract sections apply — the
      // grounding is the committed process metadata (class, method, schedule
      // or destination, subtype) and the DB-delta parity goal.
      lines.push('');
      lines.push(
        '_Internal (non-HTTP) process — no request/response contract applies. ' +
          'Parity oracle: same inputs produce the SAME database delta and the ' +
          'same emitted outputs as the current system._'
      );
      if (endpoint.protocolMetadata != null) {
        lines.push('');
        lines.push('### Internal process metadata (committed, verbatim)');
        lines.push('');
        fencedJson(lines, endpoint.protocolMetadata);
      }
    } else {
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
    }

    const effects = facts.dataEffects.filter((e) => e.endpointId === endpoint.id);
    lines.push('');
    lines.push(`### Data effects (${effects.length})`);
    if (effects.length === 0) {
      lines.push('');
      lines.push('_No committed data-effect edges for this endpoint._');
      lines.push('');
      lines.push(...zeroDataEffectCaveat('endpoint'));
    }
    for (const effect of effects) {
      lines.push('');
      lines.push(`- access mode: \`${effect.accessMode ?? 'unknown'}\``);
      if (effect.pathMetadata != null) {
        fencedJson(lines, effect.pathMetadata);
      }
      // Spec 2026-07-06-f: T-SQL dialect rewrite guidance, carried VERBATIM
      // from discovery's classifier (single-source suggestions — never
      // invented here). Rendered only when the edge's metadata carries a
      // tsql classification; ANSI/absent edges are untouched.
      const meta = effect.pathMetadata as {
        sql_dialect?: string;
        query_text?: string;
        non_portable_constructs?: Array<{
          construct?: string;
          matched_text?: string;
          suggested_equivalent?: string | null;
          note?: string;
        }>;
      } | null;
      if (meta?.sql_dialect === 'tsql' && (meta.non_portable_constructs?.length ?? 0) > 0) {
        lines.push('');
        lines.push(`#### ${DIALECT_GUIDANCE_HEADING}`);
        lines.push('');
        lines.push(
          'The SQL behind this edge uses T-SQL constructs that will NOT run ' +
            'unchanged on PostgreSQL. Rewrite using the suggested equivalents ' +
            'below, then prove behaviour with the scoped revalidation replay.'
        );
        if (typeof meta.query_text === 'string' && meta.query_text.length > 0) {
          lines.push('');
          lines.push('Offending SQL (verbatim):');
          lines.push('');
          lines.push('```sql');
          lines.push(meta.query_text);
          lines.push('```');
        }
        lines.push('');
        for (const construct of meta.non_portable_constructs ?? []) {
          const suggestion =
            construct.suggested_equivalent != null
              ? `→ \`${construct.suggested_equivalent}\``
              : '→ NO exact PostgreSQL equivalent (flagged — review required)';
          lines.push(
            `- \`${construct.matched_text ?? construct.construct ?? ''}\` ${suggestion} — ${construct.note ?? ''}`
          );
        }
      }
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
    '1. For every request in the pinned current-state baseline covering these ' +
      'endpoints, the SAME request against the new implementation must produce ' +
      'a byte-equivalent response (status, declared headers, body) — verified ' +
      'by the parity replay loop at reconcile time (captures are the ' +
      'verification oracle, never a construction input).'
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
// Internal-process spec text (Spec 2026-07-06-m — the DB-delta recipe)
// ---------------------------------------------------------------------------

export function buildInternalProcessSpecText(args: {
  story: CarriedStory;
  facts: CodeSpecFacts;
}): string {
  const { story, facts } = args;
  const lines: string[] = [];
  lines.push(`${SPEC_TEXT_REQUIRED_PREFIX} ${story.title}`);
  lines.push('');
  lines.push('## Context');
  lines.push('');
  lines.push(
    'This spec covers INTERNAL (non-HTTP) functionality — scheduled jobs, ' +
      'message listeners, batch processing. It was assembled DETERMINISTICALLY ' +
      'from the committed model. The like-for-like goal: the recreated process, ' +
      'run with the same inputs, produces the SAME database delta and the same ' +
      'emitted outputs as the current system.'
  );
  if (story.description) {
    lines.push('');
    lines.push(story.description);
  }

  const effectRefs = new Set<string>();
  for (const endpoint of facts.endpoints) {
    lines.push('');
    lines.push(`## Internal process: ${endpoint.name}`);
    lines.push('');
    lines.push(`Type: ${endpoint.endpointType || 'n/a'} · protocol: ${endpoint.protocol || 'n/a'}`);
    if (endpoint.protocolMetadata != null) {
      lines.push('');
      lines.push('### Trigger / schedule metadata (committed, verbatim)');
      lines.push('');
      fencedJson(lines, endpoint.protocolMetadata);
    }
    const effects = facts.dataEffects.filter((e) => e.endpointId === endpoint.id);
    lines.push('');
    lines.push(`### Data effects (${effects.length})`);
    if (effects.length === 0) {
      lines.push('');
      lines.push(
        '_No committed data-effect edges — the effect scope below is EMPTY; ' +
          'capture the effects (re-scan + commit) before relying on the recipe._'
      );
      lines.push('');
      lines.push(...zeroDataEffectCaveat('internal process'));
    }
    for (const effect of effects) {
      if (effect.dataEntityPointId) effectRefs.add(effect.dataEntityPointId);
      lines.push('');
      lines.push(
        `- access mode: \`${effect.accessMode ?? 'unknown'}\`` +
          (effect.dataEntityPointId ? ` · target: \`${effect.dataEntityPointId}\`` : '')
      );
      if (effect.pathMetadata != null) fencedJson(lines, effect.pathMetadata);
    }
  }

  if (facts.behaviours.length > 0) {
    lines.push('');
    lines.push(`## Behaviour blocks on the process paths (${facts.behaviours.length})`);
    for (const block of facts.behaviours) {
      lines.push('');
      lines.push(`### \`${block.name}\``);
      lines.push('');
      fencedJson(lines, block.behavior);
    }
  }

  lines.push('');
  lines.push('## Verification recipe (DB-delta oracle — Spec 2026-07-06-m)');
  lines.push('');
  lines.push(
    '1. **Pin the inputs.** Suppress the schedule on BOTH systems; trigger the ' +
      'process manually with pinned inputs (job parameters / a captured ' +
      'representative message for listeners).'
  );
  lines.push(
    `2. **Effect scope.** The comparison scope is the process's effect targets: ` +
      (effectRefs.size > 0 ? [...effectRefs].map((r) => `\`${r}\``).join(', ') : '(none committed — see above)') +
      '.'
  );
  lines.push(
    '3. **Compare DB deltas.** Snapshot the scoped tables before/after on current ' +
      'AND target; the deltas must match (row counts + reconciliation checksums — ' +
      'reuse the DB migration pack reconciliation machinery).'
  );
  lines.push(
    '4. **Compare outputs.** Emitted files byte-compare; emitted messages payload-' +
      'compare; self-API calls are covered by the endpoint parity evidence.'
  );

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
  /**
   * Target-stack section (2026-08-14): the deterministic captured-decisions
   * block appended to every carried spec so the byte-faithful parity contract
   * ALSO names the stack it must be implemented in. Null/absent → nothing
   * appended (manual-gate procedure text never receives it).
   */
  targetStackSectionText?: string | null;
}): Promise<MigrationStorySpecGenerationDto> {
  const { projectId, currentArchitectureId, story, baseRow, deps } = args;
  const withStackSection = (specText: string): string =>
    appendTargetStackSection(specText, args.targetStackSectionText ?? null);

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

  let facts: CodeSpecFacts;
  try {
    facts = await deps.fetchCodeSpecFacts({
      projectId,
      currentArchitectureId,
      endpointIds,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...baseRow,
      status: 'failed',
      errorMessage: `Code spec facts read failed: ${message}`,
    };
  }

  // INTERNAL-process stories (Spec 2026-07-06-m): no HTTP contracts, no
  // baseline examples — the verification oracle is the DB-delta recipe. The
  // spec embeds the verbatim process metadata + data effects + the four-step
  // recipe (user decision: same DB delta + same emitted outputs = parity).
  // Routed by persisted protocol OR by the facts themselves (2026-07-25):
  // interface-cluster stories over the synthesized "Internal Processing"
  // interface persist protocol 'rest', so an all-internal endpoint set must
  // route here too — otherwise the story dead-ends on the HTTP contract gate.
  const allEndpointsInternal =
    facts.endpoints.length > 0 && facts.endpoints.every(isInternalEndpointFact);
  if ((story.protocol ?? '') === 'internal' || allEndpointsInternal) {
    const foundInternal = new Set(facts.endpoints.map((e) => e.id));
    const missingInternal = endpointIds.filter((id) => !foundInternal.has(id));
    if (missingInternal.length > 0) {
      return {
        ...baseRow,
        status: 'insufficient_context',
        missingInputsJson: missingInternal.map((id) => ({
          input: `committed internal entry point ${id}`,
          reason:
            'Listed on the story but absent from the committed model — regenerate the migration plan.',
        })),
        errorMessage: null,
      };
    }
    const specText = buildInternalProcessSpecText({ story, facts });
    return {
      ...baseRow,
      status: 'generated',
      confidence: 'high',
      generatedSpecText: withStackSection(specText),
      warningsJson: null,
      missingInputsJson: null,
      focusedContextRefsJson: {
        source: 'committed_model_internal_carriage',
        endpointIds,
      },
      generatedAt: new Date().toISOString(),
      errorMessage: null,
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

  // Internal endpoints ground on their committed process metadata instead of
  // HTTP contracts (they can never have contracts — the re-run-contract-
  // capture remedy would be a dead end for a mixed HTTP+internal story).
  // Captured baseline examples are NO LONGER a contract source (round-3
  // ruling, 2026-08-18): the committed model is the construction truth; the
  // captures verify at reconcile time only.
  const anyContract = facts.endpoints.some(
    (e) =>
      e.requestContract != null ||
      e.responseContract != null ||
      (isInternalEndpointFact(e) && e.protocolMetadata != null)
  );
  if (!anyContract) {
    return {
      ...baseRow,
      status: 'insufficient_context',
      missingInputsJson: [
        {
          input: 'no_committed_contracts',
          reason:
            'None of this story\'s endpoints carry a committed request/response ' +
            'contract — re-run code discovery (contract capture) and commit, then ' +
            'regenerate the spec. (Captured baseline examples no longer substitute ' +
            'for a committed contract: captures verify at reconcile time only.)',
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
    behaviours,
    omissions,
  });

  // Rung (a): drop behaviour blocks whose data_effects claim read-only and
  // no transactional flag (the least response-shaping blocks). The former
  // rung that trimmed captured examples is gone with the examples themselves.
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
      `behaviours=${behaviours.length} chars=${specText.length}`
  );

  // SPEC-stage predicates (predicate run-judging batch) — emission only.
  const specCorr = { job: String(baseRow.workItemId ?? '') };
  trace.predicate(
    'SPEC.CARRIAGE.01', 'deterministic carriage engaged (zero-LLM spec) with fact counts',
    facts.endpoints.length > 0,
    'code story spec assembled from model facts; endpoints > 0',
    `endpoints=${facts.endpoints.length} ` +
      `behaviours=${behaviours.length} chars=${specText.length}`,
    specCorr,
  );
  const tsqlEdges = JSON.stringify(facts).includes('"sql_dialect":"tsql"');
  const guidanceIncluded = specText.includes(`#### ${DIALECT_GUIDANCE_HEADING}`);
  if (!tsqlEdges) {
    trace.predicateSkip(
      'SPEC.DIAL.01', 'T-SQL rewrite guidance embedded when tsql edges exist',
      'story carries no tsql-classified data-effect edges', specCorr,
    );
  } else {
    trace.predicate(
      'SPEC.DIAL.01', 'T-SQL rewrite guidance embedded when tsql edges exist',
      guidanceIncluded,
      'guidance block present for tsql-classified edges',
      `tsql_edges=present guidance_block=${guidanceIncluded ? 'present' : 'MISSING'}`,
      specCorr,
    );
  }
  trace.predicate(
    'SPEC.OMIT.01', 'trim omissions enumerated, never silent',
    (omissions.length > 0) === warnings.some((w) => String(w.code) === 'code_carriage_trimmed'),
    'omission manifest and trimmed-warning agree',
    `omissions=${omissions.length} chars=${specText.length}/${maxChars} ` +
      `warnings=[${warnings.map((w) => String(w.code)).join(',')}]`,
    specCorr,
  );

  return {
    ...baseRow,
    status: warnings.length > 0 ? 'generated_with_warnings' : 'generated',
    confidence: 'high',
    generatedSpecText: withStackSection(specText),
    warningsJson: warnings.length > 0 ? warnings : null,
    missingInputsJson: null,
    focusedContextRefsJson: {
      source: 'committed_model_code_carriage',
      endpointIds,
    },
    generatedAt: new Date().toISOString(),
    errorMessage: null,
  };
}
