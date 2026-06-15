# Spec Requirements: V3 Pack Migration Batch

> **SCOPE FLAG — Largest V3 Spec To Date.** This spec migrates 17 V2 packs to V3 shape, each requiring: extract → adapt → prompt layer → fixtures → baseline → smoke tests. Total surface area is roughly 17 packs × 6 deliverables = ~100 discrete migration artifacts, plus a final V2-removal pass. The task-list-creator MUST organize this into stack-ordered waves (see Q12 + the Scope Management Recommendation at the end of this document) so each wave is independently ship-able and reviewable. The risk of scope creep is real; aim for ~10-12 task groups total, each one a complete vertical slice for a single language stack.

## Initial Description

Migrate all 17 remaining V2 packs to V3's `LanguagePack` + `FrameworkPack` shape, write framework prompt layers for each, and verify via the evaluation harness (Spec 3). Removes the V2 pipeline codepaths once complete.

Spec 1 migrated `spring-classic` as the reference. Spec 2 built the layered prompt system with initial Java + TypeScript language layers and the spring-classic framework layer. Spec 3 built the evaluation harness. This spec completes pack parity — every V2 pack must work under V3 before V2 can be removed.

The 17 packs span 9 language stacks:
- **Java**: spring-boot (java-lang already exists from Spec 1)
- **TypeScript**: react-typescript, nestjs, angular
- **Python**: django, flask
- **Ruby**: rails
- **PHP**: wordpress, symfony, magento
- **Go**: kratos
- **C#**: asp-net-core, asp-net-framework
- **JavaScript**: react-javascript, jquery
- **C++**: wxwidgets, oatpp

## Requirements Discussion

### First Round Questions

**Q1 (spec split):** Should this be one monolithic spec, or split into 4a (priority-5 packs) and 4b (the remaining 12)?
**Answer:** Single monolithic spec. User acknowledged it's large. Flag upfront in the requirements that this is the largest V3 spec — 17 packs × (extract → adapt → prompt → fixtures → baseline → smoke tests). The task-list-creator should structure tasks in 7 waves by language-stack (matching Q12 order) so implementers can work stack-by-stack, each wave self-contained (language pack + its framework packs + prompts + fixtures + baselines + smoke tests). Risk of scope creep is acknowledged; suggest ~10-12 task groups total to keep each group ship-able in isolation.

**Q2 (fixture count, tiered):** How many fixtures per pack? Tiered by priority?
**Answer:** Tiered fixture counts:
- **10 fixtures**: java-spring-boot, react-typescript, django, rails, angular (high-traffic, Spec 3 priority-5)
- **5 fixtures**: nestjs, flask, wordpress, asp-net-core, symfony, kratos, magento, asp-net-framework, react-javascript
- **3 fixtures**: jquery, wxwidgets, oatpp (low priority)

**Q3 (quality issues):** How should pre-identified quality issues (jquery-v2, react-javascript-v2, asp-net-core-v2) be handled?
**Answer:** Migrate-first + TODOs. For jquery, react-javascript, and asp-net-core: migrate to V3 structure, record baseline against their reference repos (which will be low), and add a TODO in `evaluation/FIXTURES-TODO.md` documenting the suspected gap (e.g. "jquery-v2 emitted 0 on jquery-ui; detection logic likely wrong — investigate XYZ") with suggested follow-up. Do not block the migration on fixing the quality issue.

**Q4 (asp-net-framework repo):** What's the replacement repo for the removed eShopLegacyMVC?
**Answer:** `github.com/dotnet-foundation/NuGetGallery`. Commit any SHA that passes a clone + build at the fixture-authoring time.

**Q5 (legacy v1 deletion):** When should the legacy v1 directories be deleted?
**Answer:** Delete `discovery-service/src/services/extensionPacks/javaSpringBoot/` and `discovery-service/src/services/extensionPacks/reactTypescript/` directories EARLY in this spec (after confirming no imports remain). These have been commented out of `register.ts` since Spec 1 — safe to delete.

**Q6 (V2 codepath removal):** When and what to remove for V2 cleanup?
**Answer:** Batch at the END of the spec. Final task group removes:
- `extensionPackRegistry.runPacks`
- `extensionPackRegistry.getApplicablePacks`
- `packs[]` registry + `registerPack` function
- Legacy `ExtensionPack` type in `types/extensionPack.ts`
- `DISCOVERY_PIPELINE_VERSION` env var (if still referenced)
- Any V2 pack files (`<framework>PackV2/` directories) once every one is replaced by V3 equivalents

**Q7 (prompt authoring):** Who authors prompts and to what template?
**Answer:** Implementer drafts based on V2 adapter logic + framework conventions. Human review during PR is the quality gate, not a strict template. Suggested minimum section structure (as guidance, not rigid):
- **Catches** — what the adapter detects deterministically
- **Misses** — common things the LLM should look for
- **Idioms** — language/framework patterns that cue role inference

Match the style already established in `frameworks/spring-classic.md`.

**Q8 (language pack mapping — confirmed):** Is the pack→language mapping correct?
**Answer:** Confirmed:
- `javaLangPack` (existing) → spring-classic + spring-boot
- `typescriptLangPack` (new) → react-typescript + nestjs + angular
- `pythonLangPack` (new) → django + flask
- `phpLangPack` (new) → wordpress + symfony + magento
- `csharpLangPack` (new) → asp-net-core + asp-net-framework
- `javascriptLangPack` (new, separate from typescriptLangPack) → react-javascript + jquery
- `cppLangPack` (new) → wxwidgets + oatpp
- `rubyLangPack` (new) → rails
- `goLangPack` (new) → kratos

**Q9 (baseline recording):** Per-pack immediate, or batch at end?
**Answer:** Immediate per-pack. Each pack's migration task group concludes with `npx tsx scripts/run-evaluation.ts --framework <fw> --update-baseline` to record baseline.

**Q10 (LLM fixture recording):** Should we record LLM fixtures during this spec?
**Answer:** Skip entirely. Users opt-in via `--live --record` when they want gap-fill metrics. The evaluation harness must gracefully handle missing LLM fixtures (already does per Spec 3).

**Q11 (batch-validate-packs.sh gate):** What gate level for V3 vs V2 candidate counts?
**Answer:** Per-pack gate. For each migrated pack, `scripts/batch-validate-packs.sh` must show `(v3 candidate count) >= (v2 baseline count × 0.98)` (allow 2% tolerance for reasonable IR variance). Per-pack accountability matters more than aggregate — aggregate would let a high-performing pack mask a regression elsewhere. The per-pack check runs as part of the pack's own task group.

**Q12 (migration order):** What order to migrate stacks?
**Answer:** Java → TypeScript → Python → Ruby → PHP → Go → C# → JavaScript → C++. Python/Ruby/PHP can run in parallel after TypeScript where implementer bandwidth allows, but sequential by-stack in tasks.md is cleaner.

**Q13 (smoke tests):** Migrate existing smoke tests, replace, or skip?
**Answer:** Migrate existing `<framework>Adapter.smoke.test.ts` tests to V3 shape — keep the assertions, change the invocation to use `LanguagePack.extract` + `FrameworkPack.adapt` instead of direct adapter calls. Smoke tests are faster than harness; keep both.

**Q14 (out of scope additions):** Anything else to exclude beyond the raw-idea exclusions?
**Answer:** No additions. Existing out-of-scope stands: Tier B/C UX (Spec 5), new unsupported stacks (Kotlin / COBOL / C-classic / Scala), observability dashboards, pack-authoring doc rewrite, live-LLM CI.

### Existing Code to Reference

**Canonical V3 templates (the gold standard to copy):**
- Language pack template: `discovery-service/src/services/extensionPacks/languagePacks/javaLangPack/`
- Framework pack template: `discovery-service/src/services/extensionPacks/frameworkPacks/springClassicFrameworkPack/`

**Prompt layer templates:**
- Base: `discovery-service/src/services/prompts/base.md`
- Language layer: `discovery-service/src/services/prompts/languages/java.md`
- Framework layer: `discovery-service/src/services/prompts/frameworks/spring-classic.md`

**Evaluation harness (already built in Spec 3):**
- Harness code: `discovery-service/src/evaluation/`
- Run script: `discovery-service/scripts/run-evaluation.ts`
- Annotation script: `discovery-service/scripts/annotate-fixture.ts`
- Local validation script: `discovery-service/scripts/batch-validate-packs.sh`

**V2 sources to extract from (for each pack):**
- V2 pack: `discovery-service/src/services/extensionPacks/<framework>PackV2/index.ts`
- V2 adapter: `discovery-service/src/services/frameworkAdapters/<framework>/index.ts`
- V2 extractor: `discovery-service/src/services/languageExtractors/<lang>/index.ts`

**Legacy v1 directories to DELETE early in this spec:**
- `discovery-service/src/services/extensionPacks/javaSpringBoot/`
- `discovery-service/src/services/extensionPacks/reactTypescript/`

**Other key references:**
- Per-field AND predicate: `extensionPackRegistry.ts::matchesPredicate`
- Existing smoke tests: `discovery-service/src/__tests__/<framework>Adapter.smoke.test.ts` (~15 suites)
- Existing cloned reference repos at `C:/tmp/pack-validation/repos/` for fixture authoring (some may need re-cloning if stale)

**Components to reuse:**
- `LanguagePack` interface and registration plumbing from Spec 1
- `FrameworkPack` interface and registration plumbing from Spec 1
- Prompt layer composer from Spec 2
- Evaluation harness, fixture loader, baseline recorder, golden-comparator from Spec 3
- `scripts/batch-validate-packs.sh` from Spec 3

### Follow-up Questions

No follow-up round was needed — the user provided complete answers to all 14 first-round questions in one pass.

## Visual Assets

### Files Provided:
No visual assets provided. The visuals folder is empty.

### Visual Insights:
N/A — this is a backend / pack-architecture migration with no UI surface.

## Requirements Summary

### Functional Requirements

**Per-pack migration deliverables (×17 packs):**
1. **Language pack** created or extended for the pack's language (8 new language packs total: typescript, python, ruby, php, go, csharp, javascript, cpp; java already exists).
2. **Framework pack** created from the V2 adapter logic, conforming to the V3 `FrameworkPack` interface, registered in `register.ts`.
3. **Prompt layer** authored at `discovery-service/src/services/prompts/frameworks/<pack-id>.md` following the `Catches / Misses / Idioms` guidance and matching the `spring-classic.md` style.
4. **Language prompt layer** at `discovery-service/src/services/prompts/languages/<lang>.md` for each new language (8 new files).
5. **Evaluation fixtures** authored under `discovery-service/src/evaluation/fixtures/<framework>/` at the tiered counts (10 / 5 / 3 per Q2).
6. **Baseline recorded** via `npx tsx scripts/run-evaluation.ts --framework <fw> --update-baseline` at the end of each pack's task group.
7. **Smoke tests migrated** from V2 invocation shape to V3 (`LanguagePack.extract` + `FrameworkPack.adapt`) with assertions preserved.
8. **Per-pack regression gate**: `scripts/batch-validate-packs.sh` reports `(v3 count) >= (v2 baseline × 0.98)` for the pack before its task group is considered done.

**Quality-issue handling (jquery, react-javascript, asp-net-core):**
- Migrate to V3 shape regardless of detection quality.
- Record the (low) baseline as-is.
- Append a TODO entry to `discovery-service/src/evaluation/FIXTURES-TODO.md` describing the suspected gap and suggested investigation direction.
- Do NOT block migration on fixing the underlying detection logic.

**Special-case fixture sourcing:**
- `asp-net-framework` reference repo is `github.com/dotnet-foundation/NuGetGallery` at any SHA that passes clone + build at fixture-authoring time.

**Early deletion (legacy v1):**
- Remove `discovery-service/src/services/extensionPacks/javaSpringBoot/` and `discovery-service/src/services/extensionPacks/reactTypescript/` directories early, after confirming no imports remain.

**Final V2 codepath removal (last task group):**
- Delete `extensionPackRegistry.runPacks` and `extensionPackRegistry.getApplicablePacks`.
- Delete `packs[]` registry and `registerPack` function.
- Delete legacy `ExtensionPack` type in `types/extensionPack.ts`.
- Remove `DISCOVERY_PIPELINE_VERSION` env var if still referenced.
- Delete every `<framework>PackV2/` directory once its V3 equivalent ships.

### Reusability Opportunities

- **Language pack scaffold**: Copy structure of `javaLangPack/` for each new language pack (typescript, python, ruby, php, go, csharp, javascript, cpp).
- **Framework pack scaffold**: Copy structure of `springClassicFrameworkPack/` for every framework pack migration.
- **Prompt layer template**: Use `frameworks/spring-classic.md` and `languages/java.md` as style references.
- **Smoke test rewrite pattern**: One pack done first will establish the find-and-replace pattern for the remaining 16.
- **V2 logic extraction pattern**: Same split (filter+IR-extract → LanguagePack, adapt → FrameworkPack) applies uniformly across all 17 packs.
- **Evaluation harness**: All 17 packs use the same `run-evaluation.ts` and `batch-validate-packs.sh` plumbing — no harness changes expected.

### Scope Boundaries

**In Scope:**
- Migrate all 17 V2 packs to V3 `LanguagePack` + `FrameworkPack` shape.
- Create 8 new language packs (typescript, python, ruby, php, go, csharp, javascript, cpp).
- Author 17 framework prompt layers + 8 language prompt layers.
- Author tiered fixture sets (10/5/3) for each pack.
- Record per-pack baselines.
- Migrate ~15 smoke test suites to V3 invocation.
- Per-pack regression gate via `batch-validate-packs.sh`.
- Quality-issue TODOs for jquery / react-javascript / asp-net-core (no fix attempted).
- Delete legacy v1 directories early (`javaSpringBoot/`, `reactTypescript/`).
- Delete all V2 codepaths in a final cleanup task group.
- Remove `DISCOVERY_PIPELINE_VERSION` flag.

**Out of Scope:**
- Tier B/C user-facing UX (deferred to Spec 5).
- New adapters for unsupported stacks (Kotlin, COBOL, C-classic, Scala — future).
- Fixing the underlying detection-quality issues in jquery / react-javascript / asp-net-core (TODOs only — actual fixes are follow-up work).
- Recording LLM fixtures during this spec (users opt-in later via `--live --record`).
- Observability dashboards.
- Pack-authoring documentation rewrite.
- Live-LLM in CI.

### Technical Considerations

**Migration pattern (same for every pack):**
1. Locate V2 sources: `<framework>PackV2/index.ts`, `frameworkAdapters/<framework>/index.ts`, `languageExtractors/<lang>/index.ts`.
2. If language pack does not yet exist, create it under `languagePacks/<lang>LangPack/` using `javaLangPack/` as the template, lifting the file-filter + IR-extract logic from the V2 extractor.
3. Create framework pack under `frameworkPacks/<framework>FrameworkPack/` using `springClassicFrameworkPack/` as the template, lifting the adapter logic from the V2 adapter and V2 pack.
4. Register the new packs in `register.ts`.
5. Author prompt layers (`languages/<lang>.md` if new, `frameworks/<pack-id>.md` always).
6. Author tiered fixture set, run harness, record baseline.
7. Migrate smoke tests to V3 invocation shape.
8. Run `scripts/batch-validate-packs.sh` and confirm per-pack 98% gate passes.

**Per-pack gate calculation:**
- `(v3 candidate count) >= (v2 baseline count × 0.98)` — 2% tolerance for reasonable IR variance.

**Harness conventions (from Spec 3, no changes here):**
- LLM fixtures missing → harness gracefully skips, no failure.
- Baseline file format already established.
- Annotation workflow already established.

**Constraints:**
- No pack regression vs V2 baselines beyond the 2% tolerance.
- `scripts/batch-validate-packs.sh` must remain green end-to-end after each pack lands.
- Existing cloned repos at `C:/tmp/pack-validation/repos/` may need refresh — implementer should re-clone any stale repos before authoring fixtures.

**Tech stack already in place:** TypeScript discovery-service, Jest tests, evaluation harness from Spec 3, prompt composer from Spec 2.

---

## Scope Management Recommendation (for task-list-creator)

Because this is the largest V3 spec to date, the task-list-creator MUST organize tasks into stack-ordered waves so each wave is independently ship-able and reviewable. Recommended structure:

**Wave-by-wave organization (matches Q12 migration order):**

| Wave | Stack | Packs | Language Pack | New? |
|------|-------|-------|---------------|------|
| 0 | Cleanup prep | (delete legacy v1 dirs) | — | — |
| 1 | Java | spring-boot | javaLangPack | reuse |
| 2 | TypeScript | react-typescript, nestjs, angular | typescriptLangPack | new |
| 3 | Python | django, flask | pythonLangPack | new |
| 4 | Ruby | rails | rubyLangPack | new |
| 5 | PHP | wordpress, symfony, magento | phpLangPack | new |
| 6 | Go | kratos | goLangPack | new |
| 7 | C# | asp-net-core, asp-net-framework | csharpLangPack | new |
| 8 | JavaScript | react-javascript, jquery | javascriptLangPack | new |
| 9 | C++ | wxwidgets, oatpp | cppLangPack | new |
| 10 | V2 removal | (final cleanup) | — | — |
| 11 | Documentation | (update pack-authoring docs / READMEs as needed) | — | — |

**Each stack-wave (1-9) is a single task group containing:**
- Language pack creation (or confirmation it already exists)
- Each framework pack migration in the wave
- Prompt layers (language + framework)
- Fixtures + baseline recording (tiered per Q2)
- Smoke test migration
- Per-pack `batch-validate-packs.sh` gate confirmation

This yields ~10-12 task groups total, each one a complete vertical slice, each one independently ship-able if the spec needs to pause for any reason.
