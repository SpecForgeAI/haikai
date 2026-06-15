/**
 * React (JavaScript) Framework Pack (V3 `FrameworkPack`).
 *
 * Spec: V3 Pack Migration Batch (Task Group 9)
 *
 * Stage 2 producer for React + plain JavaScript codebases (.js / .jsx,
 * not TypeScript). Consumes the IR map emitted by `javascriptLangPack`
 * (the V3 Stage 1 producer) and delegates to the existing
 * deterministic `runReactAxiosAdapter` to emit `DiscoveryCandidate[]`
 * tagged with `_addedBy: 'react-axios-adapter'`.
 *
 * The V2 adapter signature takes a flat `SourceFileIR[]` plus `runId`.
 * The V3 `FrameworkPack.adapt` contract passes
 * `Map<string, SourceFileIR>`; we convert the map's values into the
 * flat array here so no adapter-logic change is needed.
 *
 * Why share `runReactAxiosAdapter` with `reactTypescriptFrameworkPack`:
 *  - The adapter's heuristics (PascalCase function components, JSX
 *    return types, .tsx/.jsx file detection, axios/fetch call-site
 *    extraction) work identically on JS and TS IR. Type annotations
 *    simply do not appear in the JS IR — that is fine, they were not
 *    used by the heuristics anyway.
 *  - The `_addedBy: 'react-axios-adapter'` tag is intentionally shared
 *    across both React framework packs because the producing logic is
 *    shared. Downstream callers can still distinguish via the pack id
 *    (`react-typescript` vs `react-javascript`) on the candidate's
 *    pack-pair selection rather than the `_addedBy` tag.
 *
 * Applicability predicate (`when`) requires BOTH `language: 'JavaScript'`
 * AND `technology: 'React'` — per-field AND semantics preserved by
 * `matchesPredicate`. TypeScript React techHints do NOT match; they
 * flow to `reactTypescriptFrameworkPack`.
 *
 * Known low quality on real-world repos (see the migrate-first +
 * TODOs section in `evaluation/FIXTURES-TODO.md`):
 *  - V2 baseline on `react-redux-realworld` is ~9 candidates across
 *    the entire repo. The adapter detects component / page shells but
 *    misses Redux slices, custom hook compositions, Context providers,
 *    saga/thunk middleware, etc. Structural migration to V3 preserves
 *    the V2 behaviour exactly — quality fixes are Spec-4 follow-up
 *    work. The prompt layer (`prompts/frameworks/react-javascript.md`)
 *    cross-references `react-typescript.md` and adds JS-specific
 *    cues (class components via `React.createClass`, prototype-based
 *    component definitions, plain-JS hook compositions).
 */

import type { FrameworkPack, TechHints } from '../../packTypes';
import type { SourceFileIR } from '../../languageIR';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import { runReactAxiosAdapter } from '../../frameworkAdapters/reactAxios';

export const reactJavascriptFrameworkPack: FrameworkPack = {
  id: 'react-javascript',
  when: { language: 'JavaScript', technology: 'React' },

  adapt(
    irFiles: Map<string, SourceFileIR>,
    runId: string,
    _techHints: TechHints,
  ): DiscoveryCandidate[] {
    // V2 adapter takes a flat IR array; convert the Map values to preserve
    // the existing adapter shape without changing any adapter logic.
    const irArray = Array.from(irFiles.values());
    const candidates = runReactAxiosAdapter(irArray, runId);
    console.log(
      `[react-javascript] Emitted ${candidates.length} candidates from ${irArray.length} IR files.`,
    );
    return candidates;
  },
};
