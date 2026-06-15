/**
 * Django Framework Pack (V3 `FrameworkPack`).
 *
 * Spec: V3 Pack Migration Batch (Task Group 4)
 *
 * Stage 2 producer for Python + Django codebases. Consumes the IR map
 * emitted by `pythonLangPack` (the V3 Stage 1 producer) and delegates to
 * the existing deterministic `runDjangoAdapter` to emit
 * `DiscoveryCandidate[]` tagged with `_addedBy: 'django-adapter'`.
 *
 * The V2 `runDjangoAdapter` signature takes a flat `SourceFileIR[]` array
 * plus `runId`. The V3 `FrameworkPack.adapt` contract passes
 * `Map<string, SourceFileIR>`; we convert the map's values into the flat
 * array here so no adapter-logic change is needed.
 *
 * Applicability predicate (`when`) requires BOTH `language: 'Python'` AND
 * `technology: 'Django'` — per-field AND semantics preserved by
 * `matchesPredicate`. Flask techHints (`{ technology: 'Flask' }`) do NOT
 * match; they flow to `flaskFrameworkPack`.
 *
 * Candidate tagging (`_addedBy: 'django-adapter'`) is unchanged from V2 —
 * downstream consumers and per-pack baseline gates rely on this tag shape.
 *
 * Detection surface (copied from the V2 adapter, unchanged):
 *   - physical_entity: classes descending from `models.Model`.
 *   - physical_attribute: class-body assignments to `models.*Field()`.
 *   - entity_relationship: `ForeignKey`, `OneToOneField`, `ManyToManyField`.
 *   - interface: class-based views extending `APIView` / `ModelViewSet`
 *     / `ListView` / etc.
 *   - endpoint: `path()` / `url()` / `re_path()` declarations in urls.py.
 *   - logical_entity + logical_data_attribute: DRF Serializer, ModelForm,
 *     Form classes.
 *   - business_logic: non-CRUD module-level functions in services.py,
 *     utils.py, or under `services/`, `domain/`, `business/` directories.
 */

import type { FrameworkPack, TechHints } from '../../packTypes';
import type { SourceFileIR } from '../../languageIR';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import { runDjangoAdapter } from '../../frameworkAdapters/django';

export const djangoFrameworkPack: FrameworkPack = {
  id: 'django',
  when: { language: 'Python', technology: 'Django' },

  adapt(
    irFiles: Map<string, SourceFileIR>,
    runId: string,
    _techHints: TechHints,
  ): DiscoveryCandidate[] {
    // V2 adapter takes a flat IR array; convert the Map values to preserve
    // the existing adapter shape without changing any adapter logic.
    const irArray = Array.from(irFiles.values());
    const candidates = runDjangoAdapter(irArray, runId);
    console.log(
      `[django] Emitted ${candidates.length} candidates from ${irArray.length} IR files.`,
    );
    return candidates;
  },
};
