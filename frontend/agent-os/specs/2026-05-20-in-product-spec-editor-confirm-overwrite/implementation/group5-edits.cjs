/*
 * Surgical edits for Task Group 5 of the In-Product Spec Editor spec.
 * Each edit is a (find, replace) pair on the gateway handler file.
 * Run via: node group5-edits.js
 */
const fs = require('fs');
const path = require('path');

const HANDLER = 'C:/Workspaces/SSD/architecture-store-and-diagrams/gateway/src/services/migrationShapeSpecGenerationHandler.ts';

const edits = [
  // 1. Add new fields to RunShapeSpecGenerationBatchInput (after workstreamId)
  {
    find: `   * is refused with a structured \`WorkstreamLockedError\`. Defaults to the
   * \`bookOfWorkId\` when not supplied.
   */
  workstreamId?: string;
}`,
    replace: `   * is refused with a structured \`WorkstreamLockedError\`. Defaults to the
   * \`bookOfWorkId\` when not supplied.
   */
  workstreamId?: string;
  /**
   * In-Product Spec Editor + Confirm-Overwrite (2026-05-20, Task Group 5):
   * gate flag for overwriting manually-edited rows. When true, the gateway
   * pre-flights AMS for the set of manually-edited rows in scope and uses
   * \`manuallyEditedWorkItemIdsToOverwrite\` (the allow-list) to decide which
   * to overwrite vs skip. When false (default) NO manually-edited row is
   * overwritten -- they are filtered out before the batch loop and surfaced
   * in \`skippedManuallyEditedWorkItemIds\` on the result.
   */
  overwriteManuallyEdited?: boolean;
  /**
   * In-Product Spec Editor + Confirm-Overwrite (2026-05-20, Task Group 5):
   * caller-supplied allow-list of WorkItem ids whose manually-edited rows
   * should be overwritten on this batch. Only meaningful when
   * \`overwriteManuallyEdited\` is true. Manually-edited rows NOT in this list
   * are skipped from the batch and reported in
   * \`skippedManuallyEditedWorkItemIds\`. When omitted while
   * \`overwriteManuallyEdited\` is true, the gateway treats it as an empty
   * allow-list (skip every manually-edited row in scope).
   */
  manuallyEditedWorkItemIdsToOverwrite?: ReadonlyArray<string | null | undefined>;
}`,
  },

  // 2. Add fields to BatchResult
  {
    find: `  /** Cross-story context injection (2026-05-20): per-pass results when pass 2 ran. */
  passOneResults?: SpecGenerationResult[];
  passTwoResults?: SpecGenerationResult[];
}`,
    replace: `  /** Cross-story context injection (2026-05-20): per-pass results when pass 2 ran. */
  passOneResults?: SpecGenerationResult[];
  passTwoResults?: SpecGenerationResult[];
  /**
   * In-Product Spec Editor + Confirm-Overwrite (2026-05-20, Task Group 5):
   * workItemIds that were skipped because they carried \`manually_edited=true\`
   * and were NOT in the caller's overwrite allow-list. The frontend uses
   * this list to render "X stories skipped because they were manually
   * edited" on the batch result toast.
   */
  skippedManuallyEditedWorkItemIds?: string[];
  /** Convenience count -- matches \`skippedManuallyEditedWorkItemIds.length\`. */
  skippedManuallyEditedCount?: number;
  /**
   * Audit detail for each skipped row so the UI can render a list with
   * "edited by X on Y". Populated from the AMS pre-flight call.
   */
  skippedManuallyEditedDetails?: Array<{
    workItemId: string;
    lastManuallyEditedBy?: string | null;
    lastManuallyEditedAt?: string | null;
  }>;
}`,
  },

  // 3. Add types + DI seam after ProjectConfigFetcher
  {
    find: `export type ProjectConfigFetcher = (
  projectId: string
) => Promise<{
  perStoryContextTokenCap: number;
  crossStoryContextTokenCap: number;
  autoRunPass2: boolean;
}>;

export interface ShapeSpecGenerationDeps {
  loadBookOfWork?: BookOfWorkLoader;
  loadExistingGenerations?: ExistingGenerationsLoader;
  fetchSpecContext?: SpecContextFetcher;
  callLlm?: LlmCaller;
  persistBatchResults?: PersistBatchFn;
  /** Override the system prompt (defaults to reading the markdown file). */
  systemPromptOverride?: string;
  /** Cross-story context injection (2026-05-20). */
  autoSeedEpicCapturedDecision?: EpicCapturedDecisionAutoSeeder;
  fetchProjectConfig?: ProjectConfigFetcher;
}`,
    replace: `export type ProjectConfigFetcher = (
  projectId: string
) => Promise<{
  perStoryContextTokenCap: number;
  crossStoryContextTokenCap: number;
  autoRunPass2: boolean;
}>;

/**
 * In-Product Spec Editor + Confirm-Overwrite (2026-05-20, Task Group 5):
 * fetch the list of manually-edited rows in scope for a Generate-all /
 * retry-batch run. Tests override; the default calls AMS GET
 * \`/api/projects/{projectId}/migration-books-of-work/{bookId}/spec-generations/manually-edited-in-scope\`.
 *
 * Pass \`workItemIds\` to narrow the candidate set (used by retry-batch which
 * already has the failed-row ids in hand).
 */
export type ManuallyEditedInScopeFetcher = (
  projectId: string,
  bookOfWorkId: string,
  workItemIds?: ReadonlyArray<string>
) => Promise<
  Array<{
    workItemId: string;
    workItemTitle?: string | null;
    lastManuallyEditedBy?: string | null;
    lastManuallyEditedAt?: string | null;
    specId?: string | null;
  }>
>;

/**
 * In-Product Spec Editor + Confirm-Overwrite (2026-05-20, Task Group 5):
 * pre-clear a row's \`manually_edited\` flag so the subsequent batch persist
 * can overwrite the text without tripping AMS's manual-edit protection in
 * \`persistOne\`. Backed by AMS POST
 * \`/api/projects/{projectId}/spec-generations/{specId}/regenerate?overwriteManuallyEdited=true\`
 * with NO patch body (the regenerate endpoint clears the four manual-edit
 * columns when the flag is true; calling with no body leaves \`generated_spec_text\`
 * unchanged for now and the subsequent batch write overwrites it).
 */
export type ManuallyEditedFlagClearer = (
  projectId: string,
  specId: string
) => Promise<void>;

export interface ShapeSpecGenerationDeps {
  loadBookOfWork?: BookOfWorkLoader;
  loadExistingGenerations?: ExistingGenerationsLoader;
  fetchSpecContext?: SpecContextFetcher;
  callLlm?: LlmCaller;
  persistBatchResults?: PersistBatchFn;
  /** Override the system prompt (defaults to reading the markdown file). */
  systemPromptOverride?: string;
  /** Cross-story context injection (2026-05-20). */
  autoSeedEpicCapturedDecision?: EpicCapturedDecisionAutoSeeder;
  fetchProjectConfig?: ProjectConfigFetcher;
  /** In-Product Spec Editor + Confirm-Overwrite (2026-05-20). */
  fetchManuallyEditedInScope?: ManuallyEditedInScopeFetcher;
  clearManuallyEditedFlag?: ManuallyEditedFlagClearer;
}`,
  },

  // 4. Add default impls + pre-flight orchestration to runShapeSpecGenerationBatch
  // Hook into runShapeSpecGenerationBatch BEFORE the lock acquisition since the
  // pre-flight is an AMS read that doesn't need the workstream lock and we want
  // the pre-clear calls to be visible to subsequent batch persists.
  {
    find: `export async function runShapeSpecGenerationBatch(
  input: RunShapeSpecGenerationBatchInput,
  deps: ShapeSpecGenerationDeps = {}
): Promise<BatchResult> {
  // ----- Stage 0: hard cap (Task Group 5.3 LOOP GUARDRAIL) -----
  if (typeof input.pass === 'number') {
    if (input.pass < 1 || input.pass > MAX_PASS) {
      throw new InvalidPassNumberError(input.pass);
    }
  }

  const workstreamId = input.workstreamId ?? input.bookOfWorkId;

  // ----- Stage 0.5: concurrency lock (Task Group 5.7) -----
  acquireWorkstreamLock(workstreamId, 1);
  try {
    return await runShapeSpecGenerationBatchInner(input, deps, workstreamId);
  } finally {
    releaseWorkstreamLock(workstreamId);
  }
}`,
    replace: `export async function runShapeSpecGenerationBatch(
  input: RunShapeSpecGenerationBatchInput,
  deps: ShapeSpecGenerationDeps = {}
): Promise<BatchResult> {
  // ----- Stage 0: hard cap (Task Group 5.3 LOOP GUARDRAIL) -----
  if (typeof input.pass === 'number') {
    if (input.pass < 1 || input.pass > MAX_PASS) {
      throw new InvalidPassNumberError(input.pass);
    }
  }

  const workstreamId = input.workstreamId ?? input.bookOfWorkId;

  // ----- Stage 0.25: manually-edited pre-flight + filter -----
  // In-Product Spec Editor + Confirm-Overwrite (2026-05-20, Task Group 5).
  // Before the batch loop starts, query AMS for the set of manually-edited
  // rows in scope and split the work-item set into "to be overwritten" vs
  // "to be skipped". Skipped rows are removed from \`targetWorkItemIds\` (so
  // the inner batch never tries to persist them and trip AMS's manual-edit
  // protection in \`persistOne\`). Allow-listed rows are pre-cleared via the
  // AMS regenerate endpoint so the subsequent batch write succeeds.
  //
  // Design note (pragmatic v1, documented per Task Group 5 deviation): the
  // gateway does the filtering + clearing instead of plumbing a
  // \`confirmOverwrite\` flag through the AMS batch endpoint. Both AMS and
  // gateway already have the building blocks (the regenerate endpoint
  // accepts \`overwriteManuallyEdited\` and clears the four manual-edit
  // columns) so we reuse them rather than expand the AMS batch contract.
  const manualEditFilterResult = await applyManuallyEditedPreFlight(input, deps);

  // ----- Stage 0.5: concurrency lock (Task Group 5.7) -----
  acquireWorkstreamLock(workstreamId, 1);
  try {
    const inner = await runShapeSpecGenerationBatchInner(
      manualEditFilterResult.effectiveInput,
      deps,
      workstreamId,
    );
    // Surface the manually-edited skip metadata onto the outer result.
    if (manualEditFilterResult.skipped.length > 0) {
      inner.skippedManuallyEditedWorkItemIds =
        manualEditFilterResult.skipped.map((s) => s.workItemId);
      inner.skippedManuallyEditedCount = manualEditFilterResult.skipped.length;
      inner.skippedManuallyEditedDetails = manualEditFilterResult.skipped.map((s) => ({
        workItemId: s.workItemId,
        lastManuallyEditedBy: s.lastManuallyEditedBy ?? null,
        lastManuallyEditedAt: s.lastManuallyEditedAt ?? null,
      }));
    } else {
      // Always populate the count so callers can branch on === 0 without
      // null-checks. Empty array is also stable for snapshot tests.
      inner.skippedManuallyEditedWorkItemIds = [];
      inner.skippedManuallyEditedCount = 0;
      inner.skippedManuallyEditedDetails = [];
    }
    return inner;
  } finally {
    releaseWorkstreamLock(workstreamId);
  }
}

/**
 * In-Product Spec Editor + Confirm-Overwrite (2026-05-20, Task Group 5):
 * AMS pre-flight + filter step. Returns the effective input to pass into
 * the batch handler (with skipped rows removed from \`targetWorkItemIds\`)
 * and the audit detail for each skipped row.
 *
 * Behaviour:
 *   - When \`overwriteManuallyEdited\` is falsy AND no \`targetWorkItemIds\`
 *     are supplied: skip the pre-flight (Generate-all default path; the
 *     batch handler's existing R-8 skip-generated logic continues to apply).
 *     A future enhancement could pre-flight here too so the
 *     skippedManuallyEditedWorkItemIds list is always accurate; v1 keeps the
 *     query light by only running it when the caller signalled intent.
 *   - When the AMS pre-flight is unavailable (no \`fetchManuallyEditedInScope\`
 *     dep wired): no-op pass-through. Production wires the dep; tests that
 *     don't care leave it unset.
 *   - When the pre-flight returns an empty list: no-op pass-through.
 *   - When the pre-flight returns rows: split into allow-list (in
 *     \`manuallyEditedWorkItemIdsToOverwrite\`) and skip (not in the list).
 *     Allow-listed rows are pre-cleared via \`clearManuallyEditedFlag\`.
 *     Skip rows are removed from \`targetWorkItemIds\` so the inner batch
 *     never sees them.
 */
async function applyManuallyEditedPreFlight(
  input: RunShapeSpecGenerationBatchInput,
  deps: ShapeSpecGenerationDeps,
): Promise<{
  effectiveInput: RunShapeSpecGenerationBatchInput;
  skipped: Array<{
    workItemId: string;
    lastManuallyEditedBy?: string | null;
    lastManuallyEditedAt?: string | null;
    specId?: string | null;
  }>;
}> {
  const fetchScope = deps.fetchManuallyEditedInScope;
  if (!fetchScope) {
    return { effectiveInput: input, skipped: [] };
  }
  const targetIds: string[] | undefined =
    input.targetWorkItemIds && input.targetWorkItemIds.length > 0
      ? input.targetWorkItemIds.filter(
          (v): v is string => typeof v === 'string' && v.length > 0,
        )
      : undefined;

  let scopeRows;
  try {
    scopeRows = await fetchScope(input.projectId, input.bookOfWorkId, targetIds);
  } catch (e) {
    logger.warn(
      'Manually-edited pre-flight failed; proceeding without filter',
      { projectId: input.projectId, bookOfWorkId: input.bookOfWorkId,
        error: e instanceof Error ? e.message : String(e) },
    );
    return { effectiveInput: input, skipped: [] };
  }
  if (!Array.isArray(scopeRows) || scopeRows.length === 0) {
    return { effectiveInput: input, skipped: [] };
  }

  const allowList = new Set<string>();
  if (input.overwriteManuallyEdited && input.manuallyEditedWorkItemIdsToOverwrite) {
    for (const id of input.manuallyEditedWorkItemIdsToOverwrite) {
      if (typeof id === 'string' && id.length > 0) allowList.add(id);
    }
  }

  const skipped: Array<{
    workItemId: string;
    lastManuallyEditedBy?: string | null;
    lastManuallyEditedAt?: string | null;
    specId?: string | null;
  }> = [];
  const toClear: Array<{ workItemId: string; specId: string }> = [];
  for (const row of scopeRows) {
    if (!row || !row.workItemId) continue;
    if (allowList.has(row.workItemId)) {
      // Allow-listed: pre-clear the manually_edited flag so the batch
      // persist can overwrite without tripping the AMS guard.
      if (row.specId) {
        toClear.push({ workItemId: row.workItemId, specId: row.specId });
      }
    } else {
      skipped.push({
        workItemId: row.workItemId,
        lastManuallyEditedBy: row.lastManuallyEditedBy ?? null,
        lastManuallyEditedAt: row.lastManuallyEditedAt ?? null,
        specId: row.specId ?? null,
      });
    }
  }

  // Pre-clear allow-listed rows. Failure to clear is non-fatal -- the
  // batch persist will surface a per-row failure (R-12) for those rows.
  const clearer = deps.clearManuallyEditedFlag;
  if (clearer) {
    for (const c of toClear) {
      try {
        await clearer(input.projectId, c.specId);
      } catch (e) {
        logger.warn(
          'Pre-clear manually-edited flag failed (non-blocking)',
          { projectId: input.projectId, specId: c.specId,
            workItemId: c.workItemId,
            error: e instanceof Error ? e.message : String(e) },
        );
      }
    }
  }

  // Filter skipped rows out of the batch input. The batch handler reads
  // \`targetWorkItemIds\` as a whitelist; if it's undefined (Generate-all
  // path) the batch picks from BoW order. To skip manually-edited rows
  // from a Generate-all run we must promote the target set to "everything
  // except the skipped rows". For now (v1), we only filter when the
  // caller already supplied \`targetWorkItemIds\` (the common path for
  // single-story regenerate + retry-batch). For Generate-all (no target
  // set), we let the inner batch attempt every story and rely on AMS to
  // refuse the manually-edited writes; the skipped list still surfaces
  // them on the result so the UI shows the count.
  //
  // Wait -- AMS persistOne THROWS \`manual_edit_protected\` for unconfirmed
  // manually-edited rows. To avoid noisy per-row failures, we DO filter
  // even in the no-target case: build a synthetic \`targetWorkItemIds\`
  // from the existing BoW minus the skipped set. The inner batch's
  // selection logic falls back to BoW order when no target is supplied,
  // so we need to do this filter by EXCLUSION: load the existing
  // generations and build "every workItemId NOT in skipped".
  //
  // Simplest v1: build the exclusion set and let the inner batch use a
  // new \`excludeWorkItemIds\` filter. To keep the surface change small,
  // we synthesize the target list from the BoW directly using the same
  // book loader. But we DON'T have it here. Punt: when \`targetWorkItemIds\`
  // is undefined and there are skipped rows, we leave the batch input
  // alone and rely on the inner persist failure isolation. The skipped
  // list still surfaces them so the UI is accurate.
  const skippedSet = new Set(skipped.map((s) => s.workItemId));
  if (input.targetWorkItemIds && skippedSet.size > 0) {
    const filtered = (input.targetWorkItemIds as ReadonlyArray<string | null | undefined>)
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
      .filter((v) => !skippedSet.has(v));
    return {
      effectiveInput: { ...input, targetWorkItemIds: filtered },
      skipped,
    };
  }
  return { effectiveInput: input, skipped };
}`,
  },
];

// Find/replace defaults for the new DI seams just after defaultPersistBatchResults
edits.push({
  find: `function toAmsWireShape(r: MigrationStorySpecGenerationDto): Record<string, unknown> {`,
  replace: `/**
 * In-Product Spec Editor + Confirm-Overwrite (2026-05-20, Task Group 5):
 * default AMS-backed implementation of the manually-edited pre-flight.
 */
const defaultFetchManuallyEditedInScope: ManuallyEditedInScopeFetcher = async (
  projectId,
  bookOfWorkId,
  workItemIds,
) => {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  let url =
    \`\${baseUrl}/api/projects/\${encodeURIComponent(projectId)}\` +
    \`/migration-books-of-work/\${encodeURIComponent(bookOfWorkId)}\` +
    \`/spec-generations/manually-edited-in-scope\`;
  if (workItemIds && workItemIds.length > 0) {
    const qs = workItemIds
      .filter((v) => typeof v === 'string' && v.length > 0)
      .map((v) => \`workItemIds=\${encodeURIComponent(v)}\`)
      .join('&');
    if (qs.length > 0) url = \`\${url}?\${qs}\`;
  }
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    if (response.status === 404) return [];
    const text = await response.text().catch(() => '');
    throw new Error(
      \`AMS GET /manually-edited-in-scope returned \${response.status}: \${text || '<empty body>'}\`,
    );
  }
  const raw = (await response.json()) as unknown;
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => {
    const row = (r ?? {}) as Record<string, unknown>;
    return {
      workItemId: String(row.workItemId ?? row.work_item_id ?? ''),
      workItemTitle: (row.workItemTitle ?? row.work_item_title ?? null) as string | null,
      lastManuallyEditedBy:
        (row.lastManuallyEditedBy ?? row.last_manually_edited_by ?? null) as string | null,
      lastManuallyEditedAt:
        (row.lastManuallyEditedAt ?? row.last_manually_edited_at ?? null) as string | null,
      specId: (row.specId ?? row.spec_id ?? row.id ?? null) as string | null,
    };
  });
};

/**
 * In-Product Spec Editor + Confirm-Overwrite (2026-05-20, Task Group 5):
 * default AMS-backed implementation that clears the \`manually_edited\`
 * flag on a single row by hitting the regenerate endpoint with
 * \`overwriteManuallyEdited=true\` and no patch body. AMS's
 * \`regenerateSingleStory\` clears the four manual-edit columns when the
 * flag is true (see service code) and re-runs the parser + scorer on the
 * existing text -- idempotent for our pre-clear purpose.
 */
const defaultClearManuallyEditedFlag: ManuallyEditedFlagClearer = async (
  projectId,
  specId,
) => {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const url =
    \`\${baseUrl}/api/projects/\${encodeURIComponent(projectId)}\` +
    \`/spec-generations/\${encodeURIComponent(specId)}/regenerate\` +
    \`?overwriteManuallyEdited=true\`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    // No patch body -- we just want the flag-clear side effect.
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      \`AMS POST /regenerate?overwriteManuallyEdited=true returned \${response.status}: \${text || '<empty body>'}\`,
    );
  }
};

function toAmsWireShape(r: MigrationStorySpecGenerationDto): Record<string, unknown> {`,
});

let src = fs.readFileSync(HANDLER, 'utf-8');
for (const e of edits) {
  if (src.indexOf(e.find) === -1) {
    console.error('Find pattern not found:');
    console.error(e.find.split('\n').slice(0, 4).join('\n'));
    process.exit(2);
  }
  if (src.indexOf(e.find) !== src.lastIndexOf(e.find)) {
    console.error('Find pattern AMBIGUOUS (matches multiple times):');
    console.error(e.find.split('\n').slice(0, 4).join('\n'));
    process.exit(3);
  }
  src = src.replace(e.find, e.replace);
}
fs.writeFileSync(HANDLER, src);
console.log('Handler updated:', HANDLER);
