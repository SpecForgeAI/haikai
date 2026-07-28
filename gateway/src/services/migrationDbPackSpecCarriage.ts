/**
 * DB-pack verbatim spec carriage (Spec 2026-07-02-c — Verbatim DB Specs,
 * Persistence-Tier Oracle Program).
 *
 * Stories the deterministic DB expansion (Spec -b) tagged `seed_db_pack_files`
 * carry `packId` + file selectors on their book-of-work blob item. For those
 * stories the generated spec text IS the pack's files, reproduced
 * BYTE-FOR-BYTE inside the spec — the LLM invents nothing because it is never
 * called: no context resolver, no prompt, no response validators. Acceptance
 * is mechanical (files reproduced at their exact repo-relative paths; the
 * pack's expected-schema diff stays green).
 *
 * This is the persistence-tier sibling of the `seed_build_files` scaffold
 * carriage (which appends the confirmed manifest verbatim) — but stronger:
 * the WHOLE spec is deterministic, not an enrichment around an LLM draft.
 *
 * Honesty rules:
 *   - A selected file missing from the pack -> `insufficient_context` with
 *     the missing paths in `missingInputsJson` (the pack changed since the
 *     plan/expansion — regenerate; NEVER emit a spec with silent holes).
 *   - Oversized carriage (many bulk scripts) is still carried in full, with a
 *     size warning -> `generated_with_warnings`.
 */

import { getConfig } from '../config';
import type {
  LoadedBookOfWorkItem,
  MigrationStorySpecGenerationDto,
} from './migrationShapeSpecGenerationHandler';
import { SPEC_TEXT_REQUIRED_PREFIX } from './specGenerationResponseValidator';

// ---------------------------------------------------------------------------
// Types + recognition
// ---------------------------------------------------------------------------

/** One pack file row (AMS snake_case wire, GET /db-migration-packs/{id}/files). */
export interface PackFileRow {
  file_path: string;
  file_kind?: string | null;
  content: string | null;
  sort_order?: number | null;
}

export type FetchPackFilesFn = (
  projectId: string,
  packId: string
) => Promise<PackFileRow[]>;

/** Char budget above which the carriage adds a size warning (not a cap). */
export const DB_PACK_CARRIAGE_SIZE_WARNING_CHARS = 300_000;

/**
 * True when the story must run the deterministic DB-pack carriage: the
 * `seed_db_pack_files` tag plus a packId plus at least one file selector.
 */
export function isDbPackCarriageStory(story: LoadedBookOfWorkItem): boolean {
  const tagged = (story.tags ?? []).includes('seed_db_pack_files');
  const hasPack = typeof story.packId === 'string' && story.packId.length > 0;
  const hasSelectors =
    (story.packFilePaths?.length ?? 0) > 0 ||
    (story.packFilePathPrefixes?.length ?? 0) > 0;
  return tagged && hasPack && hasSelectors;
}

// ---------------------------------------------------------------------------
// Default AMS read
// ---------------------------------------------------------------------------

export const defaultFetchPackFiles: FetchPackFilesFn = async (projectId, packId) => {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const url =
    `${baseUrl}/api/projects/${encodeURIComponent(projectId)}` +
    `/db-migration-packs/${encodeURIComponent(packId)}/files`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`AMS pack files fetch failed: HTTP ${response.status} ${text}`);
  }
  const rows = (await response.json()) as PackFileRow[];
  return Array.isArray(rows) ? rows : [];
};

// ---------------------------------------------------------------------------
// Selection (pure)
// ---------------------------------------------------------------------------

export interface CarriageSelection {
  files: PackFileRow[];
  /** Exact-path selectors that matched no pack file (honest failure). */
  missing: string[];
}

/**
 * Select the story's files from the pack rows: exact paths first (order
 * preserved, missing recorded), then prefix matches (pack sort order,
 * deduped against the exact set). Prefix selectors matching nothing are NOT
 * an error (an empty bulk set is a legitimate—if odd—pack state; the story
 * text still documents the prefix).
 */
export function selectCarriageFiles(
  all: PackFileRow[],
  paths: string[],
  prefixes: string[]
): CarriageSelection {
  const byPath = new Map<string, PackFileRow>();
  for (const row of all) {
    if (row && typeof row.file_path === 'string') byPath.set(row.file_path, row);
  }
  const files: PackFileRow[] = [];
  const seen = new Set<string>();
  const missing: string[] = [];
  for (const path of paths) {
    const row = byPath.get(path);
    if (!row) {
      missing.push(path);
      continue;
    }
    if (!seen.has(path)) {
      files.push(row);
      seen.add(path);
    }
  }
  if (prefixes.length > 0) {
    const sorted = [...all].sort(
      (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
    );
    for (const row of sorted) {
      if (seen.has(row.file_path)) continue;
      if (prefixes.some((p) => row.file_path.startsWith(p))) {
        files.push(row);
        seen.add(row.file_path);
      }
    }
  }
  return { files, missing };
}

// ---------------------------------------------------------------------------
// Spec text (pure, deterministic)
// ---------------------------------------------------------------------------

export function fenceFor(content: string): string {
  // A fence one backtick longer than the longest run inside the content
  // (minimum 4) can never be terminated early by the content itself.
  const longest = content.match(/`+/g)?.reduce((m, r) => Math.max(m, r.length), 0) ?? 0;
  return '`'.repeat(Math.max(4, longest + 1));
}

export function languageFor(path: string): string {
  if (path.endsWith('.sql')) return 'sql';
  if (path.endsWith('.xml')) return 'xml';
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.sh')) return 'bash';
  if (path.endsWith('.md')) return 'markdown';
  return '';
}

export function buildDbPackSpecText(args: {
  story: LoadedBookOfWorkItem;
  packId: string;
  files: PackFileRow[];
}): string {
  const { story, packId, files } = args;
  const lines: string[] = [];
  lines.push(`${SPEC_TEXT_REQUIRED_PREFIX} ${story.title}`);
  lines.push('');
  lines.push('## Context');
  lines.push('');
  lines.push(
    'This spec was assembled DETERMINISTICALLY from the DB migration pack ' +
      `(pack ${packId}) — the pack's generator already made every translation ` +
      'decision; nothing below is to be re-derived, improved, reformatted, or ' +
      'renamed. The implementation work is to land these files in the target ' +
      'repository exactly as given and wire them into the migration run.'
  );
  lines.push('');
  lines.push(
    'PHASE NOTE: the file-writing requirements below apply to the IMPLEMENT ' +
      'phase only. During spec SHAPING, the files are the content to record ' +
      'in the spec — do not write them to the repository while shaping.'
  );
  lines.push('');
  if (story.description) {
    lines.push(story.description);
    lines.push('');
  }
  lines.push('## Requirements');
  lines.push('');
  lines.push(
    '1. (Implement phase) Write every file in the "Files to reproduce" ' +
      'section at EXACTLY its stated repo-relative path, byte-for-byte (no ' +
      'reflowing, no comment edits, no renames).'
  );
  lines.push(
    '2. Do NOT modify any other migration file to "align" it with these — ' +
      'the pack is regenerated as a whole when inputs change.'
  );
  lines.push(
    "3. Acceptance is mechanical: the files match the pack content exactly " +
      "and the pack's expected-schema diff remains green after they apply."
  );
  lines.push('');
  lines.push(`## Files to reproduce byte-for-byte (${files.length})`);
  for (const file of files) {
    const content = file.content ?? '';
    const fence = fenceFor(content);
    lines.push('');
    lines.push(`### \`${file.file_path}\``);
    lines.push('');
    lines.push(`${fence}${languageFor(file.file_path)}`);
    lines.push(content.replace(/\r\n/g, '\n').replace(/\n$/, ''));
    lines.push(fence);
  }
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// The carriage runner (called from the batch loop's deterministic branch)
// ---------------------------------------------------------------------------

/**
 * Produce the per-story spec-generation row for a DB-pack carriage story.
 * NEVER calls the LLM. NEVER throws for content reasons — pack-read failures
 * and missing files land as honest per-story statuses (`failed` /
 * `insufficient_context`), keeping the batch's per-story isolation contract.
 */
export async function runDbPackSpecCarriage(args: {
  projectId: string;
  story: LoadedBookOfWorkItem;
  baseRow: MigrationStorySpecGenerationDto;
  fetchPackFiles: FetchPackFilesFn;
}): Promise<MigrationStorySpecGenerationDto> {
  const { projectId, story, baseRow, fetchPackFiles } = args;
  const packId = story.packId as string;
  const paths = story.packFilePaths ?? [];
  const prefixes = story.packFilePathPrefixes ?? [];

  let rows: PackFileRow[];
  try {
    rows = await fetchPackFiles(projectId, packId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...baseRow,
      status: 'failed',
      errorMessage: `DB pack files read failed for pack ${packId}: ${message}`,
    };
  }

  const selection = selectCarriageFiles(rows, paths, prefixes);
  if (selection.missing.length > 0) {
    return {
      ...baseRow,
      status: 'insufficient_context',
      missingInputsJson: selection.missing.map((path) => ({
        input: `pack file ${path}`,
        reason:
          'Listed on the story but absent from the current pack — the pack ' +
          'changed since the plan was expanded; regenerate the migration plan.',
      })),
      errorMessage: null,
    };
  }
  if (selection.files.length === 0) {
    return {
      ...baseRow,
      status: 'insufficient_context',
      missingInputsJson: [
        {
          input: `pack ${packId} files (${[...paths, ...prefixes].join(', ')})`,
          reason: 'No pack files matched the story selectors.',
        },
      ],
      errorMessage: null,
    };
  }

  // Target-DB binding confirmation (2026-07-20): the story that CARRIES the
  // master changelog is the story that CREATES the target database — its spec
  // must state, verbatim, where it creates it (the manifest's declared
  // binding). The operator confirms coordinates here; secrets never appear.
  let bindingSection = '';
  const carriesMasterChangelog = selection.files.some((f) =>
    f.file_path.endsWith('db.changelog-master.xml'),
  );
  if (carriesMasterChangelog) {
    const manifestRow = rows.find((r) => r.file_path === 'manifest.json');
    if (manifestRow?.content) {
      try {
        const manifest = JSON.parse(manifestRow.content) as {
          target_db?: {
            engine: string;
            host: string;
            port: number;
            database: string;
            schema: string;
            username: string;
            note?: string;
          };
        };
        const t = manifest.target_db;
        if (t) {
          bindingSection = [
            '',
            '## Target database (declared binding)',
            '',
            'This spec CREATES the target database at the coordinates the plan',
            'declared — confirm them before applying; override only when your',
            'environment genuinely differs. Credentials are supplied at apply',
            'time and are never part of this spec.',
            '',
            `- Engine: ${t.engine}`,
            `- JDBC URL: jdbc:postgresql://${t.host}:${t.port}/${t.database}`,
            `- Schema: ${t.schema}`,
            `- Username: ${t.username}`,
            '',
          ].join('\n');
        }
      } catch {
        // Malformed manifest content — the binding section is best-effort.
      }
    }
  }

  const specText =
    buildDbPackSpecText({ story, packId, files: selection.files }) + bindingSection;
  const warnings: Array<Record<string, unknown>> = [];
  if (specText.length > DB_PACK_CARRIAGE_SIZE_WARNING_CHARS) {
    warnings.push({
      code: 'db_pack_carriage_large',
      message:
        `Verbatim carriage is ${specText.length.toLocaleString('en-GB')} chars ` +
        `(${selection.files.length} files) — intentionally uncapped (the files ARE ` +
        'the deliverable), but expect a long implementation run.',
    });
  }

  console.log(
    `[diag-gateway] pm_migration_shape_spec_generation db_pack_carriage ` +
      `workItemId=${baseRow.workItemId} packId=${packId} files=${selection.files.length} ` +
      `chars=${specText.length}`
  );

  return {
    ...baseRow,
    status: warnings.length > 0 ? 'generated_with_warnings' : 'generated',
    confidence: 'high',
    generatedSpecText: specText,
    warningsJson: warnings.length > 0 ? warnings : null,
    missingInputsJson: null,
    focusedContextRefsJson: {
      source: 'db_migration_pack',
      packId,
      filePaths: selection.files.map((f) => f.file_path),
    },
    generatedAt: new Date().toISOString(),
    errorMessage: null,
  };
}
