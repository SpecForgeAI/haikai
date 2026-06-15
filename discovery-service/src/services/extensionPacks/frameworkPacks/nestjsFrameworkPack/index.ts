/**
 * NestJS Framework Pack (V3 `FrameworkPack`).
 *
 * Spec: V3 Pack Migration Batch (Task Group 3)
 *
 * Stage 2 producer for NestJS backend codebases. Consumes the IR map
 * emitted by `typescriptLangPack` and delegates to the existing
 * deterministic `runNestjsAdapter` to emit `DiscoveryCandidate[]` tagged
 * with `_addedBy: 'nestjs-adapter'`.
 *
 * The V2 adapter signature takes a flat `SourceFileIR[]` plus `runId`.
 * The V3 `FrameworkPack.adapt` contract passes `Map<string, SourceFileIR>`;
 * we convert the map's values into the flat array here so no adapter-logic
 * change is needed.
 *
 * Applicability predicate (`when`) requires BOTH `language: 'TypeScript'`
 * AND `technology: 'NestJS'` — per-field AND semantics preserved by
 * `matchesPredicate`.
 *
 * Candidate tagging (`_addedBy: 'nestjs-adapter'`) remains unchanged —
 * downstream consumers and per-pack baseline gates rely on this tag shape.
 */

import type { FrameworkPack, TechHints } from '../../packTypes';
import type { SourceFileIR } from '../../languageIR';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import { runNestjsAdapter } from '../../frameworkAdapters/nestjs';

export const nestjsFrameworkPack: FrameworkPack = {
  id: 'nestjs',
  when: { language: 'TypeScript', technology: 'NestJS' },

  adapt(
    irFiles: Map<string, SourceFileIR>,
    runId: string,
    _techHints: TechHints,
  ): DiscoveryCandidate[] {
    const irArray = Array.from(irFiles.values());
    const candidates = runNestjsAdapter(irArray, runId);
    console.log(
      `[nestjs] Emitted ${candidates.length} candidates from ${irArray.length} IR files.`,
    );
    return candidates;
  },
};
