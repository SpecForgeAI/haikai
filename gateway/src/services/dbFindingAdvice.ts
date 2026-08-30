/**
 * Per-finding disposition ADVISOR (2026-08-30) — "Suggest next step".
 *
 * A natural broadening of the gap-proposal queue from "draft FK columns" to
 * "review the finding against source truth and recommend a course of
 * action". ADVISORY ONLY: the output is a recommended disposition + a
 * one-paragraph rationale + caveats + a ready-to-paste note; a human still
 * clicks the disposition button. Nothing is ever auto-applied.
 *
 * DETERMINISTIC-FIRST, LLM-FOR-NARRATIVE (house style): the one rule we KNOW
 * lives in code, not a prompt — when a relationship's referenced parent is
 * keyed by a COMPOSITE and/or TEMPORAL key (e.g. `FilterId, ValidFrom,
 * ValidTo`), a plain FK cannot be expressed, so the Fix-with-AI FK drafting
 * is UNAPPLICABLE and the honest choices collapse to accept / known-gap
 * (or a surrogate-key redesign upstream). The pre-check detects that from
 * the committed model's keys (declared PK, pk-flagged attributes, or the
 * unique constraints/indexes discovery captures) and constrains the
 * recommendation set BEFORE the LLM writes the rationale. If the LLM is
 * unreachable while a constraint holds, deterministic advice is returned
 * with an honest caveat — never a silent failure, never invention.
 */
import type {
  CommittedPhysicalModel,
  RawPhysicalAttribute,
  RawPhysicalEntity,
} from './dbMigrationPack/inputs';
import { joinlessRelationships, type GapLlmCaller } from './dbGapProposalGeneration';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AdvisedDisposition = 'accepted' | 'fix_upstream' | 'known_gap';

export interface FindingAdvice {
  recommended_disposition: AdvisedDisposition;
  /** One-paragraph rationale, written for the operator. */
  rationale: string;
  confidence: 'high' | 'medium' | 'low';
  caveats: string[];
  /** Ready to paste into the disposition's note field (null for fix_upstream). */
  suggested_note: string | null;
  /** FALSE when the deterministic pre-check proved FK drafting unapplicable. */
  fix_with_ai_applicable: boolean;
  /** The pre-check's reason when it constrained the choices; null otherwise. */
  deterministic_constraint: string | null;
}

export interface FindingAdviceResult {
  advice: FindingAdvice;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Deterministic pre-check: inexpressible-FK parents
// ---------------------------------------------------------------------------

/** Column-name shapes that mark a TEMPORAL key member (validity windows). */
const TEMPORAL_NAME_RE = /^(valid|effective|expiry|start|end)_?(from|to|date|dt)?$|_(from|to)$|valid(from|to)/i;
const DATEISH_TYPE_RE = /date|time/i;

function keyColumnsOf(entity: RawPhysicalEntity, attrs: RawPhysicalAttribute[]): string[] {
  const cm = (entity.constraints_metadata ?? {}) as {
    primary_key?: { columns?: unknown } | null;
    unique_constraints?: Array<{ columns?: unknown } | null> | null;
    indexes?: Array<{ columns?: unknown; is_unique?: boolean } | null> | null;
  };
  const declared = Array.isArray(cm.primary_key?.columns)
    ? (cm.primary_key?.columns as unknown[]).filter(
        (c): c is string => typeof c === 'string' && c.length > 0
      )
    : [];
  if (declared.length > 0) return declared;
  const flagged = attrs.filter((a) => a.is_primary_key === true).map((a) => a.name);
  if (flagged.length > 0) return flagged;
  for (const uc of cm.unique_constraints ?? []) {
    const cols = Array.isArray(uc?.columns)
      ? (uc?.columns as unknown[]).filter((c): c is string => typeof c === 'string')
      : [];
    if (cols.length > 0) return cols;
  }
  for (const ix of cm.indexes ?? []) {
    if (ix?.is_unique !== true) continue;
    const cols = Array.isArray(ix.columns)
      ? (ix.columns as unknown[]).filter((c): c is string => typeof c === 'string')
      : [];
    if (cols.length > 0) return cols;
  }
  return [];
}

export interface InexpressibleParent {
  table: string;
  keyColumns: string[];
  temporal: boolean;
}

/**
 * Referenced parents of join-less relationships whose key a plain FK cannot
 * express: composite keys, and especially composite keys with a TEMPORAL
 * member (validity-window schemas). Pure model read; no I/O.
 */
export function detectInexpressibleFkParents(
  model: CommittedPhysicalModel
): InexpressibleParent[] {
  const attrsByEntity = new Map<string, RawPhysicalAttribute[]>();
  for (const attr of model.physicalDataAttributes) {
    const list = attrsByEntity.get(attr.physical_entity_id) ?? [];
    list.push(attr);
    attrsByEntity.set(attr.physical_entity_id, list);
  }
  const seen = new Map<string, InexpressibleParent>();
  for (const rel of joinlessRelationships(model)) {
    const attrs = attrsByEntity.get(rel.toEntity.id) ?? [];
    const key = keyColumnsOf(rel.toEntity, attrs);
    if (key.length < 2) continue; // single-column keys are expressible
    const typesByName = new Map(
      attrs.map((a) => [a.name.toLowerCase(), a.data_type ?? a.source_type ?? ''])
    );
    const temporal = key.some(
      (c) =>
        TEMPORAL_NAME_RE.test(c) || DATEISH_TYPE_RE.test(String(typesByName.get(c.toLowerCase()) ?? ''))
    );
    if (!seen.has(rel.toEntity.name)) {
      seen.set(rel.toEntity.name, {
        table: rel.toEntity.name,
        keyColumns: key,
        temporal,
      });
    }
  }
  return [...seen.values()].sort((a, b) => (a.table < b.table ? -1 : 1));
}

/** Finding kinds the pre-check applies to (FK-shaped findings). */
const FK_ADVICE_KINDS = new Set(['relationships_without_fk_columns']);

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const ADVISOR_SYSTEM_PROMPT =
  'You are a database migration triage advisor. Given ONE structural finding ' +
  'from a schema-migration pack plus schema facts from the committed model, ' +
  'you recommend the next course of action for a human operator. You respond ' +
  'with STRICT JSON only (no prose, no markdown). You never invent schema ' +
  'facts; your rationale cites only what you were given. The HUMAN decides — ' +
  'you only advise.';

function adviceUserPrompt(args: {
  findingKind: string;
  findingKey: string;
  message: string | null;
  allowed: AdvisedDisposition[];
  constraint: string | null;
  schemaFacts: string;
}): string {
  const dispositionGloss =
    'Dispositions: "accepted" = the finding is genuinely fine as-is (needs a ' +
    'reason); "fix_upstream" = fix at source / re-capture, the finding stays ' +
    'open until a regenerated pack clears it; "known_gap" = accepted debt, ' +
    'recorded as a plan item (needs a note).';
  return (
    `Structural finding:\n  kind: ${args.findingKind}\n  key: ${args.findingKey}\n` +
    `  message: ${args.message ?? '(none)'}\n\n` +
    `${dispositionGloss}\n\n` +
    (args.constraint
      ? `HARD CONSTRAINT (already proven from the schema — do not contradict it):\n` +
        `  ${args.constraint}\n\n`
      : '') +
    `Schema facts:\n${args.schemaFacts}\n\n` +
    `Choose exactly one of: ${args.allowed.join(' | ')}.\n` +
    'Respond with JSON: {"recommended_disposition": "...", "rationale": ' +
    '"<one paragraph for the operator>", "confidence": "high|medium|low", ' +
    '"caveats": ["..."], "suggested_note": "<ready to paste, or null for fix_upstream>"}'
  );
}

function schemaFactsFor(model: CommittedPhysicalModel, findingKind: string): string {
  if (FK_ADVICE_KINDS.has(findingKind)) {
    const attrsByEntity = new Map<string, RawPhysicalAttribute[]>();
    for (const attr of model.physicalDataAttributes) {
      const list = attrsByEntity.get(attr.physical_entity_id) ?? [];
      list.push(attr);
      attrsByEntity.set(attr.physical_entity_id, list);
    }
    const lines: string[] = [];
    for (const rel of joinlessRelationships(model)) {
      const key = keyColumnsOf(rel.toEntity, attrsByEntity.get(rel.toEntity.id) ?? []);
      lines.push(
        `  - ${rel.fromEntity.name} -> ${rel.toEntity.name}` +
          ` (referenced key: ${key.length > 0 ? key.join(', ') : 'NONE RESOLVED'})`
      );
    }
    return lines.length > 0 ? `Join-less relationships:\n${lines.join('\n')}` : '(none)';
  }
  return '(finding-level facts only — no additional schema slice for this kind)';
}

// ---------------------------------------------------------------------------
// Parse + orchestration
// ---------------------------------------------------------------------------

function parseAdvice(
  content: string,
  allowed: AdvisedDisposition[],
  warnings: string[]
): Pick<FindingAdvice, 'recommended_disposition' | 'rationale' | 'confidence' | 'caveats' | 'suggested_note'> {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('LLM advice contained no JSON object');
  const raw = JSON.parse(content.slice(start, end + 1)) as Record<string, unknown>;
  let disposition = raw.recommended_disposition as AdvisedDisposition;
  if (!allowed.includes(disposition)) {
    warnings.push(
      `LLM recommended "${String(raw.recommended_disposition)}" which is outside the ` +
        `allowed set [${allowed.join(', ')}] — falling back to "${allowed[allowed.length - 1]}"`
    );
    disposition = allowed[allowed.length - 1];
  }
  return {
    recommended_disposition: disposition,
    rationale: typeof raw.rationale === 'string' ? raw.rationale : '',
    confidence:
      raw.confidence === 'high' || raw.confidence === 'medium' || raw.confidence === 'low'
        ? raw.confidence
        : 'low',
    caveats: Array.isArray(raw.caveats) ? raw.caveats.map(String) : [],
    suggested_note: typeof raw.suggested_note === 'string' ? raw.suggested_note : null,
  };
}

export async function runFindingAdvice(args: {
  projectId: string;
  findingKind: string;
  findingKey: string;
  message: string | null;
  model: CommittedPhysicalModel;
  callLlm: GapLlmCaller;
}): Promise<FindingAdviceResult> {
  const warnings: string[] = [];

  // Deterministic pre-check (code, not prompt).
  let constraint: string | null = null;
  let allowed: AdvisedDisposition[] = ['accepted', 'fix_upstream', 'known_gap'];
  let fixWithAiApplicable = true;
  if (FK_ADVICE_KINDS.has(args.findingKind)) {
    const inexpressible = detectInexpressibleFkParents(args.model);
    if (inexpressible.length > 0) {
      const described = inexpressible
        .map(
          (p) =>
            `${p.table} (key: ${p.keyColumns.join(', ')}${p.temporal ? ' — temporal' : ''})`
        )
        .join('; ');
      constraint =
        `The referenced key of ${described} is composite` +
        (inexpressible.some((p) => p.temporal) ? '/temporal' : '') +
        ' — a plain FK cannot be expressed against it, so drafting FK columns ' +
        '(Fix with AI) is UNAPPLICABLE here. The honest choices are accepting ' +
        'the finding or recording a known gap (a surrogate-key redesign would ' +
        'be an upstream schema change, not metadata).';
      allowed = ['accepted', 'known_gap'];
      fixWithAiApplicable = false;
    }
  }

  const userPrompt = adviceUserPrompt({
    findingKind: args.findingKind,
    findingKey: args.findingKey,
    message: args.message,
    allowed,
    constraint,
    schemaFacts: schemaFactsFor(args.model, args.findingKind),
  });

  try {
    const { content } = await args.callLlm({
      systemPrompt: ADVISOR_SYSTEM_PROMPT,
      userPrompt,
      projectId: args.projectId,
    });
    const parsed = parseAdvice(content, allowed, warnings);
    return {
      advice: {
        ...parsed,
        fix_with_ai_applicable: fixWithAiApplicable,
        deterministic_constraint: constraint,
      },
      warnings,
    };
  } catch (err) {
    if (constraint) {
      // Fail-soft ONLY when the deterministic rule already decided the shape:
      // the recommendation stands on code, the LLM was only the narrator.
      warnings.push(
        `LLM unavailable (${err instanceof Error ? err.message : String(err)}) — ` +
          'deterministic advice returned without a narrated rationale'
      );
      return {
        advice: {
          recommended_disposition: 'known_gap',
          rationale: constraint,
          confidence: 'medium',
          caveats: ['LLM unavailable — this recommendation is the deterministic rule only.'],
          suggested_note:
            'Known gap: referenced key is composite/temporal — a plain FK cannot ' +
            'be expressed; revisit only with a surrogate-key redesign upstream.',
          fix_with_ai_applicable: false,
          deterministic_constraint: constraint,
        },
        warnings,
      };
    }
    throw err;
  }
}
