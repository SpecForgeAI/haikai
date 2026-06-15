/**
 * Rails Framework Pack (V3 `FrameworkPack`).
 *
 * Spec: V3 Pack Migration Batch (Task Group 5)
 *
 * Stage 2 producer for Ruby + Rails codebases. Consumes the IR map
 * emitted by `rubyLangPack` (the V3 Stage 1 producer) and delegates to
 * the existing deterministic `runRailsAdapter` to emit
 * `DiscoveryCandidate[]` tagged with `_addedBy: 'rails-adapter'`.
 *
 * The V2 `runRailsAdapter` signature takes a flat `SourceFileIR[]` array
 * plus `runId`. The V3 `FrameworkPack.adapt` contract passes
 * `Map<string, SourceFileIR>`; we convert the map's values into the flat
 * array here so no adapter-logic change is needed.
 *
 * Applicability predicate (`when`) requires BOTH `language: 'Ruby'` AND
 * `technology: 'Rails'` — per-field AND semantics preserved by
 * `matchesPredicate`.
 *
 * Candidate tagging (`_addedBy: 'rails-adapter'`) is unchanged from V2 —
 * downstream consumers and per-pack baseline gates rely on this tag shape.
 *
 * Detection surface (copied from the V2 adapter, unchanged):
 *   - interface: classes descending from `ApplicationController` /
 *     `ActionController::Base` / `ActionController::API`.
 *   - endpoint: conventional REST action methods
 *     (`index`, `show`, `new`, `edit`, `create`, `update`, `destroy`)
 *     on controller classes — verb + path inferred from the resource.
 *   - physical_entity: classes descending from `ApplicationRecord` /
 *     `ActiveRecord::Base`.
 *   - entity_relationship: `has_many`, `has_one`, `belongs_to`,
 *     `has_and_belongs_to_many` macros on ActiveRecord classes.
 *   - logical_entity + logical_data_attribute: classes descending from
 *     `ActiveModel::Serializer`, plus their `attributes` / `attribute`
 *     macro declarations.
 */

import type { FrameworkPack, TechHints } from '../../packTypes';
import type { SourceFileIR } from '../../languageIR';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import { runRailsAdapter } from '../../frameworkAdapters/rails';

export const railsFrameworkPack: FrameworkPack = {
  id: 'rails',
  when: { language: 'Ruby', technology: 'Rails' },

  adapt(
    irFiles: Map<string, SourceFileIR>,
    runId: string,
    _techHints: TechHints,
  ): DiscoveryCandidate[] {
    // V2 adapter takes a flat IR array; convert the Map values to preserve
    // the existing adapter shape without changing any adapter logic.
    const irArray = Array.from(irFiles.values());
    const candidates = runRailsAdapter(irArray, runId);
    console.log(
      `[rails] Emitted ${candidates.length} candidates from ${irArray.length} IR files.`,
    );
    return candidates;
  },
};
