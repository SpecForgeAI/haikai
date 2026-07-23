/**
 * DB-pack review-story readiness route (Spec 2026-07-23).
 *
 * The DB-pack planner emits HUMAN-PROCEDURE stories alongside its file-carriage
 * stories: "Review & approve <kind> translation drafts", "Re-home scheduled
 * jobs", and any pack story with no verbatim file payload. These carry the
 * pack-provenance tag but NOT the `seed_db_pack_files` tag/selectors, so they
 * matched none of the preflight's routes and fell through to the GENERIC
 * focused-context resolver — which demanded API-plane inputs (SOAP findings,
 * IaC refs, source capability) that simply do not exist for a DB review story.
 * Result: a story whose translation queue was FULLY APPROVED (29/29) showed
 * "Blocked — 3 missing inputs" live and `insufficient_context` on generation,
 * while its baked readiness correctly said ready_for_spec.
 *
 * This module classifies those stories and computes the readiness that is
 * actually true for them: the state of the pack's TRANSLATION QUEUE (the same
 * source, same disposition/review_status predicate, and same vocabulary the
 * planner bakes at generation time — the live check and the baked chip can
 * only differ by queue drift, never by vocabulary). Generation for these
 * stories is DESCRIPTION-GROUNDED (the planner-authored description +
 * acceptance criteria ARE the procedure), never the discovered-context
 * resolver.
 */
import { getConfig } from '../config';
import { logger } from './logger';
import {
  PACK_PROVENANCE_TAG,
  SEED_DB_PACK_FILES_TAG,
  type PackTranslationRow,
} from './migrationDbPackPlanner';

/** The structural slice of a book item this route reads. */
export interface DbPackStoryLike {
  id: string;
  tags?: string[] | null;
  packId?: string | null;
  packFilePaths?: string[] | null;
  packFilePathPrefixes?: string[] | null;
}

/**
 * A pack-authored story with NO verbatim file payload: pack-provenance tagged,
 * but not a `seed_db_pack_files` carriage story. These are the planner's
 * human-procedure stories (review gates, jobs re-homing) and must never route
 * through the generic focused-context resolver.
 */
export function isDbPackReviewStory(story: DbPackStoryLike): boolean {
  const tags = story.tags ?? [];
  return tags.includes(PACK_PROVENANCE_TAG) && !tags.includes(SEED_DB_PACK_FILES_TAG);
}

/**
 * The translation-queue kind a review story tracks, parsed from the planner's
 * deterministic story id (`${epic.id}-s-${kind}-review`). Null for pack
 * stories that are not per-kind review gates (e.g. jobs re-homing).
 */
export function reviewKindFromStoryId(storyId: string): string | null {
  const m = /-s-(.+)-review$/.exec(storyId);
  return m ? m[1] : null;
}

/** The packId a pack-authored story rides, from its `pack:<id>` tag. */
export function packIdFromTags(tags: string[] | null | undefined): string | null {
  const tag = (tags ?? []).find((t) => t.startsWith('pack:'));
  const id = tag ? tag.slice('pack:'.length).trim() : '';
  return id.length > 0 ? id : null;
}

/**
 * Outstanding drafts for one kind — the EXACT predicate the planner uses to
 * bake `needs_user_decision` (`disposition === 'translate'` and review_status
 * unreviewed/needs_rework), so live and baked readiness share one meaning.
 */
export function countOutstandingTranslations(
  rows: ReadonlyArray<PackTranslationRow>,
  kind: string,
): number {
  return rows.filter(
    (t) =>
      t.kind === kind &&
      t.disposition === 'translate' &&
      (t.review_status === 'unreviewed' || t.review_status === 'needs_rework'),
  ).length;
}

export type FetchPackTranslationsFn = (
  projectId: string,
  packId: string,
) => Promise<PackTranslationRow[]>;

/** One AMS read: the pack's translation queue rows. */
export const defaultFetchPackTranslations: FetchPackTranslationsFn = async (
  projectId,
  packId,
) => {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const url =
    `${baseUrl}/api/projects/${encodeURIComponent(projectId)}` +
    `/db-migration-packs/${encodeURIComponent(packId)}/translations`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`AMS pack translations fetch failed: HTTP ${response.status} ${text}`);
  }
  const rows = (await response.json()) as PackTranslationRow[];
  return Array.isArray(rows) ? rows : [];
};

export interface DbPackReviewVerdict {
  ready: boolean;
  missing: Array<Record<string, unknown>>;
  note: string | null;
}

/**
 * Live readiness for a pack-authored human-procedure story.
 *
 * - Per-kind review gate (`...-s-<kind>-review` + a `pack:<id>` tag): read the
 *   pack's translation queue; ready IFF no outstanding draft of that kind,
 *   otherwise blocked with the honest count. A queue read failure blocks with
 *   the fetch error (re-runnable via "Re-check readiness") rather than
 *   guessing.
 * - Any other pack-authored story (jobs re-homing, payload-less applies):
 *   ready — the planner-authored description is the procedure; its baked
 *   readiness reasons remain visible as provenance.
 */
export async function runDbPackReviewPreflight(args: {
  projectId: string;
  story: DbPackStoryLike;
  fetchPackTranslations?: FetchPackTranslationsFn;
}): Promise<DbPackReviewVerdict> {
  const { projectId, story } = args;
  const fetchTranslations = args.fetchPackTranslations ?? defaultFetchPackTranslations;

  const kind = reviewKindFromStoryId(story.id);
  const packId = packIdFromTags(story.tags);
  if (!kind || !packId) {
    return {
      ready: true,
      missing: [],
      note: 'pack-authored story — description-grounded generation',
    };
  }

  let rows: PackTranslationRow[];
  try {
    rows = await fetchTranslations(projectId, packId);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.warn('db_pack_review preflight: translations read failed', {
      projectId,
      packId,
      storyId: story.id,
      error: message,
    });
    return {
      ready: false,
      missing: [
        {
          input: 'pack_translations',
          reason: `Could not read the pack translation queue: ${message.slice(0, 200)}`,
        },
      ],
      note: null,
    };
  }

  const outstanding = countOutstandingTranslations(rows, kind);
  if (outstanding > 0) {
    return {
      ready: false,
      missing: [
        {
          input: 'translation_approvals',
          reason:
            `${outstanding} unapproved translation draft(s) — review them in the ` +
            'Schema migration tab → Translations.',
        },
      ],
      note: null,
    };
  }
  return {
    ready: true,
    missing: [],
    note: 'translation queue clear — description-grounded generation',
  };
}
