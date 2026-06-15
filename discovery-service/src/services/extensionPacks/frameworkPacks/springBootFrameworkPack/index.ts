/**
 * Spring Boot Framework Pack (V3 `FrameworkPack`).
 *
 * Spec: V3 Pack Migration Batch (Task Group 2)
 *
 * Stage 2 producer for annotation-era Spring Boot (2.x / 3.x). Consumes
 * the IR map emitted by `javaLangPack` (the V3 Stage 1 producer) and
 * delegates to the existing deterministic `runSpringBootAdapter` to emit
 * `DiscoveryCandidate[]` tagged with `_addedBy: 'spring-boot-adapter'`.
 *
 * The V2 `runSpringBootAdapter` signature takes a flat `SourceFileIR[]`
 * array plus `runId`. The V3 `FrameworkPack.adapt` contract passes
 * `Map<string, SourceFileIR>`; we convert the map's values into the flat
 * array here so no adapter-logic change is needed.
 *
 * Applicability predicate (`when`) requires BOTH `language: 'Java'` AND
 * `technology: 'Spring Boot'` — this is the classic-vs-Boot per-field AND
 * distinction preserved by `matchesPredicate`. Spring Boot techHints
 * (`{ language: 'Java' }` + `{ technology: 'Spring Boot' }`) match;
 * classic-Spring techHints (`{ technology: 'Spring' }`) do NOT.
 *
 * Candidate tagging (`_addedBy: 'spring-boot-adapter'`) remains unchanged
 * — downstream consumers and per-pack baseline gates rely on this tag
 * shape.
 */

import type { FrameworkPack, TechHints } from '../../packTypes';
import type { SourceFileIR } from '../../languageIR';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import { runSpringBootAdapter } from '../../frameworkAdapters/springBoot';

export const springBootFrameworkPack: FrameworkPack = {
  id: 'java-spring-boot',
  when: { language: 'Java', technology: 'Spring Boot' },

  adapt(
    irFiles: Map<string, SourceFileIR>,
    runId: string,
    _techHints: TechHints,
  ): DiscoveryCandidate[] {
    // V2 adapter takes a flat IR array; convert the Map values to preserve
    // the existing adapter shape without changing any adapter logic.
    const irArray = Array.from(irFiles.values());
    const candidates = runSpringBootAdapter(irArray, runId);
    console.log(
      `[java-spring-boot] Emitted ${candidates.length} candidates from ${irArray.length} IR files.`,
    );
    return candidates;
  },
};
