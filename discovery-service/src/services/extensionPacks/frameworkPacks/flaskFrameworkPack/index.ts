/**
 * Flask Framework Pack (V3 `FrameworkPack`).
 *
 * Spec: V3 Pack Migration Batch (Task Group 4)
 *
 * Stage 2 producer for Python + Flask codebases. Consumes the IR map
 * emitted by `pythonLangPack` (the V3 Stage 1 producer) and delegates to
 * the existing deterministic `runFlaskAdapter` to emit
 * `DiscoveryCandidate[]` tagged with `_addedBy: 'flask-adapter'`.
 *
 * The V2 `runFlaskAdapter` signature takes a flat `SourceFileIR[]` array
 * plus `runId`. The V3 `FrameworkPack.adapt` contract passes
 * `Map<string, SourceFileIR>`; we convert the map's values into the flat
 * array here so no adapter-logic change is needed.
 *
 * Applicability predicate (`when`) requires BOTH `language: 'Python'` AND
 * `technology: 'Flask'` — per-field AND semantics preserved by
 * `matchesPredicate`. Django techHints (`{ technology: 'Django' }`) do
 * NOT match; they flow to `djangoFrameworkPack`.
 *
 * Candidate tagging (`_addedBy: 'flask-adapter'`) is unchanged from V2 —
 * downstream consumers and per-pack baseline gates rely on this tag shape.
 *
 * Detection surface (copied from the V2 adapter, unchanged):
 *   - endpoint: `@app.route` / `@app.get` / `@app.post` / `@bp.route`
 *     decorator-annotated functions.
 *   - physical_entity: SQLAlchemy `db.Model` / `Base` subclasses.
 *   - physical_attribute: `db.Column()` field assignments.
 *   - entity_relationship: `db.relationship()` assignments.
 *   - logical_entity + logical_data_attribute: Marshmallow `Schema`,
 *     WTForms `Form` classes.
 */

import type { FrameworkPack, TechHints } from '../../packTypes';
import type { SourceFileIR } from '../../languageIR';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import { runFlaskAdapter } from '../../frameworkAdapters/flask';

export const flaskFrameworkPack: FrameworkPack = {
  id: 'flask',
  when: { language: 'Python', technology: 'Flask' },

  adapt(
    irFiles: Map<string, SourceFileIR>,
    runId: string,
    _techHints: TechHints,
  ): DiscoveryCandidate[] {
    // V2 adapter takes a flat IR array; convert the Map values to preserve
    // the existing adapter shape without changing any adapter logic.
    const irArray = Array.from(irFiles.values());
    const candidates = runFlaskAdapter(irArray, runId);
    console.log(
      `[flask] Emitted ${candidates.length} candidates from ${irArray.length} IR files.`,
    );
    return candidates;
  },
};
