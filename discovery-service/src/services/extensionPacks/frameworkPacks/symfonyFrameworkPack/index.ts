/**
 * Symfony Framework Pack (V3 `FrameworkPack`).
 *
 * Spec: V3 Pack Migration Batch (Task Group 6)
 *
 * Stage 2 producer for PHP + Symfony codebases. Consumes the IR map
 * emitted by `phpLangPack` (the V3 Stage 1 producer) and delegates to
 * the existing deterministic `runSymfonyAdapter` to emit
 * `DiscoveryCandidate[]` tagged with `_addedBy: 'symfony-adapter'`.
 *
 * The V2 `runSymfonyAdapter` signature takes a flat `SourceFileIR[]`
 * array plus `runId`. The V3 `FrameworkPack.adapt` contract passes
 * `Map<string, SourceFileIR>`; we convert the map's values into the flat
 * array here so no adapter-logic change is needed.
 *
 * Applicability predicate (`when`) requires BOTH `language: 'PHP'` AND
 * `technology: 'Symfony'` — per-field AND semantics preserved by
 * `matchesPredicate`. WordPress / Magento techHints do NOT match; they
 * flow to the other two PHP FrameworkPacks.
 *
 * Candidate tagging (`_addedBy: 'symfony-adapter'`) is unchanged from
 * V2 — downstream consumers and per-pack baseline gates rely on this
 * tag shape.
 *
 * Detection surface (copied from the V2 adapter, unchanged):
 *   - interface: classes whose `extends` ends with `Controller` or
 *     `AbstractController`, or that carry `#[AsController]`.
 *   - endpoint: method-level `#[Route]` attributes on controllers,
 *     combined with the class-level `#[Route]` base path.
 *   - physical_entity: classes with `#[ORM\Entity]` or `#[Entity]`
 *     attributes (Doctrine PHP 8 attribute mapping).
 *   - physical_attribute: fields with `#[ORM\Column]` / `#[ORM\Id]`.
 *   - entity_relationship: fields with `#[ORM\OneToMany]` /
 *     `ManyToOne` / `OneToOne` / `ManyToMany`.
 *
 * Gaps (deliberately out of scope in the adapter — the framework
 * prompt layer surfaces these for LLM follow-up):
 *   - PHPDoc `@Route` / `@ORM\Entity` annotations (Symfony 3/4 era).
 *   - DI container XML/YAML service definitions.
 *   - Event subscribers, voters, form types, validators,
 *     twig extensions, console commands, message handlers.
 */

import type { FrameworkPack, TechHints } from '../../packTypes';
import type { SourceFileIR } from '../../languageIR';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import { runSymfonyAdapter } from '../../frameworkAdapters/symfony';

export const symfonyFrameworkPack: FrameworkPack = {
  id: 'symfony',
  when: { language: 'PHP', technology: 'Symfony' },

  adapt(
    irFiles: Map<string, SourceFileIR>,
    runId: string,
    _techHints: TechHints,
  ): DiscoveryCandidate[] {
    // V2 adapter takes a flat IR array; convert the Map values to preserve
    // the existing adapter shape without changing any adapter logic.
    const irArray = Array.from(irFiles.values());
    const candidates = runSymfonyAdapter(irArray, runId);
    console.log(
      `[symfony] Emitted ${candidates.length} candidates from ${irArray.length} IR files.`,
    );
    return candidates;
  },
};
