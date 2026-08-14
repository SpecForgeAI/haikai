/**
 * Spec-generation PREFLIGHT — the one readiness function (Phase 0, 2026-07-20).
 *
 * Runs the generator's OWN first half for every story in a book and stops
 * before the LLM, so the plan screen's readiness chip and the batch generator
 * agree BY CONSTRUCTION (the user principle: test a function's inputs before
 * running it — never say "ready" in one place and "missing inputs" in another).
 *
 * Routing mirrors `runShapeSpecGenerationBatchInner` exactly, in the same
 * precedence order:
 *   1. DB-pack verbatim carriage  — `runDbPackSpecCarriage` (deterministic,
 *      LLM-free): the spec text is discarded; status + missingInputs kept.
 *   2. Code carriage (incl. manual-gate) — `runCodeSpecCarriage`, same
 *      treatment. Manual-gate stories are always ready (deterministic text).
 *   3. Seed-build-files — deterministic application-bootstrap carriage
 *      (2026-08-14): ready iff the confirmed target manifest resolves.
 *      Manual adds — description-grounded: the LLM path relaxes the
 *      insufficient-context short-circuit, so preflight is ready.
 *   4. Everything else — the AMS focused-context resolver +
 *      `detectInsufficientContext`, the exact pre-LLM check the batch runs.
 *      Unsaved stories (no workItemId) report `save_required` instead.
 *
 * Fail-soft per story: a read failure marks THAT story not-ready with the
 * error as a missing input; it never aborts the book's preflight.
 */
import { logger } from './logger';
import {
  LoadedBookOfWorkItem,
  MigrationStorySpecGenerationDto,
  SHAPE_SPEC_CONTEXT_TYPES,
  SpecContextFetcher,
  BookOfWorkLoader,
  defaultLoadBookOfWork,
  detectInsufficientContext,
  isManualAdd,
} from './migrationShapeSpecGenerationHandler';
import { fetchMigrationSpecContext } from './migrationSpecContextClient';
import {
  isDbPackReviewStory,
  runDbPackReviewPreflight,
  defaultFetchPackTranslations,
  plannerDeclaredMissing,
  type FetchPackTranslationsFn,
} from './migrationDbPackReviewRoute';
import { CODE_PREREQUISITE_TAG } from './migrationCodeStreamPlanner';
import {
  isDbPackCarriageStory,
  runDbPackSpecCarriage,
  defaultFetchPackFiles,
  FetchPackFilesFn,
} from './migrationDbPackSpecCarriage';
import {
  isCodeCarriageStory,
  isCodeFoundationStory,
  isManualGateCarriageStory,
  runCodeSpecCarriage,
  defaultFetchCodeSpecFacts,
  RunCodeSpecCarriageDeps,
} from './migrationCodeSpecCarriage';
import {
  isSeedBuildFilesStory,
  resolveSeedBuildFilesEnrichment,
  SeedBuildFilesEnrichment,
  SeedBuildFilesSource,
} from './migrationSeedBuildFilesEnrichment';
import { productionSeedBuildFilesSource } from './migrationSeedBuildFilesProducer';
import { runScaffoldSpecCarriage } from './migrationScaffoldSpecCarriage';

/** How the story would generate — the batch loop's routing, named. */
export type SpecPreflightRoute =
  | 'db_pack'
  | 'db_pack_review'
  | 'manual_gate'
  | 'code_facts'
  | 'scaffold'
  | 'description'
  | 'prerequisite'
  | 'resolver';

export interface SpecPreflightRow {
  book_item_id: string;
  work_item_id: string | null;
  title: string;
  route: SpecPreflightRoute;
  ready: boolean;
  missing_inputs: Array<Record<string, unknown>>;
  /** Optional operator hint (e.g. `save_required` for unsaved resolver stories). */
  note: string | null;
}

export interface SpecPreflightDeps {
  loadBookOfWork?: BookOfWorkLoader;
  fetchPackFiles?: FetchPackFilesFn;
  fetchCodeSpecFacts?: RunCodeSpecCarriageDeps['fetchCodeSpecFacts'];
  fetchSpecContext?: SpecContextFetcher;
  /** Pack translation-queue read for the db_pack_review route (Spec 2026-07-23). */
  fetchPackTranslations?: FetchPackTranslationsFn;
  /**
   * Scaffold route (2026-08-14): the SAME confirmed-manifest source the batch
   * uses — the seed_build_files story is ready iff the verbatim manifest block
   * resolves (its spec is deterministic; the decisions read is fail-soft and
   * never gates readiness).
   */
  seedBuildFilesSource?: SeedBuildFilesSource;
}

/** Minimal base row the carriage functions spread their result over. */
function baseRowFor(
  projectId: string,
  bookOfWorkId: string,
  story: LoadedBookOfWorkItem
): MigrationStorySpecGenerationDto {
  return {
    projectId,
    workItemId: story.workItemId ?? '',
    bookOfWorkId,
    bookItemId: story.id,
    status: 'failed',
  };
}

function carriageOutcome(
  row: MigrationStorySpecGenerationDto
): { ready: boolean; missing: Array<Record<string, unknown>> } {
  if (row.status === 'generated' || row.status === 'generated_with_warnings') {
    return { ready: true, missing: [] };
  }
  const missing = Array.isArray(row.missingInputsJson) ? row.missingInputsJson : [];
  if (missing.length > 0) return { ready: false, missing };
  return {
    ready: false,
    missing: [
      {
        input: 'carriage_failed',
        reason: row.errorMessage ?? `deterministic carriage returned ${row.status}`,
      },
    ],
  };
}

/**
 * Run the preflight for every story of a book. Read-only; NEVER calls the LLM.
 */
export async function runSpecPreflight(
  input: { projectId: string; bookOfWorkId: string },
  deps: SpecPreflightDeps = {}
): Promise<SpecPreflightRow[]> {
  const { projectId, bookOfWorkId } = input;
  const loadBook = deps.loadBookOfWork ?? defaultLoadBookOfWork;
  const fetchSpecContext = deps.fetchSpecContext ?? fetchMigrationSpecContext;
  const fetchCodeSpecFacts = deps.fetchCodeSpecFacts ?? defaultFetchCodeSpecFacts;

  // Memoise the pack-files read per packId — one AMS read per pack per call,
  // however many stories ride the same pack.
  const rawFetchPackFiles = deps.fetchPackFiles ?? defaultFetchPackFiles;
  const packFilesCache = new Map<string, ReturnType<FetchPackFilesFn>>();
  const memoFetchPackFiles: FetchPackFilesFn = (pid, packId) => {
    const key = `${pid}:${packId}`;
    let hit = packFilesCache.get(key);
    if (!hit) {
      hit = rawFetchPackFiles(pid, packId);
      packFilesCache.set(key, hit);
    }
    return hit;
  };

  // Same memoisation for the translation-queue read (db_pack_review route):
  // every per-kind review story of one pack shares a single AMS read.
  const rawFetchPackTranslations =
    deps.fetchPackTranslations ?? defaultFetchPackTranslations;
  const packTranslationsCache = new Map<string, ReturnType<FetchPackTranslationsFn>>();
  const memoFetchPackTranslations: FetchPackTranslationsFn = (pid, packId) => {
    const key = `${pid}:${packId}`;
    let hit = packTranslationsCache.get(key);
    if (!hit) {
      hit = rawFetchPackTranslations(pid, packId);
      packTranslationsCache.set(key, hit);
    }
    return hit;
  };

  const bow = await loadBook(projectId, bookOfWorkId);
  const stories = bow.items.filter((i) => i.type === 'story');
  const rows: SpecPreflightRow[] = [];

  // Scaffold route: resolve the confirmed-manifest enrichment lazily, ONCE,
  // only when a seed_build_files story is present in the book.
  const seedSource = deps.seedBuildFilesSource ?? productionSeedBuildFilesSource;
  let seedEnrichmentPromise: Promise<SeedBuildFilesEnrichment> | null = null;
  const getSeedEnrichment = (): Promise<SeedBuildFilesEnrichment> => {
    if (!seedEnrichmentPromise) {
      seedEnrichmentPromise = resolveSeedBuildFilesEnrichment(seedSource, {
        projectId,
        bookOfWorkId,
        targetArchitectureId: bow.targetArchitectureId ?? null,
      });
    }
    return seedEnrichmentPromise;
  };

  for (const story of stories) {
    const mk = (
      route: SpecPreflightRoute,
      ready: boolean,
      missing: Array<Record<string, unknown>> = [],
      note: string | null = null
    ): SpecPreflightRow => ({
      book_item_id: story.id,
      work_item_id: story.workItemId ?? null,
      title: story.title,
      route,
      ready,
      missing_inputs: missing,
      note,
    });

    try {
      // 1) DB-pack verbatim carriage.
      if (isDbPackCarriageStory(story)) {
        const row = await runDbPackSpecCarriage({
          projectId,
          story,
          baseRow: baseRowFor(projectId, bookOfWorkId, story),
          fetchPackFiles: memoFetchPackFiles,
        });
        const { ready, missing } = carriageOutcome(row);
        rows.push(mk('db_pack', ready, missing));
        continue;
      }

      // 1b) DB-pack HUMAN-PROCEDURE stories (Spec 2026-07-23): pack-provenance
      // tagged but carrying no verbatim file payload (review gates, jobs
      // re-homing). Pre-fix these fell through to the generic resolver, which
      // demanded API-plane inputs (SOAP findings / IaC refs / source
      // capability) that do not exist for a DB review story — blocking a story
      // whose translation queue was fully approved. Readiness here is the
      // queue itself, with the planner's own predicate + vocabulary.
      if (isDbPackReviewStory(story)) {
        const verdict = await runDbPackReviewPreflight({
          projectId,
          story,
          fetchPackTranslations: memoFetchPackTranslations,
        });
        rows.push(mk('db_pack_review', verdict.ready, verdict.missing, verdict.note));
        continue;
      }

      // 2) Code carriage (manual-gate first — always deterministic text).
      if (isCodeCarriageStory(story)) {
        if (isManualGateCarriageStory(story)) {
          rows.push(mk('manual_gate', true, [], 'human/wizard work item'));
          continue;
        }
        const row = await runCodeSpecCarriage({
          projectId,
          currentArchitectureId: bow.currentArchitectureId ?? '',
          story,
          baseRow: baseRowFor(projectId, bookOfWorkId, story),
          deps: { fetchCodeSpecFacts },
        });
        const { ready, missing } = carriageOutcome(row);
        rows.push(mk('code_facts', ready, missing));
        continue;
      }

      // 2b) FOUNDATION stories (Spec 2026-07-23): code-provenance tagged with
      // ZERO endpoints — cross-cutting planner-authored intent. Pre-fix they
      // fell to the resolver and blocked on API-plane inputs (SOAP/IaC/
      // capability) a cross-cutting story never has. Description-grounded.
      if (isCodeFoundationStory(story)) {
        rows.push(
          mk('description', true, [], 'planner-authored foundation — description-grounded generation')
        );
        continue;
      }

      // 2c) Prerequisite stories (Spec 2026-07-23): planner-declared blocked
      // gates. They stay blocked — but with the planner's OWN reasons, not the
      // resolver's irrelevant trio. No resolver call.
      if ((story.tags ?? []).includes(CODE_PREREQUISITE_TAG)) {
        rows.push(
          mk(
            'prerequisite',
            false,
            plannerDeclaredMissing(story),
            'planner-declared prerequisite — resolve the gap, then re-check'
          )
        );
        continue;
      }

      // 2d) SCAFFOLD story (2026-08-14): deterministic bootstrap carriage —
      // ready iff the confirmed target build manifest resolves (the batch's
      // exact gate; the decisions read is fail-soft and never blocks).
      if (isSeedBuildFilesStory(story)) {
        const enrichment = await getSeedEnrichment();
        const row = runScaffoldSpecCarriage({
          story,
          baseRow: baseRowFor(projectId, bookOfWorkId, story),
          enrichment,
          decisions: [],
        });
        const { ready, missing } = carriageOutcome(row);
        rows.push(
          mk('scaffold', ready, missing, 'deterministic application-bootstrap carriage')
        );
        continue;
      }

      // 3) Description-grounded (manual adds).
      if (isManualAdd(story)) {
        rows.push(mk('description', true, [], 'description-grounded generation'));
        continue;
      }

      // 4) Resolver path — the generic focused-context check.
      if (!story.workItemId) {
        rows.push(
          mk(
            'resolver',
            false,
            [
              {
                input: 'save_required',
                reason:
                  'Save this story to the backlog first — the focused-context ' +
                  'resolver needs its WorkItem.',
              },
            ],
            'save_required'
          )
        );
        continue;
      }
      const ctx = await fetchSpecContext({
        projectId,
        bookOfWorkId,
        bookItemId: story.id,
        workItemId: story.workItemId,
        currentArchitectureId: bow.currentArchitectureId,
        targetArchitectureId: bow.targetArchitectureId ?? null,
        contextTypes: [...SHAPE_SPEC_CONTEXT_TYPES],
        pass: 1,
        sourceCapabilityId: story.sourceCapabilityId ?? null,
      });
      const missing = detectInsufficientContext(ctx);
      rows.push(mk('resolver', missing === null, missing ?? []));
    } catch (e) {
      // Fail-soft: this story reports not-ready; the book's preflight goes on.
      const message = e instanceof Error ? e.message : String(e);
      logger.warn('Spec preflight story check failed (fail-soft)', {
        projectId,
        bookOfWorkId,
        bookItemId: story.id,
        error: message,
      });
      rows.push(
        mk(
          'resolver',
          false,
          [{ input: 'preflight_error', reason: message.slice(0, 300) }],
          'preflight_error'
        )
      );
    }
  }

  console.log(
    `[diag-gateway] pm_migration_spec_preflight completed projectId=${projectId} ` +
      `bookOfWorkId=${bookOfWorkId} stories=${rows.length} ` +
      `ready=${rows.filter((r) => r.ready).length}`
  );
  return rows;
}
