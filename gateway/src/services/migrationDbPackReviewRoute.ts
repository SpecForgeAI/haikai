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

/**
 * Deterministic spec text for a pack human-procedure story (Spec 2026-07-23,
 * follow-up). These stories NEVER go to the LLM: generating them
 * description-grounded produced warnings the operator could not address
 * (missing_decision_citation demanding api.* codes of a DB review story;
 * NO_CAPTURED_DECISIONS / invented codes for deliberately-absent context) and
 * a meaningless `low` confidence. The planner-authored description +
 * acceptance criteria ARE the procedure — mirror the manual-gate carriage:
 * deterministic text, status `generated`, confidence `high`, no warnings.
 */
export function buildDbPackReviewSpecText(story: {
  title: string;
  description?: string | null;
  acceptanceCriteria?: string[] | null;
}): string {
  const lines: string[] = [];
  lines.push(`/agent-os:shape-spec ${story.title}`);
  lines.push('');
  lines.push('## Pack review work item');
  lines.push('');
  lines.push(
    'This story is HUMAN review work over the DB migration pack — the ' +
      'execution driver never dispatches it to the implement-verify service. ' +
      'It completes when its gate condition holds.'
  );
  lines.push('');
  lines.push('## Procedure');
  lines.push('');
  lines.push(story.description || 'Work the pack translation queue for this story.');
  lines.push('');
  lines.push('## Gate condition');
  lines.push('');
  if (story.acceptanceCriteria && story.acceptanceCriteria.length > 0) {
    for (const criterion of story.acceptanceCriteria) {
      lines.push(`- ${criterion}`);
    }
  } else {
    lines.push(
      '- Every item in this story\'s pack queue is approved, rejected with a ' +
        'disposition, or re-dispositioned.'
    );
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * The planner-declared gaps for a `provenance:prerequisite` story, in the
 * missing-inputs shape the preflight/spec rows carry. These stories are MEANT
 * to be blocked — but pre-fix they fell into the generic resolver and showed
 * ITS irrelevant trio (SOAP/IaC/capability) instead of the planner's own
 * reason (e.g. "code discovery has not run"). Falls back to an honest generic
 * line when the blob carries no planner reasons.
 */
export function plannerDeclaredMissing(story: {
  plannerMissingInputs?: Array<string | Record<string, unknown>> | null;
}): Array<Record<string, unknown>> {
  const raw = story.plannerMissingInputs ?? [];
  const out: Array<Record<string, unknown>> = [];
  for (const entry of raw) {
    if (typeof entry === 'string' && entry.trim().length > 0) {
      out.push({ input: 'prerequisite', reason: entry.trim() });
    } else if (entry && typeof entry === 'object') {
      out.push({ input: 'prerequisite', ...entry });
    }
  }
  if (out.length === 0) {
    out.push({
      input: 'prerequisite',
      reason:
        'Planner-declared prerequisite gap — resolve the upstream input this ' +
        'story names, then re-check readiness.',
    });
  }
  return out;
}

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
