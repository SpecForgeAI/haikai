/**
 * DB Schema + Data Migration Pack API Client
 *
 * Spec: 2026-06-11 Source-Grade DB Schema + Data Migration Pack —
 * Task Group 6 (Task 6.2).
 *
 * Typed snake_case client for the gateway route surface in
 * `gateway/src/routes/dbMigrationPack.ts` (all routes live under
 * `/api/v1/projects/:projectId/db-migration-packs`):
 *
 *   POST  /generate                                — run the deterministic
 *                                                    generation pipeline.
 *   POST  /regenerate                              — EXPLICIT regeneration
 *                                                    (staleness never auto-
 *                                                    triggers it).
 *   GET   /?architecture_id=                       — list packs.
 *   GET   /:packId                                 — pack + computed
 *                                                    `is_stale` evaluation.
 *   GET   /:packId/files                           — generated file rows.
 *   GET   /:packId/manifest                        — manifest_json only.
 *   GET   /:packId/decisions                       — decision queue.
 *   POST  /:packId/decisions/:decisionId/resolve   — resolve ONE decision.
 *   POST  /:packId/decisions/resolve-bulk          — bulk resolve (same
 *                                                    resolution for all ids).
 *   PATCH /:packId                                 — attach `work_item_id`
 *                                                    (the user-chosen DB epic).
 *   GET   /:packId/download                        — on-demand zip (exposed
 *                                                    here as a URL builder).
 *   POST  /:packId/refresh-seeds                   — credentialed Sybase seed
 *                                                    re-scan.
 *   POST  /:packId/verify                          — credentialed Postgres
 *                                                    verification scan -> diff
 *                                                    -> appended drift report.
 *   GET   /:packId/drift-reports                   — persisted drift history.
 *
 * Wire format is snake_case throughout (AMS default; the gateway proxies the
 * AMS DTOs byte-for-byte) — types below mirror the AMS records
 * (`DbMigrationPackDto` et al.) and the gateway response envelopes verbatim,
 * with NO camelCase mapping layer.
 *
 * Credentials (refresh-seeds / verify) are PER-INVOCATION: they ride the
 * request body only and are never stored client-side (no module state, no
 * storage APIs) — the components prompt every time.
 *
 * Error parsing reuses the `extractGatewayErrorMessage` pattern from
 * `migrationDeliveryPlanApi.ts` (the gateway answers with the NESTED envelope
 * `{ error: { code, message, details? } }`; a naive
 * `errorBody.message || errorBody.error` read would stringify the nested
 * object into "[object Object]").
 */

const GATEWAY_BASE = import.meta.env.VITE_GATEWAY_BASE_URL ?? '';

// ============================================================================
// Wire DTOs (snake_case — mirrors the AMS records + gateway envelopes)
// ============================================================================

/** `db_migration_packs.status` lifecycle values. */
export type DbMigrationPackStatus = 'generated' | 'stale';

export type DbMigrationPackFileKind =
  | 'liquibase_master'
  | 'liquibase_changeset'
  | 'bulk_load_script'
  | 'incremental_script'
  | 'manifest'
  | 'readme';

export type DbMigrationPackDecisionCategory =
  | 'type_mapping'
  | 'computed_column'
  | 'collation'
  | 'delta_key'
  | 'other';

export type DbMigrationPackDecisionStatus = 'open' | 'resolved';

/** One coverage-ledger entry inside `manifest_json.coverage.objects[]`. */
export interface DbMigrationPackCoverageEntry {
  objectType: 'table' | 'column';
  objectRef: string;
  disposition: 'translated' | 'skipped' | 'flagged';
  reason?: string;
  decisionKeys?: string[];
  provenance: {
    entityId: string;
    attributeId?: string;
    findingIds: string[];
  };
}

/** Per-table delta strategy inside `manifest_json.delta_strategies[]`. */
export interface DbMigrationPackDeltaStrategy {
  table: string;
  strategy:
    | 'insert_only'
    | 'insert_update'
    | 'full_reload'
    | 'skipped'
    | 'needs_decision';
  deltaKey: string | null;
  source:
    | 'identity_column'
    | 'timestamp_name_heuristic'
    | 'resolved_decision'
    | 'none';
}

/**
 * The pack manifest (`manifest_json`). Mirrors the gateway generator's
 * `PackManifest` shape (`gateway/src/services/dbMigrationPack/types.ts`).
 * Inner keys are camelCase where the generator emits camelCase (the manifest
 * is persisted verbatim as JSONB — it never passes through Jackson renaming).
 */
export interface DbMigrationPackManifest {
  manifest_version: number;
  source_engine: string;
  target_engine: string;
  type_mapping_version: string;
  seed_margin: number;
  seed_margin_note: string;
  phase_ordering: string[];
  delete_propagation: string;
  coverage: {
    translated_count: number;
    skipped_count: number;
    flagged_count: number;
    objects: DbMigrationPackCoverageEntry[];
  };
  requires_translation_spec_2: Array<{
    kind: string;
    object_ref: string;
    finding_ids: string[];
  }>;
  manual_recreation: Array<{
    kind: string;
    object_ref: string;
    finding_ids: string[];
  }>;
  cycle_breaks: string[];
  cluster_notes: string[];
  collation_notes: string[];
  delta_strategies: DbMigrationPackDeltaStrategy[];
  bulk_load: {
    table_order: string[];
    expected_row_counts: Record<string, number>;
    cast_notes: Record<string, string[]>;
  };
  /** The Group 5 diff baseline; opaque to the UI. */
  expected_schema: Record<string, unknown>;
  [key: string]: unknown;
}

/** Pack row as persisted in AMS (`DbMigrationPackDto`). */
export interface DbMigrationPackDto {
  id: string;
  project_id: string;
  architecture_id: string;
  status: DbMigrationPackStatus | string;
  stale_reason: string | null;
  input_snapshot_hash: string | null;
  generated_at: string | null;
  work_item_id: string | null;
  translated_count: number | null;
  skipped_count: number | null;
  flagged_count: number | null;
  seed_margin: number | null;
  manifest_json: DbMigrationPackManifest | null;
  created_at: string;
  updated_at: string;
}

/**
 * Pack GET response: the AMS row PLUS the gateway's live staleness
 * evaluation (Task 4.6 — recomputed input snapshot hash vs the stored one;
 * decision resolves also mark the pack stale AMS-side).
 */
export interface DbMigrationPackWithStaleness extends DbMigrationPackDto {
  is_stale: boolean;
  staleness_reason: string | null;
  current_input_snapshot_hash?: string | null;
  staleness_check_error?: string | null;
}

/** One generated pack file row (`DbMigrationPackFileDto`). */
export interface DbMigrationPackFileDto {
  id: string;
  pack_id: string;
  file_path: string;
  file_kind: DbMigrationPackFileKind | string;
  content: string;
  sort_order: number | null;
}

/** One pack-scoped needs_decision row (`DbMigrationPackDecisionDto`). */
export interface DbMigrationPackDecisionDto {
  id: string;
  pack_id: string;
  decision_key: string;
  object_ref: string;
  category: DbMigrationPackDecisionCategory | string;
  question: string;
  options_json: unknown[] | null;
  resolution_json: Record<string, unknown> | null;
  status: DbMigrationPackDecisionStatus | string;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

/** One persisted drift-report row (`DbMigrationPackDriftReportDto`). */
export interface DbMigrationPackDriftReportDto {
  id: string;
  pack_id: string;
  scan_scope_json: { schemas?: string[] | null; tables?: string[] | null } | null;
  match_count: number | null;
  missing_count: number | null;
  mismatch_count: number | null;
  report_json: DbMigrationPackDriftReportJson | null;
  source: string;
  created_at: string;
}

// --- drift report_json (gateway `DriftReport`, persisted verbatim) ---------

export type DbMigrationPackDriftClassification = 'match' | 'missing' | 'mismatch';

export interface DbMigrationPackDriftDetail {
  property: string;
  expected: string | null;
  actual: string | null;
}

export interface DbMigrationPackDriftObjectEntry {
  object_type: string;
  object_ref: string;
  classification: DbMigrationPackDriftClassification;
  details?: DbMigrationPackDriftDetail[];
}

export interface DbMigrationPackUnexpectedObjectEntry {
  object_type: string;
  object_ref: string;
  detail: string | null;
}

export interface DbMigrationPackDriftReportJson {
  classification_version: number;
  objects: DbMigrationPackDriftObjectEntry[];
  /** Informational ONLY — never an error, never counted as mismatch. */
  unexpected_in_target: DbMigrationPackUnexpectedObjectEntry[];
  summary: {
    match_count: number;
    missing_count: number;
    mismatch_count: number;
    unexpected_count: number;
  };
}

// --- gateway action envelopes ----------------------------------------------

export interface GenerateDbMigrationPackResponse {
  pack: DbMigrationPackDto;
  input_snapshot_hash: string;
  counts: {
    translated_count: number;
    skipped_count: number;
    flagged_count: number;
  };
  file_count: number;
  decision_count: number;
}

export interface RefreshDbMigrationPackSeedsResponse {
  pack: DbMigrationPackDto;
  updated_file_path: string | null;
  seed_changeset_changed: boolean;
  scan_sequence_count: number;
}

export interface VerifyDbMigrationPackResponse {
  report: DbMigrationPackDriftReportJson;
  drift_report: DbMigrationPackDriftReportDto;
}

// --- per-invocation credential payloads (NEVER stored) ----------------------

/**
 * Connection details for the two live-DB actions. Field names match the
 * discovery-service scan-mode body (`DatabaseDiscoveryConfig` subset).
 * `username` / `password` travel ALONGSIDE this object in the request body
 * and exist only for the duration of the call.
 */
export interface DbMigrationPackConnection {
  host: string;
  port: number;
  databaseName: string;
  schemaName?: string | null;
  queryTimeoutSeconds?: number;
}

export interface DbMigrationPackCredentialedRequest {
  db: DbMigrationPackConnection;
  username: string;
  password: string;
}

export interface VerifyDbMigrationPackRequest
  extends DbMigrationPackCredentialedRequest {
  /** Optional area filter for per-area re-verification. */
  scope?: { schemas?: string[]; tables?: string[] } | null;
}

// ============================================================================
// Error handling (extractGatewayErrorMessage pattern)
// ============================================================================

/**
 * Extract a HUMAN-READABLE message from a gateway error body. Mirrors
 * `migrationDeliveryPlanApi.ts`: handles the NESTED envelope
 * `{ error: { code, message, details? } }` (the db-migration-pack routes),
 * plus `{ error: "string" }` and `{ message: "string" }`. Never feeds an
 * object to `new Error(...)` (which would render "[object Object]").
 */
function extractGatewayErrorMessage(errorBody: unknown): string {
  if (!errorBody || typeof errorBody !== 'object') return '';
  const top = errorBody as { message?: unknown; error?: unknown };
  if (typeof top.message === 'string' && top.message) return top.message;
  if (typeof top.error === 'string' && top.error) return top.error;
  if (top.error && typeof top.error === 'object') {
    const nested = top.error as { message?: unknown; details?: unknown };
    const message = typeof nested.message === 'string' ? nested.message : '';
    const details = typeof nested.details === 'string' ? nested.details : '';
    if (message && details) return `${message}: ${details}`;
    return message || details;
  }
  return '';
}

async function throwGatewayError(res: Response, fallback: string): Promise<never> {
  let serverMessage = '';
  try {
    serverMessage = extractGatewayErrorMessage(await res.json());
  } catch {
    // Ignore JSON parse failure — fall through to the generic message.
  }
  throw new Error(serverMessage || `${fallback}: ${res.status} ${res.statusText}`);
}

function packsBase(projectId: string): string {
  return `${GATEWAY_BASE}/api/v1/projects/${encodeURIComponent(
    projectId,
  )}/db-migration-packs`;
}

async function getJson<T>(url: string, fallback: string): Promise<T> {
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) await throwGatewayError(res, fallback);
  return (await res.json()) as T;
}

async function sendJson<T>(
  url: string,
  method: 'POST' | 'PATCH',
  body: unknown,
  fallback: string,
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) await throwGatewayError(res, fallback);
  return (await res.json()) as T;
}

// ============================================================================
// API functions
// ============================================================================

/** List the project's packs (one active pack per project+architecture). */
export async function listDbMigrationPacks(
  projectId: string,
  architectureId?: string,
): Promise<DbMigrationPackDto[]> {
  const qs = architectureId
    ? `?architecture_id=${encodeURIComponent(architectureId)}`
    : '';
  return getJson<DbMigrationPackDto[]>(
    `${packsBase(projectId)}${qs}`,
    'Failed to list DB migration packs',
  );
}

/** Read one pack INCLUDING the gateway's live staleness evaluation. */
export async function getDbMigrationPack(
  projectId: string,
  packId: string,
): Promise<DbMigrationPackWithStaleness> {
  return getJson<DbMigrationPackWithStaleness>(
    `${packsBase(projectId)}/${encodeURIComponent(packId)}`,
    `Failed to load DB migration pack ${packId}`,
  );
}

/**
 * Run the deterministic generation pipeline (EXPLICIT user action — the only
 * path that creates a pack).
 */
export async function generateDbMigrationPack(
  projectId: string,
  architectureId: string,
  seedMargin?: number,
): Promise<GenerateDbMigrationPackResponse> {
  return sendJson<GenerateDbMigrationPackResponse>(
    `${packsBase(projectId)}/generate`,
    'POST',
    {
      architecture_id: architectureId,
      ...(typeof seedMargin === 'number' ? { seed_margin: seedMargin } : {}),
    },
    'DB migration pack generation failed',
  );
}

/**
 * EXPLICIT regeneration. Staleness only ever shows a banner — nothing in the
 * client calls this automatically.
 */
export async function regenerateDbMigrationPack(
  projectId: string,
  architectureId: string,
  seedMargin?: number,
): Promise<GenerateDbMigrationPackResponse> {
  return sendJson<GenerateDbMigrationPackResponse>(
    `${packsBase(projectId)}/regenerate`,
    'POST',
    {
      architecture_id: architectureId,
      ...(typeof seedMargin === 'number' ? { seed_margin: seedMargin } : {}),
    },
    'DB migration pack regeneration failed',
  );
}

/** List the generated file rows (zip entries) for a pack. */
export async function listDbMigrationPackFiles(
  projectId: string,
  packId: string,
): Promise<DbMigrationPackFileDto[]> {
  return getJson<DbMigrationPackFileDto[]>(
    `${packsBase(projectId)}/${encodeURIComponent(packId)}/files`,
    `Failed to load DB migration pack files for ${packId}`,
  );
}

/** Read the manifest_json only. */
export async function getDbMigrationPackManifest(
  projectId: string,
  packId: string,
): Promise<DbMigrationPackManifest | null> {
  return getJson<DbMigrationPackManifest | null>(
    `${packsBase(projectId)}/${encodeURIComponent(packId)}/manifest`,
    `Failed to load DB migration pack manifest for ${packId}`,
  );
}

/** List the pack's decisions, optionally filtered server-side. */
export async function listDbMigrationPackDecisions(
  projectId: string,
  packId: string,
  filters: { status?: string; category?: string } = {},
): Promise<DbMigrationPackDecisionDto[]> {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.category) params.set('category', filters.category);
  const qs = params.toString();
  return getJson<DbMigrationPackDecisionDto[]>(
    `${packsBase(projectId)}/${encodeURIComponent(packId)}/decisions${qs ? `?${qs}` : ''}`,
    `Failed to load DB migration pack decisions for ${packId}`,
  );
}

/**
 * Resolve ONE decision. AMS flips `open -> resolved`, persists the
 * resolution payload, and marks the owning pack STALE (the explicit
 * Regenerate action lights up; nothing auto-regenerates).
 */
export async function resolveDbMigrationPackDecision(
  projectId: string,
  packId: string,
  decisionId: string,
  resolutionJson: Record<string, unknown>,
): Promise<DbMigrationPackDecisionDto> {
  return sendJson<DbMigrationPackDecisionDto>(
    `${packsBase(projectId)}/${encodeURIComponent(packId)}` +
      `/decisions/${encodeURIComponent(decisionId)}/resolve`,
    'POST',
    { resolution_json: resolutionJson },
    `Failed to resolve decision ${decisionId}`,
  );
}

/**
 * Bulk-resolve decisions with the SAME resolution payload (the
 * FindingsTab-style bulk action). Atomic AMS-side — the whole bulk is
 * rejected on any invalid id.
 */
export async function bulkResolveDbMigrationPackDecisions(
  projectId: string,
  packId: string,
  decisionIds: string[],
  resolutionJson: Record<string, unknown>,
): Promise<DbMigrationPackDecisionDto[]> {
  return sendJson<DbMigrationPackDecisionDto[]>(
    `${packsBase(projectId)}/${encodeURIComponent(packId)}/decisions/resolve-bulk`,
    'POST',
    { decision_ids: decisionIds, resolution_json: resolutionJson },
    'Failed to bulk-resolve decisions',
  );
}

/** Attach the user-chosen DB epic (PATCH `work_item_id`). */
export async function attachDbMigrationPackWorkItem(
  projectId: string,
  packId: string,
  workItemId: string | null,
): Promise<DbMigrationPackDto> {
  return sendJson<DbMigrationPackDto>(
    `${packsBase(projectId)}/${encodeURIComponent(packId)}`,
    'PATCH',
    { work_item_id: workItemId },
    `Failed to attach work item to pack ${packId}`,
  );
}

/** List the persisted drift-report history (append-only, newest last). */
export async function listDbMigrationPackDriftReports(
  projectId: string,
  packId: string,
): Promise<DbMigrationPackDriftReportDto[]> {
  return getJson<DbMigrationPackDriftReportDto[]>(
    `${packsBase(projectId)}/${encodeURIComponent(packId)}/drift-reports`,
    `Failed to load drift reports for pack ${packId}`,
  );
}

/**
 * Build the on-demand zip download URL. Used as a plain anchor/window.open
 * target so the browser streams the archive (no fetch-and-blob detour).
 */
export function getDbMigrationPackDownloadUrl(
  projectId: string,
  packId: string,
): string {
  return `${packsBase(projectId)}/${encodeURIComponent(packId)}/download`;
}

/**
 * Refresh seeds: credentialed Sybase re-scan of sequence/identity current
 * values; the gateway regenerates ONLY the sequences-seed changeset +
 * incremental high-water parameters. Credentials are per-invocation.
 */
export async function refreshDbMigrationPackSeeds(
  projectId: string,
  packId: string,
  request: DbMigrationPackCredentialedRequest,
): Promise<RefreshDbMigrationPackSeedsResponse> {
  return sendJson<RefreshDbMigrationPackSeedsResponse>(
    `${packsBase(projectId)}/${encodeURIComponent(packId)}/refresh-seeds`,
    'POST',
    request,
    'Refresh seeds failed',
  );
}

/**
 * Verify schema: credentialed Postgres verification scan -> deterministic
 * diff -> a NEW drift-report row appended to the persisted history.
 * Credentials are per-invocation; `scope` narrows the run to schemas/tables.
 */
export async function verifyDbMigrationPack(
  projectId: string,
  packId: string,
  request: VerifyDbMigrationPackRequest,
): Promise<VerifyDbMigrationPackResponse> {
  return sendJson<VerifyDbMigrationPackResponse>(
    `${packsBase(projectId)}/${encodeURIComponent(packId)}/verify`,
    'POST',
    request,
    'Schema verification failed',
  );
}

// ============================================================================
// Translations (Spec 2026-06-11 LLM-Assisted DB Object Translation Drafts —
// Task Group 5, Task 5.2)
//
// Typed snake_case client for the Group-3 gateway routes under
// `/:packId/translations` (mirrors the AMS `DbMigrationPackTranslationDto`
// wire + the gateway response envelopes verbatim):
//
//   GET   /:packId/translations                              — rows + coverage.
//   POST  /:packId/translations/translate-all                — pending+failed only.
//   POST  /:packId/translations/:translationId/translate     — translate ONE.
//   POST  /:packId/translations/:translationId/retry         — retry failed/stale.
//   POST  /:packId/translations/:translationId/disposition   — set disposition
//                                                              (drop needs reason).
//   POST  /:packId/translations/:translationId/review        — approve/reject/
//                                                              needs_rework + notes.
// ============================================================================

export type DbMigrationPackTranslationKind =
  | 'stored_procedure'
  | 'trigger'
  | 'view';

export type DbMigrationPackTranslationDisposition =
  | 'translate'
  | 'rewrite_in_app'
  | 'drop';

export type DbMigrationPackTranslationPipelineState =
  | 'pending'
  | 'translating'
  | 'drafted'
  | 'failed'
  | 'needs_manual';

export type DbMigrationPackTranslationReviewStatus =
  | 'unreviewed'
  | 'approved'
  | 'rejected'
  | 'needs_rework';

export type DbMigrationPackTranslationReviewAction =
  | 'approve'
  | 'reject'
  | 'needs_rework';

/** One flagged construct inside the judge verdict. */
export interface DbMigrationPackJudgeFlag {
  construct: string;
  concern: string;
  severity: string;
}

/**
 * The verdict-only judge output (`judge_verdict_json`), stored verbatim:
 * `{ verdict, confidence, flags: [{construct, concern, severity}] }`.
 * Typed loosely — the value is persisted LLM output validated gateway-side.
 */
export interface DbMigrationPackJudgeVerdict {
  verdict?: string;
  confidence?: number;
  flags?: DbMigrationPackJudgeFlag[];
  [key: string]: unknown;
}

/** One per-object translation row (AMS `DbMigrationPackTranslationDto`). */
export interface DbMigrationPackTranslationDto {
  id: string;
  pack_id?: string;
  /** Stable identity `kind--object_ref`, unique per pack. */
  translation_key: string;
  object_ref: string;
  kind: DbMigrationPackTranslationKind | string;
  disposition: DbMigrationPackTranslationDisposition | string;
  drop_reason: string | null;
  pipeline_state: DbMigrationPackTranslationPipelineState | string;
  source_body: string | null;
  source_body_hash: string | null;
  /** Fidelity flag: body truncated at capture (terminal needs_manual). */
  truncated: boolean | null;
  /** Fidelity flag: captured under the legacy blanket literal collapse. */
  legacy_redacted: boolean | null;
  draft_content: string | null;
  judge_verdict_json: DbMigrationPackJudgeVerdict | null;
  review_status: DbMigrationPackTranslationReviewStatus | string;
  reviewer_notes: string | null;
  created_at?: string | null;
  translated_at?: string | null;
  reviewed_at?: string | null;
}

/** Deterministic per-bucket counts (gateway `computeCoverageSummary`). */
export interface DbMigrationPackTranslationCoverageSummary {
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

export interface ListDbMigrationPackTranslationsResponse {
  translations: DbMigrationPackTranslationDto[];
  coverage: DbMigrationPackTranslationCoverageSummary;
}

/** Per-object outcome of a translate / translate-all / retry run. */
export interface DbMigrationPackTranslationOutcome {
  translation_id: string;
  translation_key: string;
  object_ref: string;
  previous_state: DbMigrationPackTranslationPipelineState | string;
  new_state: DbMigrationPackTranslationPipelineState | string;
  error: string | null;
}

export interface TranslateDbMigrationPackTranslationsResponse {
  outcomes: DbMigrationPackTranslationOutcome[];
  coverage: DbMigrationPackTranslationCoverageSummary;
}

/**
 * The approved-only emission summary the gateway attaches to disposition /
 * review responses whenever the action touched an approved row (re-emission
 * of the `translations/` zip folder + `050-translations` changelog section).
 */
export interface DbMigrationPackTranslationEmission {
  approved_count: number;
  emitted_file_paths: string[];
  changed: boolean;
}

export interface DbMigrationPackTranslationActionResponse {
  translation: DbMigrationPackTranslationDto;
  emission: DbMigrationPackTranslationEmission | null;
}

function translationsBase(projectId: string, packId: string): string {
  return `${packsBase(projectId)}/${encodeURIComponent(packId)}/translations`;
}

/** List translation rows + the deterministic coverage summary. */
export async function listDbMigrationPackTranslations(
  projectId: string,
  packId: string,
): Promise<ListDbMigrationPackTranslationsResponse> {
  return getJson<ListDbMigrationPackTranslationsResponse>(
    translationsBase(projectId, packId),
    `Failed to load translations for pack ${packId}`,
  );
}

/**
 * Bulk Translate-all: processes ONLY `pending` + `failed` objects (drafted /
 * approved / dispositioned-away / needs_manual are skipped server-side).
 */
export async function translateAllDbMigrationPackTranslations(
  projectId: string,
  packId: string,
): Promise<TranslateDbMigrationPackTranslationsResponse> {
  return sendJson<TranslateDbMigrationPackTranslationsResponse>(
    `${translationsBase(projectId, packId)}/translate-all`,
    'POST',
    {},
    'Translate-all failed',
  );
}

/**
 * Translate / re-translate ONE object. Re-translating a drafted object
 * resets its review_status to `unreviewed` with a fresh judge pass.
 */
export async function translateDbMigrationPackTranslation(
  projectId: string,
  packId: string,
  translationId: string,
): Promise<TranslateDbMigrationPackTranslationsResponse> {
  return sendJson<TranslateDbMigrationPackTranslationsResponse>(
    `${translationsBase(projectId, packId)}/${encodeURIComponent(
      translationId,
    )}/translate`,
    'POST',
    {},
    `Failed to translate ${translationId}`,
  );
}

/** Retry a `failed` (or stale `translating`) object. */
export async function retryDbMigrationPackTranslation(
  projectId: string,
  packId: string,
  translationId: string,
): Promise<TranslateDbMigrationPackTranslationsResponse> {
  return sendJson<TranslateDbMigrationPackTranslationsResponse>(
    `${translationsBase(projectId, packId)}/${encodeURIComponent(
      translationId,
    )}/retry`,
    'POST',
    {},
    `Failed to retry translation ${translationId}`,
  );
}

/**
 * Set the per-object disposition. `drop` REQUIRES a reason (the gateway
 * rejects it otherwise); flipping back to `translate` returns the row to
 * `pending` server-side (or terminal `needs_manual` when truncated).
 */
export async function setDbMigrationPackTranslationDisposition(
  projectId: string,
  packId: string,
  translationId: string,
  disposition: DbMigrationPackTranslationDisposition,
  dropReason?: string,
): Promise<DbMigrationPackTranslationActionResponse> {
  return sendJson<DbMigrationPackTranslationActionResponse>(
    `${translationsBase(projectId, packId)}/${encodeURIComponent(
      translationId,
    )}/disposition`,
    'POST',
    {
      disposition,
      ...(dropReason !== undefined ? { drop_reason: dropReason } : {}),
    },
    `Failed to set disposition on translation ${translationId}`,
  );
}

/**
 * Review action: approve / reject / needs_rework with optional notes.
 * Approve is gated server-side on a drafted row carrying its judge verdict;
 * approve / un-approve re-run the approved-only emission.
 */
export async function reviewDbMigrationPackTranslation(
  projectId: string,
  packId: string,
  translationId: string,
  action: DbMigrationPackTranslationReviewAction,
  notes?: string,
): Promise<DbMigrationPackTranslationActionResponse> {
  return sendJson<DbMigrationPackTranslationActionResponse>(
    `${translationsBase(projectId, packId)}/${encodeURIComponent(
      translationId,
    )}/review`,
    'POST',
    { action, ...(notes !== undefined ? { notes } : {}) },
    `Failed to review translation ${translationId}`,
  );
}
