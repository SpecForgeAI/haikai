/**
 * Gateway orchestration handler for the Holistic Integration/E2E TEST Work
 * Items flow.
 *
 * Spec: 2026-06-14 Holistic Integration/E2E TEST Work Items (Spec 2 of 4).
 *
 * This is a NEW headless, batch-style handler modelled on
 * `runShapeSpecGenerationBatch` (`migrationShapeSpecGenerationHandler.ts`):
 * dependency-injection seams, per-item failure isolation, structured
 * `[diag-gateway]` logs. It is NOT the interactive `test_planning_holistic`
 * chat phase (the in-panel consumer's `storyResults -> storySpecs[]` mapping is
 * a REFERENCE only for assembling `StorySpecSummary[]`).
 *
 * Input is a node selection (FEATURE or EPIC) within a book of work. The
 * handler:
 *   1. Loads the node's immediate children + their
 *      `migration_story_spec_generations` rows; builds `StorySpecSummary[]` over
 *      the SPEC-COMPLETE children (`generated` / `generated_with_warnings`).
 *   2. Injects `TEST-STRATEGY.MD` from
 *      `{projectParentFolder}/agent-os/product/TEST-STRATEGY.MD` (tolerates a
 *      missing file -> null).
 *   3. Calls the LLM via the generalized `buildHolisticTestPlanningPrompt`
 *      (level-relative: FEATURE reviews stories, EPIC reviews features) and
 *      parses `testPlan[]` (integration|e2e only; MAY be empty -- no
 *      fabrication).
 *   4. For each generated test creates ONE `TEST` work item (D2): writes BOTH a
 *      `book_of_work_json.items[]` blob item AND a `work_item` row (D3) with the
 *      created `workItemId` stamped back onto the blob, computes
 *      `sequenceOrder`/`sortOrder` after the last spanned child (D4), assembles
 *      a lighter `/agent-os:shape-spec` test-plan spec body (D6), persists a
 *      `migration_story_spec_generations` row keyed on the TEST item's
 *      `work_item_id` (D6), and writes `implement-state.json` (D6).
 *
 * Gating is ALLOW-WITH-WARNING (D5(b)(c)): the review runs over the
 * spec-complete children; any child still `insufficient_context` /
 * not-yet-generated is SKIPPED + listed in the returned warning payload, never
 * blocking. An empty spec-complete set still returns a structured result +
 * warning.
 *
 * Per-item failure isolation (R-12 posture): every per-test exception is caught
 * and recorded as a per-item failure; the batch NEVER aborts. A failed
 * implement-state write is best-effort and never aborts the item or the batch.
 *
 * Structured log markers:
 *   [diag-gateway] holistic_test_definitions review_started projectId=<id> bookOfWorkId=<id> nodeId=<id> level=<feature|epic> specCompleteChildren=<n> skippedChildren=<n>
 *   [diag-gateway] holistic_test_definitions llm_result projectId=<id> nodeId=<id> testPlan=<n>
 *   [diag-gateway] holistic_test_definitions test_item_started projectId=<id> nodeId=<id> index=<i> type=<integration|e2e>
 *   [diag-gateway] holistic_test_definitions test_item_created projectId=<id> nodeId=<id> workItemId=<id> bookItemId=<id> seq=<n> specPersisted=<bool> implementStateWritten=<bool>
 *   [diag-gateway] holistic_test_definitions test_item_failed projectId=<id> nodeId=<id> index=<i> reason=<msg>
 *   [diag-gateway] holistic_test_definitions review_completed projectId=<id> nodeId=<id> created=<n> failed=<n> emptyPlan=<bool>
 */

import { getConfig } from '../config';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';
import { ChatContext } from '../types';
import {
  StorySpecSummary,
  HolisticReviewLevel,
  buildHolisticTestPlanningPrompt,
} from './holisticTestPlanningPrompt';
import {
  assertSpecGenerationResponse,
  SPEC_TEXT_REQUIRED_PREFIX,
  GeneratedShapeSpecResponseA,
} from './specGenerationResponseValidator';
import {
  buildPersistedImplementStateLiteral,
  PlannerResponseLiteral,
  TestPlannerResponseLiteral,
  TestDefinitionLiteral,
  ImplementStatePutter,
  ImplementStatePutBody,
} from './migrationImplementReadyState';
import {
  MigrationStorySpecGenerationDto,
  SpecGenerationResult,
  PersistBatchFn,
  toAmsWireShape,
  normaliseAmsRow,
} from './migrationShapeSpecGenerationHandler';
import {
  fetchProjectFolder as defaultFetchProjectFolder,
} from './architectureModelClient';
import {
  deriveFolderName,
  buildTranscriptPath,
  normalizeKind,
} from './transcriptWriter';

const TASK_ID = 'product-manager--holistic-test-definitions';

// ---------------------------------------------------------------------------
// Public input + output types
// ---------------------------------------------------------------------------

/**
 * A single holistic test definition produced by the prompt. `type` is always
 * `integration` or `e2e` (the prompt forbids `unit`/`functional`).
 */
export interface HolisticTestDefinition {
  title: string;
  description: string;
  type: 'integration' | 'e2e';
}

/**
 * A node (FEATURE or EPIC) and its immediate children, as loaded from
 * `book_of_work_json`. Only the fields the handler reads are surfaced. The
 * `level` is derived from the node `type` by the loader.
 */
export interface LoadedHolisticNode {
  projectId: string;
  bookOfWorkId: string;
  /** The blob-item id of the FEATURE/EPIC node within `book_of_work_json`. */
  nodeBookItemId: string;
  /** The saved WorkItem UUID of the node (the TEST items' `parentId`). */
  nodeWorkItemId: string | null;
  /** The node title + description (for the prompt's node-context block). */
  nodeTitle: string;
  nodeDescription: string | null;
  /** `feature` (children are stories) or `epic` (children are features). */
  level: HolisticReviewLevel;
  /** The node's immediate children (stories at FEATURE level, features at EPIC level). */
  children: LoadedHolisticChild[];
}

/** One immediate child of the holistic node. */
export interface LoadedHolisticChild {
  /** Blob-item id within `book_of_work_json`. */
  bookItemId: string;
  /** Saved WorkItem UUID (null when the child is not yet saved to backlog). */
  workItemId: string | null;
  title: string;
  description: string | null;
  /** Display order among the node's children. */
  sequenceOrder: number;
  /**
   * D6 (2026-06-14): the like-for-like provenance marker (`carry_over` |
   * `net_new`) the AMS add-item endpoint stamps on the blob item for a manual
   * add. Threaded purely to recognise operational / non-API stories at holistic
   * review time. Absent for ordinary discovered stories.
   */
  provenance?: string | null;
  /**
   * D6 (2026-06-14): the `discovery_capability` UUID a D3 operational-capability
   * story was minted from (stamped on the blob). Its PRESENCE is the primary
   * operational marker (a discovered operational capability has no API surface).
   * Absent for ordinary API / data stories.
   */
  sourceCapabilityId?: string | null;
  /**
   * D6 (2026-06-14): the prompt FLAVOUR (`api` | `operational`) the add-item
   * endpoint stamps on a manual add. `operational` is the secondary operational
   * marker (a manual operational add with no discovered capability).
   */
  kind?: string | null;
}

export interface RunHolisticTestDefinitionsInput {
  projectId: string;
  bookOfWorkId: string;
  /** The blob-item id of the FEATURE or EPIC node to review. */
  nodeBookItemId: string;
}

/** A child skipped by the ALLOW-WITH-WARNING gate (D5(b)(c)). */
export interface SkippedChildWarning {
  bookItemId: string;
  workItemId: string | null;
  title: string;
  /** `not_generated` (no spec row / not yet attempted) or the row status. */
  reason:
    | 'not_generated'
    | 'insufficient_context'
    | 'failed'
    | 'skipped_blocked'
    | string;
}

/** Per-created TEST-item summary returned to the caller. */
export interface CreatedTestItem {
  workItemId: string;
  bookItemId: string;
  title: string;
  type: 'integration' | 'e2e';
  sequenceOrder: number;
  /** True iff the `migration_story_spec_generations` row persisted. */
  specPersisted: boolean;
  /** True iff `implement-state.json` was written. */
  implementStateWritten: boolean;
}

/** Per-test failure (R-12 isolation). */
export interface FailedTestItem {
  index: number;
  title: string;
  type: 'integration' | 'e2e';
  reason: string;
}

export interface HolisticTestDefinitionsResult {
  level: HolisticReviewLevel;
  nodeBookItemId: string;
  nodeWorkItemId: string | null;
  /** The raw test definitions the LLM produced (integration|e2e; MAY be empty). */
  testPlan: HolisticTestDefinition[];
  /** ALLOW-WITH-WARNING: children skipped because they are not spec-complete. */
  skippedChildren: SkippedChildWarning[];
  /** Count of spec-complete children the review ran over. */
  specCompleteChildCount: number;
  /** The TEST items created (ONE per generated test, D2). */
  createdTestItems: CreatedTestItem[];
  /** Per-test failures (isolated; never abort the batch). */
  failedTestItems: FailedTestItem[];
  /** True when the LLM returned no cross-cutting tests (no items created). */
  emptyPlan: boolean;
}

// ---------------------------------------------------------------------------
// Dependency-injection seams (mirrors ShapeSpecGenerationDeps)
// ---------------------------------------------------------------------------

/** Load the FEATURE/EPIC node + its immediate children + spec-row statuses. */
export type HolisticNodeLoader = (
  projectId: string,
  bookOfWorkId: string,
  nodeBookItemId: string,
) => Promise<LoadedHolisticNode>;

/** Load the spec-generation rows for the book (used to gate spec-complete children). */
export type SpecRowsLoader = (
  projectId: string,
  bookOfWorkId: string,
) => Promise<MigrationStorySpecGenerationDto[]>;

/** Read TEST-STRATEGY.MD for the project (null when absent). */
export type TestStrategyReader = (
  projectParentFolder: string,
) => Promise<string | null>;

/** Single synchronous LLM call (mirrors the shape-spec LlmCaller). */
export type HolisticLlmCaller = (input: {
  systemPrompt: string;
  userPrompt: string;
  projectId: string;
  nodeBookItemId: string;
}) => Promise<{ content: string }>;

/**
 * Create the TEST work item AND append its blob item into `book_of_work_json`,
 * stamping the created `workItemId` back onto the blob -- all atomically
 * server-side (mirrors the save-to-backlog `persistOne` + `workItemId`
 * write-back). Returns the created WorkItem UUID + the blob-item id.
 */
export type TestItemCreator = (input: {
  projectId: string;
  bookOfWorkId: string;
  parentBookItemId: string;
  parentWorkItemId: string | null;
  title: string;
  description: string;
  sequenceOrder: number;
}) => Promise<{ workItemId: string; bookItemId: string }>;

/** Resolve the project parent folder (for TEST-STRATEGY.MD + implement-state). */
export type ProjectFolderResolver = (projectId: string) => Promise<string | null>;

export interface HolisticTestDefinitionDeps {
  loadNode?: HolisticNodeLoader;
  loadSpecRows?: SpecRowsLoader;
  readTestStrategy?: TestStrategyReader;
  callLlm?: HolisticLlmCaller;
  createTestItem?: TestItemCreator;
  persistSpecRow?: PersistBatchFn;
  putImplementState?: ImplementStatePutter;
  resolveProjectFolder?: ProjectFolderResolver;
}

// ---------------------------------------------------------------------------
// Default production wiring
// ---------------------------------------------------------------------------

/**
 * Map a free-text book-item `type` to the holistic review level. Anything that
 * is not an epic is treated as a FEATURE-level review (review stories) -- the
 * caller is expected to only trigger this on FEATURE/EPIC nodes.
 */
function levelFromType(rawType: string | null | undefined): HolisticReviewLevel {
  return (rawType ?? '').toLowerCase() === 'epic' ? 'epic' : 'feature';
}

const defaultLoadNode: HolisticNodeLoader = async (
  projectId,
  bookOfWorkId,
  nodeBookItemId,
) => {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/migration-books-of-work/${encodeURIComponent(bookOfWorkId)}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `AMS GET /migration-books-of-work/${bookOfWorkId} returned ${response.status}: ${text || '<empty body>'}`,
    );
  }
  const dto = (await response.json()) as {
    project_id?: string;
    book_of_work_json?: { items?: unknown[] } | null;
  };
  const rawItems = (dto.book_of_work_json?.items as unknown[]) || [];
  const items: Array<Record<string, unknown>> = [];
  for (const raw of rawItems) {
    if (raw && typeof raw === 'object') items.push(raw as Record<string, unknown>);
  }
  const node = items.find((it) => String(it.id ?? '') === nodeBookItemId);
  if (!node) {
    throw new Error(`Node book-item '${nodeBookItemId}' not found in book_of_work_json`);
  }
  const level = levelFromType(node.type as string | undefined);
  const children: LoadedHolisticChild[] = items
    .filter((it) => (it.parentId as string | null | undefined) === nodeBookItemId)
    .map((it) => ({
      bookItemId: String(it.id ?? ''),
      workItemId: (it.workItemId as string | null | undefined) ?? null,
      title: String(it.title ?? ''),
      description: (it.description as string | null | undefined) ?? null,
      sequenceOrder: Number(it.sequenceOrder ?? 0),
      // D6: the operational-recognition signals ride the blob; tolerate snake_case
      // (AMS wire) + camelCase, mirroring the shape-spec handler's blob-read.
      provenance: (it.provenance as string | null | undefined) ?? null,
      sourceCapabilityId:
        (it.source_capability_id as string | null | undefined) ??
        (it.sourceCapabilityId as string | null | undefined) ??
        null,
      kind: (it.kind as string | null | undefined) ?? null,
    }));
  return {
    projectId,
    bookOfWorkId,
    nodeBookItemId,
    nodeWorkItemId: (node.workItemId as string | null | undefined) ?? null,
    nodeTitle: String(node.title ?? ''),
    nodeDescription: (node.description as string | null | undefined) ?? null,
    level,
    children,
  };
};

const defaultLoadSpecRows: SpecRowsLoader = async (projectId, bookOfWorkId) => {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/migration-books-of-work/${encodeURIComponent(bookOfWorkId)}/spec-generations`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    if (response.status === 404) return [];
    const text = await response.text().catch(() => '');
    throw new Error(
      `AMS GET /spec-generations returned ${response.status}: ${text || '<empty body>'}`,
    );
  }
  const raw = (await response.json()) as unknown;
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => normaliseAmsRow(row as Record<string, unknown>));
};

const defaultReadTestStrategy: TestStrategyReader = async (projectParentFolder) => {
  try {
    const p = path.join(projectParentFolder, 'agent-os', 'product', 'TEST-STRATEGY.MD');
    return await fs.promises.readFile(p, 'utf-8');
  } catch {
    return null;
  }
};

const defaultCallLlm: HolisticLlmCaller = async ({
  systemPrompt,
  userPrompt,
  projectId,
  nodeBookItemId,
}) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getLlmClient } = require('./llmClient');
  const client = getLlmClient();
  const response = await client.sendChatRequest(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    `holistic-test-definitions-${nodeBookItemId}-${Date.now()}`,
    `holistic-test-definitions-${projectId}`,
    { jsonMode: true },
  );
  return { content: response.content ?? '' };
};

/**
 * Default TEST-item creator: calls the AMS atomic "append TEST sibling"
 * endpoint that creates the `work_item` row, appends the `book_of_work_json`
 * blob item with the stamped `workItemId`, and persists -- all in one
 * transaction (mirrors the save-to-backlog write-back; Spec 2 D3).
 */
const defaultCreateTestItem: TestItemCreator = async (input) => {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const url =
    `${baseUrl}/api/projects/${encodeURIComponent(input.projectId)}` +
    `/migration-books-of-work/${encodeURIComponent(input.bookOfWorkId)}/items/append-test-item`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      parent_book_item_id: input.parentBookItemId,
      parent_work_item_id: input.parentWorkItemId,
      title: input.title,
      description: input.description,
      sequence_order: input.sequenceOrder,
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `AMS POST /items/append-test-item returned ${response.status}: ${text || '<empty body>'}`,
    );
  }
  const dto = (await response.json()) as {
    work_item_id?: string;
    workItemId?: string;
    book_item_id?: string;
    bookItemId?: string;
  };
  const workItemId = String(dto.work_item_id ?? dto.workItemId ?? '');
  const bookItemId = String(dto.book_item_id ?? dto.bookItemId ?? '');
  if (!workItemId) {
    throw new Error('AMS append-test-item response missing work_item_id');
  }
  return { workItemId, bookItemId };
};

/** Default spec-row persister: reuses the shape-spec batch endpoint. */
const defaultPersistSpecRow: PersistBatchFn = async (projectId, bookOfWorkId, results) => {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/migration-books-of-work/${encodeURIComponent(bookOfWorkId)}/spec-generations/batch`;
  const body = results.map((r) => toAmsWireShape(r));
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `AMS POST /spec-generations/batch returned ${response.status}: ${text || '<empty body>'}`,
    );
  }
  const dto = (await response.json()) as {
    persistedCount?: number;
    resultsCouldNotPersist?: number;
    perStoryResults?: unknown[];
  };
  return {
    persistedCount: dto.persistedCount ?? 0,
    resultsCouldNotPersist: dto.resultsCouldNotPersist ?? 0,
    perStoryResults: Array.isArray(dto.perStoryResults)
      ? dto.perStoryResults.map((row) => normaliseAmsRow(row as Record<string, unknown>))
      : undefined,
  };
};

/**
 * Default implement-state writer: writes the assembled PersistedImplementation
 * State literal to the gateway-filesystem implement-state file using the SAME
 * path-derivation + atomic temp+rename contract as Spec 1's default writer.
 */
const defaultPutImplementState: ImplementStatePutter = async (body) => {
  const kind = normalizeKind(body.kind);
  const folderName = deriveFolderName(body.featureTitle, body.featureId);
  const { dirPath } = buildTranscriptPath(body.projectParentFolder, folderName, kind);
  await fs.promises.mkdir(dirPath, { recursive: true });
  const jsonFilePath = path.join(dirPath, 'implementation-state.json');
  const tempPath = jsonFilePath + '.tmp';
  await fs.promises.writeFile(tempPath, JSON.stringify(body.state, null, 2), 'utf8');
  await fs.promises.rename(tempPath, jsonFilePath);
  return { success: true };
};

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

const SPEC_COMPLETE_STATUSES = new Set(['generated', 'generated_with_warnings']);

/**
 * Partition the node's children into spec-complete (`generated` /
 * `generated_with_warnings`) vs. skipped (no spec row, or a non-complete row
 * status). ALLOW-WITH-WARNING: a child with no saved WorkItem OR no spec row is
 * `not_generated`; a child whose latest row status is not spec-complete is
 * skipped with that status. (D5(b)(c).)
 */
export function partitionChildrenBySpecStatus(
  children: LoadedHolisticChild[],
  specRows: MigrationStorySpecGenerationDto[],
): { specComplete: LoadedHolisticChild[]; skipped: SkippedChildWarning[] } {
  const rowByWorkItem = new Map<string, MigrationStorySpecGenerationDto>();
  for (const r of specRows) {
    if (r.workItemId) rowByWorkItem.set(r.workItemId, r);
  }
  const specComplete: LoadedHolisticChild[] = [];
  const skipped: SkippedChildWarning[] = [];
  for (const child of children) {
    const row = child.workItemId ? rowByWorkItem.get(child.workItemId) : undefined;
    if (row && SPEC_COMPLETE_STATUSES.has(row.status)) {
      specComplete.push(child);
    } else {
      skipped.push({
        bookItemId: child.bookItemId,
        workItemId: child.workItemId,
        title: child.title,
        reason: row ? row.status : 'not_generated',
      });
    }
  }
  return { specComplete, skipped };
}

/**
 * Compute the base sequenceOrder for the FIRST TEST sibling: one past the max
 * `sequenceOrder` among the node's existing children (D4). Multiple TEST items
 * then increment from this base (+0, +1, +2, ...). Returns 1 when the node has
 * no children with a sequenceOrder.
 */
export function computeTestSequenceBase(children: LoadedHolisticChild[]): number {
  let max = 0;
  let sawAny = false;
  for (const c of children) {
    if (typeof c.sequenceOrder === 'number' && Number.isFinite(c.sequenceOrder)) {
      sawAny = true;
      if (c.sequenceOrder > max) max = c.sequenceOrder;
    }
  }
  return sawAny ? max + 1 : 1;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '\n...[truncated]' : s;
}

/**
 * Build a `StorySpecSummary` for one spec-complete child from its persisted
 * spec row. The row's `generated_spec_text` + `structured_tests_json` are the
 * source of truth; scope/acceptance sections are left for the prompt to read
 * from the title + spec text (the holistic prompt mainly needs the title +
 * tests for cross-cutting reasoning).
 */
export function buildStorySpecSummary(
  child: LoadedHolisticChild,
  row: MigrationStorySpecGenerationDto | undefined,
): StorySpecSummary {
  const tests = Array.isArray(row?.structuredTestsJson)
    ? (row!.structuredTestsJson as Array<Record<string, unknown>>).map((t) => ({
        title: String(t.title ?? ''),
        description: String(t.description ?? ''),
        type: String(t.type ?? ''),
      }))
    : undefined;
  return {
    storyTitle: child.title,
    featureUnderstanding:
      typeof row?.generatedSpecText === 'string' && row.generatedSpecText.length > 0
        ? truncate(row.generatedSpecText, 1200)
        : child.description ?? undefined,
    testPlan: tests && tests.length > 0 ? tests : undefined,
    // D6: carry the operational / non-API nature so the prompt can steer toward
    // EFFECT-asserting tests for batch-tier work the diff cannot reconcile.
    operational: isOperationalChild(child),
  };
}

/**
 * D6 (2026-06-14): a child is OPERATIONAL / non-API when it carries the
 * operational marker -- a `source_capability_id` (a D3 discovered operational
 * capability, the preferred signal) and/or `kind=operational` (a D5 manual
 * operational add). Mirrors the `migrationShapeSpecGenerationHandler`
 * `isManualAdd` + `resolveManualAddFlavour` recognition, routed through the
 * holistic node loader. Ordinary API / data stories are NOT operational.
 */
export function isOperationalChild(child: LoadedHolisticChild): boolean {
  const hasCapability =
    typeof child.sourceCapabilityId === 'string' &&
    child.sourceCapabilityId.trim().length > 0;
  const isOperationalKind = (child.kind ?? '').trim().toLowerCase() === 'operational';
  return hasCapability || isOperationalKind;
}

// ---------------------------------------------------------------------------
// Holistic -> spec assembler (D6)
// ---------------------------------------------------------------------------

/**
 * DEDICATED, lighter holistic -> spec assembler (NOT Spec 1's per-story
 * generator). Produces a canonical `/agent-os:shape-spec` test-plan body for a
 * single integration/E2E TEST item that instructs Claude Code to WRITE the
 * test code aligned to `TEST-STRATEGY.MD`. The integration/E2E definitions are
 * its input.
 *
 * The body is wrapped into the Generated-variant response shape and validated
 * via `assertSpecGenerationResponse`. The validator's structured `tests[]`
 * array is constrained to `unit`/`functional`, so it is left EMPTY here -- the
 * integration/E2E definitions live in the spec prose AND in the row's
 * `structured_tests_json` column (free-form), NOT in the validated `tests[]`.
 */
export function assembleHolisticTestSpecBody(
  test: HolisticTestDefinition,
  nodeTitle: string,
  level: HolisticReviewLevel,
  testStrategy: string | null,
  operational = false,
): string {
  const childPlural = level === 'epic' ? 'features' : 'stories';
  const perChild = level === 'epic' ? 'feature' : 'story';
  const lines: string[] = [];
  lines.push(`${SPEC_TEXT_REQUIRED_PREFIX} ${test.title}`);
  lines.push('');
  lines.push(`# ${test.type === 'e2e' ? 'End-to-End' : 'Integration'} Test: ${test.title}`);
  lines.push('');
  lines.push('## Goal');
  lines.push(
    `Write the automated ${test.type === 'e2e' ? 'end-to-end (E2E)' : 'integration'} test code ` +
      `for the cross-cutting behaviour identified during the holistic review of the ` +
      `${level} "${nodeTitle}" and its ${childPlural}. This TEST work item is implemented ` +
      `(real test code written) via the Migrate loop exactly like a story, then executed in ` +
      `Verification.`,
  );
  lines.push('');
  lines.push('## Test definition (the holistic review output)');
  lines.push(`- Type: ${test.type}`);
  lines.push(`- Title: ${test.title}`);
  lines.push(`- What it verifies: ${test.description}`);
  lines.push('');
  lines.push('## Scope in');
  lines.push(
    `- Implement the ${test.type} test described above as real, runnable automated test code.`,
  );
  lines.push(`- Align the test framework, layering, fixtures and naming to TEST-STRATEGY.MD.`);
  lines.push(`- The test joins the project test suite and is run during Verification.`);
  lines.push('');
  if (operational) {
    // D6: this story is operational / non-API -- it has no HTTP request/response
    // surface, so the API-only reconciliation cannot diff it. Steer the written
    // test to assert by EFFECT (run the pipeline -> assert DB / message / snapshot).
    lines.push('## Assert by EFFECT (operational / non-API work)');
    lines.push(
      `This ${perChild} is OPERATIONAL / non-API: it has no HTTP request/response surface, so ` +
        `reconciliation cannot verify it. The test MUST assert by EFFECT, not by HTTP request/response:`,
    );
    lines.push(`- RUN THE PIPELINE / trigger the operational job under test, then ASSERT the downstream outcome.`);
    lines.push(
      `- Assert concrete effects: rows written/updated in the expected DATABASE TABLES, the expected ` +
        `DOWNSTREAM MESSAGE published, and/or a SNAPSHOT of the produced output (file/report/extract).`,
    );
    lines.push(`- Do NOT assert an HTTP status/body (there is none); assert the persisted/emitted state the run produces.`);
    lines.push('');
  }
  lines.push('## Scope out');
  lines.push(`- Unit / functional tests for individual ${childPlural} (already defined per ${perChild}).`);
  lines.push(`- Production source changes beyond what the test needs to exercise the behaviour.`);
  lines.push('');
  lines.push('## Acceptance criteria');
  lines.push(`- A new ${test.type} test exists, compiles, and runs in the suite.`);
  lines.push(`- The test asserts the cross-cutting behaviour: ${test.description}`);
  lines.push(`- The test follows the conventions in TEST-STRATEGY.MD.`);
  lines.push('');
  lines.push('## TEST-STRATEGY.MD (project test strategy)');
  lines.push(
    testStrategy && testStrategy.trim().length > 0
      ? truncate(testStrategy, 4000)
      : 'No TEST-STRATEGY.MD found for this project; follow the repository\'s existing test conventions for integration/E2E tests.',
  );
  lines.push('');
  lines.push('## Instruction to Claude Code');
  lines.push(
    `Write the ${test.type} test code now. Place it in the appropriate test source tree, ` +
      `follow TEST-STRATEGY.MD, and ensure it asserts the behaviour described above.` +
      (operational
        ? ` Because this work is operational / non-API, run the pipeline and assert the downstream ` +
          `EFFECT (DB tables / downstream message / snapshot) rather than an HTTP response.`
        : ''),
  );
  return lines.join('\n');
}

/**
 * Wrap an assembled spec body into the Generated-variant response and validate
 * it. Throws when validation fails so the per-test loop records an isolated
 * failure.
 */
export function buildValidatedHolisticSpecResponse(
  specText: string,
): GeneratedShapeSpecResponseA {
  const candidate: GeneratedShapeSpecResponseA = {
    status: 'generated',
    confidence: 'high',
    specText,
    warnings: [],
    evidenceRefs: [],
    assumptions: [
      'The integration/E2E test is implementable from the sibling specs + TEST-STRATEGY.MD.',
    ],
    // Validator constrains tests[] to unit|functional; the integration/E2E
    // definitions live in the spec prose + the row's structured_tests_json.
    tests: [],
    affectedAreas: [],
    coveredEndpointIds: [],
  };
  const validation = assertSpecGenerationResponse(candidate);
  if (!validation.ok) {
    throw new Error(
      `Assembled holistic TEST spec failed validation: ${validation.errors.join('; ')}`,
    );
  }
  return candidate;
}

/**
 * Build the TestPlannerResponse literal for a TEST item's implement-state from
 * the SINGLE integration/E2E definition (the Test Pack the implement screen
 * renders). Built directly (not via `buildTestPlannerResponseFromTests`, which
 * counts unit/functional) because the type is integration/e2e.
 */
export function buildHolisticTestPlannerResponse(
  test: HolisticTestDefinition,
): TestPlannerResponseLiteral {
  const testPlan: TestDefinitionLiteral[] = [
    { title: test.title, description: test.description, type: test.type },
  ];
  return {
    schemaVersion: '1.0',
    message: `Integration/E2E test pack: 1 ${test.type} test to implement.`,
    testPlan,
    openQuestions: [],
  };
}

/** Build the ready PlannerResponse literal for a TEST item's implement-state. */
export function buildHolisticPlannerResponse(
  test: HolisticTestDefinition,
): PlannerResponseLiteral {
  return {
    schemaVersion: '1.1',
    message: `Write these integration/E2E tests: ${test.title}.`,
    featureUnderstanding: `Implement the ${test.type} test "${test.title}": ${test.description}`,
    scope: {
      in: ['write these integration/E2E tests'],
      out: [],
    },
    assumptions: [],
    acceptanceCriteria: [`A new ${test.type} test asserts: ${test.description}`],
    openQuestions: [],
    plannerReadyForSpec: true,
    implementationPlan: null,
  };
}

// ---------------------------------------------------------------------------
// LLM response parsing
// ---------------------------------------------------------------------------

/**
 * Parse + sanitise the holistic LLM JSON into a `HolisticTestDefinition[]`.
 * Tolerant: drops entries missing a title/description, and coerces `type` to
 * `integration` (default) when it is not `integration`/`e2e` -- the prompt
 * forbids unit/functional so any other value is treated as integration.
 * Returns [] on a parse error (logged by the caller).
 */
export function parseHolisticTestPlan(content: string): HolisticTestDefinition[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const arr = (parsed as Record<string, unknown>).testPlan;
  if (!Array.isArray(arr)) return [];
  const out: HolisticTestDefinition[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;
    const obj = raw as Record<string, unknown>;
    const title = typeof obj.title === 'string' ? obj.title.trim() : '';
    const description = typeof obj.description === 'string' ? obj.description.trim() : '';
    if (title.length === 0 || description.length === 0) continue;
    const rawType = typeof obj.type === 'string' ? obj.type.toLowerCase() : '';
    const type: 'integration' | 'e2e' = rawType === 'e2e' ? 'e2e' : 'integration';
    out.push({ title, description, type });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run the holistic review for ONE feature/epic node and create a TEST work item
 * per generated integration/E2E test.
 *
 * @param input the node selection (projectId, bookOfWorkId, nodeBookItemId)
 * @param deps  dependency overrides for tests (defaults wire to AMS + LLM)
 */
export async function runHolisticTestDefinitions(
  input: RunHolisticTestDefinitionsInput,
  deps: HolisticTestDefinitionDeps = {},
): Promise<HolisticTestDefinitionsResult> {
  const loadNode = deps.loadNode ?? defaultLoadNode;
  const loadSpecRows = deps.loadSpecRows ?? defaultLoadSpecRows;
  const readTestStrategy = deps.readTestStrategy ?? defaultReadTestStrategy;
  const callLlm = deps.callLlm ?? defaultCallLlm;
  const createTestItem = deps.createTestItem ?? defaultCreateTestItem;
  const persistSpecRow = deps.persistSpecRow ?? defaultPersistSpecRow;
  const putImplementState = deps.putImplementState ?? defaultPutImplementState;
  const resolveProjectFolder = deps.resolveProjectFolder ?? defaultFetchProjectFolder;

  const { projectId, bookOfWorkId, nodeBookItemId } = input;

  // ----- Stage 1: load node + children + spec rows -----
  const node = await loadNode(projectId, bookOfWorkId, nodeBookItemId);
  const specRows = await loadSpecRows(projectId, bookOfWorkId);

  // ----- Stage 2: ALLOW-WITH-WARNING gating (D5(b)(c)) -----
  const { specComplete, skipped } = partitionChildrenBySpecStatus(node.children, specRows);
  const rowByWorkItem = new Map<string, MigrationStorySpecGenerationDto>();
  for (const r of specRows) {
    if (r.workItemId) rowByWorkItem.set(r.workItemId, r);
  }

  console.log(
    `[diag-gateway] holistic_test_definitions review_started ` +
      `projectId=${projectId} bookOfWorkId=${bookOfWorkId} nodeId=${nodeBookItemId} ` +
      `level=${node.level} specCompleteChildren=${specComplete.length} skippedChildren=${skipped.length}`,
  );

  // ----- Stage 3: resolve project folder + TEST-STRATEGY.MD -----
  let projectParentFolder: string | null = null;
  try {
    projectParentFolder = await resolveProjectFolder(projectId);
  } catch (e) {
    logger.warn('fetchProjectFolder failed in holistic-test-definitions; proceeding without TEST-STRATEGY.MD', {
      projectId,
      error: e instanceof Error ? e.message : String(e),
    });
    projectParentFolder = null;
  }
  let testStrategy: string | null = null;
  if (projectParentFolder) {
    try {
      testStrategy = await readTestStrategy(projectParentFolder);
    } catch {
      testStrategy = null;
    }
  }

  // ----- Stage 4: build StorySpecSummary[] over spec-complete children -----
  const storySpecs: StorySpecSummary[] = specComplete.map((child) =>
    buildStorySpecSummary(child, child.workItemId ? rowByWorkItem.get(child.workItemId) : undefined),
  );
  // D6: any operational / non-API child in this node steers the holistic tests
  // toward EFFECT assertions (prompt + every emitted TEST item's spec body).
  const anyOperational = storySpecs.some((s) => s.operational === true);

  // ----- Stage 5: build prompt + call the LLM -----
  const chatContext: ChatContext = {
    workItem: {
      id: node.nodeWorkItemId ?? node.nodeBookItemId,
      title: node.nodeTitle,
      type: node.level,
      description: node.nodeDescription ?? '',
    },
  };
  const systemPrompt = buildHolisticTestPlanningPrompt(
    chatContext,
    storySpecs,
    testStrategy,
    node.level,
  );
  const userPrompt =
    `Review the ${node.level === 'epic' ? "epic's features" : "feature's stories"} above and define the ` +
    `cross-cutting integration and end-to-end tests they imply. Respond with VALID JSON ONLY per the ` +
    `system prompt's RESPONSE FORMAT. Return an EMPTY testPlan if no cross-cutting tests are warranted.`;

  let testPlan: HolisticTestDefinition[] = [];
  try {
    const { content } = await callLlm({
      systemPrompt,
      userPrompt,
      projectId,
      nodeBookItemId,
    });
    testPlan = parseHolisticTestPlan(content);
  } catch (e) {
    // A failed LLM call yields an empty plan (no items) -- the caller still
    // gets the warning payload. NEVER abort.
    logger.warn('Holistic review LLM call failed; returning empty plan', {
      projectId,
      nodeBookItemId,
      error: e instanceof Error ? e.message : String(e),
    });
    testPlan = [];
  }

  console.log(
    `[diag-gateway] holistic_test_definitions llm_result ` +
      `projectId=${projectId} nodeId=${nodeBookItemId} testPlan=${testPlan.length}`,
  );

  const result: HolisticTestDefinitionsResult = {
    level: node.level,
    nodeBookItemId,
    nodeWorkItemId: node.nodeWorkItemId,
    testPlan,
    skippedChildren: skipped,
    specCompleteChildCount: specComplete.length,
    createdTestItems: [],
    failedTestItems: [],
    emptyPlan: testPlan.length === 0,
  };

  // ----- Stage 6: empty-plan short-circuit (D2 -- no fabrication) -----
  if (testPlan.length === 0) {
    console.log(
      `[diag-gateway] holistic_test_definitions review_completed ` +
        `projectId=${projectId} nodeId=${nodeBookItemId} created=0 failed=0 emptyPlan=true`,
    );
    return result;
  }

  // ----- Stage 7: per-test creation loop (R-12 isolation) -----
  const sequenceBase = computeTestSequenceBase(node.children);
  for (let i = 0; i < testPlan.length; i++) {
    const test = testPlan[i];
    const sequenceOrder = sequenceBase + i;
    console.log(
      `[diag-gateway] holistic_test_definitions test_item_started ` +
        `projectId=${projectId} nodeId=${nodeBookItemId} index=${i} type=${test.type}`,
    );
    try {
      await createOneTestItem({
        input,
        node,
        test,
        sequenceOrder,
        testStrategy,
        operational: anyOperational,
        projectParentFolder,
        deps: { createTestItem, persistSpecRow, putImplementState },
        result,
      });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      result.failedTestItems.push({ index: i, title: test.title, type: test.type, reason });
      console.warn(
        `[diag-gateway] holistic_test_definitions test_item_failed ` +
          `projectId=${projectId} nodeId=${nodeBookItemId} index=${i} reason=${reason}`,
      );
    }
  }

  console.log(
    `[diag-gateway] holistic_test_definitions review_completed ` +
      `projectId=${projectId} nodeId=${nodeBookItemId} ` +
      `created=${result.createdTestItems.length} failed=${result.failedTestItems.length} emptyPlan=false`,
  );

  return result;
}

/**
 * Create ONE TEST work item: blob item + work_item row (D3), spec row (D6),
 * implement-state.json (D6). Pushes the created-item summary onto `result`.
 * Throws on a hard failure (work-item create) so the caller records an isolated
 * per-test failure; the spec-row + implement-state writes are best-effort and
 * recorded as `specPersisted` / `implementStateWritten` flags on the summary.
 */
async function createOneTestItem(args: {
  input: RunHolisticTestDefinitionsInput;
  node: LoadedHolisticNode;
  test: HolisticTestDefinition;
  sequenceOrder: number;
  testStrategy: string | null;
  /** D6: TRUE when any reviewed child is operational / non-API (effect steering). */
  operational: boolean;
  projectParentFolder: string | null;
  deps: {
    createTestItem: TestItemCreator;
    persistSpecRow: PersistBatchFn;
    putImplementState: ImplementStatePutter;
  };
  result: HolisticTestDefinitionsResult;
}): Promise<void> {
  const { input, node, test, sequenceOrder, testStrategy, operational, projectParentFolder, deps, result } =
    args;
  const { projectId, bookOfWorkId } = input;

  // ----- D6: assemble + validate the spec body BEFORE creating the item, so a
  // malformed body fails fast and never leaves an item without a spec. The
  // `operational` flag steers the body toward EFFECT assertions. -----
  const specText = assembleHolisticTestSpecBody(test, node.nodeTitle, node.level, testStrategy, operational);
  const validated = buildValidatedHolisticSpecResponse(specText);

  // ----- D3: create the work_item row + append the blob item (atomic) -----
  const description =
    `Cross-cutting ${test.type} test defined by the holistic review of ` +
    `${node.level} "${node.nodeTitle}". ${test.description}`;
  const created = await deps.createTestItem({
    projectId,
    bookOfWorkId,
    parentBookItemId: node.nodeBookItemId,
    parentWorkItemId: node.nodeWorkItemId,
    title: test.title,
    description,
    sequenceOrder,
  });

  // ----- D6: persist the spec-gen row keyed on the TEST item's work_item_id -----
  let specPersisted = false;
  const row: MigrationStorySpecGenerationDto = {
    projectId,
    workItemId: created.workItemId,
    bookOfWorkId,
    bookItemId: created.bookItemId,
    status: 'generated',
    confidence: validated.confidence,
    generatedSpecText: validated.specText,
    warningsJson: [],
    evidenceRefsJson: [],
    generatedAt: new Date().toISOString(),
    generationAttemptNumber: 1,
    createdByTask: TASK_ID,
    // The integration/E2E definitions live here (free-form JSONB, not the
    // validator-constrained tests[]).
    structuredTestsJson: [
      { title: test.title, description: test.description, type: test.type },
    ],
    coveredEndpointIds: [],
  };
  try {
    const persistResult = await deps.persistSpecRow(projectId, bookOfWorkId, [row]);
    specPersisted = (persistResult.persistedCount ?? 0) > 0;
    if (Array.isArray(persistResult.perStoryResults)) {
      const persisted = persistResult.perStoryResults.find(
        (r) => r.workItemId === created.workItemId,
      );
      if (persisted && persisted.id) row.id = persisted.id;
    }
  } catch (e) {
    logger.warn('holistic TEST-item spec-row persist failed (non-blocking)', {
      projectId,
      workItemId: created.workItemId,
      error: e instanceof Error ? e.message : String(e),
    });
    specPersisted = false;
  }

  // ----- D6: write implement-state.json (best-effort, isolated) -----
  let implementStateWritten = false;
  if (projectParentFolder) {
    try {
      const planner = buildHolisticPlannerResponse(test);
      const testPlanner = buildHolisticTestPlannerResponse(test);
      const state = buildPersistedImplementStateLiteral(planner, testPlanner);
      const body: ImplementStatePutBody = {
        projectId,
        featureId: created.workItemId,
        projectParentFolder,
        featureTitle: test.title,
        state,
      };
      await deps.putImplementState(body);
      implementStateWritten = true;
    } catch (e) {
      logger.warn('holistic TEST-item implement-state write failed (non-blocking)', {
        projectId,
        workItemId: created.workItemId,
        error: e instanceof Error ? e.message : String(e),
      });
      implementStateWritten = false;
    }
  }

  const summary: CreatedTestItem = {
    workItemId: created.workItemId,
    bookItemId: created.bookItemId,
    title: test.title,
    type: test.type,
    sequenceOrder,
    specPersisted,
    implementStateWritten,
  };
  result.createdTestItems.push(summary);

  console.log(
    `[diag-gateway] holistic_test_definitions test_item_created ` +
      `projectId=${projectId} nodeId=${node.nodeBookItemId} workItemId=${created.workItemId} ` +
      `bookItemId=${created.bookItemId} seq=${sequenceOrder} ` +
      `specPersisted=${specPersisted} implementStateWritten=${implementStateWritten}`,
  );
}

// Re-export for the route layer + tests.
export type { SpecGenerationResult };
