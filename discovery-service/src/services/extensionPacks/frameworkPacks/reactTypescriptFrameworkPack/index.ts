/**
 * React/TypeScript Framework Pack (V3 `FrameworkPack`).
 *
 * Spec: V3 Pack Migration Batch (Task Group 3)
 *
 * Stage 2 producer for React + TypeScript codebases (plus axios/fetch
 * call-site detection). Consumes the IR map emitted by
 * `typescriptLangPack` and delegates to the existing deterministic
 * `runReactAxiosAdapter` to emit `DiscoveryCandidate[]` tagged with
 * `_addedBy: 'react-axios-adapter'`.
 *
 * The V2 adapter signature takes a flat `SourceFileIR[]` plus `runId`.
 * The V3 `FrameworkPack.adapt` contract passes `Map<string, SourceFileIR>`;
 * we convert the map's values into the flat array here so no adapter-logic
 * change is needed.
 *
 * Applicability predicate (`when`) requires BOTH `language: 'TypeScript'`
 * AND `technology: 'React'` — per-field AND semantics preserved by
 * `matchesPredicate`.
 *
 * Known quality caveat (migration note): the V2 pack historically emits
 * only ~9 candidates on `react-redux-realworld`. Structural migration
 * preserves this behaviour. Detection-quality improvements (custom hook
 * composition, Context providers with business state, Redux slices,
 * middleware, SSR patterns) are deferred per spec — see
 * `evaluation/FIXTURES-TODO.md` for the TODO note.
 */

import type { FrameworkPack, TechHints } from '../../packTypes';
import type { SourceFileIR } from '../../languageIR';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import { runReactAxiosAdapter } from '../../frameworkAdapters/reactAxios';

export const reactTypescriptFrameworkPack: FrameworkPack = {
  id: 'react-typescript',
  when: { language: 'TypeScript', technology: 'React' },

  adapt(
    irFiles: Map<string, SourceFileIR>,
    runId: string,
    _techHints: TechHints,
  ): DiscoveryCandidate[] {
    const irArray = Array.from(irFiles.values());
    const candidates = runReactAxiosAdapter(irArray, runId);
    console.log(
      `[react-typescript] Emitted ${candidates.length} candidates from ${irArray.length} IR files.`,
    );
    return candidates;
  },
};
