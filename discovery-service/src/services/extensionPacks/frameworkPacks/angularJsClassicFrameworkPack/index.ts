/**
 * AngularJS 1.x (Classic) Framework Pack (V3 `FrameworkPack`).
 *
 * 2026-04-22: new pack covering legacy AngularJS 1.x codebases — distinct
 * from the existing `angular` pack (which targets Angular 2+ TypeScript).
 *
 * Activation: `{ language: 'JavaScript', technology: 'AngularJS' }` per
 * the per-field AND predicate convention. The tech-hint resolver is
 * expected to emit `AngularJS` (distinct from `Angular`) for core_tech
 * hints such as `"angular 1.4.1"` — the resolver uses the registered
 * pack list as its closed set, so simply registering this pack makes it
 * available.
 *
 * The V3 `FrameworkPack.adapt` contract passes `Map<string, SourceFileIR>`
 * but the legacy AngularJS detection also consumes `.html` templates
 * (never extracted by a language pack). We forward the raw source-file
 * map through the optional third parameter of
 * `runAngularJsClassicAdapter`. Today the V3 orchestrator does not make
 * the raw map available to framework packs, so this runs in
 * JS-only mode until that hook is added; the adapter still emits all
 * candidate types from .js alone.
 */

import type { FrameworkPack, TechHints } from '../../packTypes';
import type { SourceFileIR } from '../../languageIR';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import { runAngularJsClassicAdapter } from '../../frameworkAdapters/angularJsClassic';

export const angularJsClassicFrameworkPack: FrameworkPack = {
  id: 'angularjs-classic',
  when: { language: 'JavaScript', technology: 'AngularJS' },

  adapt(
    irFiles: Map<string, SourceFileIR>,
    runId: string,
    _techHints: TechHints,
  ): DiscoveryCandidate[] {
    const irArray = Array.from(irFiles.values());
    const candidates = runAngularJsClassicAdapter(irArray, runId);
    console.log(
      `[angularjs-classic] Emitted ${candidates.length} candidates from ${irArray.length} IR files.`,
    );
    return candidates;
  },
};
