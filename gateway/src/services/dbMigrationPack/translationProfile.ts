/**
 * Pair-owned translation profile (second-pair programme, Spec 6 §6.1).
 *
 * Every engine-specific word the translation prompts used to carry as a
 * literal ("Sybase ASE", the ASE catalog list, "Sybase Job Scheduler", the
 * ASE-only untranslatable constructs) now comes from the pair ruleset's
 * `translation_profile` block plus the `convention` blocks of its PROC rules.
 * With no ruleset at hand the profile is NEUTRAL ("the T-SQL source engine")
 * — never a guess at an engine.
 */
import { activeRules, procRulePrefix, type MigrationPairRule, type MigrationPairRuleset } from '../../migrationPairRules';

export interface ProfileTokenConversion {
  token: string;
  replacement: string | null;
  note: string;
}

export interface ProfileUntranslatableConstruct {
  pattern: RegExp;
  construct: string;
  concern: string;
}

export interface ProfileConvention {
  ruleId: string;
  title: string;
  objectKinds: string[];
  entries: Array<{ key: string; text: string }>;
}

export interface TranslationProfile {
  pairId: string | null;
  sourceDisplay: string;
  sourceDialect: string;
  catalogRefusal: string[];
  schedulerName: string;
  untranslatableReasons: Record<string, string>;
  untranslatableConstructs: ProfileUntranslatableConstruct[];
  tokenConversions: ProfileTokenConversion[];
  conventions: ProfileConvention[];
}

export const NEUTRAL_TRANSLATION_PROFILE: TranslationProfile = {
  pairId: null,
  sourceDisplay: 'the T-SQL source engine',
  sourceDialect: 'T-SQL',
  catalogRefusal: [],
  schedulerName: 'the source database scheduler',
  untranslatableReasons: {},
  untranslatableConstructs: [],
  tokenConversions: [],
  conventions: [],
};

/** Translation kind -> the routine object kinds whose rules' conventions apply. */
export const OBJECT_KINDS_BY_TRANSLATION_KIND: Record<string, string[]> = {
  stored_procedure: ['procedure', 'function'],
  table_valued_function: ['function'],
  scalar_function: ['function'],
  trigger: ['trigger'],
};

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function conventionText(v: unknown): string {
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

function conventionsOf(ruleset: MigrationPairRuleset): ProfileConvention[] {
  const abiId = `${procRulePrefix(ruleset)}PROC.ABI.001`;
  const out: ProfileConvention[] = [];
  for (const r of activeRules(ruleset) as MigrationPairRule[]) {
    if (!r.convention || typeof r.convention !== 'object') continue;
    // The ABI convention is carried by the calling-convention contract
    // itself (renderRoutineContract) — never duplicated into the prompt.
    if (r.id === abiId) continue;
    const kinds = r.applies_to?.object_kinds ?? [];
    out.push({
      ruleId: r.id,
      title: r.title,
      objectKinds: kinds.map((k) => k.toLowerCase()),
      entries: Object.entries(r.convention).map(([key, value]) => ({ key, text: conventionText(value) })),
    });
  }
  return out;
}

export function translationProfileFor(ruleset: MigrationPairRuleset | null | undefined): TranslationProfile {
  if (!ruleset) return NEUTRAL_TRANSLATION_PROFILE;
  const raw = (ruleset as { translation_profile?: Record<string, unknown> }).translation_profile ?? {};
  const catalogRefusal = Array.isArray(raw.catalog_refusal)
    ? (raw.catalog_refusal as unknown[]).map(str).filter((s): s is string => s !== null)
    : [];
  const untranslatableReasons: Record<string, string> = {};
  if (raw.untranslatable_reasons && typeof raw.untranslatable_reasons === 'object') {
    for (const [k, v] of Object.entries(raw.untranslatable_reasons as Record<string, unknown>)) {
      const s = str(v);
      if (s) untranslatableReasons[k] = s;
    }
  }
  const untranslatableConstructs: ProfileUntranslatableConstruct[] = [];
  if (Array.isArray(raw.untranslatable_constructs)) {
    for (const entry of raw.untranslatable_constructs as Array<Record<string, unknown>>) {
      const pattern = str(entry?.pattern);
      const construct = str(entry?.construct);
      const concern = str(entry?.concern);
      if (!pattern || !construct || !concern) continue;
      try {
        untranslatableConstructs.push({ pattern: new RegExp(pattern, 'i'), construct, concern });
      } catch {
        /* an invalid pattern in the data file is skipped, never fatal */
      }
    }
  }
  const tokenConversions: ProfileTokenConversion[] = [];
  if (Array.isArray(raw.token_conversions)) {
    for (const entry of raw.token_conversions as Array<Record<string, unknown>>) {
      const token = str(entry?.token);
      const note = str(entry?.note);
      if (!token || !note) continue;
      tokenConversions.push({ token, replacement: str(entry?.replacement), note });
    }
  }
  return {
    pairId: ruleset.pair_id,
    sourceDisplay: str(raw.source_display) ?? ruleset.source.display ?? NEUTRAL_TRANSLATION_PROFILE.sourceDisplay,
    sourceDialect: str(raw.source_dialect) ?? NEUTRAL_TRANSLATION_PROFILE.sourceDialect,
    catalogRefusal,
    schedulerName: str(raw.scheduler_name) ?? NEUTRAL_TRANSLATION_PROFILE.schedulerName,
    untranslatableReasons,
    untranslatableConstructs,
    tokenConversions,
    conventions: conventionsOf(ruleset),
  };
}

/**
 * Prompt section listing the pair conventions that govern one translation
 * kind (rule id + title + every convention entry). Empty string when none.
 */
export function renderConventions(profile: TranslationProfile, translationKind: string): string {
  const kinds = OBJECT_KINDS_BY_TRANSLATION_KIND[translationKind] ?? [];
  if (kinds.length === 0) return '';
  const applicable = profile.conventions.filter((c) => c.objectKinds.some((k) => kinds.includes(k)));
  if (applicable.length === 0) return '';
  const lines: string[] = ['Pair conventions (rule-cited; follow each exactly):'];
  for (const c of applicable) {
    lines.push(`- ${c.ruleId} — ${c.title}`);
    for (const e of c.entries) lines.push(`  - ${e.key}: ${e.text}`);
  }
  return lines.join('\n');
}
