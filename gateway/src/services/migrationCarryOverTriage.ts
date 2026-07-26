/**
 * Carry-over triage — LLM-drafted dispositions for un-accounted
 * behaviour-bearing carry-over items (2026-07-26,
 * agent-os/planning/2026-07-26-carry-over-triage-build-plan.md, Item 2).
 *
 * The user's ruling: the 37 unaccounted items "should either create new specs
 * OR be dismissed", and a deterministic-only approach won't cut it — so the
 * BOOKKEEPING stays deterministic while ALL content decisions are LLM-drafted
 * and human-approved. Nothing here auto-applies: `runCarryOverTriage` produces
 * SUGGESTIONS the review screen renders for editing/approval, and
 * `applyTriageSuggestions` executes only what the human approved, through the
 * SAME Item-1 action functions the manual buttons use.
 *
 * The four dispositions (all drafted, all human-approved):
 *   - `cite`        — an existing story's text ALREADY demonstrably covers the
 *                     item; link only (findings only).
 *   - `amend_story` — the item is in story X's scope but X doesn't address it:
 *                     drafted description update + ADDED acceptance criteria;
 *                     applying cites the finding and marks the spec STALE.
 *                     The prompt PREFERS amend over cite when in doubt (user
 *                     ruling: better to make the story really deal with it).
 *   - `new_story`   — drafted title/description/AC/workstream grounded in the
 *                     item's evidence; the description must EMBED the item's
 *                     essence (spec-gen grounds on it, not on reference
 *                     plumbing).
 *   - `dismiss`     — with a drafted, concrete reason.
 *
 * Deterministic validation (per suggestion, after the LLM):
 *   - disposition ∈ the four; cite/amend are FINDING-only (a capability's
 *     citation is the source_capability_id story mint, not a finding ref);
 *   - cite/amend target must exist in the story index;
 *   - amend must draft SOMETHING (description or criteria);
 *   - new_story must draft title + description; workstream ∈ the known
 *     vocabulary;
 *   - dismiss must draft a non-empty reason.
 *   Any violation BLANKS the disposition (null) with a `validationNote` — the
 *   review UI renders "needs manual choice"; nothing is silently coerced.
 *
 * The re-draft path (`draftSingleSuggestion` with `forcedDisposition` +
 * `guidance`) is the user's requirement: free-text guidance flows INTO the
 * drafting prompt when they choose/redirect a disposition (amend AND
 * new_story get it — same drafting shape).
 */

import { logger } from './logger';
import { getLlmClient } from './llmClient';
import { extractJson } from './plannerResponseValidator';
import { MIGRATION_BOOK_OF_WORK_WORKSTREAMS } from './generatedMigrationBookOfWorkSchema';
import { CarryOverItemDetail } from './migrationCarryOverCoverageReads';
import {
  CarryOverActionDeps,
  defaultCarryOverActionDeps,
  citeFindingIntoStory,
  amendStoryForFinding,
  createStoryForFinding,
  citeCapability,
  dismissCarryOverItem,
} from './migrationCarryOverActions';

// ============================================================================
// Types
// ============================================================================

export type TriageDisposition = 'cite' | 'amend_story' | 'new_story' | 'dismiss';

const ALL_DISPOSITIONS: ReadonlySet<string> = new Set([
  'cite',
  'amend_story',
  'new_story',
  'dismiss',
]);

const KNOWN_WORKSTREAMS: ReadonlySet<string> = new Set(
  MIGRATION_BOOK_OF_WORK_WORKSTREAMS
);

/** One cite/amend target — a STORY of the plan (compact index for the prompt). */
export interface TriageStoryIndexEntry {
  /** The blob item id (the AMS item-patch target). */
  bookItemId: string;
  title: string;
  /** Trimmed description (the prompt budget is finite). */
  description: string;
  workstream: string | null;
}

/** One un-accounted item to triage. */
export interface TriageItemInput {
  id: string;
  kind: 'capability' | 'finding';
  detail: CarryOverItemDetail | null;
}

/** The drafted amendment payload (amend_story). */
export interface TriageDraftAmendment {
  /** The FULL amended description (null = AC-only amendment). */
  description: string | null;
  appendAcceptanceCriteria: string[];
}

/** The drafted story payload (new_story). */
export interface TriageDraftStory {
  title: string;
  description: string;
  workstream: string;
  acceptanceCriteria: string[];
}

/** One reviewed suggestion (the FE's editable row). */
export interface TriageSuggestion {
  itemId: string;
  kind: 'capability' | 'finding';
  /** Null = the LLM's choice failed validation — needs a manual choice. */
  disposition: TriageDisposition | null;
  /** The cite/amend target (findings only). */
  targetBookItemId: string | null;
  rationale: string;
  draftAmendment: TriageDraftAmendment | null;
  draftStory: TriageDraftStory | null;
  dismissReason: string | null;
  /** Why validation blanked/adjusted the LLM's choice (null when clean). */
  validationNote: string | null;
}

/** The injectable LLM seam (mirrors the expansion handler's caller shape). */
export type TriageLlmCaller = (args: {
  systemPrompt: string;
  userPrompt: string;
  projectId: string;
  label: string;
}) => Promise<{ content: string }>;

export const defaultTriageLlmCaller: TriageLlmCaller = async ({
  systemPrompt,
  userPrompt,
  projectId,
  label,
}) => {
  const client = getLlmClient();
  const response = await client.sendChatRequest(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    `carry-over-triage-${label}-${Date.now()}`,
    `carry-over-triage-${projectId}`,
    { jsonMode: true }
  );
  return { content: response.content ?? '' };
};

// ============================================================================
// Prompt assembly
// ============================================================================

const MAX_STORY_DESCRIPTION_CHARS = 320;
const MAX_STORIES_IN_INDEX = 120;

function trimTo(text: string | null | undefined, max: number): string {
  const t = (text ?? '').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

/** The system prompt — the triage doctrine, shared by batch + re-draft. */
export function buildTriageSystemPrompt(): string {
  return [
    'You triage BEHAVIOUR-BEARING carry-over items from a legacy-system discovery',
    '(Sybase + Java API estate migrating like-for-like to PostgreSQL + a modern Java service).',
    'Each item is a discovered capability or finding that the migration plan does not yet',
    'account for. Non-API behaviour has NO automated reconciliation backstop — if it is',
    'silently dropped, nothing downstream catches it — so EVERY item must be consciously',
    'CITED into a story or DISMISSED with a reason before the service plane may start.',
    '',
    'For each item choose EXACTLY ONE disposition:',
    '  - "cite":        an existing story\'s CURRENT text already demonstrably covers the',
    '                   item (not vaguely related — actually covers the behaviour). Link only.',
    '  - "amend_story": the item belongs in an existing story\'s scope but that story\'s text',
    '                   does NOT address it. Draft the story\'s FULL amended description',
    '                   (fold the item\'s behaviour in; keep everything the story already',
    '                   promises) plus ADDED acceptance criteria covering the item.',
    '  - "new_story":   no existing story is the right home. Draft a self-contained story:',
    '                   title, description, workstream, acceptance criteria. The description',
    '                   must EMBED the item\'s essential behaviour and evidence — the spec',
    '                   generator grounds ONLY on the description, never on links.',
    '  - "dismiss":     the item genuinely needs no migration work (dead code, superseded by',
    '                   the target platform, out of scope by decision). Draft a concrete,',
    '                   reviewable reason — never a generic one.',
    '',
    'Doctrine:',
    '  - When torn between cite and amend_story, PREFER amend_story: a story that merely',
    '    brushes the item is not accounting for it.',
    '  - CAPABILITIES may only use new_story or dismiss (their citation mechanism is a',
    '    minted capability story, not a text link).',
    '  - Dismiss is a last resort; behaviour-bearing items usually deserve work.',
    '',
    'Respond with STRICT JSON only (no markdown fence, no commentary):',
    '{',
    '  "disposition": "cite" | "amend_story" | "new_story" | "dismiss",',
    '  "target_book_item_id": "<story id>" | null,',
    '  "rationale": "<1-3 sentences: why this disposition>",',
    '  "draft_amendment": { "description": "<full amended text>" | null,',
    '                        "append_acceptance_criteria": ["..."] } | null,',
    '  "draft_story": { "title": "...", "description": "...",',
    '                    "workstream": "<one of the allowed workstreams>",',
    '                    "acceptance_criteria": ["..."] } | null,',
    '  "dismiss_reason": "<concrete reason>" | null',
    '}',
  ].join('\n');
}

/** The per-item user prompt (batch and re-draft share it; re-draft adds steering). */
export function buildTriageUserPrompt(params: {
  item: TriageItemInput;
  storyIndex: TriageStoryIndexEntry[];
  forcedDisposition?: TriageDisposition | null;
  guidance?: string | null;
}): string {
  const { item, storyIndex } = params;
  const detail = item.detail;
  const lines: string[] = [];
  lines.push(`ITEM TO TRIAGE (${item.kind}):`);
  lines.push(`- id: ${item.id}`);
  lines.push(`- title: ${detail?.title ?? '(untitled)'}`);
  if (detail?.summary) lines.push(`- summary: ${detail.summary}`);
  if (detail?.severity) lines.push(`- severity: ${detail.severity}`);
  if (detail?.category) lines.push(`- category: ${detail.category}`);
  if (item.kind === 'capability' && detail?.memberFindingCount != null) {
    lines.push(
      `- absorbs ${detail.memberFindingCount} member finding(s) — accounting for the capability accounts for them`
    );
  }
  lines.push('');
  if (item.kind === 'capability') {
    lines.push(
      'This is a CAPABILITY: allowed dispositions are "new_story" or "dismiss" ONLY.'
    );
  }
  lines.push('ALLOWED WORKSTREAMS (for draft_story.workstream):');
  lines.push(MIGRATION_BOOK_OF_WORK_WORKSTREAMS.join(', '));
  lines.push('');
  lines.push(`EXISTING STORIES (${storyIndex.length} — cite/amend targets):`);
  for (const s of storyIndex.slice(0, MAX_STORIES_IN_INDEX)) {
    lines.push(
      `- [${s.bookItemId}] "${s.title}"${s.workstream ? ` (${s.workstream})` : ''}: ${trimTo(
        s.description,
        MAX_STORY_DESCRIPTION_CHARS
      )}`
    );
  }
  if (storyIndex.length > MAX_STORIES_IN_INDEX) {
    lines.push(`… and ${storyIndex.length - MAX_STORIES_IN_INDEX} more (omitted).`);
  }
  if (params.forcedDisposition) {
    lines.push('');
    lines.push(
      `THE REVIEWER HAS CHOSEN the disposition "${params.forcedDisposition}" — do NOT` +
        ' change it; produce the best possible draft FOR that disposition.'
    );
  }
  if (params.guidance && params.guidance.trim() !== '') {
    lines.push('');
    lines.push('REVIEWER GUIDANCE (fold this into the draft):');
    lines.push(params.guidance.trim());
  }
  return lines.join('\n');
}

// ============================================================================
// Response parsing + deterministic validation
// ============================================================================

function parseLlmJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    const extracted = extractJson(content);
    if (!extracted) throw new Error('No JSON found in LLM response');
    return JSON.parse(extracted);
  }
}

function cleanStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string' && entry.trim() !== '') out.push(entry.trim());
  }
  return out;
}

/**
 * Turn the parsed LLM payload into a VALIDATED suggestion. Never throws for
 * content problems — a violation blanks the disposition with a note so the
 * review UI can render "needs manual choice". Pure; exported for tests.
 */
export function validateTriagePayload(
  item: TriageItemInput,
  storyIndex: TriageStoryIndexEntry[],
  payload: unknown
): TriageSuggestion {
  const base: TriageSuggestion = {
    itemId: item.id,
    kind: item.kind,
    disposition: null,
    targetBookItemId: null,
    rationale: '',
    draftAmendment: null,
    draftStory: null,
    dismissReason: null,
    validationNote: null,
  };
  if (!payload || typeof payload !== 'object') {
    return { ...base, validationNote: 'The model returned no usable JSON object.' };
  }
  const p = payload as Record<string, unknown>;
  const rationale = typeof p.rationale === 'string' ? p.rationale.trim() : '';
  base.rationale = rationale;

  const rawDisposition = typeof p.disposition === 'string' ? p.disposition.trim() : '';
  if (!ALL_DISPOSITIONS.has(rawDisposition)) {
    return {
      ...base,
      validationNote: `Unknown disposition '${rawDisposition || '(none)'}' — pick one manually.`,
    };
  }
  const disposition = rawDisposition as TriageDisposition;

  // Capabilities cannot cite/amend — their citation is the capability-story mint.
  if (item.kind === 'capability' && (disposition === 'cite' || disposition === 'amend_story')) {
    return {
      ...base,
      validationNote:
        `A capability cannot '${disposition}' (its citation is a minted capability story) — ` +
        'choose new_story or dismiss manually.',
    };
  }

  const storyIds = new Set(storyIndex.map((s) => s.bookItemId));
  const targetBookItemId =
    typeof p.target_book_item_id === 'string' && p.target_book_item_id.trim() !== ''
      ? p.target_book_item_id.trim()
      : null;

  if (disposition === 'cite' || disposition === 'amend_story') {
    if (!targetBookItemId || !storyIds.has(targetBookItemId)) {
      return {
        ...base,
        validationNote:
          `The suggested target story '${targetBookItemId ?? '(none)'}' does not exist — ` +
          'pick the target manually.',
      };
    }
  }

  if (disposition === 'amend_story') {
    const rawAmendment = p.draft_amendment as Record<string, unknown> | null | undefined;
    const description =
      rawAmendment && typeof rawAmendment.description === 'string' &&
      rawAmendment.description.trim() !== ''
        ? rawAmendment.description.trim()
        : null;
    const criteria = cleanStringList(rawAmendment?.append_acceptance_criteria);
    if (description === null && criteria.length === 0) {
      return {
        ...base,
        targetBookItemId,
        validationNote:
          'The amendment drafts no description change and no added criteria — draft it manually.',
      };
    }
    return {
      ...base,
      disposition,
      targetBookItemId,
      draftAmendment: { description, appendAcceptanceCriteria: criteria },
    };
  }

  if (disposition === 'new_story') {
    const rawStory = p.draft_story as Record<string, unknown> | null | undefined;
    const title =
      rawStory && typeof rawStory.title === 'string' ? rawStory.title.trim() : '';
    const description =
      rawStory && typeof rawStory.description === 'string' ? rawStory.description.trim() : '';
    const workstream =
      rawStory && typeof rawStory.workstream === 'string' ? rawStory.workstream.trim() : '';
    const criteria = cleanStringList(rawStory?.acceptance_criteria);
    if (title === '' || description === '') {
      return {
        ...base,
        validationNote: 'The drafted story is missing a title or description — draft it manually.',
      };
    }
    if (!KNOWN_WORKSTREAMS.has(workstream)) {
      return {
        ...base,
        validationNote:
          `The drafted workstream '${workstream || '(none)'}' is not in the allowed vocabulary — ` +
          'pick it manually.',
      };
    }
    return {
      ...base,
      disposition,
      draftStory: { title, description, workstream, acceptanceCriteria: criteria },
    };
  }

  if (disposition === 'dismiss') {
    const reason =
      typeof p.dismiss_reason === 'string' && p.dismiss_reason.trim() !== ''
        ? p.dismiss_reason.trim()
        : null;
    if (!reason) {
      return {
        ...base,
        validationNote: 'A dismissal needs a concrete reason — write one manually.',
      };
    }
    return { ...base, disposition, dismissReason: reason };
  }

  // cite — the link-only disposition (target already validated above).
  return { ...base, disposition, targetBookItemId };
}

// ============================================================================
// Batch triage + single re-draft
// ============================================================================

export interface RunTriageParams {
  projectId: string;
  bookId: string;
  items: TriageItemInput[];
  storyIndex: TriageStoryIndexEntry[];
}

/**
 * Draft ONE suggestion for one item (the batch loop + the re-draft route both
 * come through here). An LLM/transport failure yields a null-disposition
 * suggestion with the error in `validationNote` (fail-soft per item — one bad
 * call must not sink the batch).
 */
export async function draftSingleSuggestion(
  params: {
    projectId: string;
    item: TriageItemInput;
    storyIndex: TriageStoryIndexEntry[];
    forcedDisposition?: TriageDisposition | null;
    guidance?: string | null;
  },
  callLlm: TriageLlmCaller = defaultTriageLlmCaller
): Promise<TriageSuggestion> {
  try {
    const { content } = await callLlm({
      systemPrompt: buildTriageSystemPrompt(),
      userPrompt: buildTriageUserPrompt({
        item: params.item,
        storyIndex: params.storyIndex,
        forcedDisposition: params.forcedDisposition ?? null,
        guidance: params.guidance ?? null,
      }),
      projectId: params.projectId,
      label: params.item.id,
    });
    const payload = parseLlmJson(content);
    const suggestion = validateTriagePayload(params.item, params.storyIndex, payload);
    // A forced disposition is the REVIEWER'S choice: if the model drifted to a
    // different one, the drafts don't match the ask — blank it for re-review
    // rather than applying the wrong thing.
    if (
      params.forcedDisposition &&
      suggestion.disposition !== null &&
      suggestion.disposition !== params.forcedDisposition
    ) {
      return {
        ...suggestion,
        disposition: null,
        validationNote:
          `The model drafted '${suggestion.disposition}' but you asked for ` +
          `'${params.forcedDisposition}' — re-draft or fill it in manually.`,
      };
    }
    return suggestion;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown LLM error';
    logger.warn('[diag-gateway] carry_over_triage draft_failed', {
      projectId: params.projectId,
      itemId: params.item.id,
      error: message,
    });
    return {
      itemId: params.item.id,
      kind: params.item.kind,
      disposition: null,
      targetBookItemId: null,
      rationale: '',
      draftAmendment: null,
      draftStory: null,
      dismissReason: null,
      validationNote: `Drafting failed (${message}) — choose manually or retry.`,
    };
  }
}

/**
 * Run the triage over ALL un-accounted items — one LLM call per item,
 * SEQUENTIAL (the shared Azure rate-limit budget is precious and the batch is
 * a few dozen items). Returns suggestions in input order. NOTHING is applied.
 */
export async function runCarryOverTriage(
  params: RunTriageParams,
  callLlm: TriageLlmCaller = defaultTriageLlmCaller
): Promise<TriageSuggestion[]> {
  const suggestions: TriageSuggestion[] = [];
  for (const item of params.items) {
    suggestions.push(
      await draftSingleSuggestion(
        { projectId: params.projectId, item, storyIndex: params.storyIndex },
        callLlm
      )
    );
  }
  logger.info('[diag-gateway] carry_over_triage batch_drafted', {
    projectId: params.projectId,
    bookId: params.bookId,
    itemCount: params.items.length,
    needsManualChoice: suggestions.filter((s) => s.disposition === null).length,
  });
  return suggestions;
}

// ============================================================================
// Apply (approved suggestions only — sequential, fail-soft per item)
// ============================================================================

/** One approved suggestion as the FE sends it back (post-editing). */
export interface ApprovedSuggestion {
  itemId: string;
  kind: 'capability' | 'finding';
  disposition: TriageDisposition;
  targetBookItemId?: string | null;
  draftAmendment?: TriageDraftAmendment | null;
  draftStory?: TriageDraftStory | null;
  dismissReason?: string | null;
}

export interface ApplyTriageItemResult {
  itemId: string;
  disposition: TriageDisposition;
  ok: boolean;
  error: string | null;
}

export interface ApplyTriageParams {
  projectId: string;
  bookId: string;
  architectureId: string;
  suggestions: ApprovedSuggestion[];
  /** Item id -> detail (for the finding's run id + capability titles). */
  itemDetailById: Map<string, CarryOverItemDetail>;
}

/**
 * Apply the APPROVED suggestions sequentially through the SAME action
 * functions the manual buttons use. Fail-soft per item: a failure is recorded
 * and the batch continues (the coverage read afterwards shows the truth).
 */
export async function applyTriageSuggestions(
  params: ApplyTriageParams,
  deps: CarryOverActionDeps = defaultCarryOverActionDeps()
): Promise<ApplyTriageItemResult[]> {
  const results: ApplyTriageItemResult[] = [];
  for (const s of params.suggestions) {
    const detail = params.itemDetailById.get(s.itemId) ?? null;
    let outcome: { ok: boolean; error: string | null };
    try {
      outcome = await applyOne(params, s, detail, deps);
    } catch (error) {
      outcome = {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
    results.push({ itemId: s.itemId, disposition: s.disposition, ...outcome });
  }
  logger.info('[diag-gateway] carry_over_triage apply_complete', {
    projectId: params.projectId,
    bookId: params.bookId,
    applied: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
  });
  return results;
}

async function applyOne(
  params: ApplyTriageParams,
  s: ApprovedSuggestion,
  detail: CarryOverItemDetail | null,
  deps: CarryOverActionDeps
): Promise<{ ok: boolean; error: string | null }> {
  switch (s.disposition) {
    case 'cite': {
      if (s.kind !== 'finding') {
        return { ok: false, error: 'only findings can be cited onto an existing story' };
      }
      if (!s.targetBookItemId) {
        return { ok: false, error: 'cite needs a target story' };
      }
      const result = await citeFindingIntoStory(
        {
          projectId: params.projectId,
          bookId: params.bookId,
          bookItemId: s.targetBookItemId,
          findingId: s.itemId,
        },
        deps
      );
      return result.ok ? { ok: true, error: null } : { ok: false, error: result.error };
    }
    case 'amend_story': {
      if (s.kind !== 'finding') {
        return { ok: false, error: 'only findings can amend an existing story' };
      }
      if (!s.targetBookItemId) {
        return { ok: false, error: 'amend needs a target story' };
      }
      const result = await amendStoryForFinding(
        {
          projectId: params.projectId,
          bookId: params.bookId,
          bookItemId: s.targetBookItemId,
          findingId: s.itemId,
          description: s.draftAmendment?.description ?? null,
          appendAcceptanceCriteria: s.draftAmendment?.appendAcceptanceCriteria ?? [],
        },
        deps
      );
      return result.ok ? { ok: true, error: null } : { ok: false, error: result.error };
    }
    case 'new_story': {
      if (s.kind === 'capability') {
        // A capability's story is the source_capability_id mint (the D3 cite):
        // the drafted title/description ride the minted story.
        const result = await citeCapability(
          {
            projectId: params.projectId,
            bookId: params.bookId,
            capabilityId: s.itemId,
            title: s.draftStory?.title ?? detail?.title ?? s.itemId,
            description: s.draftStory?.description ?? null,
          },
          deps
        );
        return result.ok ? { ok: true, error: null } : { ok: false, error: result.error };
      }
      if (!s.draftStory) {
        return { ok: false, error: 'new_story needs a drafted story' };
      }
      const result = await createStoryForFinding(
        {
          projectId: params.projectId,
          bookId: params.bookId,
          findingId: s.itemId,
          title: s.draftStory.title,
          description: s.draftStory.description,
          workstream: s.draftStory.workstream,
          acceptanceCriteria: s.draftStory.acceptanceCriteria,
        },
        deps
      );
      return result.ok ? { ok: true, error: null } : { ok: false, error: result.error };
    }
    case 'dismiss': {
      if (!s.dismissReason || s.dismissReason.trim() === '') {
        return { ok: false, error: 'dismiss needs a non-empty reason' };
      }
      if (s.kind === 'finding' && !detail?.runId) {
        return { ok: false, error: 'the finding has no run id (dismissal is run-scoped)' };
      }
      const result = await dismissCarryOverItem(
        {
          projectId: params.projectId,
          architectureId: params.architectureId,
          kind: s.kind,
          id: s.itemId,
          ...(s.kind === 'finding' ? { runId: detail?.runId ?? undefined } : {}),
          reason: s.dismissReason,
        },
        deps
      );
      return result.ok ? { ok: true, error: null } : { ok: false, error: result.error };
    }
    default:
      return { ok: false, error: `unknown disposition '${String(s.disposition)}'` };
  }
}
