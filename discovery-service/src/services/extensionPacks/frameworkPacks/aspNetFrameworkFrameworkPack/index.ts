/**
 * ASP.NET Framework (MVC 3/4/5 + Web API) Framework Pack
 * (V3 `FrameworkPack`).
 *
 * Spec: V3 Pack Migration Batch (Task Group 8)
 *
 * Stage 2 producer for legacy C# + ASP.NET Framework (.NET Framework
 * 3.5/4.x) codebases. Consumes the IR map emitted by `csharpLangPack`
 * (the V3 Stage 1 producer) and delegates to the existing
 * deterministic `runAspNetFrameworkAdapter` to emit
 * `DiscoveryCandidate[]` tagged with `_addedBy: 'aspnet-framework-adapter'`.
 *
 * The V2 `runAspNetFrameworkAdapter` signature takes a flat
 * `SourceFileIR[]` array plus `runId`. The V3 `FrameworkPack.adapt`
 * contract passes `Map<string, SourceFileIR>`; we convert the map's
 * values into the flat array here so no adapter-logic change is
 * needed.
 *
 * Applicability predicate (`when`) requires BOTH `language: 'C#'`
 * AND `technology: 'ASP.NET'` — per-field AND semantics preserved by
 * `matchesPredicate`. ASP.NET Core techHints do NOT match; they flow
 * to `aspNetCoreFrameworkPack`. The pack-id `'asp-net-framework'`
 * intentionally mirrors the V2 pack id (per spec task 8.5 — naming is
 * intentional).
 *
 * Note: the V2 `aspNetFrameworkPackV2` used a thin
 * `extractCSharpNetFxIR` wrapper that re-tagged the IR's `language`
 * field as `'csharp-netfx'`. `runAspNetFrameworkAdapter` does NOT
 * inspect the `language` field — it delegates to
 * `runAspNetCoreAdapter` keyed off attribute + base-type heuristics
 * — so the single shared `csharpLangPack` (producing
 * `language: 'csharp'` IR) is functionally equivalent. Same pattern
 * as `phpLangPack` / `magentoFrameworkPack` (which similarly bridges
 * the legacy `php-legacy` IR tag).
 *
 * Candidate tagging (`_addedBy: 'aspnet-framework-adapter'`) is
 * unchanged from V2 — downstream consumers and per-pack baseline
 * gates rely on this tag shape. The adapter explicitly swaps the
 * inner `aspnetcore-adapter` tag to `aspnet-framework-adapter` so
 * provenance stays distinguishable when both packs run.
 *
 * Detection surface (delegated to `runAspNetCoreAdapter`, unchanged):
 *   - The aspnet-core adapter's controller-detection regex matches
 *     any class whose base type ends with `Controller` /
 *     `ControllerBase`, plus any class annotated `[ApiController]` /
 *     `[Controller]`. This already covers classic MVC
 *     (`class FooController : Controller`), Web API 2
 *     (`class FooController : ApiController`), and modern API
 *     controllers — so the framework pack reuses the core adapter
 *     directly with only the provenance tag swap.
 *   - HTTP-verb attributes (`[HttpGet]` / `[HttpPost]` / etc.) on
 *     methods produce `endpoint` candidates (with `[Route]`
 *     composition).
 *   - `DbSet<T>` properties on `DbContext` subclasses produce
 *     `physical_entity` candidates.
 *   - `[Table]` POCOs with Data Annotations produce
 *     `physical_entity` + `physical_attribute` candidates.
 *
 * Gaps (deliberately out of scope in the adapter — the framework
 * prompt layer surfaces these for LLM follow-up):
 *   - `Global.asax` `Application_Start` lifecycle.
 *   - `Web.config` connection strings, authentication mode,
 *     `<system.web>` configuration, `<httpModules>` /
 *     `<httpHandlers>` / `<modules>` / `<handlers>`.
 *   - OWIN middleware (`Startup.Configuration(IAppBuilder)`).
 *   - Route registration in `App_Start/RouteConfig.cs` /
 *     `WebApiConfig.cs` (`routes.MapRoute(...)`,
 *     `config.Routes.MapHttpRoute(...)`).
 *   - MEF composition (`[Export]` / `[Import]` /
 *     `CompositionContainer`).
 *   - Classic WebForms (`*.aspx` / `*.ascx` + code-behind
 *     `Page_Load`).
 *   - `IHttpModule` / `IHttpHandler` implementations.
 */

import type { FrameworkPack, TechHints } from '../../packTypes';
import type { SourceFileIR } from '../../languageIR';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import { runAspNetFrameworkAdapter } from '../../frameworkAdapters/aspNetFramework';

export const aspNetFrameworkFrameworkPack: FrameworkPack = {
  id: 'asp-net-framework',
  when: { language: 'C#', technology: 'ASP.NET' },

  adapt(
    irFiles: Map<string, SourceFileIR>,
    runId: string,
    _techHints: TechHints,
  ): DiscoveryCandidate[] {
    // V2 adapter takes a flat IR array; convert the Map values to preserve
    // the existing adapter shape without changing any adapter logic.
    const irArray = Array.from(irFiles.values());
    const candidates = runAspNetFrameworkAdapter(irArray, runId);
    console.log(
      `[asp-net-framework] Emitted ${candidates.length} candidates from ${irArray.length} IR files.`,
    );
    return candidates;
  },
};
