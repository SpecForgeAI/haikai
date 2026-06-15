/**
 * Extension Pack Registry
 *
 * Manages registration and lookup of V3 LanguagePacks + FrameworkPacks
 * used by the discovery pipeline. Packs are registered at startup
 * (`extensionPacks/register.ts`) and evaluated against techHints from
 * the discovery config to determine applicability.
 *
 * V3 surface (Spec: V3 Discovery Pipeline Foundation, Task Group 3,
 * unified by V3 Pack Migration Batch — Task Groups 1 + 11):
 *  - `languagePacks[]` / `frameworkPacks[]` — two-tier registries.
 *  - `registerLanguagePack` / `registerFrameworkPack` — registration fns.
 *  - `findLanguagePack` / `findFrameworkPacks` — predicate-matched lookups.
 *  - `computeTier` — returns `'A' | 'B' | 'C'` based on which tiers match.
 *  - `matchesPredicate` — per-field AND semantics on
 *    `{ language, technology }` predicates.
 *
 * The legacy V2 surface (`packs[]`, `registerPack`, `runPacks`,
 * `getApplicablePacks`) was atomically removed in Task Group 11 of the
 * V3 Pack Migration Batch spec, alongside every `<framework>PackV2/`
 * directory. There is no V2 fallback path any longer — every pack runs
 * via `LanguagePack.extract` + `FrameworkPack.adapt`.
 *
 * `clearRegistry` and `getRegisteredPackCount` cover both V3 registries
 * so tests reset the full world in a single call and diagnostics see
 * every registered pack.
 */

import type {
  FrameworkPack,
  LanguagePack,
  TechHints,
} from './extensionPacks';
import type {
  FrameworkPackPredicate,
  LanguagePackPredicate,
} from './extensionPacks/packTypes';

/**
 * Internal storage for registered V3 language packs (Stage 1 producers).
 */
let languagePacks: LanguagePack[] = [];

/**
 * Internal storage for registered V3 framework packs (Stage 2 producers).
 */
let frameworkPacks: FrameworkPack[] = [];

/**
 * Registers a V3 LanguagePack in the registry.
 *
 * Duplicate ids are skipped with a warning.
 *
 * @param pack - The LanguagePack to register
 */
export function registerLanguagePack(pack: LanguagePack): void {
  if (languagePacks.some((p) => p.id === pack.id)) {
    console.warn(
      `[ExtensionPackRegistry] LanguagePack '${pack.id}' is already registered, skipping.`,
    );
    return;
  }
  languagePacks.push(pack);
  console.log(`[ExtensionPackRegistry] Registered language pack: ${pack.id}`);
}

/**
 * Registers a V3 FrameworkPack in the registry.
 *
 * Duplicate ids are skipped with a warning.
 *
 * @param pack - The FrameworkPack to register
 */
export function registerFrameworkPack(pack: FrameworkPack): void {
  if (frameworkPacks.some((p) => p.id === pack.id)) {
    console.warn(
      `[ExtensionPackRegistry] FrameworkPack '${pack.id}' is already registered, skipping.`,
    );
    return;
  }
  frameworkPacks.push(pack);
  console.log(`[ExtensionPackRegistry] Registered framework pack: ${pack.id}`);
}

/**
 * Evaluates a pack predicate against the provided techHints.
 *
 * Semantics:
 * - Each specified field in the predicate must be satisfied by *some* hint:
 *   `language` requires some hint with matching `language`, and `technology`
 *   requires some hint with matching `technology`. When both are specified,
 *   both field-requirements must be met — so a classic-Spring stack
 *   (hints: `{language:'Java'}`, `{technology:'Spring'}`) matches
 *   `{ language:'Java', technology:'Spring' }` but NOT
 *   `{ language:'Java', technology:'Spring Boot' }`.
 *
 *   This fits how `parseCoretech` produces hints: each hint carries either
 *   a language or a technology, not both. Requiring both on one hint would
 *   never match.
 *
 * LanguagePack predicates carry `language` only; FrameworkPack predicates
 * carry `language` + `technology`. An empty predicate (all fields
 * undefined) does NOT match.
 */
export function matchesPredicate(
  predicate: LanguagePackPredicate | FrameworkPackPredicate,
  techHints: TechHints,
): boolean {
  const hintEntries = Object.values(techHints);

  const hasLang = typeof predicate.language === 'string';
  const hasTech =
    typeof (predicate as FrameworkPackPredicate).technology === 'string';

  if (!hasLang && !hasTech) return false;

  const wantLang = hasLang ? predicate.language.toLowerCase() : null;
  const wantTech = hasTech
    ? (predicate as FrameworkPackPredicate).technology.toLowerCase()
    : null;

  const langOK =
    wantLang === null ||
    hintEntries.some((h) => h.language?.toLowerCase() === wantLang);
  const techOK =
    wantTech === null ||
    hintEntries.some((h) => h.technology?.toLowerCase() === wantTech);

  return langOK && techOK;
}

/**
 * V3 lookup-by-id: returns the registered `LanguagePack` whose `id` matches,
 * or `null` if none. Used by `techHintsFromResolvedColumns` to derive
 * predicate-compatible techHints from the service's `core_tech_language_pack`
 * column instead of trusting the LLM-resolver's free-text name (which has
 * historically drifted, e.g. resolver emits `"Spring Framework"` while the
 * predicate wants `"Spring"` — see `KNOWN_ISSUES.md` ISS-### resolved
 * 2026-04-27).
 */
export function getLanguagePackById(id: string): LanguagePack | null {
  return languagePacks.find((p) => p.id === id) ?? null;
}

/**
 * V3 lookup-by-id: returns the registered `FrameworkPack` whose `id` matches,
 * or `null` if none. Companion to `getLanguagePackById`.
 */
export function getFrameworkPackById(id: string): FrameworkPack | null {
  return frameworkPacks.find((p) => p.id === id) ?? null;
}

/**
 * V3 lookup: returns the first registered `LanguagePack` whose predicate
 * matches the provided techHints, or `null` when none match.
 *
 * Reuses `matchesPredicate` (per-field AND semantics) so selection behavior
 * remains identical across packs.
 *
 * @param techHints - Technology hints from discovery config
 * @returns The first matching LanguagePack, or null
 */
export function findLanguagePack(techHints: TechHints): LanguagePack | null {
  for (const pack of languagePacks) {
    if (matchesPredicate(pack.when, techHints)) {
      return pack;
    }
  }
  return null;
}

/**
 * V3 lookup: returns ALL registered `FrameworkPack`s whose predicates match
 * the provided techHints. Returns an empty array when none match.
 *
 * Reuses `matchesPredicate` (per-field AND semantics) so e.g. classic-Spring
 * techHints never surface a Spring Boot framework pack and vice versa.
 *
 * @param techHints - Technology hints from discovery config
 * @returns All matching FrameworkPacks (possibly empty)
 */
export function findFrameworkPacks(techHints: TechHints): FrameworkPack[] {
  return frameworkPacks.filter((pack) => matchesPredicate(pack.when, techHints));
}

/**
 * V3 tier computation for a discovery run's techHints.
 *
 *  - `'A'` — a LanguagePack matches AND at least one FrameworkPack matches.
 *  - `'B'` — a LanguagePack matches, but no FrameworkPack does (IR-only).
 *  - `'C'` — neither a LanguagePack nor a FrameworkPack matches.
 *
 * Persisted on the `discovery_run.mode` column so operators can distinguish
 * full-coverage runs from language-only or LLM-only runs without
 * re-deriving the state.
 *
 * @param techHints - Technology hints from discovery config
 * @returns `'A'`, `'B'`, or `'C'`
 */
export function computeTier(techHints: TechHints): 'A' | 'B' | 'C' {
  const hasLanguage = findLanguagePack(techHints) !== null;
  const hasFramework = findFrameworkPacks(techHints).length > 0;
  if (hasLanguage && hasFramework) return 'A';
  if (hasLanguage) return 'B';
  return 'C';
}

/**
 * Clears registered LanguagePacks + FrameworkPacks.
 *
 * Primarily used for testing to reset the registry state.
 */
export function clearRegistry(): void {
  languagePacks = [];
  frameworkPacks = [];
}

/**
 * Returns the total count of registered packs across both V3 registries.
 *
 * Useful for diagnostics and testing.
 */
export function getRegisteredPackCount(): number {
  return languagePacks.length + frameworkPacks.length;
}

/**
 * Pack metadata returned by the `/discovery/packs` diagnostic endpoint.
 * Surfaces the unique id and predicate for each registered pack so callers
 * can correlate `(coreTech) -> (which pack would activate)`. Does not
 * expose the `extract` / `adapt` callables to keep the surface read-only.
 */
export interface RegisteredPackMetadata {
  /** Unique pack id (e.g. `java-lang`, `spring-classic`). */
  id: string;
  /** Tier the pack belongs to: language-layer (Stage 1) or framework-layer (Stage 2). */
  kind: 'language' | 'framework';
  /** Predicate evaluated by `matchesPredicate` against techHints. */
  when: LanguagePackPredicate | FrameworkPackPredicate;
}

/**
 * Returns metadata for every registered V3 pack (LanguagePacks +
 * FrameworkPacks). Used by the `/discovery/packs` diagnostic endpoint.
 *
 * The legacy V2 surface this used to expose was removed in Task Group 11
 * of the V3 Pack Migration Batch spec.
 */
export function getRegisteredPacks(): RegisteredPackMetadata[] {
  const langMeta: RegisteredPackMetadata[] = languagePacks.map((p) => ({
    id: p.id,
    kind: 'language',
    when: p.when,
  }));
  const fwMeta: RegisteredPackMetadata[] = frameworkPacks.map((p) => ({
    id: p.id,
    kind: 'framework',
    when: p.when,
  }));
  return [...langMeta, ...fwMeta];
}
