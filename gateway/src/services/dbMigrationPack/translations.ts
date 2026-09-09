/**
 * Per-object DB translation pipeline (Sybase ASE T-SQL -> PostgreSQL).
 *
 * Spec: 2026-06-11 LLM-Assisted DB Object Translation Drafts — Task Group 3.
 *
 * Stages per `requires_translation_spec_2` object:
 *   seed      — one durable translation row per manifest entry; source body
 *               resolved from its provenance finding detail_json; fidelity
 *               flags computed at seed time (truncated -> needs_manual
 *               terminal; missing `literal_policy: targeted_v2` marker ->
 *               legacy_redacted). Regeneration re-links by `translation_key`
 *               (`kind--object_ref`) + source-body SHA-256: unchanged hash
 *               preserves draft/verdict/review verbatim; changed hash demotes
 *               review to needs_rework with an auto-appended note (approval
 *               NEVER silently survives a source change).
 *   pre-pass  — deterministic, NO LLM: NON_PORTABLE token conversions +
 *               known-untranslatable construct flags (never guessed).
 *   translate — ONE focused LLM call per object (proc -> PL/pgSQL function;
 *               trigger -> trigger function + CREATE TRIGGER; view -> SQL).
 *   judge     — verdict-only LLM call; a draft persists as `drafted` ONLY
 *               together with its judge verdict (one PATCH).
 *
 * LLM is allowed ONLY in the translate + judge calls — everything else here
 * is pure deterministic code. Both call types follow the one-retry
 * `callWithRetry` convention from `migrationBookOfWorkExpansionHandler.ts`
 * and run through the ONE shared bounded pool (`getMigrationPlanLlmPool()` /
 * `MIGRATION_PLAN_LLM_CONCURRENCY`) — no new pool, no new knob.
 *
 * Coverage guarantee (code-enforced, never diligence): after every run each
 * manifest object resolves to exactly one bucket — translated-draft |
 * rewrite-in-app | dropped(reason) | failed(retryable) |
 * needs-manual(truncated) — anything else throws.
 */

import * as crypto from 'crypto';
import { getConfig } from '../../config';
import { logger } from '../logger';
import type { LlmCallerFn } from '../migrationBookOfWorkHandler';
import { LlmConcurrencyPool, getMigrationPlanLlmPool } from '../llmConcurrencyPool';
import type { RawDiscoveryFinding } from './inputs';
import { loadPairRuleset, type MigrationPairRuleset } from '../../migrationPairRules';
import {
  deriveRoutineDescriptor,
  renderRoutineContract,
  type RoutineCatalogRow,
  type RoutineDescriptor,
} from './routineInvocationDescriptor';
import { validateDraftAgainstDescriptor } from './descriptorValidator';
import {
  JudgeVerdict,
  TranslationDraftResponse,
  validateJudgeVerdict,
  validateTranslationResponse,
} from './translationValidators';

// ---------------------------------------------------------------------------
// Wire types (AMS snake_case — Group 2 endpoints)
// ---------------------------------------------------------------------------

/**
 * 2026-08-07 (gold standard C4): + `check_constraint` (non-portable CHECK
 * expressions used to die as "translate manually and ALTER TABLE after
 * review" comments — manual residue) and + `scheduled_job` (DB-resident jobs
 * used to land in `manual_recreation` — same residue; they now translate to
 * pg_cron schedules). AMS chk_dmpt_kind extended by changeset 220.
 */
export const TRANSLATION_KINDS = [
  'stored_procedure',
  'trigger',
  'view',
  'check_constraint',
  'scheduled_job',
] as const;
export type TranslationKind = (typeof TRANSLATION_KINDS)[number];
export type TranslationDisposition = 'translate' | 'rewrite_in_app' | 'drop';
export type TranslationPipelineState =
  | 'pending'
  | 'translating'
  | 'drafted'
  | 'failed'
  | 'needs_manual';
export type TranslationReviewStatus = 'unreviewed' | 'approved' | 'rejected' | 'needs_rework';

/** One per-object translation row (AMS `db_migration_pack_translations` wire). */
export interface TranslationRow {
  id: string;
  pack_id?: string;
  translation_key: string;
  object_ref: string;
  kind: TranslationKind;
  disposition: TranslationDisposition;
  drop_reason: string | null;
  pipeline_state: TranslationPipelineState;
  source_body: string | null;
  source_body_hash: string | null;
  truncated: boolean | null;
  legacy_redacted: boolean | null;
  draft_content: string | null;
  judge_verdict_json: Record<string, unknown> | null;
  review_status: TranslationReviewStatus;
  reviewer_notes: string | null;
  created_at?: string | null;
  translated_at?: string | null;
  reviewed_at?: string | null;
  /** Spec 1 (2026-09-09): the routine-catalog row the body came from, when one exists. */
  routine_id?: string | null;
}

/** Sparse PATCH body — omitted fields are untouched AMS-side. */
export interface TranslationPatch {
  pipeline_state?: TranslationPipelineState;
  draft_content?: string;
  judge_verdict_json?: Record<string, unknown>;
  disposition?: TranslationDisposition;
  drop_reason?: string;
  review_status?: TranslationReviewStatus;
  reviewer_notes?: string;
  /**
   * Supply-body path (2026-08-07): a TRUNCATED capture used to be a terminal
   * needs_manual dead-end. The operator can now paste the full source body;
   * the route recomputes the hash, clears the fidelity flags, and returns
   * the row to `pending` for a fresh translate.
   */
  source_body?: string;
  source_body_hash?: string;
  truncated?: boolean;
  legacy_redacted?: boolean;
}

/** One row of the bulk upsert-by-translation_key batch (sparse per row). */
export interface TranslationUpsertRow {
  translation_key: string;
  object_ref: string;
  kind: TranslationKind;
  source_body: string;
  source_body_hash: string;
  truncated: boolean;
  legacy_redacted: boolean;
  pipeline_state?: TranslationPipelineState;
  review_status?: TranslationReviewStatus;
  reviewer_notes?: string;
  /** Spec 1 (2026-09-09): the `db_routines` row the body came from, when one exists. */
  routine_id?: string | null;
}

/**
 * A `db_routines` row as the AMS routine catalog serves it (Spec 1,
 * 2026-09-09). Only the fields the seed resolver needs: the FULL body is the
 * source of record (never truncated, never redacted), keyed by kind + name.
 */
export interface RoutineBodySource {
  id: string;
  schema_name: string;
  routine_name: string;
  routine_kind: 'procedure' | 'function' | 'trigger';
  full_body: string;
}

/** A `requires_translation_spec_2` manifest entry (Spec-1 shape). */
export interface RequiresTranslationEntry {
  kind: string;
  object_ref: string;
  finding_ids: string[];
  /**
   * DIRECT source body (2026-08-07): kinds whose bodies live in the pack IR
   * rather than findings (check_constraint) carry the body on the entry
   * itself; when present it wins over the findings lookup and the seed is
   * full-fidelity (never truncated / legacy-redacted).
   */
  source_body?: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** AMS round-trip failure on a translations endpoint (status + body preserved). */
export class TranslationsAmsError extends Error {
  public readonly status: number;
  public readonly body: string;
  constructor(status: number, body: string) {
    super(`AMS db-migration-pack translations call failed: HTTP ${status} ${body}`);
    this.name = 'TranslationsAmsError';
    this.status = status;
    this.body = body;
  }
}

/** A precondition failure on a translation action (mapped to its HTTP status). */
export class TranslationActionError extends Error {
  public readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'TranslationActionError';
    this.status = status;
  }
}

/**
 * Thrown by the post-run coverage assertion when any manifest object is NOT
 * in exactly one bucket — the guarantee is enforced in code, never diligence.
 */
export class TranslationCoverageError extends Error {
  public readonly unaccounted: string[];
  public readonly invalid: string[];
  public readonly unknown: string[];
  constructor(args: { unaccounted?: string[]; invalid?: string[]; unknown?: string[] }) {
    const parts: string[] = [];
    if (args.unaccounted?.length) parts.push(`unaccounted: ${args.unaccounted.join(', ')}`);
    if (args.invalid?.length) parts.push(`invalid bucket: ${args.invalid.join(', ')}`);
    if (args.unknown?.length) parts.push(`unknown rows: ${args.unknown.join(', ')}`);
    super(`DB translation coverage assertion FAILED — ${parts.join('; ')}`);
    this.name = 'TranslationCoverageError';
    this.unaccounted = args.unaccounted ?? [];
    this.invalid = args.invalid ?? [];
    this.unknown = args.unknown ?? [];
  }
}

// ---------------------------------------------------------------------------
// The ONE identity + hash convention (used by seeding, re-link AND emission)
// ---------------------------------------------------------------------------

/** Stable identity: `kind--object_ref` (the decision_key analogue). */
export function translationKey(kind: string, objectRef: string): string {
  return `${kind}--${objectRef}`;
}

/** SHA-256 hex of the source body — the re-link change detector. */
export function computeSourceBodyHash(body: string): string {
  return crypto.createHash('sha256').update(body, 'utf8').digest('hex');
}

/** The redaction-policy marker Group 1 stamps on new captures. */
export const TARGETED_LITERAL_POLICY = 'targeted_v2';

// ---------------------------------------------------------------------------
// Seeding (3.2) — source bodies from provenance finding detail_json
// ---------------------------------------------------------------------------

export interface SeedSource {
  translation_key: string;
  kind: TranslationKind;
  object_ref: string;
  source_body: string;
  source_body_hash: string;
  truncated: boolean;
  legacy_redacted: boolean;
  /** TRUE when no body could be resolved OR the body is truncated — terminal. */
  terminal_needs_manual: boolean;
  /** The routine-catalog row the body came from (Spec 1); null = finding body. */
  routine_id?: string | null;
}

/** Routine kinds a translation kind can be sourced from the routine catalog. */
const ROUTINE_KINDS_BY_TRANSLATION_KIND: Partial<Record<TranslationKind, Array<RoutineBodySource['routine_kind']>>> = {
  stored_procedure: ['procedure', 'function'],
  trigger: ['trigger'],
};

/** Bare lower-case tail of an object ref (`dbo.upd_x` -> `upd_x`). */
function objectRefTail(ref: string): string {
  const cleaned = ref.replace(/[[\]"]/g, '').trim();
  return (cleaned.split('.').pop() ?? cleaned).toLowerCase();
}

/**
 * Index routine-catalog rows by `<kind>:<bare name>` for the seed resolver.
 * Procedures and functions share the `stored_procedure` translation kind.
 */
export function indexRoutineBodies(routines: RoutineBodySource[]): Map<string, RoutineBodySource> {
  const index = new Map<string, RoutineBodySource>();
  for (const r of routines) {
    if (typeof r.full_body !== 'string' || r.full_body.length === 0) continue;
    const key = `${r.routine_kind}:${r.routine_name.toLowerCase()}`;
    if (!index.has(key)) index.set(key, r);
  }
  return index;
}

const FINDING_TYPE_BY_KIND: Record<TranslationKind, string> = {
  stored_procedure: 'stored_procedure_logic',
  trigger: 'trigger_logic',
  view: 'view_definition',
  scheduled_job: 'db_resident_scheduled_job',
  // check_constraint bodies ride the entry itself (`source_body`), never a
  // finding — the sentinel can never match a real finding_type.
  check_constraint: '__direct_source_body__',
};

/**
 * Resolve one seed source per manifest entry. Bodies live in the provenance
 * finding detail_json: `bodySnippet` (stored_procedure_logic) / `body`
 * (trigger_logic, view_definition). Fidelity computed HERE, at seed time:
 * `truncated: true` -> terminal needs_manual; no `literal_policy: targeted_v2`
 * marker -> legacy_redacted (the marker's ABSENCE is the legacy detector).
 */
export function resolveSeedSources(
  entries: RequiresTranslationEntry[],
  findings: RawDiscoveryFinding[],
  routines: RoutineBodySource[] = []
): SeedSource[] {
  const findingsById = new Map(findings.map((f) => [f.id, f]));
  const routineIndex = indexRoutineBodies(routines);
  const seeds: SeedSource[] = [];
  for (const entry of entries) {
    if (!(TRANSLATION_KINDS as readonly string[]).includes(entry.kind)) continue;
    const kind = entry.kind as TranslationKind;
    // ROUTINE CATALOG body (Spec 1, 2026-09-09): when the DB scan profiled
    // this object, its FULL body is the source of record — never truncated,
    // never legacy-redacted — and the row is linked by routine_id. The
    // finding-snippet path below stays as the fallback for pre-catalog runs.
    const routineKinds = ROUTINE_KINDS_BY_TRANSLATION_KIND[kind] ?? [];
    const tail = objectRefTail(entry.object_ref);
    const routine = routineKinds
      .map((rk) => routineIndex.get(`${rk}:${tail}`))
      .find((r): r is RoutineBodySource => r !== undefined);
    if (routine) {
      seeds.push({
        translation_key: translationKey(kind, entry.object_ref),
        kind,
        object_ref: entry.object_ref,
        source_body: routine.full_body,
        source_body_hash: computeSourceBodyHash(routine.full_body),
        truncated: false,
        legacy_redacted: false,
        terminal_needs_manual: false,
        routine_id: routine.id,
      });
      continue;
    }
    // DIRECT source body (2026-08-07): the entry carries its own body (check
    // constraints — the expression lives in the pack IR, not a finding).
    // Full fidelity by construction.
    if (typeof entry.source_body === 'string' && entry.source_body.length > 0) {
      seeds.push({
        translation_key: translationKey(kind, entry.object_ref),
        kind,
        object_ref: entry.object_ref,
        source_body: entry.source_body,
        source_body_hash: computeSourceBodyHash(entry.source_body),
        truncated: false,
        legacy_redacted: false,
        terminal_needs_manual: false,
      });
      continue;
    }
    const candidates = (entry.finding_ids ?? [])
      .map((id) => findingsById.get(id))
      .filter(
        (f): f is RawDiscoveryFinding =>
          f !== undefined && f.finding_type === FINDING_TYPE_BY_KIND[kind]
      )
      .sort((a, b) => a.id.localeCompare(b.id));
    let body: string | null = null;
    let truncated = false;
    let legacyRedacted = true; // marker ABSENCE = legacy
    for (const finding of candidates) {
      const detail = finding.detail_json ?? {};
      // Body field per kind: procs snippet, scheduled jobs carry `command`
      // (2026-08-07 — the schedule cadence is prefixed so the translator can
      // produce the matching cron expression), everything else `body`.
      const raw =
        kind === 'stored_procedure'
          ? detail['bodySnippet']
          : kind === 'scheduled_job'
            ? (detail['command'] ?? detail['body'])
            : detail['body'];
      if (typeof raw === 'string' && raw.length > 0) {
        const schedule =
          kind === 'scheduled_job' && typeof detail['schedule'] === 'string'
            ? `-- source schedule: ${detail['schedule']}\n`
            : '';
        body = `${schedule}${raw}`;
        truncated = detail['truncated'] === true;
        legacyRedacted =
          kind === 'scheduled_job'
            ? false // job commands are captured verbatim (no literal policy)
            : detail['literal_policy'] !== TARGETED_LITERAL_POLICY;
        break;
      }
    }
    const sourceBody = body ?? '';
    seeds.push({
      translation_key: translationKey(kind, entry.object_ref),
      kind,
      object_ref: entry.object_ref,
      source_body: sourceBody,
      source_body_hash: computeSourceBodyHash(sourceBody),
      truncated,
      legacy_redacted: legacyRedacted,
      terminal_needs_manual: truncated || body === null,
    });
  }
  return seeds.sort((a, b) => a.translation_key.localeCompare(b.translation_key));
}

export interface TranslationSyncSummary {
  seeded_new: number;
  relinked_unchanged: number;
  demoted_needs_rework: number;
  removed: number;
}

function shortHash(hash: string | null): string {
  return (hash ?? '').slice(0, 8) || 'none';
}

function demoteNote(oldHash: string | null, newHash: string): string {
  return (
    `[auto] Source body changed on pack regeneration ` +
    `(hash ${shortHash(oldHash)} -> ${shortHash(newHash)}); review demoted to needs_rework — ` +
    `re-review the draft against the updated source. Approval never silently survives a source change.`
  );
}

/**
 * Build the bulk upsert batch: the re-link/demote pass (source-hash
 * comparison against the EXISTING rows) runs BEFORE the seed upsert, so:
 *   - unchanged hash  -> sparse row (identity + source fields only): the AMS
 *     upsert preserves draft / verdict / disposition / review / notes
 *     verbatim;
 *   - changed hash    -> source updated AND review demoted to needs_rework
 *     with the auto-appended note (only when there is a draft or a review to
 *     demote);
 *   - manifest-removed rows -> deleted deterministically (`delete_absent`);
 *   - new objects     -> seeded `pending` (or terminal `needs_manual`).
 */
export function buildTranslationUpsertBatch(
  seeds: SeedSource[],
  existing: TranslationRow[]
): {
  translations: TranslationUpsertRow[];
  delete_absent: true;
  summary: TranslationSyncSummary;
} {
  const existingByKey = new Map(existing.map((r) => [r.translation_key, r]));
  const seedKeys = new Set(seeds.map((s) => s.translation_key));
  const summary: TranslationSyncSummary = {
    seeded_new: 0,
    relinked_unchanged: 0,
    demoted_needs_rework: 0,
    removed: existing.filter((r) => !seedKeys.has(r.translation_key)).length,
  };
  const translations: TranslationUpsertRow[] = seeds.map((seed) => {
    const row: TranslationUpsertRow = {
      translation_key: seed.translation_key,
      object_ref: seed.object_ref,
      kind: seed.kind,
      source_body: seed.source_body,
      source_body_hash: seed.source_body_hash,
      truncated: seed.truncated,
      legacy_redacted: seed.legacy_redacted,
    };
    if (seed.routine_id) row.routine_id = seed.routine_id;
    const prior = existingByKey.get(seed.translation_key);
    if (!prior) {
      row.pipeline_state = seed.terminal_needs_manual ? 'needs_manual' : 'pending';
      summary.seeded_new += 1;
      return row;
    }
    // Fidelity-driven state transitions apply on EVERY re-link (a re-scan can
    // lift a truncated body out of needs_manual, or newly truncate one).
    if (seed.terminal_needs_manual && prior.pipeline_state !== 'needs_manual') {
      row.pipeline_state = 'needs_manual';
    } else if (!seed.terminal_needs_manual && prior.pipeline_state === 'needs_manual') {
      row.pipeline_state = 'pending';
    }
    if (prior.source_body_hash === seed.source_body_hash) {
      // Unchanged: draft/verdict/disposition/review/notes preserved verbatim
      // (sparse upsert — those fields are simply not supplied).
      summary.relinked_unchanged += 1;
      return row;
    }
    // Changed hash: demote any draft/review — approval NEVER silently
    // survives a source change.
    const hasDraftOrReview =
      prior.review_status !== 'unreviewed' ||
      (prior.draft_content !== null && prior.draft_content !== undefined && prior.draft_content !== '');
    if (hasDraftOrReview) {
      row.review_status = 'needs_rework';
      const note = demoteNote(prior.source_body_hash, seed.source_body_hash);
      row.reviewer_notes = prior.reviewer_notes ? `${prior.reviewer_notes}\n${note}` : note;
      summary.demoted_needs_rework += 1;
    }
    return row;
  });
  return { translations, delete_absent: true, summary };
}

// ---------------------------------------------------------------------------
// AMS client (production defaults; tests inject)
// ---------------------------------------------------------------------------

function translationsBaseUrl(projectId: string, packId: string): string {
  return (
    `${getConfig().architectureModelServiceBaseUrl}/api/projects/${encodeURIComponent(projectId)}` +
    `/db-migration-packs/${encodeURIComponent(packId)}/translations`
  );
}

async function amsRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text().catch(() => '');
  if (!response.ok) throw new TranslationsAmsError(response.status, text);
  return JSON.parse(text) as T;
}

export type FetchTranslationsFn = (projectId: string, packId: string) => Promise<TranslationRow[]>;
export type UpsertTranslationsFn = (
  projectId: string,
  packId: string,
  body: { translations: TranslationUpsertRow[]; delete_absent: boolean }
) => Promise<TranslationRow[]>;
export type PatchTranslationFn = (
  projectId: string,
  packId: string,
  translationId: string,
  patch: TranslationPatch
) => Promise<TranslationRow>;
export type FetchPackRowFn = (
  projectId: string,
  packId: string
) => Promise<{ manifest_json?: Record<string, unknown> | null; [key: string]: unknown }>;

export const defaultFetchTranslations: FetchTranslationsFn = (projectId, packId) =>
  amsRequest<TranslationRow[]>(translationsBaseUrl(projectId, packId), {
    headers: { Accept: 'application/json' },
  });

export const defaultUpsertTranslations: UpsertTranslationsFn = (projectId, packId, body) =>
  amsRequest<TranslationRow[]>(translationsBaseUrl(projectId, packId), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });

export const defaultPatchTranslation: PatchTranslationFn = (
  projectId,
  packId,
  translationId,
  patch
) =>
  amsRequest<TranslationRow>(
    `${translationsBaseUrl(projectId, packId)}/${encodeURIComponent(translationId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(patch),
    }
  );

export const defaultFetchPackRow: FetchPackRowFn = (projectId, packId) =>
  amsRequest(
    `${getConfig().architectureModelServiceBaseUrl}/api/projects/${encodeURIComponent(projectId)}` +
      `/db-migration-packs/${encodeURIComponent(packId)}`,
    { headers: { Accept: 'application/json' } }
  );

// ---------------------------------------------------------------------------
// syncPackTranslations — the seeding + re-link/demote pass (3.2)
// ---------------------------------------------------------------------------

export type FetchRoutinesFn = (
  projectId: string,
  architectureId: string
) => Promise<RoutineBodySource[]>;

/**
 * Routine catalog read (Spec 1, 2026-09-09): the AMS `db_routines` list for
 * the architecture. FAIL-SOFT: a missing catalog (pre-Spec-1 AMS, no DB scan
 * yet) yields [] and the finding-snippet path seeds as before — loudly logged.
 */
export const defaultFetchRoutines: FetchRoutinesFn = async (projectId, architectureId) => {
  try {
    return await amsRequest<RoutineBodySource[]>(
      `${getConfig().architectureModelServiceBaseUrl}/api/projects/${encodeURIComponent(projectId)}` +
        `/architectures/${encodeURIComponent(architectureId)}/db-routines`,
      { headers: { Accept: 'application/json' } }
    );
  } catch (error) {
    logger.warn(
      `[diag-gateway] db_translation stage=routine-catalog-unavailable projectId=${projectId} ` +
        `architectureId=${architectureId} reason=${error instanceof Error ? error.message : String(error)}`
    );
    return [];
  }
};

export interface TranslationSyncDeps {
  fetchTranslations?: FetchTranslationsFn;
  upsertTranslations?: UpsertTranslationsFn;
  fetchRoutines?: FetchRoutinesFn;
}

export interface TranslationSyncResult {
  rows: TranslationRow[];
  summary: TranslationSyncSummary;
}

/**
 * Ensure one translation row per manifest entry. The re-link/demote pass
 * (source-hash comparison against existing rows) runs BEFORE re-seeding —
 * one bulk upsert with `delete_absent` removes manifest-dropped objects
 * deterministically.
 */
export async function syncPackTranslations(
  args: {
    projectId: string;
    packId: string;
    entries: RequiresTranslationEntry[];
    findings: RawDiscoveryFinding[];
    /** Spec 1: when supplied, the routine catalog is consulted for full bodies. */
    architectureId?: string | null;
  },
  deps: TranslationSyncDeps = {}
): Promise<TranslationSyncResult> {
  const fetchTranslations = deps.fetchTranslations ?? defaultFetchTranslations;
  const upsertTranslations = deps.upsertTranslations ?? defaultUpsertTranslations;
  const fetchRoutines = deps.fetchRoutines ?? defaultFetchRoutines;

  logger.info(
    `[diag-gateway] db_translation stage=seed projectId=${args.projectId} packId=${args.packId} ` +
      `entries=${args.entries.length}`
  );
  const existing = await fetchTranslations(args.projectId, args.packId);
  const routines = args.architectureId ? await fetchRoutines(args.projectId, args.architectureId) : [];
  const seeds = resolveSeedSources(args.entries, args.findings, routines);
  const fromCatalog = seeds.filter((s) => s.routine_id).length;
  if (routines.length > 0 || fromCatalog > 0) {
    logger.info(
      `[diag-gateway] db_translation stage=seed-routine-catalog packId=${args.packId} ` +
        `routines=${routines.length} seeded_from_catalog=${fromCatalog}`
    );
  }
  const batch = buildTranslationUpsertBatch(seeds, existing);
  const rows = await upsertTranslations(args.projectId, args.packId, {
    translations: batch.translations,
    delete_absent: batch.delete_absent,
  });
  logger.info(
    `[diag-gateway] db_translation stage=seed-complete packId=${args.packId} ` +
      `new=${batch.summary.seeded_new} relinked=${batch.summary.relinked_unchanged} ` +
      `demoted=${batch.summary.demoted_needs_rework} removed=${batch.summary.removed}`
  );
  return { rows, summary: batch.summary };
}

// ---------------------------------------------------------------------------
// Deterministic pre-pass (3.3) — NO LLM, never guesses
// ---------------------------------------------------------------------------

/**
 * The NON_PORTABLE_DEFAULT_FUNCTIONS token set from discovery's
 * `databasePackFindingBuilders.ts`, mirrored here field-for-field with its
 * deterministic Postgres conversion where one exists (the gateway cannot
 * import across services — same mirroring discipline as the IR in types.ts).
 * `replacement: null` = a known construct with NO exact Postgres equivalent;
 * those are FLAGGED, never guessed.
 */
export const NON_PORTABLE_TOKEN_CONVERSIONS: ReadonlyArray<{
  token: string;
  replacement: string | null;
  note: string;
}> = [
  { token: 'getdate', replacement: 'now()', note: 'T-SQL getdate() -> Postgres now()' },
  {
    token: 'getutcdate',
    replacement: "(now() AT TIME ZONE 'UTC')",
    note: "T-SQL getutcdate() -> Postgres (now() AT TIME ZONE 'UTC')",
  },
  { token: 'sysdatetime', replacement: 'now()', note: 'T-SQL sysdatetime() -> Postgres now()' },
  {
    token: 'newid',
    replacement: 'gen_random_uuid()',
    note: 'T-SQL newid() -> Postgres gen_random_uuid() (pgcrypto)',
  },
  {
    token: 'newsequentialid',
    replacement: null,
    note: 'T-SQL newsequentialid() has no exact Postgres equivalent (sequential UUID)',
  },
  {
    token: 'suser_name',
    replacement: 'current_user',
    note: 'T-SQL suser_name() -> Postgres current_user',
  },
  {
    token: 'suser_sname',
    replacement: 'current_user',
    note: 'T-SQL suser_sname() -> Postgres current_user',
  },
  {
    token: 'user_name',
    replacement: 'current_user',
    note: 'T-SQL user_name() -> Postgres current_user',
  },
  {
    token: 'host_name',
    replacement: null,
    note: 'T-SQL host_name() has no exact Postgres equivalent (inet_client_addr()/application_name approximate)',
  },
  {
    token: 'db_name',
    replacement: 'current_database()',
    note: 'T-SQL db_name() -> Postgres current_database()',
  },
  {
    token: 'app_name',
    replacement: "current_setting('application_name')",
    note: "T-SQL app_name() -> Postgres current_setting('application_name')",
  },
  { token: '@@spid', replacement: 'pg_backend_pid()', note: 'T-SQL @@spid -> Postgres pg_backend_pid()' },
  {
    token: '@@servername',
    replacement: null,
    note: 'T-SQL @@servername has no exact Postgres equivalent',
  },
];

/** Known-untranslatable / high-care T-SQL constructs — flagged, never guessed. */
export const KNOWN_UNTRANSLATABLE_CONSTRUCTS: ReadonlyArray<{
  pattern: RegExp;
  construct: string;
  concern: string;
}> = [
  {
    pattern: /\bxp_cmdshell\b/i,
    construct: 'xp_cmdshell',
    concern: 'OS command execution has no PostgreSQL equivalent',
  },
  {
    pattern: /\bxp_sendmail\b/i,
    construct: 'xp_sendmail',
    concern: 'mail-from-database has no built-in PostgreSQL equivalent',
  },
  {
    pattern: /\bsp_OA\w*\b/i,
    construct: 'sp_OA* (OLE automation)',
    concern: 'OLE automation procedures have no PostgreSQL equivalent',
  },
  {
    pattern: /\bWAITFOR\b/i,
    construct: 'WAITFOR',
    concern: 'WAITFOR DELAY/TIME has no direct equivalent (pg_sleep approximates DELAY only)',
  },
  {
    pattern: /\bholdlock\b/i,
    construct: 'HOLDLOCK',
    concern: 'Sybase locking hints do not map onto PostgreSQL MVCC semantics',
  },
  {
    pattern: /@@identity\b/i,
    construct: '@@identity',
    concern: '@@identity needs an explicit RETURNING clause / lastval() decision in PostgreSQL',
  },
];

export interface PrePassResult {
  /** The body with deterministic token conversions applied. */
  convertedBody: string;
  /** Human-readable notes for each conversion that actually fired. */
  conversionNotes: string[];
  /** Known-untranslatable constructs detected in the body (flag, never guess). */
  flags: string[];
}

/**
 * The deterministic pre-pass: apply the token conversions that have an exact
 * Postgres equivalent and FLAG every known construct that does not. NO LLM.
 */
export function runDeterministicPrePass(body: string): PrePassResult {
  let converted = body;
  const conversionNotes: string[] = [];
  const flags: string[] = [];

  // Longest token first so e.g. `suser_sname` never partially matches.
  const ordered = [...NON_PORTABLE_TOKEN_CONVERSIONS].sort(
    (a, b) => b.token.length - a.token.length
  );
  for (const entry of ordered) {
    if (entry.token.startsWith('@@')) {
      const re = new RegExp(entry.token.replace(/[@]/g, '\\$&'), 'gi');
      if (re.test(converted)) {
        if (entry.replacement) {
          converted = converted.replace(re, entry.replacement);
          conversionNotes.push(entry.note);
        } else {
          flags.push(`${entry.token}: ${entry.note}`);
        }
      }
      continue;
    }
    // Function-style zero-arg token: `token()` (optionally spaced), not
    // preceded by an identifier character.
    const re = new RegExp(`(^|[^a-z0-9_@])${entry.token}\\s*\\(\\s*\\)`, 'gi');
    if (re.test(converted)) {
      if (entry.replacement) {
        converted = converted.replace(re, `$1${entry.replacement}`);
        conversionNotes.push(entry.note);
      } else {
        flags.push(`${entry.token}(): ${entry.note}`);
      }
    }
  }

  for (const construct of KNOWN_UNTRANSLATABLE_CONSTRUCTS) {
    if (construct.pattern.test(body)) {
      flags.push(`${construct.construct}: ${construct.concern}`);
    }
  }

  return { convertedBody: converted, conversionNotes, flags };
}

// ---------------------------------------------------------------------------
// Schema context (from the pack manifest's expected_schema — the pack IR)
// ---------------------------------------------------------------------------

interface ExpectedSchemaLike {
  tables?: Array<{ schemaName?: string; tableName?: string }>;
  columns?: Array<{
    schemaName?: string;
    tableName?: string;
    columnName?: string;
    dataType?: string;
    isNullable?: boolean;
    isPrimaryKey?: boolean;
  }>;
}

const SCHEMA_CONTEXT_TABLE_CAP = 12;

/**
 * Deterministic schema context for the prompts: the tables (with columns)
 * from the pack IR's expected schema whose names appear in the source body,
 * capped; falls back to a compact table-name list when nothing matches.
 */
export function buildSchemaContext(
  manifest: Record<string, unknown> | null,
  sourceBody: string
): string {
  const expected = (manifest?.['expected_schema'] ?? null) as ExpectedSchemaLike | null;
  const tables = expected?.tables ?? [];
  const columns = expected?.columns ?? [];
  if (tables.length === 0) return 'No schema context available.';
  const bodyLower = sourceBody.toLowerCase();
  const matched = tables
    .filter((t) => t.tableName && bodyLower.includes(String(t.tableName).toLowerCase()))
    .slice(0, SCHEMA_CONTEXT_TABLE_CAP);
  if (matched.length === 0) {
    const names = tables
      .map((t) => `${t.schemaName ?? 'dbo'}.${t.tableName ?? '?'}`)
      .sort()
      .slice(0, 50);
    return `Target tables (PostgreSQL): ${names.join(', ')}`;
  }
  const lines: string[] = ['Referenced target tables (PostgreSQL types):'];
  for (const t of matched) {
    const qualified = `${t.schemaName ?? 'dbo'}.${t.tableName}`;
    const cols = columns
      .filter((c) => c.tableName === t.tableName && c.schemaName === t.schemaName)
      .map(
        (c) =>
          `${c.columnName} ${c.dataType ?? '?'}${c.isPrimaryKey ? ' PK' : ''}` +
          `${c.isNullable === false ? ' NOT NULL' : ''}`
      );
    lines.push(`- ${qualified}(${cols.join(', ')})`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Prompts (3.4 / 3.5)
// ---------------------------------------------------------------------------

const KIND_INSTRUCTIONS: Record<TranslationKind, string> = {
  stored_procedure:
    'Translate the Sybase ASE T-SQL stored procedure (or function) into ONE PostgreSQL PL/pgSQL function ' +
    '(CREATE OR REPLACE FUNCTION ... LANGUAGE plpgsql). When a "Calling-convention contract" section ' +
    'follows, the function header (name, argument names/order/types, OUT arguments, RETURNS clause) ' +
    'MUST match it exactly — it is the contract the application and the reconciliation harness call.',
  trigger:
    'Translate the Sybase ASE T-SQL trigger into a PostgreSQL trigger function ' +
    '(CREATE OR REPLACE FUNCTION ... RETURNS trigger LANGUAGE plpgsql) PLUS the matching ' +
    'CREATE TRIGGER statement.',
  view:
    'Translate the Sybase ASE T-SQL view definition into PostgreSQL SQL ' +
    '(CREATE OR REPLACE VIEW ...).',
  check_constraint:
    'Translate the Sybase ASE CHECK constraint into PostgreSQL. The source body is the ' +
    'complete ALTER TABLE ... ADD CONSTRAINT ... CHECK (<T-SQL expression>) statement; ' +
    'produce the equivalent PostgreSQL ALTER TABLE ... ADD CONSTRAINT ... CHECK ' +
    '(<PostgreSQL boolean expression>); — QUOTE the table/constraint identifiers ' +
    '(double quotes, source case preserved) and translate T-SQL built-ins to their ' +
    'PostgreSQL equivalents. The semantics of the check must be preserved exactly.',
  scheduled_job:
    'Translate the Sybase DB-resident scheduled job into PostgreSQL pg_cron. Produce: ' +
    '(1) ONE PL/pgSQL function (CREATE OR REPLACE FUNCTION ... LANGUAGE plpgsql) holding ' +
    "the job's translated body, and (2) the matching SELECT cron.schedule('<job-name>', " +
    "'<cron expression derived from the source schedule comment>', $$SELECT <function>()$$); " +
    'statement. Note in `notes` that the pg_cron extension must be installed on the target ' +
    'and that the source job must be disabled at swap-over (no job may run twice).',
};

export function buildTranslationPrompt(args: {
  kind: TranslationKind;
  objectRef: string;
  prePass: PrePassResult;
  schemaContext: string;
  /**
   * Spec 2 (2026-09-09): the deterministic calling-convention contract +
   * static profile summary for routines. STATIC inputs only — captured
   * scenarios never enter this prompt (evidence enters through Spec 4's
   * ladder, after a test fails).
   */
  contract?: string | null;
  /** Spec 2: header mismatches from a previous draft (one automatic re-prompt). */
  contractViolations?: string[] | null;
}): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = [
    'You are a database migration engineer translating Sybase ASE T-SQL objects into PostgreSQL.',
    'Produce a faithful, reviewable PostgreSQL DRAFT — semantic equivalence over style.',
    'Where a construct has no PostgreSQL equivalent, translate conservatively and add a note;',
    'NEVER invent behaviour the source does not have.',
    'NEVER reference ASE system catalogs (sysobjects, syscolumns, sysindexes, ...) in the draft —',
    'they do not exist on PostgreSQL. Rewrite catalog/metadata queries against',
    'pg_catalog/information_schema equivalents; if the object is inherently ASE-administrative,',
    'say so in the notes instead of emitting unrunnable SQL.',
    'Respond with ONLY a JSON object: { "draft_sql": "<the complete PostgreSQL SQL>", "notes": ["..."] }.',
  ].join('\n');
  const lines: string[] = [];
  lines.push(`Object: ${args.objectRef} (kind: ${args.kind})`);
  lines.push(KIND_INSTRUCTIONS[args.kind]);
  if (args.contract && args.contract.trim().length > 0) {
    lines.push('');
    lines.push('Calling-convention contract (deterministic — the header MUST match):');
    lines.push(args.contract.trim());
  }
  if (args.contractViolations && args.contractViolations.length > 0) {
    lines.push('');
    lines.push('Your previous draft violated the contract — fix ONLY these, keep everything else:');
    for (const v of args.contractViolations) lines.push(`- ${v}`);
  }
  lines.push('');
  lines.push('Schema context:');
  lines.push(args.schemaContext);
  if (args.prePass.conversionNotes.length > 0) {
    lines.push('');
    lines.push('Deterministic token conversions ALREADY applied to the body below:');
    for (const n of args.prePass.conversionNotes) lines.push(`- ${n}`);
  }
  if (args.prePass.flags.length > 0) {
    lines.push('');
    lines.push('Known-untranslatable constructs detected (handle conservatively, note each):');
    for (const f of args.prePass.flags) lines.push(`- ${f}`);
  }
  lines.push('');
  lines.push('Source body (T-SQL, pre-converted):');
  lines.push('```sql');
  lines.push(args.prePass.convertedBody);
  lines.push('```');
  return { systemPrompt, userPrompt: lines.join('\n') };
}

export function buildJudgePrompt(args: {
  kind: TranslationKind;
  objectRef: string;
  sourceBody: string;
  draftSql: string;
  schemaContext: string;
}): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = [
    'You are a verdict-only judge for a Sybase ASE T-SQL -> PostgreSQL translation.',
    'You JUDGE semantic equivalence — you NEVER rewrite or improve the draft.',
    'Respond with ONLY a JSON object:',
    '{ "verdict": "equivalent" | "equivalent_with_concerns" | "not_equivalent",',
    '  "confidence": <0..1>,',
    '  "flags": [ { "construct": "...", "concern": "...", "severity": "low|medium|high" } ] }',
  ].join('\n');
  const lines: string[] = [];
  lines.push(`Object: ${args.objectRef} (kind: ${args.kind})`);
  lines.push('');
  lines.push('Schema context:');
  lines.push(args.schemaContext);
  lines.push('');
  lines.push('Source (Sybase ASE T-SQL):');
  lines.push('```sql');
  lines.push(args.sourceBody);
  lines.push('```');
  lines.push('');
  lines.push('Draft (PostgreSQL):');
  lines.push('```sql');
  lines.push(args.draftSql);
  lines.push('```');
  return { systemPrompt, userPrompt: lines.join('\n') };
}

// ---------------------------------------------------------------------------
// LLM call helper — shared pool + ONE retry (the callWithRetry convention)
// ---------------------------------------------------------------------------

function parseLlmJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('No JSON found in LLM response');
    return JSON.parse(content.slice(start, end + 1));
  }
}

async function callWithRetry<T>(args: {
  label: string;
  projectId: string;
  systemPrompt: string;
  userPrompt: string;
  callLlm: LlmCallerFn;
  llmPool: LlmConcurrencyPool;
  validate: (payload: unknown) => { ok: true; value: T } | { ok: false; errors: string[] };
}): Promise<T> {
  const attempt = async (): Promise<T> => {
    const { content } = await args.llmPool.run(() =>
      args.callLlm({
        systemPrompt: args.systemPrompt,
        userPrompt: args.userPrompt,
        projectId: args.projectId,
      })
    );
    const parsed = parseLlmJson(content);
    const result = args.validate(parsed);
    if (!result.ok) {
      throw new Error(`${args.label} response failed validation: ${result.errors.join('; ')}`);
    }
    return result.value;
  };
  try {
    return await attempt();
  } catch (firstError) {
    logger.warn('DB translation LLM call failed; retrying once', {
      projectId: args.projectId,
      label: args.label,
      error: firstError instanceof Error ? firstError.message : String(firstError),
    });
    try {
      return await attempt();
    } catch (secondError) {
      const message = secondError instanceof Error ? secondError.message : String(secondError);
      throw new Error(`${args.label} failed after retry: ${message}`);
    }
  }
}

const defaultCallLlm: LlmCallerFn = async ({ systemPrompt, userPrompt, projectId }) => {
  // Lazy-import to keep tests cleanly mockable (mirrors the expansion handler).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getLlmClient } = require('../llmClient');
  const client = getLlmClient();
  const response = await client.sendChatRequest(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    `db-translation-${Date.now()}`,
    `db-translation-${projectId}`,
    { jsonMode: true }
  );
  return { content: response.content ?? '' };
};

// ---------------------------------------------------------------------------
// Coverage (3.6) — summary counts + the code-enforced assertion
// ---------------------------------------------------------------------------

export interface TranslationCoverageSummary {
  total: number;
  pending: number;
  translating: number;
  drafted: number;
  failed: number;
  needs_manual: number;
  rewrite_in_app: number;
  dropped: number;
  approved: number;
  rejected: number;
  needs_rework: number;
  unreviewed: number;
}

/** Deterministic per-bucket counts for the list response / coverage chips. */
export function computeCoverageSummary(rows: TranslationRow[]): TranslationCoverageSummary {
  const summary: TranslationCoverageSummary = {
    total: rows.length,
    pending: 0,
    translating: 0,
    drafted: 0,
    failed: 0,
    needs_manual: 0,
    rewrite_in_app: 0,
    dropped: 0,
    approved: 0,
    rejected: 0,
    needs_rework: 0,
    unreviewed: 0,
  };
  for (const row of rows) {
    if (row.disposition === 'rewrite_in_app') {
      summary.rewrite_in_app += 1;
      continue;
    }
    if (row.disposition === 'drop') {
      summary.dropped += 1;
      continue;
    }
    summary[row.pipeline_state] += 1;
    summary[row.review_status] += 1;
  }
  return summary;
}

/**
 * The coverage CODE guarantee: every manifest object resolves to exactly one
 * bucket — translated-draft | rewrite-in-app | dropped(reason) |
 * failed(retryable) | needs-manual(truncated). A drafted row WITHOUT its
 * judge verdict, a dropped row WITHOUT a reason, a manifest object with no
 * row, or a row for no manifest object each FAIL the run. `forbidPending`
 * (translate-all) also fails any object still `pending` after the run; a
 * stale `translating` row is treated as retryable (like `failed`), never
 * silent.
 */
export function assertTranslationCoverage(
  entries: RequiresTranslationEntry[],
  rows: TranslationRow[],
  options: { forbidPending?: boolean } = {}
): void {
  const expected = new Set(
    entries
      .filter((e) => (TRANSLATION_KINDS as readonly string[]).includes(e.kind))
      .map((e) => translationKey(e.kind, e.object_ref))
  );
  const unaccounted: string[] = [];
  const invalid: string[] = [];
  const unknown: string[] = [];
  const seen = new Map<string, number>();
  for (const row of rows) {
    seen.set(row.translation_key, (seen.get(row.translation_key) ?? 0) + 1);
    if (!expected.has(row.translation_key)) {
      unknown.push(row.translation_key);
      continue;
    }
    if (row.disposition === 'rewrite_in_app') continue;
    if (row.disposition === 'drop') {
      if (!row.drop_reason || row.drop_reason.trim().length === 0) {
        invalid.push(`${row.translation_key} (dropped without an explicit reason)`);
      }
      continue;
    }
    switch (row.pipeline_state) {
      case 'drafted':
        if (!row.draft_content || !row.judge_verdict_json) {
          invalid.push(`${row.translation_key} (drafted without draft content + judge verdict)`);
        }
        break;
      case 'failed':
      case 'needs_manual':
        break;
      case 'translating':
        // Stale translating (gateway restart mid-run) — surfaced retryable.
        break;
      case 'pending':
        if (options.forbidPending) {
          unaccounted.push(`${row.translation_key} (still pending after translate-all)`);
        }
        break;
      default:
        invalid.push(`${row.translation_key} (unknown pipeline_state '${row.pipeline_state}')`);
    }
  }
  for (const key of expected) {
    const count = seen.get(key) ?? 0;
    if (count === 0) unaccounted.push(key);
    if (count > 1) invalid.push(`${key} (duplicate translation rows)`);
  }
  if (unaccounted.length > 0 || invalid.length > 0 || unknown.length > 0) {
    throw new TranslationCoverageError({
      unaccounted: unaccounted.sort(),
      invalid: invalid.sort(),
      unknown: unknown.sort(),
    });
  }
}

// ---------------------------------------------------------------------------
// Orchestration (3.6) — state machine + translate/judge per object
// ---------------------------------------------------------------------------

export interface TranslationOutcome {
  translation_id: string;
  translation_key: string;
  object_ref: string;
  previous_state: TranslationPipelineState;
  new_state: TranslationPipelineState;
  error: string | null;
}

export interface TranslationPipelineDeps {
  fetchPack?: FetchPackRowFn;
  fetchTranslations?: FetchTranslationsFn;
  patchTranslation?: PatchTranslationFn;
  callLlm?: LlmCallerFn;
  /** Defaults to the ONE shared migration-plan pool — never a new pool. */
  llmPool?: LlmConcurrencyPool;
  /** Spec 2 (2026-09-09): the routine catalog rows for the pack's architecture (fail-soft). */
  fetchRoutineCatalog?: FetchRoutineCatalogFn;
  /** Spec 2: the pair ruleset the descriptor derivation cites (null = no contract). */
  loadRuleset?: () => MigrationPairRuleset | null;
}

export type FetchRoutineCatalogFn = (
  projectId: string,
  architectureId: string
) => Promise<RoutineCatalogRow[]>;

/**
 * Routine catalog read for the translation pipeline (Spec 2). FAIL-SOFT:
 * without a catalog every routine translates without a contract, exactly as
 * before — loudly logged, never silent.
 */
export const defaultFetchRoutineCatalog: FetchRoutineCatalogFn = async (projectId, architectureId) => {
  try {
    return await amsRequest<RoutineCatalogRow[]>(
      `${getConfig().architectureModelServiceBaseUrl}/api/projects/${encodeURIComponent(projectId)}` +
        `/architectures/${encodeURIComponent(architectureId)}/db-routines`,
      { headers: { Accept: 'application/json' } }
    );
  } catch (error) {
    logger.warn(
      `[diag-gateway] db_translation stage=routine-catalog-unavailable projectId=${projectId} ` +
        `architectureId=${architectureId} reason=${error instanceof Error ? error.message : String(error)}`
    );
    return [];
  }
};

export interface RunTranslationPipelineArgs {
  projectId: string;
  packId: string;
  scope: { mode: 'all' } | { mode: 'single' | 'retry'; translationId: string };
}

export interface RunTranslationPipelineResult {
  outcomes: TranslationOutcome[];
  coverage: TranslationCoverageSummary;
  rows: TranslationRow[];
}

/** Translate-all targets: ONLY pending + failed, disposition `translate`. */
export function selectTranslateAllTargets(rows: TranslationRow[]): TranslationRow[] {
  return rows.filter(
    (r) =>
      r.disposition === 'translate' &&
      // 2026-09-04: 'translating' admitted too. A run that died mid-flight (a
      // 500 after the rows were stamped translating, before any moved to
      // drafted/failed) left rows stuck there indefinitely; the per-row Retry
      // already permitted them (assertSingleTargetEligible), but Translate-all
      // claimed there was no work.
      (r.pipeline_state === 'pending' ||
        r.pipeline_state === 'failed' ||
        r.pipeline_state === 'translating')
  );
}

function assertSingleTargetEligible(row: TranslationRow, mode: 'single' | 'retry'): void {
  if (row.disposition !== 'translate') {
    throw new TranslationActionError(
      400,
      `Translation ${row.translation_key} is dispositioned '${row.disposition}' — flip it back to 'translate' first.`
    );
  }
  if (row.pipeline_state === 'needs_manual') {
    throw new TranslationActionError(
      400,
      `Translation ${row.translation_key} needs manual translation (body truncated at capture) — it cannot be machine-translated.`
    );
  }
  if (row.review_status === 'approved') {
    throw new TranslationActionError(
      400,
      `Translation ${row.translation_key} is approved — change its review status before re-translating.`
    );
  }
  if (mode === 'retry' && row.pipeline_state !== 'failed' && row.pipeline_state !== 'translating') {
    throw new TranslationActionError(
      400,
      `Translation ${row.translation_key} is '${row.pipeline_state}' — retry applies only to failed or stale translating objects.`
    );
  }
}

/**
 * Run the translate -> judge pipeline. Per object: PATCH `translating` ->
 * deterministic pre-pass -> LLM translate (one retry) -> LLM judge (one
 * retry) -> ONE PATCH persisting draft + verdict together as `drafted`
 * (review_status reset to `unreviewed` — a fresh judge pass always lands
 * unreviewed). Any failure after retry -> `failed` (retryable); the draft is
 * NEVER persisted without its verdict. Ends with the coverage assertion.
 */
export async function runTranslationPipeline(
  args: RunTranslationPipelineArgs,
  deps: TranslationPipelineDeps = {}
): Promise<RunTranslationPipelineResult> {
  const fetchPack = deps.fetchPack ?? defaultFetchPackRow;
  const fetchTranslations = deps.fetchTranslations ?? defaultFetchTranslations;
  const patchTranslation = deps.patchTranslation ?? defaultPatchTranslation;
  const callLlm = deps.callLlm ?? defaultCallLlm;
  const llmPool = deps.llmPool ?? getMigrationPlanLlmPool();
  const fetchRoutineCatalog = deps.fetchRoutineCatalog ?? defaultFetchRoutineCatalog;
  const loadRuleset = deps.loadRuleset ?? loadPairRuleset;
  const { projectId, packId } = args;

  const pack = await fetchPack(projectId, packId);
  const manifest = (pack.manifest_json ?? null) as Record<string, unknown> | null;
  // Spec 2 (2026-09-09): the calling-convention contract per routine —
  // derived from the routine catalog + pair ruleset, cited on the prompt.
  const packArchitectureId =
    typeof pack.architecture_id === 'string' && pack.architecture_id.length > 0
      ? pack.architecture_id
      : null;
  const ruleset = loadRuleset();
  const routineCatalog = packArchitectureId ? await fetchRoutineCatalog(projectId, packArchitectureId) : [];
  const routinesById = new Map(routineCatalog.map((r) => [r.id, r]));
  const contractFor = (row: TranslationRow): RoutineContract | null => {
    if (!ruleset || !row.routine_id) return null;
    const routine = routinesById.get(row.routine_id);
    if (!routine) return null;
    if (routine.routine_kind !== 'procedure' && routine.routine_kind !== 'function') return null;
    const descriptor = deriveRoutineDescriptor(routine, ruleset);
    return { descriptor, text: renderRoutineContract(routine, descriptor) };
  };
  const entries = (manifest?.['requires_translation_spec_2'] ??
    []) as RequiresTranslationEntry[];
  const rows = await fetchTranslations(projectId, packId);

  let targets: TranslationRow[];
  if (args.scope.mode === 'all') {
    targets = selectTranslateAllTargets(rows);
  } else {
    const { translationId } = args.scope;
    const row = rows.find((r) => r.id === translationId);
    if (!row) {
      throw new TranslationActionError(404, `Translation ${translationId} not found on pack ${packId}.`);
    }
    assertSingleTargetEligible(row, args.scope.mode);
    targets = [row];
  }

  logger.info(
    `[diag-gateway] db_translation stage=run projectId=${projectId} packId=${packId} ` +
      `mode=${args.scope.mode} targets=${targets.length}`
  );

  const outcomes = await Promise.all(
    targets.map((row) =>
      translateOneObject({
        projectId,
        packId,
        row,
        manifest,
        patchTranslation,
        callLlm,
        llmPool,
        contract: contractFor(row),
      })
    )
  );

  // Post-run state + the coverage CODE guarantee.
  const finalRows = await fetchTranslations(projectId, packId);
  if (manifest) {
    assertTranslationCoverage(entries, finalRows, {
      forbidPending: args.scope.mode === 'all',
    });
  } else {
    logger.warn(
      `[diag-gateway] db_translation stage=coverage packId=${packId} skipped=no-manifest`
    );
  }
  const coverage = computeCoverageSummary(finalRows);
  logger.info(
    `[diag-gateway] db_translation stage=complete packId=${packId} ` +
      `drafted=${coverage.drafted} failed=${coverage.failed}`
  );
  return { outcomes, coverage, rows: finalRows };
}

/** The per-routine contract handed to the translator (Spec 2). */
export interface RoutineContract {
  descriptor: RoutineDescriptor;
  /** Prompt-ready rendering (descriptor + signature + static profile summary). */
  text: string;
}

async function translateOneObject(args: {
  projectId: string;
  packId: string;
  row: TranslationRow;
  manifest: Record<string, unknown> | null;
  patchTranslation: PatchTranslationFn;
  callLlm: LlmCallerFn;
  llmPool: LlmConcurrencyPool;
  /** Spec 2: null when the routine has no catalog row (pre-catalog behaviour). */
  contract?: RoutineContract | null;
}): Promise<TranslationOutcome> {
  const { projectId, packId, row } = args;
  const previousState = row.pipeline_state;
  const outcome = (newState: TranslationPipelineState, error: string | null): TranslationOutcome => ({
    translation_id: row.id,
    translation_key: row.translation_key,
    object_ref: row.object_ref,
    previous_state: previousState,
    new_state: newState,
    error,
  });
  try {
    await args.patchTranslation(projectId, packId, row.id, { pipeline_state: 'translating' });

    logger.info(
      `[diag-gateway] db_translation stage=prepass packId=${packId} key=${row.translation_key}`
    );
    const prePass = runDeterministicPrePass(row.source_body ?? '');
    const schemaContext = buildSchemaContext(args.manifest, row.source_body ?? '');

    logger.info(
      `[diag-gateway] db_translation stage=translate packId=${packId} key=${row.translation_key}`
    );
    const contract = args.contract ?? null;
    const translatePrompt = buildTranslationPrompt({
      kind: row.kind,
      objectRef: row.object_ref,
      prePass,
      schemaContext,
      contract: contract?.text ?? null,
    });
    let draft: TranslationDraftResponse = await callWithRetry({
      label: `translate ${row.translation_key}`,
      projectId,
      systemPrompt: translatePrompt.systemPrompt,
      userPrompt: translatePrompt.userPrompt,
      callLlm: args.callLlm,
      llmPool: args.llmPool,
      validate: validateTranslationResponse,
    });

    // Spec 2 (2026-09-09): the draft header must match the descriptor. One
    // automatic re-prompt naming the violations; a second mismatch fails the
    // object loudly as `abi_mismatch` (retryable, never a silent drift).
    if (contract) {
      let check = validateDraftAgainstDescriptor(draft.draftSql, contract.descriptor);
      if (!check.ok) {
        logger.info(
          `[diag-gateway] db_translation stage=abi-reprompt packId=${packId} key=${row.translation_key} ` +
            `violations=${check.violations.length}`
        );
        const rePrompt = buildTranslationPrompt({
          kind: row.kind,
          objectRef: row.object_ref,
          prePass,
          schemaContext,
          contract: contract.text,
          contractViolations: check.violations,
        });
        draft = await callWithRetry({
          label: `translate(abi) ${row.translation_key}`,
          projectId,
          systemPrompt: rePrompt.systemPrompt,
          userPrompt: rePrompt.userPrompt,
          callLlm: args.callLlm,
          llmPool: args.llmPool,
          validate: validateTranslationResponse,
        });
        check = validateDraftAgainstDescriptor(draft.draftSql, contract.descriptor);
        if (!check.ok) {
          throw new Error(`abi_mismatch: ${check.violations.join('; ')}`);
        }
      }
    }

    logger.info(
      `[diag-gateway] db_translation stage=judge packId=${packId} key=${row.translation_key}`
    );
    const judgePrompt = buildJudgePrompt({
      kind: row.kind,
      objectRef: row.object_ref,
      sourceBody: row.source_body ?? '',
      draftSql: draft.draftSql,
      schemaContext,
    });
    const verdict: JudgeVerdict = await callWithRetry({
      label: `judge ${row.translation_key}`,
      projectId,
      systemPrompt: judgePrompt.systemPrompt,
      userPrompt: judgePrompt.userPrompt,
      callLlm: args.callLlm,
      llmPool: args.llmPool,
      validate: validateJudgeVerdict,
    });

    // ONE persist: draft + verdict land together as `drafted`; a fresh judge
    // pass always resets review to `unreviewed` (the re-translate rule).
    logger.info(
      `[diag-gateway] db_translation stage=persist packId=${packId} key=${row.translation_key} state=drafted`
    );
    await args.patchTranslation(projectId, packId, row.id, {
      pipeline_state: 'drafted',
      draft_content: draft.draftSql,
      judge_verdict_json: {
        verdict: verdict.verdict,
        confidence: verdict.confidence,
        flags: verdict.flags,
        ...(draft.notes.length > 0 ? { translator_notes: draft.notes } : {}),
        // Spec 2: the contract the draft was held to (shape + confidence +
        // cited rules) rides the verdict so the reviewer and the replayer
        // see the same convention.
        ...(contract
          ? {
              invocation_descriptor: {
                shape: contract.descriptor.shape,
                pg_function: `${contract.descriptor.pg_schema}.${contract.descriptor.pg_function}`,
                confidence: contract.descriptor.confidence,
                rules_cited: contract.descriptor.rules_cited,
              },
            }
          : {}),
      },
      review_status: 'unreviewed',
    });
    return outcome('drafted', null);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(
      `[diag-gateway] db_translation stage=persist packId=${packId} key=${row.translation_key} state=failed`,
      { error: message }
    );
    // Failure after retry (translate OR judge) -> `failed` (retryable). The
    // unverified draft is NOT persisted — it never becomes reviewable.
    await args.patchTranslation(projectId, packId, row.id, { pipeline_state: 'failed' });
    return outcome('failed', message);
  }
}
