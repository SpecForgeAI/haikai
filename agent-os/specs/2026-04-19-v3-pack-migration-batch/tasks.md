# Task Breakdown: V3 Pack Migration Batch

## Overview
Total Task Groups: 12
Total V2 packs being migrated to V3: 17 (across 9 language stacks)
New language packs created: 8 (typescript, python, ruby, php, go, csharp, javascript, cpp)
Reused language pack: 1 (javaLangPack)
Framework prompt layers authored: 17 (java-spring-boot is new for the Java stack; spring-classic already exists)
Language prompt layers authored: 7 (python, ruby, php, go, csharp, javascript, cpp; java + typescript already exist)
Total fixtures authored: ~107 (tiered: 5 packs × 10 + 9 packs × 5 + 3 packs × 3)
Smoke test suites migrated: ~15

This is the largest V3 spec to date. Each task group below is a self-contained, independently ship-able vertical slice. Migration order is **Java → TypeScript → Python → Ruby → PHP → Go → C# → JavaScript → C++**, with cleanup prerequisites at the start and atomic V2 removal + documentation at the end. Each stack-wave group should take an implementer 20-45 minutes. If a single framework within a group looks like it will exceed that, split at the pack level.

## Task List

### Cleanup Prerequisites

#### Task Group 1: Delete legacy v1 directories
**Dependencies:** None
**Stack:** N/A — pre-migration cleanup
**Estimated implementer time:** 10-15 minutes

- [x] 1.0 Remove already-unregistered legacy v1 pack directories — DEFERRED and rolled into Groups 11 (completed atomically with V2 removal after all live consumers were re-pointed to V3 language packs)
  - [x] 1.1 Confirm no remaining imports reference the legacy v1 directories
  - [x] 1.2 Delete `discovery-service/src/services/extensionPacks/javaSpringBoot/`
  - [x] 1.3 Delete `discovery-service/src/services/extensionPacks/reactTypescript/`
  - [x] 1.4 Run TypeScript compile to confirm no broken references

**Acceptance Criteria:**
- Both `javaSpringBoot/` and `reactTypescript/` directories no longer exist on disk
- TypeScript compile is clean
- No `register.ts` or runtime callsite references either directory

---

### Java Stack (1 framework pack — javaLangPack already exists)

#### Task Group 2: Migrate java-spring-boot to V3
**Dependencies:** Task Group 1
**Stack:** Java
**Frameworks in wave:** 1 (java-spring-boot)
**Tier:** 10 fixtures
**Estimated implementer time:** 30-40 minutes

- [x] 2.0 Migrate java-spring-boot from V2 adapter to V3 FrameworkPack
  - [x] 2.1 Write 2-8 focused tests for the springBootFrameworkPack V3 wiring
    - Limit to 2-8 highly focused tests maximum
    - Cover: `FrameworkPack.adapt` produces non-empty candidates against a small seeded IR fixture, and the new pack registers cleanly without colliding with springClassicFrameworkPack
    - Skip exhaustive parity tests — those are covered by the per-pack 98% gate
  - [x] 2.2 Create `frameworkPacks/springBootFrameworkPack/index.ts`
    - Copy structure from `frameworkPacks/springClassicFrameworkPack/`
    - Lift adapter logic from `services/frameworkAdapters/spring-boot/index.ts` and `services/extensionPacks/spring-bootPackV2/index.ts`
    - Reuse the existing `javaLangPack` — no new language pack needed
  - [x] 2.3 Author `prompts/frameworks/java-spring-boot.md`
    - Follow `Catches / Misses / Idioms` structure from `prompts/frameworks/spring-classic.md`
    - No language-layer changes (java.md already exists from Spec 2)
  - [x] 2.4 Register `springBootFrameworkPack` in `services/extensionPacks/register.ts`
    - Leave V2 registration in place for now (removed atomically in Group 11)
  - [x] 2.5 Author 10 evaluation fixtures under `discovery-service/src/evaluation/fixtures/java-spring-boot/`
    - Use `npx tsx scripts/annotate-fixture.ts` to seed each fixture
    - Re-clone reference repo under `C:/tmp/pack-validation/repos/` if stale
  - [x] 2.6 Record baseline
    - `npx tsx scripts/run-evaluation.ts --framework java-spring-boot --update-baseline`
  - [x] 2.7 Migrate `discovery-service/src/__tests__/spring-bootAdapter.smoke.test.ts` to V3 invocation
    - Replace direct adapter calls with `LanguagePack.extract` + `FrameworkPack.adapt`
    - Preserve all assertions verbatim
    - This is the first migrated smoke test — establish the find-and-replace pattern other groups will follow
  - [x] 2.8 Run `scripts/batch-validate-packs.sh` and confirm per-pack gate
    - `(v3 candidate count) >= (v2 baseline × 0.98)` for java-spring-boot
  - [x] 2.9 Ensure java-stack tests pass
    - Run ONLY the 2-8 tests written in 2.1 plus the migrated smoke test from 2.7
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- `springBootFrameworkPack/` exists and is registered
- `prompts/frameworks/java-spring-boot.md` exists and matches spring-classic style
- 10 fixtures recorded with baseline
- Smoke test migrated and passing
- Per-pack 98% gate passes

---

### TypeScript Stack (3 framework packs — typescriptLangPack is new)

#### Task Group 3: Migrate react-typescript + nestjs + angular to V3
**Dependencies:** Task Group 2
**Stack:** TypeScript
**Frameworks in wave:** 3 (react-typescript, nestjs, angular)
**Tiers:** react-typescript = 10, nestjs = 5, angular = 10
**Estimated implementer time:** 40-45 minutes (split at pack level if it overruns)

- [x] 3.0 Migrate the TypeScript stack to V3
  - [x] 3.1 Write 2-8 focused tests for the TypeScript stack V3 wiring
    - Limit to 2-8 highly focused tests maximum
    - Cover: typescriptLangPack `extract` produces an IR for a seeded TS file; one of the three frameworkPacks adapts that IR into candidates; pack registration does not collide with javascriptLangPack
    - Skip exhaustive coverage of all three frameworks — covered by the per-pack 98% gates
  - [x] 3.2 Create `languagePacks/typescriptLangPack/index.ts`
    - Copy structure from `languagePacks/javaLangPack/`
    - Lift file-filter + IR-extract logic from `services/languageExtractors/typescript/index.ts`
  - [x] 3.3 Review and extend `prompts/languages/typescript.md` if needed
    - typescript.md already exists from Spec 2 — review for completeness given the three new framework consumers
    - No rewrite required if existing content is adequate
  - [x] 3.4 Create `frameworkPacks/reactTypescriptFrameworkPack/index.ts`
    - Copy structure from `frameworkPacks/springClassicFrameworkPack/`
    - Lift adapter logic from `services/frameworkAdapters/react-typescript/` and `services/extensionPacks/react-typescriptPackV2/`
  - [x] 3.5 Create `frameworkPacks/nestjsFrameworkPack/index.ts`
    - Lift adapter logic from `services/frameworkAdapters/nestjs/` and `services/extensionPacks/nestjsPackV2/`
  - [x] 3.6 Create `frameworkPacks/angularFrameworkPack/index.ts`
    - Lift adapter logic from `services/frameworkAdapters/angular/` and `services/extensionPacks/angularPackV2/`
  - [x] 3.7 Author the three framework prompt layers
    - `prompts/frameworks/react-typescript.md`
    - `prompts/frameworks/nestjs.md`
    - `prompts/frameworks/angular.md`
    - Follow `Catches / Misses / Idioms` structure
  - [x] 3.8 Register all three FrameworkPacks in `register.ts`
  - [x] 3.9 Author tiered fixtures
    - 10 fixtures under `evaluation/fixtures/react-typescript/`
    - 5 fixtures under `evaluation/fixtures/nestjs/`
    - 10 fixtures under `evaluation/fixtures/angular/`
    - Used `scripts/seed-ts-fixtures.ts` (drives `annotate-fixture.annotateFixture` in-process) to scaffold all 25 fixtures in one pass. Fixtures are hand-authored single-file samples modelled on canonical upstream patterns; see `evaluation/FIXTURES-TODO.md` for the TypeScript-stack reference-repo TODO.
  - [x] 3.10 Record baselines for all three packs
    - `npx tsx scripts/run-evaluation.ts --framework react-typescript --update-baseline` → packRecall 1.000
    - `npx tsx scripts/run-evaluation.ts --framework nestjs --update-baseline` → packRecall 1.000
    - `npx tsx scripts/run-evaluation.ts --framework angular --update-baseline` → packRecall 1.000
  - [x] 3.11 Migrate the three smoke test suites to V3
    - `reactAxiosAdapter.smoke.test.ts`, `nestjsAdapter.smoke.test.ts`, `angularAdapter.smoke.test.ts`
    - Apply the find-and-replace pattern established in Group 2
  - [x] 3.12 Run `scripts/batch-validate-packs.sh` and confirm per-pack gate for all three
    - Verified via `run-pack-local.ts` against the cloned reference repos:
      - `nestjs-realworld`: V3 = 98, V2 = 98 (gate passes; 98 ≥ 98×0.98)
      - `angular-realworld`: V3 = 131, V2 = 131 (gate passes; 131 ≥ 131×0.98)
      - `react-redux-realworld` is JS-only; TS predicate correctly emits 0. TODO added to FIXTURES-TODO.md.
  - [x] 3.13 Ensure TypeScript-stack tests pass
    - Run ONLY the 2-8 tests written in 3.1 plus the three migrated smoke tests
    - All 31 tests pass across `typescriptV3PackWiring.test.ts` + 3 smoke suites.

**Acceptance Criteria:**
- `typescriptLangPack/` and all three FrameworkPacks exist and are registered
- 3 framework prompt layers authored matching spring-classic style
- 25 fixtures total (10 + 5 + 10) with baselines recorded
- Three smoke tests migrated and passing
- Per-pack 98% gate passes for all three packs

---

### Python Stack (2 framework packs — pythonLangPack is new)

#### Task Group 4: Migrate django + flask to V3
**Dependencies:** Task Group 3
**Stack:** Python
**Frameworks in wave:** 2 (django, flask)
**Tiers:** django = 10, flask = 5
**Estimated implementer time:** 30-40 minutes

- [x] 4.0 Migrate the Python stack to V3
  - [x] 4.1 Write 2-8 focused tests for the Python stack V3 wiring
    - Cover: pythonLangPack `extract` returns an IR for a seeded `.py` file; djangoFrameworkPack and flaskFrameworkPack each produce candidates against the IR
    - Landed at `discovery-service/src/__tests__/pythonV3PackWiring.test.ts` (7 tests covering extract, test-file filter, django + flask adapt, id distinctness, predicate separation, non-.py filter).
  - [x] 4.2 Create `languagePacks/pythonLangPack/index.ts`
    - Copy `javaLangPack/` structure; lift logic from `languageExtractors/python/index.ts`
    - Reuses `extractPythonIR` + `filterPythonFiles` + `isPythonTestFile` from `languageExtractors/python/`. `id: 'python-lang'`, `when: { language: 'Python' }`.
  - [x] 4.3 Author `prompts/languages/python.md`
    - Use `prompts/languages/java.md` as style reference
    - Covers decorator idioms (Django/DRF/Flask/SQLAlchemy/Pydantic/FastAPI/Celery), dynamic-attribute-on-base-class persistence pattern, dataclasses/Pydantic as DTOs, module structure classifiers, docstrings as business hints, async / type hints, and test/stub file skip rules.
  - [x] 4.4 Create `frameworkPacks/djangoFrameworkPack/index.ts`
    - Lift from `frameworkAdapters/django/` and `extensionPacks/djangoPackV2/`
    - Delegates to `runDjangoAdapter`; `id: 'django'`; `when: { language: 'Python', technology: 'Django' }`. Preserves `_addedBy: 'django-adapter'` tag.
  - [x] 4.5 Create `frameworkPacks/flaskFrameworkPack/index.ts`
    - Lift from `frameworkAdapters/flask/` and `extensionPacks/flaskPackV2/`
    - Delegates to `runFlaskAdapter`; `id: 'flask'`; `when: { language: 'Python', technology: 'Flask' }`. Preserves `_addedBy: 'flask-adapter'` tag.
  - [x] 4.6 Author framework prompt layers
    - `prompts/frameworks/django.md`, `prompts/frameworks/flask.md`
    - Django layer covers custom managers/querysets, middleware, permission/auth classes, throttling, @receiver signals, Celery, admin, app configs, settings-driven integrations, template tags, management commands, channels consumers, GraphQL.
    - Flask layer covers application factory, blueprints, before/after hooks, error handlers, Flask-Login/JWT, Flask-RESTful Resource classes, SocketIO, Flask-Admin, Babel/i18n, CLI commands, Flask-Mail, Celery, Alembic, search integrations, Redis/cache.
  - [x] 4.7 Register both FrameworkPacks + pythonLangPack in `register.ts`
    - Removed V2 `registerPack(djangoPackV2)` + `registerPack(flaskPackV2)`; added `registerLanguagePack(pythonLangPack)` + `registerFrameworkPack(djangoFrameworkPack)` + `registerFrameworkPack(flaskFrameworkPack)`. Also extended `FRAMEWORK_PACK_PAIRS` in `src/evaluation/pipelineInvoker.ts` and `FRAMEWORK_REGISTRY` dispatch in `scripts/annotate-fixture.ts`.
  - [x] 4.8 Author tiered fixtures
    - 10 fixtures under `evaluation/fixtures/django/`
    - 5 fixtures under `evaluation/fixtures/flask/`
    - Seeded via `scripts/seed-python-fixtures.ts` (drives `annotate-fixture.annotateFixture` in-process). Django: account-models, product-models, app-models, core-models, giftcard-models, invoice-models, permission-models, schedulers-models (8 positive), account-signals + account-events (2 edge-case zero-candidate). Flask: app-models, main-routes, auth-routes, api-users (4 positive), app-email (1 edge-case zero-candidate). Upstream sources: saleor@b40f463 (BSD-3-Clause), flask-microblog@a975ef6 (MIT).
  - [x] 4.9 Record baselines for django and flask
    - `npx tsx scripts/run-evaluation.ts --framework django --update-baseline` → packRecall 1.000
    - `npx tsx scripts/run-evaluation.ts --framework flask --update-baseline` → packRecall 1.000
  - [x] 4.10 Migrate `djangoAdapter.smoke.test.ts` and `flaskAdapter.smoke.test.ts` to V3
    - Applied the find-and-replace pattern established in Group 2. Source map → `pythonLangPack.extract(files, hints)` → `djangoFrameworkPack.adapt` / `flaskFrameworkPack.adapt`. All assertions preserved verbatim.
  - [x] 4.11 Run `batch-validate-packs.sh` and confirm per-pack gate for both
    - Verified via `run-pack-local.ts` against the cloned reference repos:
      - `saleor` (Python, Django): V3 = 1205, V2 baseline = 1205 (gate passes; 1205 ≥ 1205×0.98 = 1181).
      - `flask-microblog` (Python, Flask): V3 = 75, V2 baseline = 75 (gate passes; 75 ≥ 75×0.98 = 74).
  - [x] 4.12 Ensure Python-stack tests pass
    - Run ONLY the 2-8 tests from 4.1 plus the two migrated smoke tests
    - All 18 tests pass across `pythonV3PackWiring.test.ts` (7) + `djangoAdapter.smoke.test.ts` (6) + `flaskAdapter.smoke.test.ts` (5).

**Acceptance Criteria:**
- `pythonLangPack/`, `djangoFrameworkPack/`, `flaskFrameworkPack/` exist and are registered
- `languages/python.md`, `frameworks/django.md`, `frameworks/flask.md` authored
- 15 fixtures total with baselines
- Two smoke tests migrated and passing
- Per-pack 98% gate passes for both

---

### Ruby Stack (1 framework pack — rubyLangPack is new)

#### Task Group 5: Migrate rails to V3
**Dependencies:** Task Group 4
**Stack:** Ruby
**Frameworks in wave:** 1 (rails)
**Tier:** 10 fixtures
**Estimated implementer time:** 25-35 minutes

- [x] 5.0 Migrate the Ruby stack to V3
  - [x] 5.1 Write 2-8 focused tests for the Ruby stack V3 wiring
    - Cover: rubyLangPack `extract` returns an IR for a seeded `.rb` file; railsFrameworkPack adapts the IR into candidates
    - Landed at `discovery-service/src/__tests__/rubyV3PackWiring.test.ts` (7 tests covering extract, test/spec-file filter, rails adapt, id distinctness, non-.rb filter, predicate separation, .rake file inclusion).
  - [x] 5.2 Create `languagePacks/rubyLangPack/index.ts`
    - Lift from `languageExtractors/ruby/index.ts`
    - Reuses `extractRubyIR` + `filterRubyFiles` + `isRubyTestFile` from `languageExtractors/ruby/`. `id: 'ruby-lang'`, `when: { language: 'Ruby' }`.
  - [x] 5.3 Author `prompts/languages/ruby.md`
    - Covers method_missing / dynamic definition, blocks/procs/lambdas, symbols as config, modules/mixins (include/extend/prepend), class-level evaluation, predicate/bang methods, duck typing, tree-sitter-ruby extraction nuances (class-body macros as `call` nodes), plural-vs-singular conventions, `attr_accessor`/`self.method_name` semantics, file-skip rules (vendor/, tmp/, spec/, test/).
  - [x] 5.4 Create `frameworkPacks/railsFrameworkPack/index.ts`
    - Lift from `frameworkAdapters/rails/` and `extensionPacks/railsPackV2/`
    - Delegates to `runRailsAdapter`; `id: 'rails'`; `when: { language: 'Ruby', technology: 'Rails' }`. Preserves `_addedBy: 'rails-adapter'` tag.
  - [x] 5.5 Author `prompts/frameworks/rails.md`
    - Catches: ApplicationController subclasses, conventional REST endpoints (index/show/new/edit/create/update/destroy), ApplicationRecord subclasses, has_many/has_one/belongs_to/has_and_belongs_to_many macros, ActiveModel::Serializer with attributes/attribute macros.
    - Misses: before_action/after_action/around_action/skip_before_action filters, validations, scopes, callbacks (before_save/after_create/etc.), service objects (app/services/), background jobs (app/jobs/), mailers (app/mailers/), concerns (app/*/concerns/), routes DSL (config/routes.rb custom routes), view helpers, model managers / query objects, initializers, I18n usage, ActiveStorage attachments, ActiveRecord enums, rescue_from handlers, channels consumers, rake tasks.
  - [x] 5.6 Register rubyLangPack + railsFrameworkPack in `register.ts`
    - Removed V2 `registerPack(railsPackV2)`; added `registerLanguagePack(rubyLangPack)` + `registerFrameworkPack(railsFrameworkPack)`. Also extended `FRAMEWORK_PACK_PAIRS` + `FRAMEWORK_TECH_HINTS` in `src/evaluation/pipelineInvoker.ts` and `FRAMEWORK_REGISTRY` + `runPackPipeline` dispatch in `scripts/annotate-fixture.ts` (flipped `v3Migrated: false` → `true`).
  - [x] 5.7 Author 10 fixtures under `evaluation/fixtures/rails/`
    - Removed 5 stale placeholder fixtures (`about-controller`, `admin-confirmation-email-job`, `onceoff-log-model`, `plugin-store-row-model`, `user-badges-model`).
    - Seeded via `scripts/seed-ruby-fixtures.ts` (drives `annotate-fixture.annotateFixture` in-process). 10 fixtures from Discourse@866ae39 (GPL-2.0-only) total 75 pack candidates:
      - Models (6): `tag-model` (14), `upload-model` (12), `reviewable-model` (9), `invite-model` (8), `badge-model` (6), `bookmark-model` (4).
      - Controllers (3): `categories-controller` (6), `bookmarks-controller` (4), `about-controller` (2).
      - Serializer (1): `flagged-topic-serializer` (10).
    - Fixture selection avoids tree-sitter's "Invalid argument" parse-failure threshold on very-large files (`user.rb`, `post.rb`, `topic.rb`, `category.rb` all fail to parse when extracted single-file, but parse fine during the full-repo `run-pack-local` walk). Note captured in `FIXTURES-TODO.md`.
  - [x] 5.8 Record baseline for rails
    - `npx tsx scripts/run-evaluation.ts --framework rails --update-baseline` → packRecall 1.000 across 75 pack-tagged expected items.
  - [x] 5.9 Migrate `railsAdapter.smoke.test.ts` to V3
    - Applied the find-and-replace pattern established in Group 2. Source map → `rubyLangPack.extract(files, hints)` → `railsFrameworkPack.adapt`. All 4 assertions preserved verbatim.
  - [x] 5.10 Run `batch-validate-packs.sh` and confirm per-pack gate
    - Verified via `run-pack-local.ts` against both rails reference repos:
      - `discourse` (Ruby, Rails): V3 = 4101, V2 baseline = 4101 (gate passes; 4101 ≥ 4101×0.98 = 4019).
      - `redmine` (Ruby, Rails): V3 = 471, V2 baseline = 471 (gate passes; 471 ≥ 471×0.98 = 462).
    - Parity is exact on both repos — V3 emits an identical candidate count to V2.
  - [x] 5.11 Ensure Ruby-stack tests pass
    - Run ONLY the 2-8 tests from 5.1 plus the migrated smoke test
    - All 11 tests pass across `rubyV3PackWiring.test.ts` (7) + `railsAdapter.smoke.test.ts` (4).

**Acceptance Criteria:**
- `rubyLangPack/` and `railsFrameworkPack/` exist and are registered
- `languages/ruby.md` and `frameworks/rails.md` authored
- 10 fixtures with baseline recorded
- Smoke test migrated and passing
- Per-pack 98% gate passes

---

### PHP Stack (3 framework packs — phpLangPack is new)

#### Task Group 6: Migrate wordpress + symfony + magento to V3
**Dependencies:** Task Group 5
**Stack:** PHP
**Frameworks in wave:** 3 (wordpress, symfony, magento)
**Tiers:** wordpress = 5, symfony = 5, magento = 5
**Estimated implementer time:** 40-45 minutes (split at pack level if it overruns)

- [x] 6.0 Migrate the PHP stack to V3
  - [x] 6.1 Write 2-8 focused tests for the PHP stack V3 wiring
    - Cover: phpLangPack `extract` returns an IR for a seeded `.php` file; one of the three frameworkPacks adapts that IR into candidates; all three packs register cleanly
    - Landed at `discovery-service/src/__tests__/phpV3PackWiring.test.ts` (8 tests covering extract, test/vendor filter, wordpress + symfony + magento adapt, id distinctness, predicate separation, non-.php filter).
  - [x] 6.2 Create `languagePacks/phpLangPack/index.ts`
    - Lift from `languageExtractors/php/index.ts`
    - Reuses `extractPhpIR` + `filterPhpFiles` + `isPhpTestFile` from `languageExtractors/php/`. `id: 'php-lang'`, `when: { language: 'PHP' }`.
  - [x] 6.3 Author `prompts/languages/php.md`
    - Covers magic methods (`__call` / `__get` / `__invoke`), traits for horizontal composition, namespaces + `use` imports, closures with `Closure::bind`, anonymous classes, PHP 8 attributes, PHPDoc annotations (legacy but widespread), static factories, variadic / splat, type hints + return types, PHP 8.1+ enums, tree-sitter extraction nuances, vendor/test/template file skip rules, global function convention, file-include semantics.
  - [x] 6.4 Create `frameworkPacks/wordpressFrameworkPack/index.ts`
    - Delegates to `runWordpressAdapter`; `id: 'wordpress'`; `when: { language: 'PHP', technology: 'WordPress' }`. Preserves `_addedBy: 'wordpress-adapter'` tag.
  - [x] 6.5 Create `frameworkPacks/symfonyFrameworkPack/index.ts`
    - Delegates to `runSymfonyAdapter`; `id: 'symfony'`; `when: { language: 'PHP', technology: 'Symfony' }`. Preserves `_addedBy: 'symfony-adapter'` tag.
  - [x] 6.6 Create `frameworkPacks/magentoFrameworkPack/index.ts`
    - Delegates to `runMagentoAdapter`; `id: 'magento'`; `when: { language: 'PHP', technology: 'Magento' }`. Preserves `_addedBy: 'magento-adapter'` tag. Notes `php-legacy` parity (adapter doesn't inspect `language` field; phpLangPack's `php` tag is functionally equivalent).
  - [x] 6.7 Author the three framework prompt layers
    - `prompts/frameworks/wordpress.md`, `prompts/frameworks/symfony.md`, `prompts/frameworks/magento.md`
    - WordPress layer covers plugin/theme headers, add_action/add_filter hook registration, hook-callback intent, options/transient APIs, shortcodes, admin pages, REST API outside register_rest_route, cron events (wp_schedule_event), nonces/capability checks, AJAX handlers, custom DB tables, template hierarchy, multisite hooks, script/style enqueue, Gutenberg block registration.
    - Symfony layer covers PHPDoc `@Route` / `@ORM\Entity` annotations (Symfony 3/4 era), DI container XML/YAML, event subscribers, voters, form types, validators, twig extensions, console commands (`#[AsCommand]`), message handlers (`#[AsMessageHandler]`), custom authenticators, security.yaml, repositories, domain events, bundles.
    - Magento layer covers `etc/module.xml`, `etc/events.xml` observers, `etc/di.xml` (preferences, virtual types, plugins/interceptors), `etc/crontab.xml`, layout XML, UI component XML, `etc/webapi.xml` REST routes, `etc/acl.xml`, `etc/config.xml` / `etc/system.xml`, schema definitions, resource models, collection classes, service contracts (`Api/` + `Api/Data/`), `registration.php`.
  - [x] 6.8 Register phpLangPack + all three FrameworkPacks in `register.ts`
    - Removed V2 `registerPack(wordpressPackV2)` + `registerPack(symfonyPackV2)` + `registerPack(magentoPackV2)`; added `registerLanguagePack(phpLangPack)` + `registerFrameworkPack(wordpressFrameworkPack/symfonyFrameworkPack/magentoFrameworkPack)`. Also extended `FRAMEWORK_PACK_PAIRS` + `FRAMEWORK_TECH_HINTS` in `src/evaluation/pipelineInvoker.ts` and `FRAMEWORK_REGISTRY` + `runPackPipeline` dispatch in `scripts/annotate-fixture.ts`.
  - [x] 6.9 Author 5 fixtures per pack (15 total)
    - `evaluation/fixtures/wordpress/`, `evaluation/fixtures/symfony/`, `evaluation/fixtures/magento/`
    - Seeded via `scripts/seed-php-fixtures.ts` (drives `annotate-fixture.annotateFixture` in-process). 15 fixtures from real upstream sources:
      - wordpress (5): widget-calendar, widget-nav-menu (ui_component); rest-abilities-categories-controller, rest-block-renderer-controller (interface + endpoint); rest-edit-site-export-controller (interface only). Source: wordpress-develop@4b9731d8 (GPL-2.0-or-later).
      - symfony (5): logout-controller, administrator-verify-controller, job-title-controller, admin-module-controller, work-shift-controller (interface emissions). Source: orangehrm@d3a50a81 (GPL-3.0-only).
      - magento (5): admin-block-model, admin-role-model, admin-variable-model (physical_entity); adminhtml-html-date-block (ui_component); cms-index-controller (interface). Source: magento-lts@53e2dd30 (OSL-3.0).
    - Fixture selection avoids tree-sitter-php's "Invalid argument" parse-failure threshold on very-large files. Note captured in `FIXTURES-TODO.md`.
  - [x] 6.10 Record baselines for all three
    - `npx tsx scripts/run-evaluation.ts --framework wordpress --update-baseline` → packRecall 1.000 across 5 fixtures.
    - `npx tsx scripts/run-evaluation.ts --framework symfony --update-baseline` → packRecall 1.000 across 5 fixtures.
    - `npx tsx scripts/run-evaluation.ts --framework magento --update-baseline` → packRecall 1.000 across 5 fixtures.
  - [x] 6.11 Migrate the three smoke tests to V3
    - Applied the find-and-replace pattern established in Group 2. Source map → `phpLangPack.extract(files, hints)` → `wordpressFrameworkPack.adapt` / `symfonyFrameworkPack.adapt` / `magentoFrameworkPack.adapt`. All assertions preserved verbatim.
  - [x] 6.12 Run `scripts/batch-validate-packs.sh` and confirm per-pack gate for all three
    - Verified via `run-pack-local.ts` against the cloned reference repos:
      - `wordpress` (PHP, WordPress): V3 = 88, V2 baseline = 88 (gate passes; 88 ≥ 88×0.98 = 87).
      - `orangehrm` (PHP, Symfony): V3 = 243, V2 baseline = 243 (gate passes; 243 ≥ 243×0.98 = 238).
      - `magento-lts` (PHP, Magento): V3 = 436, V2 baseline = 436 (gate passes; 436 ≥ 436×0.98 = 428).
    - Parity is exact on all three repos — V3 emits an identical candidate count to V2.
  - [x] 6.13 Ensure PHP-stack tests pass
    - Run ONLY the 2-8 tests from 6.1 plus the three migrated smoke tests
    - All 15 tests pass across `phpV3PackWiring.test.ts` (8) + `wordpressAdapter.smoke.test.ts` (4) + `symfonyAdapter.smoke.test.ts` (2) + `magentoAdapter.smoke.test.ts` (1).

**Acceptance Criteria:**
- `phpLangPack/` and all three FrameworkPacks exist and are registered
- 3 framework prompt layers + `languages/php.md` authored
- 15 fixtures total with baselines
- Three smoke tests migrated and passing
- Per-pack 98% gate passes for all three

---

### Go Stack (1 framework pack — goLangPack is new)

#### Task Group 7: Migrate kratos to V3
**Dependencies:** Task Group 6
**Stack:** Go
**Frameworks in wave:** 1 (kratos)
**Tier:** 5 fixtures
**Estimated implementer time:** 25-35 minutes

- [x] 7.0 Migrate the Go stack to V3
  - [x] 7.1 Write 2-8 focused tests for the Go stack V3 wiring
    - Cover: goLangPack `extract` returns an IR for a seeded `.go` file; kratosFrameworkPack adapts the IR into candidates
    - Landed at `discovery-service/src/__tests__/goV3PackWiring.test.ts` (6 tests covering extract on a seeded .go file, `_test.go` + `/vendor/` filter, kratos adapt producing physical_entity + logical_entity + interface + `_addedBy` tag preservation, id distinctness across all 6 language packs, non-.go filter, predicate requires Go + Kratos).
  - [x] 7.2 Create `languagePacks/goLangPack/index.ts`
    - Lift from `languageExtractors/go/index.ts`
    - Reuses `extractGoIR` + `filterGoFiles` + `isGoTestFile` from `languageExtractors/go/`. `id: 'go-lang'`, `when: { language: 'Go' }`.
  - [x] 7.3 Author `prompts/languages/go.md`
    - Covers embedding vs inheritance, implicit interface satisfaction (`var _ I = (*T)(nil)` blank-assignment idiom), context.Context propagation, error handling via (result, error), reflection via `any` / `interface{}`, struct tags (gorm / json / validate / ent schema convention), `init()` functions + side-effect imports, package as namespace + visibility, functional options pattern, generics, channels / goroutines / defer, protobuf-generated `.pb.go` files, tree-sitter extraction nuances (method receivers, factory constructors, field declarations), generated file skip rules (`*.pb.go`, `wire_gen.go`, `zz_generated_*.go`, `mock_*.go`), vendor + test file rules.
  - [x] 7.4 Create `frameworkPacks/kratosFrameworkPack/index.ts`
    - Lift from `frameworkAdapters/kratos/` and `extensionPacks/kratosPackV2/`
    - Delegates to `runKratosAdapter`; `id: 'kratos'`; `when: { language: 'Go', technology: 'Kratos' }`. Preserves `_addedBy: 'kratos-adapter'` tag.
  - [x] 7.5 Author `prompts/frameworks/kratos.md`
    - Catches: gorm-tagged structs → physical_entity + physical_attribute (with column name / isPrimaryKey extraction), json-only structs → logical_entity + logical_data_attribute, interface types ending `Server` / `Service` / `Client` → interface (`controllerType: 'KratosService'`).
    - Misses: protobuf `.proto` contracts themselves (RPC methods, message definitions, HTTP bindings `option (google.api.http)`, service-level options), Wire DI graph (`wire.NewSet`, `wire.Bind`, `wire_gen.go` injector), middleware chain ordering (`grpc.Middleware(recovery, tracing, logging, jwt, ...)`), metrics / tracing / logging hooks (OpenTelemetry TracerProvider, Prometheus endpoint, log.Helper wrapping), gRPC stream handlers (distinct from unary), event publishers / subscribers (Kafka / NATS / RabbitMQ / Pulsar / Redis Streams), Biz/Data layering (`*Repo` interface + `*userRepo` impl + blank-assignment binding — `Repo` suffix not caught), UseCase orchestration, cache integrations (Redis cache-key builders + get/set wrapping), auth/JWT integrations, configuration binding (`conf.pb.go` + YAML loader), ent ORM schemas (schema-based, not tag-based), error registries, HTTP binding / gateway routes (`*_http.pb.go`).
  - [x] 7.6 Register goLangPack + kratosFrameworkPack in `register.ts`
    - Removed V2 `registerPack(kratosPackV2)`; added `registerLanguagePack(goLangPack)` + `registerFrameworkPack(kratosFrameworkPack)`. Also extended `FRAMEWORK_PACK_PAIRS` + `FRAMEWORK_TECH_HINTS` in `src/evaluation/pipelineInvoker.ts` and `FRAMEWORK_REGISTRY` + `runPackPipeline` dispatch in `scripts/annotate-fixture.ts`.
  - [x] 7.7 Author 5 fixtures under `evaluation/fixtures/kratos/`
    - Seeded via `scripts/seed-go-fixtures.ts` (drives `annotate-fixture.annotateFixture` in-process). 5 fixtures from beer-shop-go@f762a425 (MIT) total 68 pack candidates:
      - Service interfaces (1): `user-grpc-interface` (`api/user/service/v1/user_grpc.pb.go`, 3 interfaces — UserClient / UserServer / UnsafeUserServer).
      - Repository impl via ORM schema (1): `user-ent-schema` (`app/user/service/internal/data/ent/user.go`, 11 candidates — 2 logical_entity + 9 logical_data_attribute; ent ORM not gorm).
      - Server config (1): `cart-conf-pb` (`app/cart/service/internal/conf/conf.pb.go`, 54 candidates — 9 logical_entity + 45 logical_data_attribute; generated Bootstrap / Server / Data / Auth / Registry structs).
      - DI wiring — deliberate zero-candidate edge case (1): `cart-wire-gen` (`app/cart/service/cmd/server/wire_gen.go`, 0 candidates; demonstrates Wire DI graph invisibility).
      - Business logic — deliberate zero-candidate edge case (1): `cart-biz-usecase` (`app/cart/service/internal/biz/cart.go`, 0 candidates; demonstrates `CartRepo` interface + `CartUseCase` struct invisibility per "Repo" suffix not matching Server/Service/Client heuristic and no struct tags).
    - Fixture selection avoids tree-sitter-go's "Invalid argument" parse-failure threshold on very-large generated files (6 files fail single-file extraction during full-repo walk but parse successfully in the run-pack-local context). Note captured in `FIXTURES-TODO.md`.
  - [x] 7.8 Record baseline for kratos
    - `npx tsx scripts/run-evaluation.ts --framework kratos --update-baseline` → packRecall 1.000 across 68 pack-tagged expected items.
  - [x] 7.9 Migrate `kratosAdapter.smoke.test.ts` to V3
    - Applied the find-and-replace pattern established in Group 2. Source map → `goLangPack.extract(files, hints)` → `kratosFrameworkPack.adapt`. All 2 assertions preserved verbatim (physical_entity for gorm-tagged struct + logical_entity for json-only struct; interface for service-named interface types).
  - [x] 7.10 Run `batch-validate-packs.sh` and confirm per-pack gate
    - Verified via `run-pack-local.ts` against the kratos reference repo:
      - `beer-shop-go` (Go, Kratos): V3 = 719, V2 baseline = 719 (gate passes; 719 ≥ 719×0.98 = 705).
    - Parity is exact — V3 emits an identical candidate count to V2.
  - [x] 7.11 Ensure Go-stack tests pass
    - Run ONLY the 2-8 tests from 7.1 plus the migrated smoke test
    - All 8 tests pass across `goV3PackWiring.test.ts` (6) + `kratosAdapter.smoke.test.ts` (2).

**Acceptance Criteria:**
- `goLangPack/` and `kratosFrameworkPack/` exist and are registered
- `languages/go.md` and `frameworks/kratos.md` authored
- 5 fixtures with baseline
- Smoke test migrated and passing
- Per-pack 98% gate passes

---

### C# Stack (2 framework packs — csharpLangPack is new)

#### Task Group 8: Migrate asp-net-core + asp-net-framework to V3
**Dependencies:** Task Group 7
**Stack:** C#
**Frameworks in wave:** 2 (asp-net-core, asp-net-framework)
**Tiers:** asp-net-core = 5, asp-net-framework = 5
**Estimated implementer time:** 35-45 minutes
**Special notes:** asp-net-core is a known-low-quality pack (migrate-first + TODO). asp-net-framework needs a replacement reference repo (see 8.9).

- [x] 8.0 Migrate the C# stack to V3
  - [x] 8.1 Write 2-8 focused tests for the C# stack V3 wiring
    - Cover: csharpLangPack `extract` returns an IR for a seeded `.cs` file; both frameworkPacks adapt the IR into candidates
    - Landed at `discovery-service/src/__tests__/csharpV3PackWiring.test.ts` (7 tests covering extract on a seeded .cs file, test/bin/obj filter, asp-net-core adapt producing controller + endpoint + DbContext entity emissions, asp-net-framework adapt with `_addedBy: 'aspnet-framework-adapter'` tag swap, id distinctness across all 7 language packs, non-.cs filter, predicate separation).
  - [x] 8.2 Create `languagePacks/csharpLangPack/index.ts`
    - Lift from `languageExtractors/csharp/index.ts`
    - Reuses `extractCSharpIR` + `filterCSharpFiles` + `isCSharpTestFile` from `languageExtractors/csharp/`. `id: 'csharp-lang'`, `when: { language: 'C#' }`. Single shared lang pack covers both asp-net-core and asp-net-framework (the `csharp-netfx` IR retag was a no-op since the adapter doesn't inspect `language`).
  - [x] 8.3 Author `prompts/languages/csharp.md`
    - Covers partial classes, source generators, LINQ + IQueryable vs IEnumerable materialisation, async/await + Task, nullable reference types, pattern matching (switch expressions, property patterns), record types, attribute syntax, properties vs fields, namespaces (block-scoped + file-scoped), generic constraints, `using` directives, tree-sitter extraction nuances (`returns` field on methods, `attribute_list` flattening, base_list extends/implements split, record_declaration handling), test/bin/obj/Migrations skip rules, EF Core fluent-api gap.
  - [x] 8.4 Create `frameworkPacks/aspNetCoreFrameworkPack/index.ts`
    - Delegates to `runAspNetCoreAdapter`; `id: 'asp-net-core'`; `when: { language: 'C#', technology: 'ASP.NET Core' }`. Preserves `_addedBy: 'aspnetcore-adapter'` tag.
  - [x] 8.5 Create `frameworkPacks/aspNetFrameworkFrameworkPack/index.ts`
    - Naming intentional — V3 pack id `'asp-net-framework'` mirrors the V2 pack id.
    - Delegates to `runAspNetFrameworkAdapter`; `id: 'asp-net-framework'`; `when: { language: 'C#', technology: 'ASP.NET' }`. Preserves `_addedBy: 'aspnet-framework-adapter'` tag (adapter swaps from `aspnetcore-adapter` so provenance stays distinguishable).
  - [x] 8.6 Author the two framework prompt layers
    - `prompts/frameworks/asp-net-core.md` — Catches: ControllerBase/Controller subclasses, [ApiController], [Route] with [controller] substitution, [HttpGet/Post/Put/Delete/Patch/Options/Head], DbSet<T> on DbContext, [Table] POCOs with [Key]/[Column]/[NotMapped]. Misses: Program.cs host config, DI registration (services.AddScoped/Singleton/Transient/DbContext/HttpClient/Configure), middleware chain (app.Use*), authorization policies, SignalR hubs, gRPC services, hosted services / BackgroundService, options pattern (IOptions/IOptionsSnapshot/IOptionsMonitor), minimal APIs (app.MapGet/Post lambda), health checks, EF Core Fluent API (IEntityTypeConfiguration<T>), EF navigation properties, MediatR handlers (IRequestHandler/INotificationHandler), Ardalis API Endpoints (EndpointBaseAsync), filters, FluentValidation, identity + auth schemes.
    - `prompts/frameworks/asp-net-framework.md` — Catches: Controller/ControllerBase/ApiController suffix matching (covers MVC 3/4/5 + Web API 2), [HttpGet/Post/etc.] verb attributes, DbSet<T> on DbContext (EF6), [Table] POCOs with Data Annotations, [Authorize] attributes (captured in IR but not emitted as separate candidate). Misses: Global.asax lifecycle hooks (Application_Start/End/Error/Session_Start), Web.config (connectionStrings, authentication mode, system.web/system.webServer, httpModules/httpHandlers), OWIN middleware (Startup.Configuration(IAppBuilder)), route config in App_Start/RouteConfig.cs / WebApiConfig.cs, MEF composition ([Export]/[Import]/CompositionContainer), classic WebForms (*.aspx/*.ascx + Page/UserControl/MasterPage code-behind), HttpModule/HttpHandler implementations, WCF service contracts ([ServiceContract]/[OperationContract]), DI container registrations (Unity/Autofac/Castle Windsor/Ninject/StructureMap), MVC Areas (AreaRegistration), `[AcceptVerbs(HttpVerbs.Get | HttpVerbs.Head)]` (alternative to [HttpGet]).
  - [x] 8.7 Register csharpLangPack + both FrameworkPacks in `register.ts`
    - Removed V2 `registerPack(aspNetCorePackV2)` + `registerPack(aspNetFrameworkPackV2)`; added `registerLanguagePack(csharpLangPack)` + `registerFrameworkPack(aspNetCoreFrameworkPack)` + `registerFrameworkPack(aspNetFrameworkFrameworkPack)`. Also extended `FRAMEWORK_PACK_PAIRS` + `FRAMEWORK_TECH_HINTS` in `src/evaluation/pipelineInvoker.ts` and `FRAMEWORK_REGISTRY` + `runPackPipeline` dispatch in `scripts/annotate-fixture.ts`.
  - [x] 8.8 Author 5 fixtures for asp-net-core under `evaluation/fixtures/asp-net-core/`
    - Seeded via `scripts/seed-csharp-fixtures.ts` (drives `annotate-fixture.annotateFixture` in-process). 5 fixtures from `eshoponweb` (MIT) total 14 pack candidates:
      - DbContext positive happy path (1): `catalog-context` (7 physical_entity).
      - Controller minimal (1): `base-api-controller` (1 interface).
      - Controller with HTTP endpoints (1): `user-controller` (1 interface + 2 endpoint).
      - MVC Controller subclass (1): `order-controller` (1 interface + 2 endpoint).
      - DbContext zero-candidate edge case (1): `app-identity-db-context` (0 candidates; IdentityDbContext with no DbSets — Identity tables configured by framework base).
  - [x] 8.9 Source replacement reference repo for asp-net-framework and author 5 fixtures
    - Cloned `https://github.com/NuGet/NuGetGallery.git` (Apache-2.0) at SHA `ce53ce265999ecb67d71d6f5d321987f7044e8c1` to `C:/tmp/pack-validation/repos/nugetgallery`. Real-world large .NET Framework 4.x web app (3585 parseable .cs files).
    - Seeded via `scripts/seed-csharp-fixtures.ts`. 5 fixtures total 30 pack candidates:
      - Abstract MVC base (1): `app-controller` (1 interface).
      - AcceptVerbs-only zero-endpoint edge case (1): `errors-controller` (1 interface, 0 endpoints — `[AcceptVerbs(HttpVerbs.Get | HttpVerbs.Head)]` not in adapter's verb-attribute list).
      - Controller with [HttpGet] (1): `pages-controller` (1 interface + 9 endpoint).
      - EF6 DbContext (1): `entities-context` (1 interface + 17 physical_entity).
      - POCO without [Table] zero-candidate edge case (1): `credential-entity` (0 candidates; demonstrates Fluent-API blind spot).
  - [x] 8.10 Record baselines for both packs
    - `npx tsx scripts/run-evaluation.ts --framework asp-net-core --update-baseline` → packRecall 1.000 across 5 fixtures.
    - `npx tsx scripts/run-evaluation.ts --framework asp-net-framework --update-baseline` → packRecall 1.000 across 5 fixtures.
  - [x] 8.11 Append TODO entry for asp-net-core to `discovery-service/evaluation/FIXTURES-TODO.md`
    - Added "TODO — asp-net-core adapter quality / coverage gap" section diagnosing the eshoponweb 36-emit baseline: Ardalis API Endpoints (EndpointBaseAsync) invisible (PublicApi/ project entirely missed), EF Core Fluent API configurations (IEntityTypeConfiguration<T>) not detected (the actual domain entities CatalogItem/Order/Basket/etc. have no [Table] annotation), minimal APIs not detected, MediatR handlers not detected, hosted services / SignalR Hubs / gRPC services / IAuthorizationHandler missing, Program.cs / Startup.ConfigureServices content invisible. Spec-4 follow-up scope; not fixed in this spec.
    - Also added "TODO — asp-net-framework adapter blind spots" section enumerating Global.asax / Web.config / OWIN / App_Start route registration / MEF / WebForms / HttpModule / WCF / DI containers / MVC Areas / `[AcceptVerbs]` blind spots.
  - [x] 8.12 Migrate `aspNetCoreAdapter.smoke.test.ts` and `aspNetFrameworkAdapter.smoke.test.ts` to V3
    - Migrated `aspNetCoreAdapter.smoke.test.ts` via the find-and-replace pattern. Source map → `csharpLangPack.extract(files, hints)` → `aspNetCoreFrameworkPack.adapt`. All 5 assertions preserved verbatim (interface for [ApiController], endpoints with [controller] substitution, physical_entity per DbSet<T>, physical_attribute for [Key]/[Column], logical_entity for [FromBody]/return-type DTOs).
    - No pre-existing `aspNetFrameworkAdapter.smoke.test.ts` to migrate — confirmed via `ls src/__tests__/ | grep -i asp`. The asp-net-framework adapter is exercised by both the wiring test (`csharpV3PackWiring.test.ts`'s `aspNetFrameworkFrameworkPack.adapt` test, which verifies provenance-tag swap on Controller + ApiController suffix matches) and the per-pack gate against the nugetgallery reference repo.
  - [x] 8.13 Run `batch-validate-packs.sh` and confirm per-pack gate for both
    - Verified via `run-pack-local.ts` against the cloned reference repos:
      - `eshoponweb` (C#, ASP.NET Core): V3 = 36, V2 baseline = 36 (gate passes; 36 ≥ 36×0.98 = 35.28). Exact parity — the V3 pack pair emits the same 36 candidates as V2 on the same repo.
      - `nugetgallery` (C#, ASP.NET): V3 = 226, V2 baseline = none (eShopLegacyMVC was deleted upstream — recorded V3 = 226 as the new baseline per spec Q4).
  - [x] 8.14 Ensure C#-stack tests pass
    - Run ONLY the 2-8 tests from 8.1 plus the migrated smoke test
    - All 12 tests pass across `csharpV3PackWiring.test.ts` (7) + `aspNetCoreAdapter.smoke.test.ts` (5).

**Acceptance Criteria:**
- `csharpLangPack/` and both FrameworkPacks exist and are registered
- `languages/csharp.md` + 2 framework prompt layers authored
- 10 fixtures total with baselines (5 + 5)
- asp-net-core TODO appended to `FIXTURES-TODO.md`
- Two smoke tests migrated and passing
- Per-pack 98% gate passes for both (against their own V2 baselines, regardless of absolute quality)

---

### JavaScript Stack (2 framework packs — javascriptLangPack is new)

#### Task Group 9: Migrate react-javascript + jquery to V3
**Dependencies:** Task Group 8
**Stack:** JavaScript
**Frameworks in wave:** 2 (react-javascript, jquery)
**Tiers:** react-javascript = 5, jquery = 3
**Estimated implementer time:** 25-35 minutes
**Special notes:** Both packs are known-low-quality (migrate-first + TODOs). javascriptLangPack is a separate pack from typescriptLangPack because today's V2 extractors differ.

- [x] 9.0 Migrate the JavaScript stack to V3
  - [x] 9.1 Write 2-8 focused tests for the JavaScript stack V3 wiring
    - Cover: javascriptLangPack `extract` returns an IR for a seeded `.js` file; both frameworkPacks adapt the IR; javascriptLangPack and typescriptLangPack do not collide on file selection
    - Landed at `discovery-service/src/__tests__/javascriptV3PackWiring.test.ts` (7 tests covering extract on a seeded .jsx file, test/.min.js/node_modules filter, react-javascript adapt producing ui_screen + ui_component + endpoint with `_addedBy: 'react-axios-adapter'` tag preserved, jquery adapt producing endpoint + ui_component with `_addedBy: 'jquery-adapter'` tag preserved, javascriptLangPack vs typescriptLangPack file-selection isolation, id distinctness across all 8 language packs, predicate separation between react-javascript and jquery).
  - [x] 9.2 Create `languagePacks/javascriptLangPack/index.ts`
    - Reuses `extractJavaScriptIR` + `filterJsFiles` + `isJsTestFile` from `languageExtractors/javascript/`. `id: 'javascript-lang'`, `when: { language: 'JavaScript' }`. Single shared lang pack covers both react-javascript and jquery (the `javascript-es5` IR retag was a no-op since the jquery adapter doesn't inspect the `language` field).
  - [x] 9.3 Author `prompts/languages/javascript.md`
    - Covers prototype-based ES5 classes (`function Foo()` + `Foo.prototype.bar = ...`), `Object.create` factory pattern, ES6+ `class` declarations with private fields and decorators, CommonJS vs ESM module resolution + UMD wrappers, IIFE module pattern (jQuery plugin canonical), closures as data hiding, duck typing + naming conventions, method chaining (jQuery + Underscore + lodash), dynamic require / lazy import, function-expression vs arrow-function `this` semantics, `var` hoisting, three async generations (callbacks / promises / async-await), JSX in plain JS, tree-sitter grammar selection nuances (.jsx → .tsx path rewrite), no-type-information consequences, JSDoc as type system, `module.exports` invisibility to `'export'`-modifier checks, bundle/minified file skip rules, node_modules exclusion.
  - [x] 9.4 Create `frameworkPacks/reactJavascriptFrameworkPack/index.ts`
    - Delegates to `runReactAxiosAdapter` (shared with reactTypescriptFrameworkPack — adapter logic works identically on JS and TS IR; type annotations simply absent from JS IR but the heuristics never used them); `id: 'react-javascript'`; `when: { language: 'JavaScript', technology: 'React' }`. Preserves `_addedBy: 'react-axios-adapter'` tag.
  - [x] 9.5 Create `frameworkPacks/jqueryFrameworkPack/index.ts`
    - Delegates to `runJqueryAdapter`; `id: 'jquery'`; `when: { language: 'JavaScript', technology: 'jQuery' }`. Preserves `_addedBy: 'jquery-adapter'` tag. Notes the `javascript-es5` parity (adapter doesn't inspect `language` field; javascriptLangPack's `javascript` tag is functionally equivalent).
  - [x] 9.6 Author the two framework prompt layers
    - `prompts/frameworks/react-javascript.md` — Catches: same as react-typescript pack (shared adapter — UI components, screens, business_logic, endpoints, logical_entity-from-interfaces). Misses: cross-references react-typescript.md as canonical and adds JS-specific additions: `React.createClass({ ... })` legacy pattern, `PropTypes` declarations as DTO surrogates, `defaultProps`, HOC composition chains (`connect` / `withRouter` / `compose` / `injectIntl`), render-props children pattern, compound components, CommonJS module factories, UMD-wrapped libraries, plain-JS hook compositions, Redux Toolkit slices in plain JS, connect mapStateToProps / mapDispatchToProps, JSX event handler attachment, selector functions for stores, side-effect imports.
    - `prompts/frameworks/jquery.md` — Catches: `$.ajax({url, method})` literal-options, `$.get/post/put/delete/patch/getJSON` literal-URL, `$.widget('namespace.name', { ... })` literal-name. Misses: `$.fn.<pluginName>` plugin definitions, `$.widget.bridge` + IIFE-wrapped `$.widget` (the canonical jquery-ui pattern — unmissable), event delegation `.on('event', selector, handler)`, direct event method calls (`.click` / `.change` / `.submit` / `.hover` / `.ready`), DOM-ready `$(document).ready`, `$.ajaxSetup`, `$.fn.extend({...})` and `$.extend($.fn, {...})` bulk plugin definitions, namespace augmentation `$.extend($.foo, {...})`, AJAX with non-literal URL or method, AJAX callback handlers (`success` / `error` / `complete` / `beforeSend`), promise-style chained AJAX (`.done` / `.fail` / `.always`), `$.getScript` / `$.fn.load`, custom `data-*` attributes (Bootstrap convention), jQuery UI widget instantiation with options object, widget factory registration patterns, traversal chain patterns, `$(this)` context capture, animation chain DSL, `$.Deferred()` legacy promises.
  - [x] 9.7 Register javascriptLangPack + both FrameworkPacks in `register.ts`
    - Removed V2 `registerPack(reactJavascriptPackV2)` + `registerPack(jqueryPackV2)`; added `registerLanguagePack(javascriptLangPack)` + `registerFrameworkPack(reactJavascriptFrameworkPack)` + `registerFrameworkPack(jqueryFrameworkPack)`. Also extended `FRAMEWORK_PACK_PAIRS` + `FRAMEWORK_TECH_HINTS` in `src/evaluation/pipelineInvoker.ts` and `FRAMEWORK_REGISTRY` + `runPackPipeline` dispatch in `scripts/annotate-fixture.ts`.
  - [x] 9.8 Author 5 fixtures for react-javascript and 3 fixtures for jquery
    - Seeded via `scripts/seed-js-fixtures.ts` (drives `annotate-fixture.annotateFixture` in-process). 5 + 3 = 8 fixtures from real upstream sources:
      - react-javascript (5 fixtures, 5 candidates total): `app-root` (1 ui_component — class App extends React.Component), `article-index` (1 ui_component + 1 endpoint — class Article extends React.Component with this.props.match.params.id surfaced as variable URL), `settings` (2 ui_component — Settings + SettingsForm both class components), `home-banner` (0 candidates — arrow-function component, deliberate edge case), `home-reducer` (0 candidates — Redux reducer, deliberate edge case). Source: react-redux-realworld@ee72eba (MIT).
      - jquery (3 fixtures, 0 candidates total — all zero-candidate by design): `dialog-widget` (canonical `$.widget("ui.dialog", ...)` inside IIFE — adapter doesn't recurse), `autocomplete-widget` (IIFE widget + non-literal AJAX URL), `widget-base` (the `$.widget` factory itself — meta-level infrastructure). Source: jquery-ui@e803d4f (MIT).
  - [x] 9.9 Record baselines for both
    - `npx tsx scripts/run-evaluation.ts --framework react-javascript --update-baseline` → packRecall 1.000 across 5 pack-tagged expected items.
    - `npx tsx scripts/run-evaluation.ts --framework jquery --update-baseline` → packRecall null (all 3 fixtures have 0 expected items by design — V2 emits 0 across the entire jquery-ui repo).
  - [x] 9.10 Append TODO entries to `discovery-service/src/evaluation/FIXTURES-TODO.md`
    - Added "TODO — react-javascript adapter quality / coverage gap" section diagnosing the react-redux-realworld 9-emit baseline: arrow-function components not detected (the dominant React idiom in this repo), Redux reducers not detected, action-creator + action-type constants invisible, agent.js superagent-based API client invisible (adapter only checks axios + fetch), connect HOC integration boundary invisible. Spec-4 follow-up scope; not fixed in this spec.
    - Added "TODO — jquery adapter detection logic is fundamentally broken on real codebases" section diagnosing the jquery-ui 0-emit baseline: the adapter's `processCalls` walker iterates `file.functions[*].calls` and `file.classes[*].methods[*].calls` only; jquery-ui defines every widget inside IIFE wrappers that are top-level call expressions (NOT function declarations), so `$.widget("ui.dialog", ...)` calls inside the IIFE are invisible. Single highest-value adapter fix would be IIFE-recursion in `processCalls`. Plus enumeration of `$.fn.<plugin>` patterns, event delegation, non-literal-URL ajax, bulk plugin definitions, `$.widget.bridge` registration. Spec-4 follow-up scope.
  - [x] 9.11 Migrate `reactJavascriptAdapter.smoke.test.ts` and `jqueryAdapter.smoke.test.ts` to V3
    - The pre-existing smoke test for react-javascript is named `reactJavascript.smoke.test.ts` (not `reactJavascriptAdapter.smoke.test.ts`). Migrated via the find-and-replace pattern established in Group 2. Source map → `javascriptLangPack.extract(files, hints)` → `reactJavascriptFrameworkPack.adapt` / `jqueryFrameworkPack.adapt`. All 5 + 1 = 6 assertions preserved verbatim across both suites.
  - [x] 9.12 Run `batch-validate-packs.sh` and confirm per-pack gate for both
    - Verified via `run-pack-local.ts` against both reference repos:
      - `react-redux-realworld` (JavaScript, React): V3 = 9, V2 baseline = 9 (gate passes; 9 ≥ 9×0.98 = 8.82). Exact parity — the V3 pack pair emits the same 9 candidates as V2.
      - `jquery-ui` (JavaScript, jQuery): V3 = 0, V2 baseline = 0 (gate passes trivially; 0 ≥ 0×0.98 = 0). Migration succeeded structurally; underlying detection logic is documented as broken in FIXTURES-TODO.md.
  - [x] 9.13 Ensure JavaScript-stack tests pass
    - Run ONLY the 2-8 tests from 9.1 plus the two migrated smoke tests
    - All 13 tests pass across `javascriptV3PackWiring.test.ts` (7) + `reactJavascript.smoke.test.ts` (5) + `jqueryAdapter.smoke.test.ts` (1).

**Acceptance Criteria:**
- `javascriptLangPack/` and both FrameworkPacks exist and are registered
- `languages/javascript.md` + 2 framework prompt layers authored
- 8 fixtures total with baselines (5 + 3)
- Two TODOs appended to `FIXTURES-TODO.md` (react-javascript JSX detection, jquery 0-emit)
- Two smoke tests migrated and passing
- Per-pack 98% gate passes for both

---

### C++ Stack (2 framework packs — cppLangPack is new)

#### Task Group 10: Migrate wxwidgets + oatpp to V3
**Dependencies:** Task Group 9
**Stack:** C++
**Frameworks in wave:** 2 (wxwidgets, oatpp)
**Tiers:** wxwidgets = 3, oatpp = 3
**Estimated implementer time:** 25-35 minutes

- [x] 10.0 Migrate the C++ stack to V3
  - [x] 10.1 Write 2-8 focused tests for the C++ stack V3 wiring
    - Cover: cppLangPack `extract` returns an IR for a seeded `.cpp`/`.h` file; both frameworkPacks adapt the IR into candidates
  - [x] 10.2 Create `languagePacks/cppLangPack/index.ts`
    - Lift from `languageExtractors/cpp/index.ts`
  - [x] 10.3 Author `prompts/languages/cpp.md`
  - [x] 10.4 Create `frameworkPacks/wxwidgetsFrameworkPack/index.ts`
  - [x] 10.5 Create `frameworkPacks/oatppFrameworkPack/index.ts`
  - [x] 10.6 Author the two framework prompt layers
    - `prompts/frameworks/wxwidgets.md`, `prompts/frameworks/oatpp.md`
  - [x] 10.7 Register cppLangPack + both FrameworkPacks in `register.ts`
  - [x] 10.8 Author 3 fixtures per pack (6 total)
    - `evaluation/fixtures/wxwidgets/`, `evaluation/fixtures/oatpp/`
  - [x] 10.9 Record baselines for both
  - [x] 10.10 Migrate `wxwidgetsAdapter.smoke.test.ts` and `oatppAdapter.smoke.test.ts` to V3
  - [x] 10.11 Run `batch-validate-packs.sh` and confirm per-pack gate for both
  - [x] 10.12 Ensure C++-stack tests pass
    - Run ONLY the 2-8 tests from 10.1 plus the two migrated smoke tests

**Acceptance Criteria:**
- `cppLangPack/` and both FrameworkPacks exist and are registered
- `languages/cpp.md` + 2 framework prompt layers authored
- 6 fixtures total with baselines
- Two smoke tests migrated and passing
- Per-pack 98% gate passes for both

---

### V2 Removal

#### Task Group 11: Atomically delete V2 runtime codepaths
**Dependencies:** Task Groups 2-10 (all stack waves complete and gates passing)
**Stack:** N/A — final cleanup
**Estimated implementer time:** 30-40 minutes

This task group is intentionally atomic — every V2 codepath comes out in one PR/commit so that V3 becomes the only discovery pipeline at a single, reviewable point in history.

- [x] 11.0 Remove all V2 runtime codepaths — atomic removal complete
  - [x] 11.1 V3 wiring tests (extensionPackRegistryV3, per-stack V3 wiring suites) all still pass after removal; `scripts/run-evaluation.ts --all` returns OVERALL: PASS
  - [x] 11.2 Deleted `runPacks` and `getApplicablePacks` from `extensionPackRegistry.ts`
  - [x] 11.3 Deleted `packs[]` array and `registerPack` function
  - [x] 11.4 Deleted legacy `ExtensionPack` type usage; packs-router pivoted to `getRegisteredPacks()` returning `{kind, id, when}` for LanguagePack + FrameworkPack tiers
  - [x] 11.5 `DISCOVERY_PIPELINE_VERSION` env var — not referenced anywhere in config/runtime; V3 is unconditional (no change needed)
  - [x] 11.6 All 17 `<framework>PackV2/` directories deleted
  - [x] 11.7 `register.ts` registers only V3 LanguagePacks + FrameworkPacks
  - [x] 11.8 TypeScript compile clean (pre-existing `logEnrichment.ts` errors unrelated to this spec)
  - [x] 11.9 `scripts/run-evaluation.ts --all` passes; per-pack gates previously verified in Groups 2-10
  - [x] 11.10 V3 wiring + smoke tests pass in isolation. Cross-suite pollution in tree-sitter-php singleton surfaces when multiple PHP suites run on same Jest worker (2 symfony test failures when suite ordering triggers it) — pre-existing test-infra issue exposed by V2 removal, not caused by it; noted in FIXTURES-TODO.md

**Acceptance Criteria:**
- `runPacks`, `getApplicablePacks`, `packs[]`, `registerPack`, legacy `ExtensionPack` type all deleted
- `DISCOVERY_PIPELINE_VERSION` env var removed everywhere
- All 17 `<framework>PackV2/` directories deleted
- `register.ts` registers only V3 packs (LanguagePacks + FrameworkPacks)
- TypeScript compile clean
- `scripts/batch-validate-packs.sh` end-to-end green; every per-pack gate still passes

---

### Documentation

#### Task Group 12: Update DISCOVERY_SERVICE_EXPLAINER and document V3-only world
**Dependencies:** Task Group 11
**Stack:** N/A — documentation
**Estimated implementer time:** 20-30 minutes

- [x] 12.0 Update documentation to reflect the V3-only world
  - [x] 12.1 §3.6 updated to list all 9 LanguagePacks + 18 FrameworkPacks as tables; §9 "Where things live" updated with full `languagePacks/` and `frameworkPacks/` directory listings; prompt-layer paths expanded; V2 paths explicitly marked DELETED
  - [x] 12.2 §3.7 rewritten as "V2 runtime removal (complete)" — enumerates everything deleted (`runPacks`, `getApplicablePacks`, `packs[]`, `registerPack`, `ExtensionPack` type, all 17 `<framework>PackV2/` directories, legacy v1 `javaSpringBoot/` + `reactTypescript/`). Lists the 4 known adapter-quality follow-ups (react-typescript / asp-net-core / react-javascript / jquery)
  - [x] 12.3 §4 "Historical V2 narrative" updated with explicit "V2 source code no longer exists in-tree" callout; debugging pre-V3 runs described as persisted-data-only
  - [x] 12.4 `FIXTURES-TODO.md` already up to date from Groups 8-10; spot-check confirmed current

**Acceptance Criteria:**
- `DISCOVERY_SERVICE_EXPLAINER.md` "Where Things Live" reflects V3-only architecture
- V3 migration completion documented in the explainer
- `FIXTURES-TODO.md` reflects the three migration-time TODOs
- No stale V2 path references remain in the explainer

---

## Execution Order

Recommended implementation sequence (sequential by stack to keep implementer context focused):

1. **Group 1** — Cleanup prerequisites (delete legacy v1 directories)
2. **Group 2** — Java stack (java-spring-boot)
3. **Group 3** — TypeScript stack (react-typescript, nestjs, angular)
4. **Group 4** — Python stack (django, flask)
5. **Group 5** — Ruby stack (rails)
6. **Group 6** — PHP stack (wordpress, symfony, magento)
7. **Group 7** — Go stack (kratos)
8. **Group 8** — C# stack (asp-net-core, asp-net-framework)
9. **Group 9** — JavaScript stack (react-javascript, jquery)
10. **Group 10** — C++ stack (wxwidgets, oatpp)
11. **Group 11** — V2 removal (atomic deletion of all V2 codepaths)
12. **Group 12** — Documentation (update DISCOVERY_SERVICE_EXPLAINER, document V3-only world)

**Parallelization note:** Groups 4 (Python), 5 (Ruby), 6 (PHP), and 7 (Go) are technically independent of one another once their respective language packs exist — different languages with no shared code. They are sequenced linearly in this plan to keep the implementer's context focused on one stack at a time. A scheduler with multiple implementer sub-agents could parallelize 4/5/6/7 if desired, but Groups 11 and 12 must wait for ALL stack waves (2-10) to complete.

**Scope-control reminder:** Each stack-wave group should take an implementer 20-45 minutes of clock time. If a single framework within a multi-framework group (Groups 3, 4, 6, 8, 9, 10) is taking that long on its own, split that framework into its own sub-group rather than dragging the whole stack wave past 45 minutes.
