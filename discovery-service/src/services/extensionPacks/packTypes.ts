/**
 * V3 Pack Type Contracts — `LanguagePack` and `FrameworkPack`.
 *
 * Spec: V3 Discovery Pipeline Foundation (Task Group 2)
 *
 * The V3 pipeline runs packs first and LLM gap-fill second. Two typed
 * tiers split the work:
 *
 *  - `LanguagePack` — matches on `language` only and extracts a
 *    `Map<filePath, SourceFileIR>` from raw source files. Produces the
 *    deterministic, language-level structural facts that FrameworkPacks
 *    consume.
 *  - `FrameworkPack` — matches on `language` + `technology` and consumes
 *    an IR map to emit `DiscoveryCandidate[]`. Tags its candidates with
 *    `_addedBy: '<framework>-adapter'` so downstream consumers can
 *    identify the producing pack.
 *
 * The legacy V2 `ExtensionPack` type and `<framework>PackV2/` directories
 * were atomically removed in Task Group 11 of the V3 Pack Migration
 * Batch spec. See `runDiscoveryV3` for runtime wiring.
 *
 * IR shape (`SourceFileIR`) is re-exported from `languageIR.ts`
 * unchanged — IR schema formalization is deferred to Spec 4.
 */

import type { DiscoveryCandidate } from '../../types/candidate';
import type { SourceFileIR } from './languageIR';

/**
 * TechHints shape shared by both pack tiers.
 *
 * Mirrors the existing `Record<string, { language?; technology?; version? }>`
 * used by `matchesPredicate`. Each entry carries at most one of language /
 * technology (per the `parseCoretech` output shape), and pack-level
 * predicates AND the specified fields across hints.
 */
export type TechHints = Record<
  string,
  { language?: string; technology?: string; version?: string }
>;

/**
 * Applicability predicate for a `LanguagePack`.
 *
 * Matches only on `language`. A LanguagePack is considered applicable when
 * some techHint entry carries a matching `language` field (case-insensitive).
 */
export interface LanguagePackPredicate {
  language: string;
}

/**
 * Applicability predicate for a `FrameworkPack`.
 *
 * Matches on BOTH `language` AND `technology` using the per-field AND
 * semantics preserved from `matchesPredicate` — the two fields can come
 * from different techHint entries (e.g. one hint with `{ language: 'Java' }`
 * and another with `{ technology: 'Spring' }`), but both must be present.
 */
export interface FrameworkPackPredicate {
  language: string;
  technology: string;
}

/**
 * A LanguagePack extracts Universal IR from source files for a single
 * source language. It is the Stage 1 producer in the V3 pipeline.
 *
 * Contract:
 *  - `id` is a unique string identifier (e.g. `'java-lang'`).
 *  - `when.language` must match some techHint for the pack to be selected.
 *  - `extract` receives the raw source file map (path -> contents) plus
 *    techHints and returns a `Map<filePath, SourceFileIR>` covering the
 *    subset of files the language applies to. Files the extractor
 *    cannot or should not process (e.g. test files, non-language files)
 *    are simply omitted from the returned map.
 *
 * Note: the IR shape (`SourceFileIR`) is imported unchanged from
 * `languageIR.ts`. This spec does NOT formalize the IR schema — that is
 * deferred to Spec 4.
 */
export interface LanguagePack {
  /** Unique pack identifier (e.g. `'java-lang'`, `'typescript-lang'`). */
  id: string;
  /** Applicability predicate — a single required language string. */
  when: LanguagePackPredicate;
  /**
   * Extract per-file IR for the pack's language.
   *
   * @param sourceFiles  Raw source contents keyed by file path.
   * @param techHints    Technology hints from the discovery config.
   * @returns            IR entries keyed by file path. Files outside the
   *                     pack's language or filtered out (e.g. tests) are
   *                     simply omitted.
   */
  extract(
    sourceFiles: Map<string, string>,
    techHints: TechHints,
  ): Map<string, SourceFileIR>;
}

/**
 * A FrameworkPack consumes Universal IR produced by a LanguagePack and
 * emits `DiscoveryCandidate[]`. It is the Stage 2 producer in the V3
 * pipeline — the deterministic structural-facts tier.
 *
 * Contract:
 *  - `id` is a unique string identifier (e.g. `'spring-classic'`).
 *  - `when.language` + `when.technology` must both be satisfied by the
 *    techHints (per-field AND semantics, see `matchesPredicate`).
 *  - `adapt` receives the IR map from the Stage 1 LanguagePack, the
 *    current `runId` for candidate attribution, and techHints. Emitted
 *    candidates must carry `_addedBy: '<framework>-adapter'` (embedded in
 *    `data`) so downstream tooling can identify the producing pack.
 *
 * FrameworkPacks are stateless and deterministic: the same IR input on
 * the same `runId` must produce byte-identical candidate output so that
 * OpenMRS parity spot-checks (Task Group 7) remain stable.
 */
export interface FrameworkPack {
  /** Unique pack identifier (e.g. `'spring-classic'`, `'react-typescript'`). */
  id: string;
  /** Applicability predicate — language + technology must both be present. */
  when: FrameworkPackPredicate;
  /**
   * Adapt an IR map into discovery candidates.
   *
   * @param irFiles    IR entries produced by a Stage 1 LanguagePack.
   * @param runId      Discovery run identifier, attached to every candidate.
   * @param techHints  Technology hints from the discovery config.
   * @returns          Candidates tagged with the pack's `_addedBy` marker.
   */
  adapt(
    irFiles: Map<string, SourceFileIR>,
    runId: string,
    techHints: TechHints,
  ): DiscoveryCandidate[];
}

// Re-export SourceFileIR so consumers can `import { SourceFileIR } from
// 'services/extensionPacks'` via the barrel without reaching into
// `languageIR.ts` directly.
export type { SourceFileIR } from './languageIR';
