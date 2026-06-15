# Specification: V3 Pack Migration Batch

## Goal
Migrate the remaining 17 V2 framework packs to the V3 `LanguagePack` + `FrameworkPack` shape (with prompt layers, fixtures, baselines, and migrated smoke tests for each), then atomically remove the V2 pipeline codepaths so V3 is the only discovery pipeline.

## User Stories
- As a discovery-service maintainer, I want every framework pack to live in the V3 shape so that there is a single, consistent extension model and the V2 dual-path can be deleted.
- As a pack author, I want a reusable per-language `LanguagePack` plus per-framework `FrameworkPack` and prompt layer so that adding or improving framework support does not require duplicating file-filter or IR-extract logic.
- As a release engineer, I want per-pack baselines and a 98% candidate-count gate so that no migration silently regresses detection coverage.

## Specific Requirements

**Stack-ordered migration waves**
- Organize migration into 10 stack waves matching Q12 order: Java, TypeScript, Python, Ruby, PHP, Go, C#, JavaScript, C++, then V2 removal.
- Each wave is a complete vertical slice: language pack (new or reused) + every framework pack in the stack + prompt layers + fixtures + baselines + smoke tests + per-pack gate.
- Each wave must be independently ship-able and reviewable; aim for ~10-12 task groups total.
- Within waves, framework packs migrate sequentially after the shared language pack is in place.

**Language pack creation (8 new + 1 reused)**
- Reuse existing `javaLangPack` for the Java wave (spring-boot joins spring-classic).
- Create `typescriptLangPack` shared by react-typescript, nestjs, angular.
- Create `pythonLangPack` (django, flask), `rubyLangPack` (rails), `phpLangPack` (wordpress, symfony, magento).
- Create `goLangPack` (kratos), `csharpLangPack` (asp-net-core, asp-net-framework).
- Create `javascriptLangPack` (react-javascript, jquery) as a separate pack from typescript because today's V2 extractors differ.
- Create `cppLangPack` (wxwidgets, oatpp).
- Each new language pack lifts the file-filter + IR-extract logic from the existing `languageExtractors/<lang>/index.ts`.

**Framework pack creation (17 packs)**
- Each framework pack is created under `frameworkPacks/<framework>FrameworkPack/` using `springClassicFrameworkPack/` as the template.
- Adapter logic is lifted from the V2 `frameworkAdapters/<framework>/index.ts` and the V2 `<framework>PackV2/index.ts`.
- Each pack is registered in `register.ts`; the V2 registration is removed only when its V3 equivalent ships and passes the gate.
- Per-field AND predicate behavior in `services/extensionPackRegistry.ts::matchesPredicate` continues to apply.

**Prompt layer authoring (15 framework + 7 new language layers)**
- Author one `prompts/frameworks/<pack-id>.md` per framework (15 new files; spring-classic exists, java-spring-boot is new).
- Author one `prompts/languages/<lang>.md` per new language pack (7 new files: python, ruby, php, go, csharp, javascript, cpp; java + typescript already exist from Spec 2).
- Follow the `Catches / Misses / Idioms` guidance from Q7 and match the style of `prompts/frameworks/spring-classic.md`.
- Quality gate is human PR review, not a rigid template.

**Tiered evaluation fixtures**
- 10 fixtures per pack: java-spring-boot, react-typescript, django, rails, angular.
- 5 fixtures per pack: nestjs, flask, wordpress, asp-net-core, symfony, kratos, magento, asp-net-framework, react-javascript.
- 3 fixtures per pack: jquery, wxwidgets, oatpp.
- Fixtures live under `discovery-service/src/evaluation/fixtures/<framework>/` and follow the format established in Spec 3.
- Re-clone any stale repos under `C:/tmp/pack-validation/repos/` before authoring fixtures.

**Per-pack baseline recording and gate**
- At the end of each pack's migration, record baseline via `npx tsx scripts/run-evaluation.ts --framework <fw> --update-baseline`.
- Run `scripts/batch-validate-packs.sh` and confirm `(v3 candidate count) >= (v2 baseline count × 0.98)` for the pack.
- Per-pack accountability matters more than aggregate; aggregate would let high-performing packs mask regressions.
- A pack is not "done" until the gate passes and the smoke tests pass.

**Smoke test migration**
- Migrate ~15 existing `discovery-service/src/__tests__/<framework>Adapter.smoke.test.ts` suites to V3 invocation.
- Keep all assertions; change invocation from direct adapter calls to `LanguagePack.extract` + `FrameworkPack.adapt`.
- The first migrated pack establishes the find-and-replace pattern for the remaining suites.
- Smoke tests are kept alongside the harness because they are faster.

**Quality-issue triage (migrate-first + TODOs)**
- jquery: migrate to V3, baseline against jquery-ui as-is, append a TODO to `discovery-service/src/evaluation/FIXTURES-TODO.md` noting the 0-emit on jquery-ui.
- react-javascript: migrate, baseline (~9 emits on react-redux-realworld), append TODO suggesting JSX component detection investigation.
- asp-net-core: migrate, baseline (~36 emits on eShopOnWeb), append TODO suggesting controller/DbContext pattern investigation.
- asp-net-framework: use `github.com/dotnet-foundation/NuGetGallery` at any SHA that passes clone + build at fixture-authoring time as the replacement for the deleted eShopLegacyMVC.
- Do NOT block migration on fixing the underlying detection logic.

**Early legacy v1 deletion**
- Delete `discovery-service/src/services/extensionPacks/javaSpringBoot/` early in the spec (already un-registered since Spec 1).
- Delete `discovery-service/src/services/extensionPacks/reactTypescript/` early in the spec (already un-registered since Spec 1).
- Confirm no imports remain before deletion.

**Final V2 codepath removal (last task group)**
- Delete `extensionPackRegistry.runPacks` and `extensionPackRegistry.getApplicablePacks`.
- Delete the `packs[]` registry and `registerPack` function.
- Delete the legacy `ExtensionPack` type in `types/extensionPack.ts`.
- Remove the `DISCOVERY_PIPELINE_VERSION` env var and any remaining references.
- Delete every `<framework>PackV2/` directory now that its V3 equivalent ships.
- Update `DISCOVERY_SERVICE_EXPLAINER.md` and `FIXTURES-TODO.md` to reflect the V3-only world.

## Existing Code to Leverage

**`discovery-service/src/services/extensionPacks/languagePacks/javaLangPack/index.ts`**
- Canonical V3 `LanguagePack` template from Spec 1.
- Copy structure for each of the 8 new language packs (typescript, python, ruby, php, go, csharp, javascript, cpp).
- File-filter + IR-extract pattern is the contract every language pack must implement.

**`discovery-service/src/services/extensionPacks/frameworkPacks/springClassicFrameworkPack/index.ts`**
- Canonical V3 `FrameworkPack` template from Spec 1.
- Copy structure for all 17 framework pack migrations.
- Demonstrates how adapter logic is lifted from a V2 pack into the V3 `adapt` shape.

**`discovery-service/src/services/prompts/{base.md, languages/java.md, frameworks/spring-classic.md}`**
- Style and structure reference for all 15 new framework prompt layers and 7 new language prompt layers.
- `frameworks/spring-classic.md` is the gold-standard `Catches / Misses / Idioms` example.
- Prompt composer from Spec 2 already wires layers together; no composer changes needed.

**`discovery-service/src/evaluation/` + `scripts/run-evaluation.ts` + `scripts/annotate-fixture.ts` + `scripts/batch-validate-packs.sh`**
- Evaluation harness, fixture loader, baseline recorder, golden-comparator, and local validation script from Spec 3.
- Used unchanged by every pack to record baselines and run the per-pack 98% gate.
- Harness already gracefully handles missing LLM fixtures (no live-LLM recording in this spec).

**V2 sources at `discovery-service/src/services/{extensionPacks/<framework>PackV2, frameworkAdapters/<framework>, languageExtractors/<lang>}/index.ts` plus smoke tests at `discovery-service/src/__tests__/<framework>Adapter.smoke.test.ts`**
- The V2 pack and adapter supply the adapt logic that moves into the FrameworkPack.
- The V2 extractor supplies the filter + IR-extract logic that moves into the LanguagePack.
- ~15 smoke test suites supply the assertions to preserve under the V3 invocation shape.
- Pre-cloned reference repos under `C:/tmp/pack-validation/repos/*` accelerate fixture authoring (re-clone if stale).

## Out of Scope
- Tier B/C user-facing UX (deferred to Spec 5).
- New adapters for unsupported stacks (Kotlin, COBOL, C-classic, Scala — future work).
- Fixing the underlying detection-quality issues in jquery / react-javascript / asp-net-core (TODOs only — actual fixes are follow-up work).
- Recording LLM fixtures during this spec (users opt-in later via `--live --record`).
- Observability dashboards.
- Pack-authoring documentation rewrite (only `DISCOVERY_SERVICE_EXPLAINER.md` and `FIXTURES-TODO.md` updates are in scope).
- Live-LLM runs in CI.
- Splitting into 4a / 4b sub-specs (single monolithic spec per Q1; waves provide the structure instead).
- Changes to the evaluation harness, prompt composer, or `LanguagePack`/`FrameworkPack` interfaces (all stable as of Spec 3).
