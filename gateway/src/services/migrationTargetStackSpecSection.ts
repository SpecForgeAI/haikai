/**
 * Target-technology-stack spec section (2026-08-14) — the deterministic block
 * appended to EVERY service-plane spec.
 *
 * The live failure this closes: the seven interface carriage specs are
 * (correctly) byte-faithful parity contracts and the foundation specs are
 * LLM prose — and NONE of them named the target stack, so the implementer
 * received technology-neutral route tables aimed at an empty repository. The
 * stack was captured all along (the 51-code architect conversation); it just
 * never rode into the one artifact the implementer reads.
 *
 * This module renders the captured decisions as one deterministic markdown
 * section — grouped by the SAME section mapping the target-tech-stack.md
 * export uses — with an artefact-type framing sentence: the deliverable is
 * source code inside the application the scaffold story (sequenced FIRST)
 * creates. Deterministic render, no LLM; scoped per-element overrides carry
 * their scope qualifier; nothing is invented for absent decisions.
 */

import {
  TARGET_TECH_STACK_SECTION_ORDER,
  sectionFor,
} from './architectConversation/targetTechStackSectionMapping';
import { TargetStateCapturedDecision } from './targetStateCapturedDecisionsClient';

/**
 * Human-readable value of one captured-decision row. Prefers `answerSummary`;
 * unwraps the pre-fill JSON envelope (`{ value, sourceQuote, sourceFile }`,
 * where `value` may be a string or a `{ framework, version }` pair); otherwise
 * the raw `answerValue` verbatim. Mirrors the target-tech-stack.md renderer.
 */
export function resolveDecisionDisplayValue(d: TargetStateCapturedDecision): string {
  if (d.answerSummary && d.answerSummary.length > 0) return d.answerSummary;
  const raw = d.answerValue ?? '';
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const value = parsed.value;
      if (typeof value === 'string' && value.length > 0) return value;
      if (value && typeof value === 'object') {
        const fw = (value as Record<string, unknown>).framework;
        const ver = (value as Record<string, unknown>).version;
        if (typeof fw === 'string' && fw.length > 0) {
          return typeof ver === 'string' && ver.length > 0 ? `${fw} ${ver}` : fw;
        }
      }
    } catch {
      // Fall through to verbatim rendering.
    }
  }
  return raw;
}

/**
 * Latest ARCHITECTURE-WIDE value per decision code (scope invariant: an
 * architecture-scope row has `scopeRefId` null). Scoped per-element overrides
 * are irrelevant to bootstrapping the application shell and are ignored by
 * the scaffold carriage's recipe gating.
 */
export function architectureDecisionValues(
  decisions: readonly TargetStateCapturedDecision[],
): Map<string, string> {
  const byCode = new Map<string, string>();
  for (const d of decisions) {
    if (d.scopeRefId) continue;
    if (!byCode.has(d.decisionCode)) {
      byCode.set(d.decisionCode, resolveDecisionDisplayValue(d));
    }
  }
  return byCode;
}

/** Stable heading — spec readers and tests key on it. */
export const TARGET_STACK_SECTION_HEADING =
  '## Target technology stack (captured decisions — authoritative)';

/** DB-plane streams whose specs carry their own pack files instead. */
export const NON_STACK_STREAMS: readonly string[] = [
  'target_database_schema_implementation',
  'data_migration',
];

/**
 * True when the story belongs to a DB-plane stream (`stream:<name>` tag).
 * Stories without a stream tag (manual adds, legacy discovered stories) are
 * NOT excluded — the target stack applies to the migration as a whole.
 */
export function isDbPlaneStream(tags: readonly (string | null | undefined)[] | null | undefined): boolean {
  for (const t of tags ?? []) {
    const tag = (t ?? '').trim();
    if (!tag.startsWith('stream:')) continue;
    if (NON_STACK_STREAMS.includes(tag.substring('stream:'.length))) return true;
  }
  return false;
}

/** Scope qualifier for a per-element override row (architecture-wide → null). */
function scopeQualifier(d: TargetStateCapturedDecision): string | null {
  if (!d.scopeRefId) return null;
  const refType = d.scopeRefType ? `${d.scopeRefType} ` : '';
  return `(scope: ${d.scopeKind} ${refType}${d.scopeRefId})`;
}

/**
 * Render the captured decisions as the deterministic spec section, or `null`
 * when there are no decisions (nothing is fabricated — the spec simply
 * carries no stack block, and the scaffold spec's own not-captured warnings
 * surface the gap).
 */
export interface TargetStackSectionOptions {
  /**
   * Drop modernize.* decisions whose mapping is an identity no-op
   * (`String -> java.lang.String`, `Object -> java.lang.Object`, `V -> V`):
   * they carry no instruction and padded every spec (Kiro review BEHAV-08).
   */
  dropIdentityNoOps?: boolean;
  /** Exclude decision codes for which this returns true (e.g. every modernize.*
   *  when the spec already renders its story-RELEVANT modernization subset). */
  excludeCodes?: (decisionCode: string) => boolean;
}

function simpleTypeName(type: string): string {
  let s = type.trim();
  const lt = s.indexOf('<');
  if (lt >= 0) s = s.slice(0, lt);
  s = s.replace(/\[\s*\]/g, '');
  return s.includes('.') ? s.slice(s.lastIndexOf('.') + 1) : s;
}

/**
 * True when a modernize.* decision maps a type onto itself: same simple name
 * on both sides of the `from -> to` mapping (the ruleset's from/to when the
 * code is known, else the rendered `X -> Y` display value). Exported for tests.
 */
export function isIdentityNoOpDecision(d: TargetStateCapturedDecision): boolean {
  if (!d.decisionCode.startsWith('modernize.')) return false;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { defaultModernizationRuleset } = require('./sclModernizationRuleset');
  const rule = (defaultModernizationRuleset().rules as Array<{ code: string; from?: string; to?: string }>)
    .find((r) => r.code === d.decisionCode);
  let from: string | null = rule?.from ?? null;
  let to: string | null = rule?.to ?? null;
  if (!from || !to) {
    const display = resolveDecisionDisplayValue(d);
    const arrow = display.indexOf('->');
    if (arrow < 0) return false;
    from = display.slice(0, arrow);
    to = display.slice(arrow + 2);
  }
  // Identity = the source type is written UNQUALIFIED and names the same class
  // the target spells out (`String -> java.lang.String`), or both sides are
  // literally equal (`V -> V`). A package MOVE with the same simple name
  // (`org.joda.time.LocalDate -> java.time.LocalDate`) is a real mapping.
  const f = from.trim();
  const tt = to.trim();
  if (f === tt) return true;
  return !f.includes('.') && simpleTypeName(f) === simpleTypeName(tt);
}

export function buildTargetStackSpecSection(
  decisions: readonly TargetStateCapturedDecision[],
  options: TargetStackSectionOptions = {},
): string | null {
  if (!decisions || decisions.length === 0) return null;

  const buckets = new Map<string, TargetStateCapturedDecision[]>();
  for (const d of decisions) {
    if (options.excludeCodes && options.excludeCodes(d.decisionCode)) continue;
    if (options.dropIdentityNoOps && isIdentityNoOpDecision(d)) continue;
    const section = sectionFor(d.decisionCode);
    const bucket = buckets.get(section);
    if (bucket) bucket.push(d);
    else buckets.set(section, [d]);
  }

  if (buckets.size === 0) return null;

  const lines: string[] = [];
  lines.push(TARGET_STACK_SECTION_HEADING);
  lines.push('');
  lines.push(
    'The target technology stack IS decided — captured in the architect ' +
      'conversation and listed below. The deliverable of this story is SOURCE CODE ' +
      'inside the application created by the scaffold story (sequenced FIRST in ' +
      'this plan): implement against these exact technologies, extending the ' +
      'scaffolded application — never a technology-neutral artefact, never a ' +
      'parallel structure, never a different stack. Cite decisions as ' +
      '`[decision:<code>]` where they shape a choice. Do NOT contradict a listed ' +
      'decision; where a needed decision is NOT listed, surface the gap instead ' +
      'of inventing an answer.'
  );
  lines.push('');

  const emitSection = (section: string, rows: TargetStateCapturedDecision[]) => {
    lines.push(`### ${section}`);
    lines.push('');
    for (const d of rows) {
      const qualifier = scopeQualifier(d);
      const value = resolveDecisionDisplayValue(d);
      lines.push(
        qualifier
          ? `- \`${d.decisionCode}\` ${qualifier} — ${value}`
          : `- \`${d.decisionCode}\` — ${value}`
      );
    }
    lines.push('');
  };

  for (const section of TARGET_TECH_STACK_SECTION_ORDER) {
    const rows = buckets.get(section) ?? [];
    if (rows.length > 0) emitSection(section, rows);
  }
  // Defensive: any section key outside the standard order still renders.
  for (const [section, rows] of buckets.entries()) {
    if (TARGET_TECH_STACK_SECTION_ORDER.includes(section)) continue;
    if (rows.length > 0) emitSection(section, rows);
  }

  return lines.join('\n').trimEnd();
}

/**
 * Append the stack section to a spec text (no-op passthrough when the section
 * is null or the text already carries the heading — idempotent for re-runs).
 */
export function appendTargetStackSection(
  specText: string,
  sectionText: string | null,
): string {
  if (!sectionText) return specText;
  if (specText.includes(TARGET_STACK_SECTION_HEADING)) return specText;
  return `${specText}\n\n${sectionText}`;
}
