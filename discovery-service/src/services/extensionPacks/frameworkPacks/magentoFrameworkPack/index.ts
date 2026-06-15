/**
 * Magento Framework Pack (V3 `FrameworkPack`).
 *
 * Spec: V3 Pack Migration Batch (Task Group 6)
 *
 * Stage 2 producer for PHP + Magento codebases (Magento 1 LTS +
 * Magento 2). Consumes the IR map emitted by `phpLangPack` (the V3
 * Stage 1 producer) and delegates to the existing deterministic
 * `runMagentoAdapter` to emit `DiscoveryCandidate[]` tagged with
 * `_addedBy: 'magento-adapter'`.
 *
 * The V2 `runMagentoAdapter` signature takes a flat `SourceFileIR[]`
 * array plus `runId`. The V3 `FrameworkPack.adapt` contract passes
 * `Map<string, SourceFileIR>`; we convert the map's values into the
 * flat array here so no adapter-logic change is needed.
 *
 * Applicability predicate (`when`) requires BOTH `language: 'PHP'` AND
 * `technology: 'Magento'` — per-field AND semantics preserved by
 * `matchesPredicate`. WordPress / Symfony techHints do NOT match; they
 * flow to the other two PHP FrameworkPacks.
 *
 * Candidate tagging (`_addedBy: 'magento-adapter'`) is unchanged from
 * V2 — downstream consumers and per-pack baseline gates rely on this
 * tag shape.
 *
 * Note on `php-legacy` IR tag: the V2 `magentoPackV2` used a thin
 * `extractPhpLegacyIR` wrapper that re-tagged the IR's `language` field
 * as `'php-legacy'`. `runMagentoAdapter` does NOT inspect the
 * `language` field — it keys off `cls.extends` pattern matches — so the
 * single shared `phpLangPack` (producing `language: 'php'` IR) is
 * functionally equivalent. The per-pack baseline gate against
 * magento-lts confirms parity.
 *
 * Detection surface (copied from the V2 adapter, unchanged):
 *   - interface: classes extending `Mage_Core_Controller_*`,
 *     `Magento\\Framework\\App\\Action\\Action`, or whose `extends`
 *     ends with `Action` / `AbstractAction`.
 *   - physical_entity: classes extending `Mage_Core_Model_Abstract`,
 *     `AbstractModel`, or matching `Framework.*AbstractModel`.
 *   - ui_component: classes extending `Mage_Core_Block_*`,
 *     `AbstractBlock`, or `Template`.
 *
 * Gaps (deliberately out of scope in the adapter — the framework
 * prompt layer surfaces these for LLM follow-up):
 *   - `etc/module.xml` module declarations.
 *   - `etc/events.xml` observers.
 *   - `etc/di.xml` interface preferences + virtual types + plugins
 *     (interceptors).
 *   - Layout XML / UI component XML config.
 *   - Cron jobs via `etc/crontab.xml`.
 */

import type { FrameworkPack, TechHints } from '../../packTypes';
import type { SourceFileIR } from '../../languageIR';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import { runMagentoAdapter } from '../../frameworkAdapters/magento';

export const magentoFrameworkPack: FrameworkPack = {
  id: 'magento',
  when: { language: 'PHP', technology: 'Magento' },

  adapt(
    irFiles: Map<string, SourceFileIR>,
    runId: string,
    _techHints: TechHints,
  ): DiscoveryCandidate[] {
    // V2 adapter takes a flat IR array; convert the Map values to preserve
    // the existing adapter shape without changing any adapter logic.
    const irArray = Array.from(irFiles.values());
    const candidates = runMagentoAdapter(irArray, runId);
    console.log(
      `[magento] Emitted ${candidates.length} candidates from ${irArray.length} IR files.`,
    );
    return candidates;
  },
};
