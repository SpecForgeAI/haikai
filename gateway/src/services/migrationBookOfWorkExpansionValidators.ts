/**
 * Hand-rolled validators for the phase-2 epic-expansion LLM responses.
 *
 * Spec: 2026-06-11 Two-Phase Migration Delivery Plan Generation
 * (Skeleton → Expand) — Task Group 4.
 *
 * Modelled on `architectConversation/techStackPrefillResponseValidator.ts`
 * (the validated-LLM-pass precedent): explicit per-rule checks, the
 * `{ ok, value | errors }` return shape, NO JSON-schema library (the gateway
 * carries none in its package.json).
 *
 * Three response surfaces are validated here:
 *
 *   1. `validateExpansionBatchResponse` — the per-inventory-batch expansion
 *      call: story `templates` per work type + a standard-vs-exceptional
 *      `classifications` array covering EVERY batch item exactly once + full
 *      bespoke `stories` ONLY for the exceptional items. Items outside the
 *      supplied batch and feature ids outside the epic are hard failures —
 *      the prompt forbids inventing either, and the validator enforces it.
 *
 *   2. `validateJudgeResponse` — the verdict-only layer-3 judge pass per
 *      stamped batch: `{ flaggedItemIds: [...] }`, every id ⊆ the stamped
 *      batch's inventory-item ids.
 *
 *   3. `validateBespokeStoryResponse` / `validateNonInventoryExpansionResponse`
 *      — a single bespoke story rewrite / the whole-epic single-call path for
 *      non-inventory epics. Both lean on the exported
 *      `validateMigrationBookOfWorkItem` schema check plus the
 *      parent-feature-scoping rule.
 */

import {
  MigrationBookOfWorkItem,
  ValidationResult,
  validateMigrationBookOfWorkItem,
} from './generatedMigrationBookOfWorkSchema';

// ---------------------------------------------------------------------------
// Typed shapes
// ---------------------------------------------------------------------------

/** One story template per work type, stamped across standard items IN CODE. */
export interface ExpansionStoryTemplate {
  /** Work-type key the template covers (e.g. `api_endpoint`, `db_table`). */
  workType: string;
  /** Title template with fact placeholders (e.g. `{METHOD}`, `{path}`). */
  titleTemplate: string;
  /** Description template with fact placeholders. */
  descriptionTemplate: string;
  /** SMALL set of templated acceptance criteria per work type. */
  acceptanceCriteriaTemplates: string[];
}

export type ExpansionClassificationKind = 'standard' | 'exceptional';

/** The LLM's per-inventory-item classification within one batch. */
export interface ExpansionClassification {
  /** Inventory item id — MUST belong to the supplied batch. */
  itemId: string;
  classification: ExpansionClassificationKind;
  /** Template work type used to stamp a `standard` item. */
  workType: string;
  /** Feature id (one of the epic's existing features) the story parents to. */
  parentFeatureId: string;
  /** Optional rationale (used for exceptional classifications). */
  reason?: string;
}

/** A full bespoke story for ONE exceptional inventory item. */
export interface ExpansionBespokeStory {
  /** The inventory item this story covers — links story ↔ classification. */
  itemId: string;
  /** Full MigrationBookOfWorkItem-shaped story payload. */
  story: MigrationBookOfWorkItem;
}

export interface ExpansionBatchResponse {
  templates: ExpansionStoryTemplate[];
  classifications: ExpansionClassification[];
  bespokeStories: ExpansionBespokeStory[];
}

/** Verdict-only judge response (layer 3). */
export interface ExpansionJudgeResponse {
  flaggedItemIds: string[];
}

/** Whole-epic single-call response for non-inventory epics. */
export interface NonInventoryExpansionResponse {
  stories: MigrationBookOfWorkItem[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/**
 * Validates one candidate story payload against the MigrationBookOfWorkItem
 * schema plus the expansion-scoping rules (type must be `story`; parent must
 * be one of the epic's existing feature ids — the prompt forbids inventing
 * parents and this enforces it).
 */
function validateScopedStory(
  raw: unknown,
  featureIds: ReadonlySet<string>,
  label: string
): ValidationResult<MigrationBookOfWorkItem> {
  const itemResult = validateMigrationBookOfWorkItem(raw);
  if (!itemResult.ok) {
    return {
      ok: false,
      errors: itemResult.errors.map((e) => `${label}: ${e}`),
    };
  }
  const story = itemResult.value;
  const errors: string[] = [];
  if (story.type !== 'story') {
    errors.push(`${label}: type must be "story" (got ${JSON.stringify(story.type)})`);
  }
  if (story.parentId === null || !featureIds.has(story.parentId)) {
    errors.push(
      `${label}: parentId ${JSON.stringify(story.parentId)} is not one of the epic's existing feature ids`
    );
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: story };
}

// ---------------------------------------------------------------------------
// 1. Per-batch expansion response
// ---------------------------------------------------------------------------

export interface ExpansionBatchValidationContext {
  /** Inventory item ids supplied in THIS batch — the only legal itemIds. */
  batchItemIds: ReadonlySet<string>;
  /** The epic's existing feature ids — the only legal story parents. */
  featureIds: ReadonlySet<string>;
}

export function validateExpansionBatchResponse(
  payload: unknown,
  ctx: ExpansionBatchValidationContext
): ValidationResult<ExpansionBatchResponse> {
  if (!isPlainObject(payload)) {
    return { ok: false, errors: ['Expansion batch response is not a JSON object'] };
  }

  const errors: string[] = [];
  if (!Array.isArray(payload.templates)) errors.push('templates must be an array');
  if (!Array.isArray(payload.classifications)) {
    errors.push('classifications must be an array');
  }
  if (!Array.isArray(payload.bespokeStories)) {
    errors.push('bespokeStories must be an array');
  }
  if (errors.length > 0) return { ok: false, errors };

  // Templates ---------------------------------------------------------------
  const templates: ExpansionStoryTemplate[] = [];
  const templateWorkTypes = new Set<string>();
  for (let i = 0; i < (payload.templates as unknown[]).length; i++) {
    const raw = (payload.templates as unknown[])[i];
    if (!isPlainObject(raw)) {
      errors.push(`templates[${i}] must be an object`);
      continue;
    }
    if (!isNonEmptyString(raw.workType)) {
      errors.push(`templates[${i}].workType must be a non-empty string`);
      continue;
    }
    if (templateWorkTypes.has(raw.workType)) {
      errors.push(`templates[${i}].workType ${JSON.stringify(raw.workType)} is duplicated`);
    }
    templateWorkTypes.add(raw.workType);
    if (!isNonEmptyString(raw.titleTemplate)) {
      errors.push(`templates[${i}].titleTemplate must be a non-empty string`);
    }
    if (!isNonEmptyString(raw.descriptionTemplate)) {
      errors.push(`templates[${i}].descriptionTemplate must be a non-empty string`);
    }
    if (!isStringArray(raw.acceptanceCriteriaTemplates)) {
      errors.push(`templates[${i}].acceptanceCriteriaTemplates must be an array of strings`);
    }
    templates.push({
      workType: raw.workType,
      titleTemplate: typeof raw.titleTemplate === 'string' ? raw.titleTemplate : '',
      descriptionTemplate:
        typeof raw.descriptionTemplate === 'string' ? raw.descriptionTemplate : '',
      acceptanceCriteriaTemplates: isStringArray(raw.acceptanceCriteriaTemplates)
        ? raw.acceptanceCriteriaTemplates
        : [],
    });
  }

  // Classifications ----------------------------------------------------------
  const classifications: ExpansionClassification[] = [];
  const seenItemIds = new Set<string>();
  for (let i = 0; i < (payload.classifications as unknown[]).length; i++) {
    const raw = (payload.classifications as unknown[])[i];
    if (!isPlainObject(raw)) {
      errors.push(`classifications[${i}] must be an object`);
      continue;
    }
    if (!isNonEmptyString(raw.itemId)) {
      errors.push(`classifications[${i}].itemId must be a non-empty string`);
      continue;
    }
    if (!ctx.batchItemIds.has(raw.itemId)) {
      // Hard rule: the prompt forbids inventing items outside the batch.
      errors.push(
        `classifications[${i}].itemId ${JSON.stringify(raw.itemId)} is not in the supplied inventory batch`
      );
    }
    if (seenItemIds.has(raw.itemId)) {
      errors.push(
        `classifications[${i}].itemId ${JSON.stringify(raw.itemId)} is classified more than once`
      );
    }
    seenItemIds.add(raw.itemId);
    if (raw.classification !== 'standard' && raw.classification !== 'exceptional') {
      errors.push(
        `classifications[${i}].classification must be 'standard' or 'exceptional' (got ${JSON.stringify(raw.classification)})`
      );
    }
    if (raw.classification === 'standard') {
      if (!isNonEmptyString(raw.workType) || !templateWorkTypes.has(raw.workType)) {
        errors.push(
          `classifications[${i}].workType ${JSON.stringify(raw.workType)} has no matching template (standard items must be stampable)`
        );
      }
    }
    if (!isNonEmptyString(raw.parentFeatureId) || !ctx.featureIds.has(raw.parentFeatureId)) {
      errors.push(
        `classifications[${i}].parentFeatureId ${JSON.stringify(raw.parentFeatureId)} is not one of the epic's existing feature ids`
      );
    }
    classifications.push({
      itemId: raw.itemId,
      classification: raw.classification === 'exceptional' ? 'exceptional' : 'standard',
      workType: typeof raw.workType === 'string' ? raw.workType : '',
      parentFeatureId: typeof raw.parentFeatureId === 'string' ? raw.parentFeatureId : '',
      reason: typeof raw.reason === 'string' ? raw.reason : undefined,
    });
  }

  // Coverage: every batch item classified EXACTLY once ------------------------
  for (const itemId of ctx.batchItemIds) {
    if (!seenItemIds.has(itemId)) {
      errors.push(`inventory item ${JSON.stringify(itemId)} was not classified`);
    }
  }

  // Bespoke stories -----------------------------------------------------------
  const exceptionalIds = new Set(
    classifications
      .filter((c) => c.classification === 'exceptional')
      .map((c) => c.itemId)
  );
  const bespokeStories: ExpansionBespokeStory[] = [];
  const seenBespokeIds = new Set<string>();
  for (let i = 0; i < (payload.bespokeStories as unknown[]).length; i++) {
    const raw = (payload.bespokeStories as unknown[])[i];
    if (!isPlainObject(raw)) {
      errors.push(`bespokeStories[${i}] must be an object`);
      continue;
    }
    if (!isNonEmptyString(raw.itemId)) {
      errors.push(`bespokeStories[${i}].itemId must be a non-empty string`);
      continue;
    }
    if (!exceptionalIds.has(raw.itemId)) {
      errors.push(
        `bespokeStories[${i}].itemId ${JSON.stringify(raw.itemId)} is not classified 'exceptional' — bespoke stories are for exceptions ONLY`
      );
    }
    if (seenBespokeIds.has(raw.itemId)) {
      errors.push(`bespokeStories[${i}].itemId ${JSON.stringify(raw.itemId)} is duplicated`);
    }
    seenBespokeIds.add(raw.itemId);
    const storyResult = validateScopedStory(raw.story, ctx.featureIds, `bespokeStories[${i}].story`);
    if (!storyResult.ok) {
      errors.push(...storyResult.errors);
      continue;
    }
    bespokeStories.push({ itemId: raw.itemId, story: storyResult.value });
  }
  // Every exceptional classification needs a bespoke story.
  for (const itemId of exceptionalIds) {
    if (!seenBespokeIds.has(itemId)) {
      errors.push(
        `exceptional item ${JSON.stringify(itemId)} has no bespoke story in bespokeStories`
      );
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { templates, classifications, bespokeStories } };
}

// ---------------------------------------------------------------------------
// 2. Judge response (verdict-only, layer 3)
// ---------------------------------------------------------------------------

export function validateJudgeResponse(
  payload: unknown,
  stampedItemIds: ReadonlySet<string>
): ValidationResult<ExpansionJudgeResponse> {
  if (!isPlainObject(payload)) {
    return { ok: false, errors: ['Judge response is not a JSON object'] };
  }
  const errors: string[] = [];
  if (!isStringArray(payload.flaggedItemIds)) {
    return { ok: false, errors: ['flaggedItemIds must be an array of strings'] };
  }
  const flaggedItemIds: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < payload.flaggedItemIds.length; i++) {
    const id = payload.flaggedItemIds[i];
    if (!isNonEmptyString(id)) {
      errors.push(`flaggedItemIds[${i}] must be a non-empty string`);
      continue;
    }
    if (!stampedItemIds.has(id)) {
      errors.push(
        `flaggedItemIds[${i}] ${JSON.stringify(id)} is not a stamped item in this batch`
      );
      continue;
    }
    if (!seen.has(id)) {
      seen.add(id);
      flaggedItemIds.push(id);
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { flaggedItemIds } };
}

// ---------------------------------------------------------------------------
// 3. Single bespoke rewrite + non-inventory whole-epic responses
// ---------------------------------------------------------------------------

export function validateBespokeStoryResponse(
  payload: unknown,
  featureIds: ReadonlySet<string>
): ValidationResult<MigrationBookOfWorkItem> {
  if (!isPlainObject(payload)) {
    return { ok: false, errors: ['Bespoke story response is not a JSON object'] };
  }
  // Accept either `{ story: {...} }` or the bare story object itself.
  const candidate = isPlainObject(payload.story) ? payload.story : payload;
  return validateScopedStory(candidate, featureIds, 'story');
}

export function validateNonInventoryExpansionResponse(
  payload: unknown,
  featureIds: ReadonlySet<string>
): ValidationResult<NonInventoryExpansionResponse> {
  if (!isPlainObject(payload)) {
    return { ok: false, errors: ['Non-inventory expansion response is not a JSON object'] };
  }
  if (!Array.isArray(payload.stories)) {
    return { ok: false, errors: ['stories must be an array'] };
  }
  if (payload.stories.length === 0) {
    return { ok: false, errors: ['stories must contain at least one story'] };
  }
  const errors: string[] = [];
  const stories: MigrationBookOfWorkItem[] = [];
  for (let i = 0; i < payload.stories.length; i++) {
    const result = validateScopedStory(payload.stories[i], featureIds, `stories[${i}]`);
    if (!result.ok) {
      errors.push(...result.errors);
      continue;
    }
    stories.push(result.value);
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { stories } };
}
