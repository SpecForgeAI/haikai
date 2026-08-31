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
 *   - SIZE-GATED de-inlining (2026-08-04 live incident): a single file above
 *     `DB_PACK_INLINE_MAX_CHARS` (the live case: a 640KB `manifest.json`
 *     producing a 21,870-line requirements.md) is NOT inlined. It is listed
 *     reference-only (path + sha256 + size) with an explicit DO-NOT-AUTHOR
 *     instruction — the IVS run-end `assemble-run` job overlays the COMPLETE
 *     pack fetched from AMS byte-for-byte with structural validation
 *     (implement-verify-service/src/job_queue/assembly.py), so the
 *     authoritative bytes never depended on the agent re-typing spec text.
 *     Small files stay inline so per-spec branches remain reviewable.
 */

import { createHash } from 'crypto';
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
 * Per-file inline budget (2026-08-04): a file larger than this is carried
 * REFERENCE-ONLY (path + sha256 + size + do-not-author) — run assembly
 * overlays the real bytes. 64KB keeps every ordinary changeset inline while
 * catching the pathological reference blobs (manifest.json was ~640KB live).
 */
export const DB_PACK_INLINE_MAX_CHARS = 65_536;

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

/** House citation notation, identical to the scaffold/SCL carriage form. */
function citeDecision(...codes: string[]): string {
  return codes.map((code) => `[decision:${code}]`).join('');
}

export function buildDbPackSpecText(args: {
  story: LoadedBookOfWorkItem;
  packId: string;
  files: PackFileRow[];
  /** `manifest.target_db.engine` when the pack declares one. */
  targetEngine?: string | null;
}): string {
  const { story, packId, files, targetEngine } = args;
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
  // SIZE-GATED split (2026-08-04): oversized files are reference-only — the
  // run-end assemble job overlays the real bytes from AMS, so inlining 640KB
  // of manifest.json bought nothing and cost a 21,870-line requirements.md.
  const inline = files.filter((f) => (f.content ?? '').length <= DB_PACK_INLINE_MAX_CHARS);
  const overlaid = files.filter((f) => (f.content ?? '').length > DB_PACK_INLINE_MAX_CHARS);

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
  if (overlaid.length > 0) {
    lines.push(
      '4. Do NOT author, stub, or placeholder any file in the "Files overlaid ' +
        'at run assembly" section — the run-end assembly job writes those ' +
        'byte-for-byte from the pack store with structural validation. ' +
        'Creating them here would only be overwritten (or worse, drift).'
    );
  }
  lines.push('');

  // -------------------------------------------------------------------------
  // Acceptance criteria (2026-08-30)
  //
  // These specs previously carried NO acceptance-criteria section at all:
  // every DB-tier spec emitted `## Context` + `## Requirements` + the file
  // list and stopped there — yet the book-of-work stories DID carry
  // acceptance criteria. The criteria existed on the item and simply never
  // reached the spec text, so the acceptance surface was invisible to the
  // implementer and unscoreable by the quality scorer.
  // -------------------------------------------------------------------------
  const storyAc = (story.acceptanceCriteria ?? [])
    .map((criterion) => String(criterion).trim())
    .filter((criterion) => criterion.length > 0);

  lines.push('## Acceptance criteria');
  lines.push('');
  for (const criterion of storyAc) lines.push(`- ${criterion}`);
  lines.push(
    `- All ${inline.length} file(s) in "Files to reproduce byte-for-byte" exist at ` +
      'their exact repo-relative paths and match the pack content byte-for-byte ' +
      '(no reflow, no rename, no comment edits).'
  );
  lines.push(
    "- The pack's expected-schema diff returns GREEN after these changesets apply."
  );
  lines.push("- No migration file outside this story's file list is modified.");
  if (overlaid.length > 0) {
    lines.push(
      `- The ${overlaid.length} run-assembly file(s) are ABSENT from the branch — ` +
        'the run-end assembly job writes them, so authoring one here is a defect ' +
        'rather than a contribution.'
    );
  }
  if (storyAc.length === 0) {
    lines.push('');
    lines.push(
      '> NOTE: the book-of-work story recorded no acceptance criteria of its own, ' +
        'so the mechanical criteria above are the WHOLE acceptance surface here. ' +
        'That is expected for pure carriage, but be clear about what it means: ' +
        'nothing above checks migration BEHAVIOUR, only that the bytes landed.'
    );
  }
  lines.push('');

  // -------------------------------------------------------------------------
  // Decisions carried (2026-08-30)
  //
  // The DB-tier specs cited ZERO decisions. Every other carriage archetype
  // cites its governing decisions in `[decision:<code>]` form so the
  // implementer can see what was already settled; the DB tier silently
  // presented pack output as if it had no provenance.
  // -------------------------------------------------------------------------
  lines.push('## Decisions carried (cite, never re-decide)');
  lines.push('');
  lines.push(
    'Every translation choice behind these files was made upstream by the pack ' +
      'generator. Cite them; do not re-derive, re-open, or "improve" them.'
  );
  lines.push('');
  if (targetEngine) {
    lines.push(`- Target engine: \`${targetEngine}\` ${citeDecision('db.engine')}`);
  }
  lines.push(
    `- Pack provenance: pack ${packId} — the pack's decision queue is the ` +
      'authoritative record for every per-object translation decision ' +
      '(translate / rewrite-in-app / drop) that produced this content.'
  );
  lines.push('');

  lines.push(`## Files to reproduce byte-for-byte (${inline.length})`);
  for (const file of inline) {
    const content = file.content ?? '';
    const fence = fenceFor(content);
    lines.push('');
    lines.push(`### \`${file.file_path}\``);
    lines.push('');
    lines.push(`${fence}${languageFor(file.file_path)}`);
    lines.push(content.replace(/\r\n/g, '\n').replace(/\n$/, ''));
    lines.push(fence);
  }
  if (overlaid.length > 0) {
    lines.push('');
    lines.push(`## Files overlaid at run assembly — do NOT author (${overlaid.length})`);
    lines.push('');
    lines.push(
      `These pack ${packId} files exceed the inline budget ` +
        `(${DB_PACK_INLINE_MAX_CHARS.toLocaleString('en-GB')} chars). They are ` +
        'runtime reference data, not requirements to read: the run-end ' +
        'assembly overlays each byte-for-byte from the pack store and ' +
        'validates the assembled whole. Verify by path + checksum only.'
    );
    for (const file of overlaid) {
      const content = file.content ?? '';
      const sha256 = createHash('sha256').update(content, 'utf8').digest('hex');
      lines.push('');
      lines.push(`### \`${file.file_path}\``);
      lines.push('');
      lines.push(`- Size: ${content.length.toLocaleString('en-GB')} chars`);
      lines.push(`- sha256: \`${sha256}\``);
      lines.push(`- Source: pack ${packId} file store (overlaid at assembly)`);
    }
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

  // The manifest's declared target binding, read UNCONDITIONALLY (2026-08-30).
  // Previously this was parsed only for the one story carrying the master
  // changelog, so the engine was unavailable to every other DB-tier spec and
  // none of them could cite `[decision:db.engine]`.
  type PackTargetDb = {
    engine: string;
    host: string;
    port: number;
    database: string;
    schema: string;
    username: string;
    note?: string;
  };
  let targetDb: PackTargetDb | null = null;
  const manifestRow = rows.find((r) => r.file_path === 'manifest.json');
  if (manifestRow?.content) {
    try {
      const manifest = JSON.parse(manifestRow.content) as { target_db?: PackTargetDb };
      targetDb = manifest.target_db ?? null;
    } catch {
      // Malformed manifest — both the binding section and the engine cite are
      // best-effort and simply stay absent.
      targetDb = null;
    }
  }

  // Target-DB binding confirmation (2026-07-20): the story that CARRIES the
  // master changelog is the story that CREATES the target database — its spec
  // must state, verbatim, where it creates it (the manifest's declared
  // binding). The operator confirms coordinates here; secrets never appear.
  let bindingSection = '';
  const carriesMasterChangelog = selection.files.some((f) =>
    f.file_path.endsWith('db.changelog-master.xml'),
  );
  if (carriesMasterChangelog && targetDb) {
    const t = targetDb;
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

  const specText =
    buildDbPackSpecText({
      story,
      packId,
      files: selection.files,
      targetEngine: targetDb?.engine ?? null,
    }) + bindingSection;
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
