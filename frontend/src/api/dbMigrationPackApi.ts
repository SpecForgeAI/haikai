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
  method: 'POST' | 'PATCH' | 'PUT',
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

// ============================================================================
// Structural findings + dispositions (Spec 2026-08-04-2 — Structural findings
// dispositions)
//
// The pack generator emits structured `structural_findings` (suspicious zeros
// like "no primary keys captured", stable `kind:subject` identities). Every
// finding must be dispositioned by a human BEFORE plan generation / Migrate:
//
//   accepted     — the zero is genuinely true (note REQUIRED); closes it.
//   fix_upstream — re-capture / fix at source; STAYS OPEN until a regenerated
//                  pack no longer emits the finding (never manually closed).
//   known_gap    — accepted debt (note REQUIRED); closes it AND materialises
//                  a known-gap item in the migration plan.
//
// Gateway routes (`gateway/src/routes/dbMigrationPack.ts`):
//   GET    /:packId/structural-findings                          — merged view.
//   PUT    /:packId/structural-findings/:findingKey/disposition  — upsert.
//   DELETE /:packId/structural-findings/:findingKey/disposition  — re-open.
//
// Finding keys contain colons (`no_primary_keys:all_tables`) — they ALWAYS
// ride URL-encoded in the path. Dispositions persist per PROJECT in AMS, so
// they survive pack regeneration; a regenerated pack that stops emitting a
// finding auto-clears it (resolution is never a manual flag).
// ============================================================================

export type DbMigrationPackStructuralFindingDisposition =
  | 'accepted'
  | 'fix_upstream'
  | 'known_gap';

/** One finding joined with its (possibly absent) disposition (gateway `StructuralFindingState`). */
export interface DbMigrationPackStructuralFinding {
  /** Stable identity `kind:subject`, e.g. `no_primary_keys:all_tables`. */
  key: string;
  kind: string;
  subject: string;
  message: string;
  disposition: DbMigrationPackStructuralFindingDisposition | string | null;
  note: string | null;
  /** True while the finding blocks plan generation / Migrate (undispositioned OR fix_upstream). */
  open: boolean;
}

export interface ListDbMigrationPackStructuralFindingsResponse {
  findings: DbMigrationPackStructuralFinding[];
}

/** One persisted disposition row (AMS `DbStructuralFindingDispositionDto`). */
export interface DbMigrationPackStructuralFindingDispositionDto {
  finding_key: string;
  kind?: string | null;
  subject?: string | null;
  disposition: DbMigrationPackStructuralFindingDisposition | string;
  note?: string | null;
}

function structuralFindingsBase(projectId: string, packId: string): string {
  return `${packsBase(projectId)}/${encodeURIComponent(packId)}/structural-findings`;
}

/** List the pack's current findings merged with the project's dispositions. */
export async function listDbMigrationPackStructuralFindings(
  projectId: string,
  packId: string,
): Promise<ListDbMigrationPackStructuralFindingsResponse> {
  return getJson<ListDbMigrationPackStructuralFindingsResponse>(
    structuralFindingsBase(projectId, packId),
    `Failed to load structural findings for pack ${packId}`,
  );
}

/**
 * Set/replace one finding's disposition. AMS REQUIRES a note for `accepted`
 * and `known_gap` (400 otherwise) — callers must collect one before the call
 * fires. `kind` + `subject` always ride from the finding row (the AMS create
 * path needs them). The colon-bearing finding key is URL-encoded in the path.
 */
export async function setDbMigrationPackStructuralFindingDisposition(
  projectId: string,
  packId: string,
  finding: Pick<DbMigrationPackStructuralFinding, 'key' | 'kind' | 'subject'>,
  disposition: DbMigrationPackStructuralFindingDisposition,
  note?: string,
): Promise<DbMigrationPackStructuralFindingDispositionDto> {
  return sendJson<DbMigrationPackStructuralFindingDispositionDto>(
    `${structuralFindingsBase(projectId, packId)}/${encodeURIComponent(
      finding.key,
    )}/disposition`,
    'PUT',
    {
      disposition,
      ...(note !== undefined ? { note } : {}),
      kind: finding.kind,
      subject: finding.subject,
    },
    `Failed to set disposition on finding ${finding.key}`,
  );
}

/** Remove a disposition — the finding RE-OPENS (AMS answers 204 No Content). */
export async function clearDbMigrationPackStructuralFindingDisposition(
  projectId: string,
  packId: string,
  findingKey: string,
): Promise<void> {
  const res = await fetch(
    `${structuralFindingsBase(projectId, packId)}/${encodeURIComponent(
      findingKey,
    )}/disposition`,
    { method: 'DELETE', headers: { Accept: 'application/json' } },
  );
  if (!res.ok) {
    await throwGatewayError(res, `Failed to clear disposition on finding ${findingKey}`);
  }
}

// ============================================================================
// Sybase schema harvest (Spec 3 — harvest the REAL schema from the live
// source database, save it back into the model, and regenerate the pack)
//
// Gateway routes (`gateway/src/routes/dbMigrationPack.ts`):
//   POST /test-source-connection — quick credential/driver probe (camelCase
//                                  body, matching the gateway route contract).
//   POST /structural-harvest     — LONG request (catalog scan + save-back +
//                                  regenerate can take up to ~10 minutes);
//                                  snake_case body. NO client timeout is set
//                                  (plain fetch, no AbortController) — the
//                                  call rides the browser default.
//
// Credentials are PER-INVOCATION (same rule as refresh-seeds / verify): they
// ride the request body only and are never stored client-side.
// ============================================================================

/** camelCase body — mirrors the gateway test-source-connection contract. */
export interface TestDbSourceConnectionRequest {
  host: string;
  port: number;
  databaseName: string;
  username: string;
  password: string;
  /** Defaults to 'sybase' gateway-side. */
  dbEngine?: string;
  /** 'jtds' | 'jconnect'; omitted = gateway auto-selects. */
  sybaseDriver?: string;
}

export interface TestDbSourceConnectionResponse {
  success: boolean;
  engine: string;
  serverVersion: string;
  driverUsed: string;
}

/** snake_case body — mirrors the gateway structural-harvest contract. */
export interface RunDbStructuralHarvestRequest {
  architecture_id: string;
  target_architecture_id?: string;
  host: string;
  port: number;
  database_name: string;
  username: string;
  password: string;
  sybase_driver?: string;
  include_schemas?: string[];
  service_id?: string;
}

/** How far the harvest pipeline got before stopping. */
export type DbStructuralHarvestStage =
  | 'completed'
  | 'scan_failed'
  | 'save_failed'
  | 'regenerate_failed';

/** Save-back summary — present once the scan succeeded and save-back ran. */
export interface DbStructuralHarvestSavedBack {
  entitiesCreated: number;
  entitiesSkipped: number;
  candidatesCommitted: number;
}

export interface RunDbStructuralHarvestResponse {
  runId: string;
  stage: DbStructuralHarvestStage;
  runStatus: string;
  savedBack: DbStructuralHarvestSavedBack | null;
  packRegenerated: boolean;
  /** The regenerated pack's findings (same shape the findings panel lists). */
  findings: DbMigrationPackStructuralFinding[];
  error?: string;
}

/**
 * Probe the source DB connection (engine version + which driver connected).
 * Failures answer 400 `{ success: false, error: { message } }` — surfaced via
 * the standard nested-envelope error extraction.
 */
export async function testDbSourceConnection(
  projectId: string,
  request: TestDbSourceConnectionRequest,
): Promise<TestDbSourceConnectionResponse> {
  return sendJson<TestDbSourceConnectionResponse>(
    `${packsBase(projectId)}/test-source-connection`,
    'POST',
    request,
    'Source connection test failed',
  );
}

/**
 * Run the full structural harvest: scan the live source catalogs, save the
 * harvested schema back into the model, and regenerate the pack. LONG request
 * (up to ~10 minutes) — deliberately NO client-side timeout/abort here.
 */
export async function runStructuralHarvest(
  projectId: string,
  request: RunDbStructuralHarvestRequest,
): Promise<RunDbStructuralHarvestResponse> {
  return sendJson<RunDbStructuralHarvestResponse>(
    `${packsBase(projectId)}/structural-harvest`,
    'POST',
    request,
    'Structural harvest failed',
  );
}

// ============================================================================
// Gap proposals (Spec 4 — LLM gap-proposal queue, 2026-08-04)
//
// LLM-drafted structural-metadata proposals for pack structural findings
// (missing fk_columns join metadata / missing primary keys). Drafts land in
// the AMS `db_gap_proposals` review queue; NOTHING touches the model until a
// human approves a row — approval applies additively via the MCP
// `apply_gap_metadata` tool (populated slots are never overwritten; skips
// ride back as honest notes).
//
// Gateway routes (`gateway/src/routes/dbGapProposals.ts`, base /api/v1):
//   POST /projects/:projectId/db-gap-proposals/generate
//   GET  /projects/:projectId/db-gap-proposals?finding_key=
//   POST /projects/:projectId/db-gap-proposals/:proposalId/review
//   POST /projects/:projectId/db-gap-proposals/manual
//
// Wire is snake_case EXCEPT `unsupportedReason` on the generate response —
// that field is emitted by the gateway route directly (it never passes
// through AMS/Jackson), so it stays camelCase on the wire.
//
// Review is deliberately NOT routed through `sendJson`: the gateway answers
// 422/502 with `{ review_status: 'approved', apply_error }` bodies (the
// human's approval stands; only the model apply failed) — those must reach
// the caller as DATA, not as a stringified throw. Manual-add 400s carry
// `error.warnings` (per-drop validation notes) which ride on a typed error.
// ============================================================================

export type DbGapProposalKind = 'fk_join' | 'primary_key';

export type DbGapProposalOrigin = 'llm' | 'manual';

export type DbGapProposalReviewStatus =
  | 'unreviewed'
  | 'approved'
  | 'rejected'
  | 'needs_rework';

export type DbGapProposalReviewAction = 'approve' | 'reject' | 'needs_rework';

export type DbGapProposalConfidence = 'high' | 'medium' | 'low';

/** `payload_json` for kind 'fk_join' (generator `FkJoinPayload`). */
export interface DbGapProposalFkJoinPayload {
  relationship_id: string;
  from_table?: string;
  join_columns: string[];
  to_table?: string;
  referenced_columns: string[];
  [key: string]: unknown;
}

/** `payload_json` for kind 'primary_key' (generator `PrimaryKeyPayload`). */
export interface DbGapProposalPrimaryKeyPayload {
  table: string;
  entity_id?: string;
  columns: string[];
  [key: string]: unknown;
}

export type DbGapProposalPayload =
  | DbGapProposalFkJoinPayload
  | DbGapProposalPrimaryKeyPayload
  | Record<string, unknown>;

/**
 * One validated draft as the generate/manual responses carry it (gateway
 * `GapProposalRow` — no queue identity yet). Queue rows extend this.
 */
export interface DbGapProposalDraft {
  proposal_key: string;
  finding_key: string;
  kind: DbGapProposalKind | string;
  payload_json: DbGapProposalPayload;
  rationale: string;
  confidence: DbGapProposalConfidence | string;
}

/** One persisted queue row (AMS `db_gap_proposals`, snake_case wire). */
export interface DbGapProposalRow extends DbGapProposalDraft {
  id: string;
  origin: DbGapProposalOrigin | string;
  review_status: DbGapProposalReviewStatus | string;
  reviewer_notes: string | null;
  applied_at: string | null;
  created_at?: string | null;
}

export interface GenerateDbGapProposalsRequest {
  architecture_id: string;
  finding_kind: string;
  finding_key: string;
}

export interface GenerateDbGapProposalsResponse {
  supported: boolean;
  /** Why generation is unsupported for this finding kind (camelCase — see header note). */
  unsupportedReason?: string;
  /** Drafts also persisted server-side to the queue (when supported + non-empty). */
  proposals: DbGapProposalDraft[];
  /** Honest per-drop notes (hallucinated names etc.) — rendered verbatim. */
  warnings: string[];
}

/** One MCP apply skip — the slot was already populated; nothing overwritten. */
export interface DbGapProposalApplySkip {
  delta: unknown;
  reason: string;
}

export interface DbGapProposalApplyResult {
  applied: number;
  skipped: DbGapProposalApplySkip[];
}

export interface ReviewDbGapProposalRequest {
  action: DbGapProposalReviewAction;
  reviewer_notes?: string;
  /** REQUIRED for approve (the MCP apply targets this architecture). */
  architecture_id: string;
}

export interface ReviewDbGapProposalResponse {
  review_status: DbGapProposalReviewStatus | string;
  /** Approve only — the MCP apply outcome (skips carry honest reasons). */
  apply?: DbGapProposalApplyResult;
  /** Stamped ONLY when the model actually changed (applied > 0). */
  applied_at?: string | null;
  /**
   * 422/502 approve outcomes: the row is LEFT APPROVED but the model apply
   * failed — surfaced verbatim, never swallowed.
   */
  apply_error?: string;
}

export interface AddManualDbGapProposalRequest {
  architecture_id: string;
  finding_key: string;
  kind: DbGapProposalKind;
  payload_json: Record<string, unknown>;
  rationale?: string;
}

export interface AddManualDbGapProposalResponse {
  proposal: DbGapProposalDraft;
  warnings: string[];
}

/**
 * Manual-add validation failure (400): the payload named tables/columns the
 * committed model does not have. `warnings` carries the gateway's per-drop
 * notes (`error.warnings`) so callers render them, not just the message.
 */
export class DbGapProposalValidationError extends Error {
  constructor(
    message: string,
    public readonly warnings: string[],
  ) {
    super(message);
    this.name = 'DbGapProposalValidationError';
  }
}

function gapProposalsBase(projectId: string): string {
  return `${GATEWAY_BASE}/api/v1/projects/${encodeURIComponent(
    projectId,
  )}/db-gap-proposals`;
}

/**
 * LLM-draft proposals for ONE structural finding. Valid drafts are ALSO
 * persisted server-side to the queue — callers should refetch the list after
 * this resolves. `supported: false` means this finding kind has no LLM
 * resolution path (harvest / accept instead) — nothing was written.
 */
export async function generateGapProposals(
  projectId: string,
  request: GenerateDbGapProposalsRequest,
): Promise<GenerateDbGapProposalsResponse> {
  return sendJson<GenerateDbGapProposalsResponse>(
    `${gapProposalsBase(projectId)}/generate`,
    'POST',
    request,
    'Gap-proposal generation failed',
  );
}

/** List the project's queue rows, optionally filtered to one finding. */
export async function listGapProposals(
  projectId: string,
  findingKey?: string,
): Promise<DbGapProposalRow[]> {
  const qs = findingKey ? `?finding_key=${encodeURIComponent(findingKey)}` : '';
  return getJson<DbGapProposalRow[]>(
    `${gapProposalsBase(projectId)}${qs}`,
    'Failed to load gap proposals',
  );
}

/**
 * Review one queue row: approve | reject | needs_rework. Approve routes the
 * additive model write through MCP `apply_gap_metadata`; skip notes and
 * apply errors come back as DATA on the response (422/502 bodies carrying
 * `review_status` are returned, NOT thrown — the approval stands even when
 * the apply failed, and callers must surface that honestly).
 */
export async function reviewGapProposal(
  projectId: string,
  proposalId: string,
  request: ReviewDbGapProposalRequest,
): Promise<ReviewDbGapProposalResponse> {
  const res = await fetch(
    `${gapProposalsBase(projectId)}/${encodeURIComponent(proposalId)}/review`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(request),
    },
  );
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (
    body &&
    typeof body === 'object' &&
    typeof (body as { review_status?: unknown }).review_status === 'string'
  ) {
    // 200, or a 422/502 approve outcome (row approved, apply_error set).
    return body as ReviewDbGapProposalResponse;
  }
  if (!res.ok) {
    throw new Error(
      extractGatewayErrorMessage(body) ||
        `Failed to review gap proposal ${proposalId}: ${res.status} ${res.statusText}`,
    );
  }
  return (body ?? {}) as ReviewDbGapProposalResponse;
}

/**
 * Add a human-authored proposal. Validated server-side by round-tripping the
 * generator's own hallucination guards — a 400 throws
 * `DbGapProposalValidationError` carrying the per-drop warnings.
 */
export async function addManualGapProposal(
  projectId: string,
  request: AddManualDbGapProposalRequest,
): Promise<AddManualDbGapProposalResponse> {
  const res = await fetch(`${gapProposalsBase(projectId)}/manual`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    const nested =
      body && typeof body === 'object'
        ? (body as { error?: { warnings?: unknown } }).error
        : null;
    const warnings =
      nested && typeof nested === 'object' && Array.isArray(nested.warnings)
        ? nested.warnings.map(String)
        : [];
    throw new DbGapProposalValidationError(
      extractGatewayErrorMessage(body) ||
        `Failed to add the manual proposal: ${res.status} ${res.statusText}`,
      warnings,
    );
  }
  return (await res.json()) as AddManualDbGapProposalResponse;
}
