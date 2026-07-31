/**
 * Approved-only dual emission for DB object translations.
 *
 * Spec: 2026-06-11 LLM-Assisted DB Object Translation Drafts — Task Group 4.
 *
 * For each APPROVED translation (disposition `translate`, review_status
 * `approved`, draft present):
 *   - one `db_migration_pack_files` row, file_kind `translation`, at
 *     `translations/<kind>.<schema>.<object>.sql`;
 *   - one changeset in the consolidated
 *     `liquibase/changesets/050-translations.sql` formatted-SQL section,
 *     referenced from the master changelog (Spec-1 numbering — 050 is next
 *     after 040-sequences-seed) ONLY when at least one approved translation
 *     exists.
 *
 * THE APPROVED-ONLY INVARIANT: the executable path (master changelog) only
 * EVER contains approved content. Unapproved / rejected / needs-rework /
 * dispositioned-away objects appear in NEITHER the file rows NOR the
 * changelog — there is no draft-marked emission anywhere; drafts live only
 * in the `db_migration_pack_translations` table and the UI.
 *
 * CHECKSUM STABILITY: changeset ids (`translation--<kind>--<object_ref>`)
 * and the logicalFilePath are stable functions of object identity, and the
 * emitted content carries NO timestamps — re-emission of unchanged approved
 * content is byte-identical (no Liquibase checksum churn).
 *
 * Emission re-runs whenever a review status changes to/from `approved` (the
 * review route) and on pack regeneration (AFTER the re-link/demote pass, so
 * demoted approvals drop out until re-approved). `zip.ts` needs no changes —
 * it assembles from file rows on demand.
 *
 * NO LLM — pure deterministic code.
 */

import { getConfig } from '../../config';
import { logger } from './../logger';
import {
  SEQUENCES_SEED_CHANGESET_PATH,
  changesetHeader,
  formattedSqlHeader,
} from './liquibase';
import { assertPackFilesValid } from './packValidation';
import {
  TranslationRow,
  TranslationsAmsError,
  translationKey,
  defaultFetchTranslations,
  FetchTranslationsFn,
} from './translations';

export const TRANSLATIONS_CHANGESET_PATH = 'liquibase/changesets/050-translations.sql';

/** Stable per-object file path: `translations/<kind>.<schema>.<object>.sql`. */
export function translationFilePath(kind: string, objectRef: string): string {
  return `translations/${kind}.${objectRef}.sql`;
}

/** Stable changeset id — a pure function of object identity (Spec-1 convention).
 * Single-dash separators ONLY: `--` inside a changeset id breaks Liquibase's
 * formatted-SQL parser (2026-07-31; the persisted `translation_key` DB key
 * keeps its historic `--` form — that key never enters a changelog). */
export function translationChangesetId(kind: string, objectRef: string): string {
  return `translation-${kind}-${objectRef}`;
}

// ---------------------------------------------------------------------------
// Approved selection + emission content (pure)
// ---------------------------------------------------------------------------

/**
 * The approved set: disposition `translate` AND review_status `approved`
 * AND a draft exists. Everything else is excluded from BOTH outputs.
 */
export function selectApprovedTranslations(rows: TranslationRow[]): TranslationRow[] {
  return rows
    .filter(
      (r) =>
        r.disposition === 'translate' &&
        r.review_status === 'approved' &&
        typeof r.draft_content === 'string' &&
        r.draft_content.length > 0
    )
    .sort((a, b) => a.translation_key.localeCompare(b.translation_key));
}

/** One emitted per-object translation file (NO timestamps — checksum-stable). */
export function emitTranslationFileContent(row: TranslationRow): string {
  return (
    `-- Approved translation (Sybase ASE T-SQL -> PostgreSQL): ${row.kind} ${row.object_ref}\n` +
    `-- Source identity: ${row.translation_key}\n` +
    `-- Only APPROVED translations are emitted — drafts never enter the executable path.\n` +
    `${row.draft_content}\n`
  );
}

/**
 * The consolidated `050-translations` formatted-SQL changeset. One changeset
 * per approved object, id `translation--<kind>--<object_ref>` — stable, so
 * unchanged approved content emits byte-identical (no checksum churn).
 */
export function emitTranslationsChangeset(approved: TranslationRow[]): string {
  const lines: string[] = [];
  lines.push(formattedSqlHeader(TRANSLATIONS_CHANGESET_PATH).trimEnd());
  lines.push(
    `-- Approved DB object translations (Sybase ASE T-SQL -> PostgreSQL).` +
      ` Only APPROVED translations appear here — unapproved drafts are never emitted.`
  );
  for (const row of approved) {
    lines.push(
      changesetHeader(translationChangesetId(row.kind, row.object_ref), 'post-load')
        .trimEnd()
        .replace(/^\n/, '')
    );
    lines.push(
      `-- ${row.kind} ${row.object_ref} (also emitted at ${translationFilePath(row.kind, row.object_ref)})`
    );
    lines.push(String(row.draft_content));
  }
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// The pure file/manifest transform
// ---------------------------------------------------------------------------

/** Snake_case file row — the AMS wire AND the pack upsert body shape. */
export interface EmissionFileRow {
  file_path: string;
  file_kind: string;
  content: string;
  sort_order: number;
}

const SEED_INCLUDE_LINE =
  `  <include file="${SEQUENCES_SEED_CHANGESET_PATH.replace(/^liquibase\//, '')}" relativeToChangelogFile="true"/>`;
const TRANSLATIONS_INCLUDE_LINE =
  `  <include file="${TRANSLATIONS_CHANGESET_PATH.replace(/^liquibase\//, '')}" relativeToChangelogFile="true"/>`;

function rewriteMasterChangelog(content: string, includeTranslations: boolean): string {
  // Strip any existing 050 include, then re-insert after the 040 include only
  // when at least one approved translation exists.
  const stripped = content
    .split('\n')
    .filter((line) => line.trim() !== TRANSLATIONS_INCLUDE_LINE.trim())
    .join('\n');
  if (!includeTranslations) return stripped;
  if (!stripped.includes(SEED_INCLUDE_LINE)) {
    // Defensive: no 040 include found — append before the closing tag.
    return stripped.replace(
      '</databaseChangeLog>',
      `${TRANSLATIONS_INCLUDE_LINE}\n</databaseChangeLog>`
    );
  }
  return stripped.replace(
    SEED_INCLUDE_LINE,
    `${SEED_INCLUDE_LINE}\n${TRANSLATIONS_INCLUDE_LINE}`
  );
}

/** The manifest `translations` section — per-object approval provenance. */
export interface ManifestTranslationsSection {
  approved_count: number;
  approved_objects: Array<{
    kind: string;
    object_ref: string;
    translation_key: string;
    file_path: string;
    changeset_id: string;
    source_body_hash: string | null;
    reviewed_at: string | null;
  }>;
  note: string;
}

export const MANIFEST_TRANSLATIONS_NOTE =
  'Only APPROVED translations (disposition translate, review_status approved) are emitted into ' +
  'translations/ and the 050-translations changelog section. Unapproved drafts live only in the ' +
  'translation review table and never reach the executable path.';

export function buildManifestTranslationsSection(
  approved: TranslationRow[]
): ManifestTranslationsSection {
  return {
    approved_count: approved.length,
    approved_objects: approved.map((row) => ({
      kind: row.kind,
      object_ref: row.object_ref,
      translation_key: row.translation_key,
      file_path: translationFilePath(row.kind, row.object_ref),
      changeset_id: translationChangesetId(row.kind, row.object_ref),
      source_body_hash: row.source_body_hash ?? null,
      reviewed_at: row.reviewed_at ?? null,
    })),
    note: MANIFEST_TRANSLATIONS_NOTE,
  };
}

export interface ApplyTranslationEmissionResult {
  files: EmissionFileRow[];
  manifest: Record<string, unknown> | null;
  emittedFilePaths: string[];
}

/**
 * The deterministic emission transform: strip every previously-emitted
 * translation artifact (translation-kind rows, the 050 changeset, the master
 * include), then re-emit from the CURRENT approved set. Pure — same inputs,
 * byte-identical outputs.
 */
export function applyTranslationEmission(args: {
  files: EmissionFileRow[];
  manifest: Record<string, unknown> | null;
  rows: TranslationRow[];
}): ApplyTranslationEmissionResult {
  const approved = selectApprovedTranslations(args.rows);

  // 1) Strip prior emission artifacts (idempotent re-emission).
  const base = args.files.filter(
    (f) => f.file_kind !== 'translation' && f.file_path !== TRANSLATIONS_CHANGESET_PATH
  );

  // 2) Master changelog include list: 050 present ONLY with >=1 approved.
  const withMaster = base.map((f) =>
    f.file_kind === 'liquibase_master'
      ? { ...f, content: rewriteMasterChangelog(f.content, approved.length > 0) }
      : f
  );

  // 3) Manifest translations section (per-object approval provenance) +
  //    the manifest.json file row kept in lockstep.
  let manifest = args.manifest;
  if (manifest) {
    manifest = { ...manifest, translations: buildManifestTranslationsSection(approved) };
  }
  const manifestContent = manifest ? JSON.stringify(manifest, null, 2) + '\n' : null;
  const withManifest = withMaster.map((f) =>
    f.file_path === 'manifest.json' && manifestContent !== null
      ? { ...f, content: manifestContent }
      : f
  );

  // 4) Append the approved emission: the 050 changeset + one translation file
  //    row per object, in stable translation_key order.
  const files = [...withManifest];
  const emittedFilePaths: string[] = [];
  if (approved.length > 0) {
    let sortOrder = files.reduce((max, f) => Math.max(max, f.sort_order), -1) + 1;
    files.push({
      file_path: TRANSLATIONS_CHANGESET_PATH,
      file_kind: 'liquibase_changeset',
      content: emitTranslationsChangeset(approved),
      sort_order: sortOrder++,
    });
    emittedFilePaths.push(TRANSLATIONS_CHANGESET_PATH);
    for (const row of approved) {
      const path = translationFilePath(row.kind, row.object_ref);
      files.push({
        file_path: path,
        file_kind: 'translation',
        content: emitTranslationFileContent(row),
        sort_order: sortOrder++,
      });
      emittedFilePaths.push(path);
    }
  }
  return { files, manifest, emittedFilePaths };
}

// ---------------------------------------------------------------------------
// runTranslationEmission — the callable trigger (review route + regeneration)
// ---------------------------------------------------------------------------

interface PackRowDto {
  id: string;
  architecture_id: string;
  status: string;
  stale_reason: string | null;
  input_snapshot_hash: string | null;
  translated_count: number | null;
  skipped_count: number | null;
  flagged_count: number | null;
  seed_margin: number | null;
  manifest_json: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface TranslationEmissionDeps {
  fetchPack?: (projectId: string, packId: string) => Promise<PackRowDto>;
  fetchPackFiles?: (projectId: string, packId: string) => Promise<EmissionFileRow[]>;
  fetchTranslations?: FetchTranslationsFn;
  putPack?: (projectId: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

async function amsJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text().catch(() => '');
  if (!response.ok) throw new TranslationsAmsError(response.status, text);
  return JSON.parse(text) as T;
}

function amsBase(): string {
  return getConfig().architectureModelServiceBaseUrl;
}

const defaultFetchPack: NonNullable<TranslationEmissionDeps['fetchPack']> = (projectId, packId) =>
  amsJson(
    `${amsBase()}/api/projects/${encodeURIComponent(projectId)}` +
      `/db-migration-packs/${encodeURIComponent(packId)}`,
    { headers: { Accept: 'application/json' } }
  );

const defaultFetchPackFiles: NonNullable<TranslationEmissionDeps['fetchPackFiles']> = (
  projectId,
  packId
) =>
  amsJson(
    `${amsBase()}/api/projects/${encodeURIComponent(projectId)}` +
      `/db-migration-packs/${encodeURIComponent(packId)}/files`,
    { headers: { Accept: 'application/json' } }
  );

const defaultPutPack: NonNullable<TranslationEmissionDeps['putPack']> = (projectId, body) =>
  amsJson(`${amsBase()}/api/projects/${encodeURIComponent(projectId)}/db-migration-packs`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });

export interface RunTranslationEmissionResult {
  approvedCount: number;
  emittedFilePaths: string[];
  changed: boolean;
}

/**
 * Re-run the approved-only emission for a pack: fetch the current file rows +
 * translation rows, apply the pure transform, persist via the pack PUT with
 * every pack-level field passed through verbatim (decisions intentionally
 * OMITTED — the decision queue is untouched, same as refresh-seeds).
 */
export async function runTranslationEmission(
  projectId: string,
  packId: string,
  deps: TranslationEmissionDeps = {}
): Promise<RunTranslationEmissionResult> {
  const fetchPack = deps.fetchPack ?? defaultFetchPack;
  const fetchPackFiles = deps.fetchPackFiles ?? defaultFetchPackFiles;
  const fetchTranslations = deps.fetchTranslations ?? defaultFetchTranslations;
  const putPack = deps.putPack ?? defaultPutPack;

  logger.info(
    `[diag-gateway] db_translation stage=emission projectId=${projectId} packId=${packId}`
  );
  const [pack, files, rows] = await Promise.all([
    fetchPack(projectId, packId),
    fetchPackFiles(projectId, packId),
    fetchTranslations(projectId, packId),
  ]);

  const result = applyTranslationEmission({
    files: files.map((f) => ({
      file_path: f.file_path,
      file_kind: f.file_kind,
      content: f.content,
      sort_order: f.sort_order,
    })),
    manifest: pack.manifest_json ?? null,
    rows,
  });

  // Runnable-pack gate (WS3 P0): the emission rewrites the master changelog
  // include list — a dangling 050 include (the live 2026-07-30 parse
  // blocker) must fail HERE, before the pack is persisted.
  assertPackFilesValid(result.files, 'translation emission');

  const changed =
    JSON.stringify(result.files.map((f) => [f.file_path, f.content])) !==
    JSON.stringify(files.map((f) => [f.file_path, f.content]));

  await putPack(projectId, {
    architecture_id: pack.architecture_id,
    status: pack.status,
    stale_reason: pack.stale_reason ?? null,
    input_snapshot_hash: pack.input_snapshot_hash ?? null,
    translated_count: pack.translated_count ?? null,
    skipped_count: pack.skipped_count ?? null,
    flagged_count: pack.flagged_count ?? null,
    seed_margin: pack.seed_margin ?? null,
    manifest_json: result.manifest ?? pack.manifest_json ?? null,
    files: result.files,
  });

  const approvedCount = selectApprovedTranslations(rows).length;
  logger.info(
    `[diag-gateway] db_translation stage=emission-complete packId=${packId} ` +
      `approved=${approvedCount} changed=${changed}`
  );
  return { approvedCount, emittedFilePaths: result.emittedFilePaths, changed };
}
