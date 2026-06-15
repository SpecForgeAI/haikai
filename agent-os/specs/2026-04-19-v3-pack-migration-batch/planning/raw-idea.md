Migrate all 17 remaining V2 packs to V3's LanguagePack + FrameworkPack shape, write framework prompt layers for each, and verify via the evaluation harness (Spec 3). Removes the V2 pipeline codepaths once complete.

## Context

Spec 1 migrated spring-classic as the reference. Spec 2 built the layered prompt system with initial Java + TypeScript language layers and spring-classic framework layer. Spec 3 built the evaluation harness. This spec completes pack parity — every V2 pack must work under V3 before V2 can be removed.

## In scope

1. Migrate each of these 17 packs to V3 shape:
   - **Java stack**: java-spring-boot-v2 (already shares java-lang with spring-classic — just new framework pack)
   - **TypeScript stack**: react-typescript-v2, nestjs-v2, angular-v2
   - **Python stack**: django-v2, flask-v2 (new language pack: python-lang)
   - **Ruby stack**: rails-v2 (new language pack: ruby-lang)
   - **PHP stack**: wordpress-v2, symfony-v2, magento-v2 (new language pack: php-lang)
   - **Go stack**: kratos-v2 (new language pack: go-lang)
   - **C# stack**: asp-net-core-v2, asp-net-framework-v2 (new language pack: csharp-lang)
   - **JavaScript stack**: react-javascript-v2, jquery-v2 (new language pack: javascript-lang — note: can't share with typescript-lang because they use different extractors today)
   - **C++ stack**: wxwidgets-v2, oatpp-v2 (new language pack: cpp-lang)

2. For each pack:
   - Extract the file-filter + IR-extract logic into the shared LanguagePack (create if not exists).
   - Move the adapter logic into the FrameworkPack.
   - Write `frameworks/<pack-id>.md` prompt layer with framework-specific guidance (blind spots, idioms, common misses).
   - Extend `languages/<lang>.md` prompt layer if new (Python, Ruby, PHP, Go, C#, JavaScript, C++).
   - Add evaluation fixtures for the pack (5-10 files minimum per pack — abbreviated for low-priority packs like oatpp).
   - Pack must pass evaluation harness thresholds before merge.

3. Fix known quality issues found in pre-validation:
   - **jquery-v2** emits 0 on jquery-ui — detection logic needs rework.
   - **react-javascript-v2** emits only 9 on react-redux-realworld — likely missing JSX component detection.
   - **asp-net-core-v2** emits only 36 on eShopOnWeb — likely missing controller/DbContext patterns.
   - **Find asp-net-framework replacement repo** — eShopLegacyMVC was removed from dotnet-architecture org. Candidates: dotnet-foundation/NuGetGallery.

4. Remove V2 codepaths:
   - Delete `services/extensionPacks/javaSpringBoot/` and `services/extensionPacks/reactTypescript/` (legacy v1 packs, already not registered).
   - Delete `register.ts` V2 registrations; `register.ts` registers only LanguagePack + FrameworkPack now.
   - Remove `DISCOVERY_PIPELINE_VERSION` feature flag (V3 is the only pipeline).

## Scope control

If this spec grows unwieldy during execution, split into **4a** (priority 5: java-spring-boot, django, react-typescript, rails, angular) and **4b** (remaining 12). But maintain consistency — same migration pattern across all packs.

## Out of scope

- Tier B/C user-facing UX (Spec 5).
- New adapters for stacks we don't currently support (Kotlin, COBOL, C-classic, Scala — future work).

## Key constraints

- All migrations must pass the evaluation harness before merge — no pack moves forward without baseline recorded and maintained.
- Local harness (`scripts/batch-validate-packs.sh`) must still work end-to-end.
- No pack regression in candidate count vs V2 harness baselines.

## Done when

- All 18 packs run under V3.
- V2 codepaths deleted.
- Evaluation harness green for all 18 packs.
- `scripts/batch-validate-packs.sh` produces >= the V2 candidate counts for every repo.
- Documentation updated.
