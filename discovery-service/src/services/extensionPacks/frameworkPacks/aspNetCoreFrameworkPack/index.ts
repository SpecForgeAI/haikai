/**
 * ASP.NET Core Framework Pack (V3 `FrameworkPack`).
 *
 * Spec: V3 Pack Migration Batch (Task Group 8)
 *
 * Stage 2 producer for C# + ASP.NET Core codebases. Consumes the IR
 * map emitted by `csharpLangPack` (the V3 Stage 1 producer) and
 * delegates to the existing deterministic `runAspNetCoreAdapter` to
 * emit `DiscoveryCandidate[]` tagged with `_addedBy: 'aspnetcore-adapter'`.
 *
 * The V2 `runAspNetCoreAdapter` signature takes a flat `SourceFileIR[]`
 * array plus `runId`. The V3 `FrameworkPack.adapt` contract passes
 * `Map<string, SourceFileIR>`; we convert the map's values into the
 * flat array here so no adapter-logic change is needed.
 *
 * Applicability predicate (`when`) requires BOTH `language: 'C#'` AND
 * `technology: 'ASP.NET Core'` — per-field AND semantics preserved by
 * `matchesPredicate`. ASP.NET (Framework) techHints do NOT match;
 * they flow to `aspNetFrameworkFrameworkPack`.
 *
 * Candidate tagging (`_addedBy: 'aspnetcore-adapter'`) is unchanged
 * from V2 — downstream consumers and per-pack baseline gates rely on
 * this tag shape.
 *
 * Detection surface (copied from the V2 adapter, unchanged):
 *   - interface: classes annotated with `[ApiController]` / `[Controller]`
 *     OR whose base type ends with `Controller` / `ControllerBase` —
 *     `controllerType: 'AspNetCoreController'`.
 *   - endpoint: methods on controllers carrying `[HttpGet]` / `[HttpPost]`
 *     / `[HttpPut]` / `[HttpDelete]` / `[HttpPatch]` / `[HttpOptions]`
 *     / `[HttpHead]` attributes. Full path composed from class-level
 *     `[Route]` (with `[controller]` token substitution) + method-level
 *     verb attribute argument.
 *   - physical_entity: each `DbSet<T>` property on a class extending
 *     `DbContext` (entity name = type parameter, table name = field
 *     name).
 *   - physical_entity + physical_attribute: classes annotated with
 *     `[Table("name")]` (Data Annotations POCO entities). Each field
 *     becomes a `physical_attribute`; `[Key]` flags primary key,
 *     `[Column("name")]` overrides column name, `[NotMapped]` skips.
 *   - logical_entity + logical_data_attribute: DTO classes referenced
 *     from controller method bodies via `[FromBody]` parameter type
 *     OR action-method return-type generic argument (e.g.
 *     `ActionResult<List<ProductDto>>` → `ProductDto`).
 *
 * Known low quality on real-world repos (eShopOnWeb baseline 36
 * candidates) — many ASP.NET Core apps use minimal APIs (`app.MapGet`
 * / `app.MapPost`), Ardalis.ApiEndpoints (`EndpointBaseAsync`), or
 * Fluent EF Core configuration (`OnModelCreating` + `IEntityTypeConfiguration`)
 * none of which match the deterministic patterns above. See
 * `evaluation/FIXTURES-TODO.md` for the captured follow-up. Prompt
 * layer (`prompts/frameworks/asp-net-core.md`) targets these misses
 * for LLM gap-fill.
 */

import type { FrameworkPack, TechHints } from '../../packTypes';
import type { SourceFileIR } from '../../languageIR';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import { runAspNetCoreAdapter } from '../../frameworkAdapters/aspNetCore';

export const aspNetCoreFrameworkPack: FrameworkPack = {
  id: 'asp-net-core',
  when: { language: 'C#', technology: 'ASP.NET Core' },

  adapt(
    irFiles: Map<string, SourceFileIR>,
    runId: string,
    _techHints: TechHints,
  ): DiscoveryCandidate[] {
    // V2 adapter takes a flat IR array; convert the Map values to preserve
    // the existing adapter shape without changing any adapter logic.
    const irArray = Array.from(irFiles.values());
    const candidates = runAspNetCoreAdapter(irArray, runId);
    console.log(
      `[asp-net-core] Emitted ${candidates.length} candidates from ${irArray.length} IR files.`,
    );
    return candidates;
  },
};
