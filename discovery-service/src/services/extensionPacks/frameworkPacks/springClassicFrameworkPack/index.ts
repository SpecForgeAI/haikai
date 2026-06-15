/**
 * Spring Classic Framework Pack (V3 `FrameworkPack`).
 *
 * Spec: V3 Discovery Pipeline Foundation (Task Group 4)
 *
 * Stage 2 producer for annotation-era classic Spring (3.x / 4.x / 5.x,
 * non-Boot). Consumes the IR map emitted by `javaLangPack` (the V3
 * Stage 1 producer) and delegates to the existing deterministic
 * `runSpringClassicAdapter` to emit `DiscoveryCandidate[]` tagged with
 * `_addedBy: 'spring-classic-adapter'`.
 *
 * The V2 `runSpringClassicAdapter` signature takes a flat
 * `SourceFileIR[]` array plus `runId`. The V3 `FrameworkPack.adapt`
 * contract passes `Map<string, SourceFileIR>`; we convert the map's
 * values into the flat array here so no adapter-logic change is needed.
 *
 * Applicability predicate (`when`) requires BOTH `language: 'Java'` AND
 * `technology: 'Spring'` — this is the classic-vs-Boot per-field AND
 * distinction preserved by `matchesPredicate`. Classic-Spring techHints
 * (hints like `{ language: 'Java' }` + `{ technology: 'Spring' }`) match;
 * Spring-Boot techHints (`{ technology: 'Spring Boot' }`) do NOT.
 *
 * Candidate tagging (`_addedBy: 'spring-classic-adapter'`) remains
 * unchanged — downstream consumers and OpenMRS parity spot-checks
 * (Task Group 7) rely on this tag shape.
 */

import type { FrameworkPack, TechHints } from '../../packTypes';
import type { SourceFileIR } from '../../languageIR';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import { runSpringClassicAdapter } from '../../frameworkAdapters/springClassic';

export const springClassicFrameworkPack: FrameworkPack = {
  id: 'spring-classic',
  when: { language: 'Java', technology: 'Spring' },

  adapt(
    irFiles: Map<string, SourceFileIR>,
    runId: string,
    _techHints: TechHints,
  ): DiscoveryCandidate[] {
    // V2 adapter takes a flat IR array; convert the Map values to preserve
    // the existing adapter shape without changing any adapter logic.
    const irArray = Array.from(irFiles.values());
    const candidates = runSpringClassicAdapter(irArray, runId);
    console.log(
      `[spring-classic] Emitted ${candidates.length} candidates from ${irArray.length} IR files.`,
    );
    return candidates;
  },
};
