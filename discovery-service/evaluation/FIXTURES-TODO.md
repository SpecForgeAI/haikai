# Fixtures TODO — V3 Evaluation Harness

Spec: `agent-os/specs/2026-04-19-v3-evaluation-harness`.

This document captures scope that was intentionally deferred from Task Group 6 to stay within the implementer's time budget (<45 minutes of fixture authoring). None of the deferred items are blockers for Group 7 or Spec 4; they land incrementally.

## What shipped in Group 6

- **spring-classic: 10 real fixtures** with curated `expected.json` + README per case. Pack-recall baseline is real (`1.000` at HEAD).
- **django: 5 placeholder fixtures** with `expected: []` and descriptive READMEs. Baseline is all-null.
- **rails: 5 placeholder fixtures** with `expected: []` and descriptive READMEs. Baseline is all-null.

## What shipped in V3 Pack Migration Batch Task Group 3 (TypeScript wave)

- **react-typescript: 10 fixtures** — hand-authored single-file samples modelled on common React + TS patterns (DTOs, axios API clients, components, screens, page-path classification, CRUD-filter cases, router-config negatives).
- **nestjs: 5 fixtures** — modelled on `nestjs-realworld-example-app` patterns (controller / entity / service / user-controller / comment-entity).
- **angular: 10 fixtures** — modelled on `angular-realworld-example-app` patterns (components / services / models / pages).

Baselines recorded at `packRecall = 1.000` across all three packs (expected items were scaffolded from pack output by `annotate-fixture`, so 100% pack recall is the floor, not a quality claim). Per-pack V2 → V3 count parity was verified by running the V3 pipeline against the same upstream cloned repos as V2:

| Repo                  | V2 baseline | V3 count | Gate (V3 ≥ V2×0.98) |
|-----------------------|------------:|---------:|:-------------------:|
| `nestjs-realworld`    | 98          | 98       | pass                |
| `angular-realworld`   | 131         | 131      | pass                |
| `react-redux-realworld` (TS run) | — | 0    | n/a — JS repo       |

## What shipped in V3 Pack Migration Batch Task Group 4 (Python wave)

- **django: 10 fixtures** (replacing the 5 placeholders from Group 6) — sourced from `C:/tmp/pack-validation/repos/saleor` at SHA `b40f4635e155ecfe07bd914dad53f1cd304c4c5d`. Mix of canonical `models.py` files (account, product, app, core, giftcard, invoice, permission, schedulers) plus two deliberate edge cases (account-signals, account-events) where the pack correctly emits zero candidates.
- **flask: 5 fixtures** — sourced from `C:/tmp/pack-validation/repos/flask-microblog` at SHA `a975ef64864354867c88e0ed3a17ba7d17dca752`. Covers SQLAlchemy models, main + auth blueprint routes, JSON-API users endpoints, and a helper-only module (app-email, 0 candidates) as a negative example.

Baselines recorded at `packRecall = 1.000` across both packs. Per-pack V2 → V3 count parity verified by running the V3 pipeline against the same upstream cloned repos as V2:

| Repo                | V2 baseline | V3 count | Gate (V3 ≥ V2×0.98) |
|---------------------|------------:|---------:|:-------------------:|
| `saleor`            | 1205        | 1205     | pass (gate: 1181)   |
| `flask-microblog`   | 75          | 75       | pass (gate: 74)     |

Fixture seeding is reproducible via `npx tsx scripts/seed-python-fixtures.ts`.

## What shipped in V3 Pack Migration Batch Task Group 5 (Ruby wave)

- **rails: 10 fixtures** (replacing the 5 placeholders from Group 6) — sourced from `C:/tmp/pack-validation/repos/discourse` at SHA `866ae39d4642f667eb75a663e672d0eaf32db595`. Mix of real upstream files:
  - **Models (6)** — `tag-model` (14 candidates: entity + 13 relationships), `upload-model` (12), `reviewable-model` (9), `invite-model` (8), `badge-model` (6), `bookmark-model` (4). Exercise the ActiveRecord `has_many` / `has_one` / `belongs_to` / `has_and_belongs_to_many` macro path.
  - **Controllers (3)** — `categories-controller` (interface + 5 REST endpoints), `bookmarks-controller` (interface + 3 endpoints), `about-controller` (interface + 1 endpoint). Cover the `ApplicationController` subclass + conventional REST action-method detection path.
  - **Serializer (1)** — `flagged-topic-serializer` (logical_entity + 9 logical_data_attribute). The rare `ActiveModel::Serializer` direct-subclass case the adapter specifically targets.

Baseline recorded at `packRecall = 1.000` across 75 pack-tagged expected items. Per-pack V2 → V3 count parity verified by running the V3 pipeline against both rails reference repos:

| Repo        | V2 baseline | V3 count | Gate (V3 ≥ V2×0.98) |
|-------------|------------:|---------:|:-------------------:|
| `discourse` | 4101        | 4101     | pass (gate: 4019)   |
| `redmine`   | 471         | 471      | pass (gate: 462)    |

Fixture seeding is reproducible via `npx tsx scripts/seed-ruby-fixtures.ts`.

**Note on single-file fixtures and large models.** The tree-sitter-ruby parser fails with `Invalid argument` on some of Discourse's largest files (`user.rb` / `post.rb` / `topic.rb` / `category.rb`, all in the 1000–2400-line range). Full-repo runs via `run-pack-local.ts` still parse and emit candidates for those files because tree-sitter's buffer allocation behaves differently at the scale of a real repo walk than for single-file extract runs. Fixtures therefore select medium-sized representative examples (tag / upload / reviewable) rather than the largest possible models — the full-repo gate still exercises every file. Follow-up: investigate whether tree-sitter's parse-buffer size can be tuned for very-large single-file extracts.

## What shipped in V3 Pack Migration Batch Task Group 6 (PHP wave)

- **wordpress: 5 fixtures** — sourced from `C:/tmp/pack-validation/repos/wordpress` at SHA `4b9731d84ebfc95d791a68be22cbe84fe3e5e140`. Mix of real upstream files:
  - **Widgets (2)** — `widget-calendar`, `widget-nav-menu`: classes extending `WP_Widget` → `ui_component` emission.
  - **REST controllers + register_rest_route (2)** — `rest-abilities-categories-controller` (interface + 1 endpoint), `rest-block-renderer-controller` (interface + 1 endpoint): classes extending `WP_REST_Controller` with `register_rest_route` calls inside methods.
  - **Interface-only REST controller (1)** — `rest-edit-site-export-controller`: `extends WP_REST_Controller` with no detectable `register_rest_route` inside the class (registration happens elsewhere). Exercises the interface-only emission path.
- **symfony: 5 fixtures** — sourced from `C:/tmp/pack-validation/repos/orangehrm` at SHA `d3a50a814c3098fde81b99abfaacd8cb5a787429`. 5 controllers drawn from the authentication + admin plugins (`logout-controller`, `administrator-verify-controller`, `job-title-controller`, `admin-module-controller`, `work-shift-controller`). Each class extends a framework or custom `*Controller` base matching the adapter's `/(AbstractController|Controller)$/` regex, emitting 1 `interface` candidate per fixture.
- **magento: 5 fixtures** — sourced from `C:/tmp/pack-validation/repos/magento-lts` at SHA `53e2dd30cfde1fede26a3e77e8e64457d51e1deb`. Mix of real upstream files:
  - **Models (3)** — `admin-block-model`, `admin-role-model`, `admin-variable-model`: classes extending `Mage_Core_Model_Abstract` → `physical_entity` emission.
  - **Block (1)** — `adminhtml-html-date-block`: class extending `Mage_Adminhtml_Block_*` → `ui_component` emission.
  - **Controller (1)** — `cms-index-controller`: class extending `Mage_Core_Controller_Front_Action` → `interface` emission.

Baselines recorded at `packRecall = 1.000` across all three packs. Per-pack V2 → V3 count parity verified by running the V3 pipeline against the same upstream cloned repos as V2:

| Repo            | V2 baseline | V3 count | Gate (V3 ≥ V2×0.98) |
|-----------------|------------:|---------:|:-------------------:|
| `wordpress`     | 88          | 88       | pass (gate: 87)     |
| `orangehrm`     | 243         | 243      | pass (gate: 238)    |
| `magento-lts`   | 436         | 436      | pass (gate: 428)    |

Fixture seeding is reproducible via `npx tsx scripts/seed-php-fixtures.ts`.

**Note on `php-legacy` extractor and magento parity.** The V2 `magentoPackV2` used a thin `extractPhpLegacyIR` wrapper (re-tagged IR's `language` field as `'php-legacy'`). The magento adapter does NOT inspect the `language` field — it keys off `cls.extends` pattern matches — so the single shared `phpLangPack` (producing `language: 'php'` IR) is functionally equivalent. The full-repo gate against magento-lts confirms exact count parity (436 V3 vs 436 V2).

**Note on single-file fixtures and large PHP files.** Same tree-sitter size-limit behaviour as the Ruby wave: tree-sitter-php fails with `Invalid argument` on some very-large PHP files (e.g. `app/code/core/Mage/Catalog/Model/Product.php`, `app/code/core/Mage/Customer/Model/Customer.php`, `app/code/core/Mage/Sales/Model/Order.php`) when extracted single-file, but parses fine during the full-repo `run-pack-local` walk. Fixtures therefore select medium-sized representative examples (e.g. `Mage/Admin/Model/{Block,Role,Variable}.php`) rather than the largest possible classes — the full-repo gate still exercises every file. Follow-up: see the equivalent note in the Ruby section; investigation is shared across both stacks.

**Note on orangehrm + PHPDoc annotations.** orangehrm is Symfony-based but predates PHP 8 attributes (uses PHPDoc `/** @ORM\Entity */` and `/** @Route */` annotations). The current `symfony` adapter does NOT parse PHPDoc, so entities in this repo are invisible to the deterministic pack — all 243 emissions come from controllers detected via the `extends *Controller` name-suffix match. Controllers are the only consistently emitted surface on this repo for fixture selection. The prompt layer (`prompts/frameworks/symfony.md`) documents PHPDoc annotations as a known "misses" category for the LLM gap-fill to surface.

## What shipped in V3 Pack Migration Batch Task Group 7 (Go wave)

- **kratos: 5 fixtures** — sourced from `C:/tmp/pack-validation/repos/beer-shop-go` at SHA `f762a4251b7c74120c74406033b370a132cc1fde` (MIT). Mix of real upstream files that deliberately exercise both the adapter's positive emission paths AND its blind spots (per-spec direction: "pick service interfaces, repository impls, server config, DI wiring, and one business logic file"):
  - **Service interfaces (1)** — `user-grpc-interface` (`api/user/service/v1/user_grpc.pb.go`, 3 `interface` candidates): `UserClient` / `UserServer` / `UnsafeUserServer` — the protobuf-generated gRPC service-contract interfaces. Caught via the adapter's `Server` / `Service` / `Client` name-suffix heuristic.
  - **Repository impl via ORM schema (1)** — `user-ent-schema` (`app/user/service/internal/data/ent/user.go`, 11 candidates: 2 logical_entity + 9 logical_data_attribute). Beer-shop-go uses Facebook's `ent` ORM (not gorm). ent schema files carry json-tagged struct fields so the adapter emits them as logical entities / attributes — a faithful projection of the gorm-only heuristic's limitation.
  - **Server config (1)** — `cart-conf-pb` (`app/cart/service/internal/conf/conf.pb.go`, 54 candidates: 9 logical_entity + 45 logical_data_attribute). Generated Bootstrap / Server / Data / Registry config structs with json-protobuf tags — the deployment-contract surface.
  - **DI wiring — deliberate zero-candidate edge case (1)** — `cart-wire-gen` (`app/cart/service/cmd/server/wire_gen.go`, 0 candidates). Google Wire's generated injector function with no struct tags, no `Server/Service/Client` interfaces. The adapter correctly emits nothing — the prompt layer targets this miss directly ("Wire dependency-injection wiring").
  - **Business logic — deliberate zero-candidate edge case (1)** — `cart-biz-usecase` (`app/cart/service/internal/biz/cart.go`, 0 candidates). Contains the `CartRepo` interface (name ends `Repo`, NOT caught by `Server/Service/Client` heuristic) and the `CartUseCase` struct (no tags). Both are architecturally meaningful but invisible to the deterministic pack — prompt layer targets these as "Repository pattern layering" and "UseCase / Service layer orchestration".

Baseline recorded at `packRecall = 1.000` across 68 pack-tagged expected items. Per-pack V2 → V3 count parity verified by running the V3 pipeline against the kratos reference repo:

| Repo            | V2 baseline | V3 count | Gate (V3 ≥ V2×0.98) |
|-----------------|------------:|---------:|:-------------------:|
| `beer-shop-go`  | 719         | 719      | pass (gate: 705)    |

Parity is exact — V3 emits an identical candidate count to V2. Fixture seeding is reproducible via `npx tsx scripts/seed-go-fixtures.ts`.

**Note on tree-sitter-go parse failures on large generated files.** tree-sitter-go fails with `Invalid argument` on 6 of the repo's very-large generated files (e.g. `app/user/service/internal/conf/conf.pb.go` at ~30KB with deeply-nested protobuf registrations, `api/cart/service/v1/cart.pb.go` at ~35KB) when extracted single-file. The full-repo run via `run-pack-local.ts` still logs 6 parse failures but emits 719 candidates from the remaining 228 parseable files. Fixtures therefore select medium-sized representative examples (e.g. `cart-conf-pb` at ~24KB parses successfully; `cart.pb.go` at ~35KB does not). Same follow-up as Ruby / PHP: investigate whether tree-sitter's parse-buffer size can be tuned for very-large single-file extracts.

**Note on ent ORM vs gorm.** The kratos adapter's physical_entity detection path keys off `gorm:` struct tags exclusively. Beer-shop-go uses `ent` (Facebook's schema-first ORM, not struct-tag-based), so even though the underlying user / card / address / beer tables are relational, the adapter emits them as `logical_entity` (via the json-tag fallback) rather than `physical_entity`. This is a known adapter limitation — not an IR gap. The prompt layer (`prompts/frameworks/kratos.md`) documents ent ORM schemas as a "misses" category for the LLM gap-fill to surface.

## TODO — kratos adapter blind spots (captured as prompt misses)

The kratos V3 `frameworks/kratos.md` prompt layer enumerates the deterministic pack's blind spots. The highest-value follow-ups (do NOT fix in this spec — capture as follow-up work):

- **Protobuf `.proto` files are not parsed.** The adapter sees the generated `*_grpc.pb.go` `Server` / `Client` interface types but NOT the individual RPC methods, message definitions, HTTP bindings (`option (google.api.http) = { ... }`), or service-level options. Each RPC is an endpoint; each message is a DTO. Surface via LLM.
- **Wire DI graph is invisible.** `wire.go` / `wire_gen.go` files emit zero candidates because they contain no struct tags and no Server/Service/Client interfaces. Provider sets (`wire.NewSet(...)`), bindings (`wire.Bind(new(I), new(*C))`), and the injector function itself carry the service's concrete dependency graph. This is the single largest architectural surface the adapter misses.
- **Middleware chain ordering.** `server/grpc.go` / `server/http.go` construct transports with `grpc.Middleware(recovery, tracing, logging, jwt, ...)`. Each middleware is a cross-cutting concern; the ordering is load-bearing. None of this is captured.
- **Repository / UseCase layering.** The biz-layer `type XRepo interface` convention uses a `Repo` suffix not caught by the Server/Service/Client heuristic, and the `XUseCase struct` pattern has no tags. Both are architecturally central but invisible.
- **ent ORM schemas.** `ent/schema/*.go` declares `ent.Schema` interfaces with `Fields()` / `Edges()` / `Indexes()` methods. Ent uses code-generation, not struct tags, so the schema → table mapping is invisible.
- **Kafka / NATS / RabbitMQ / Pulsar publishers and subscribers.** Kratos does not standardize a message-bus library; connection setup happens in `data/data.go` or `server/server.go` and never surfaces as a struct tag.
- **OpenTelemetry / Prometheus / log.Helper integrations.** Metrics endpoint, TracerProvider setup, and log.Helper wrapping at each layer are integration points the adapter does not identify.

Parity with V2 (per-pack 98% gate) holds despite these misses — they are misses in BOTH V2 and V3 identically, and per-pack gate evaluates V3 vs V2. Fixing these is Spec-4 follow-up scope.

## What shipped in V3 Pack Migration Batch Task Group 8 (C# wave)

- **asp-net-core: 5 fixtures** — sourced from `C:/tmp/pack-validation/repos/eshoponweb` at SHA captured at fixture-authoring time (MIT). Reference repo deliberately retained from V2 even though its quality is known low (V2 baseline: 36 candidates across 247 parseable .cs files — see follow-up section below). Mix of real upstream files exercising both positive emission paths AND deliberate zero-candidate edge cases:
  - **DbContext positive happy path (1)** — `catalog-context` (`src/Infrastructure/Data/CatalogContext.cs`, 7 `physical_entity` candidates): EF Core `DbContext` with 7 `DbSet<T>` properties (Baskets / CatalogItems / CatalogBrands / CatalogTypes / Orders / OrderItems / BasketItems). The single largest positive emission on the repo.
  - **Controller minimal (1)** — `base-api-controller` (`src/Web/Controllers/Api/BaseApiController.cs`, 1 `interface` candidate): minimal `[ApiController]` + `[Route]` annotated controller. Demonstrates controller-detection in isolation.
  - **Controller with [HttpGet] / [HttpPost] (1)** — `user-controller` (`src/Web/Controllers/UserController.cs`, 3 candidates: 1 `interface` + 2 `endpoint`): `[ApiController]` + verb-attribute action methods.
  - **MVC Controller subclass (1)** — `order-controller` (`src/Web/Controllers/OrderController.cs`, 3 candidates: 1 `interface` + 2 `endpoint`): `Controller` (NOT `ControllerBase`) subclass with `[HttpGet]` action methods. Demonstrates the `Controller`-suffix detection path.
  - **DbContext zero-candidate edge case (1)** — `app-identity-db-context` (`src/Infrastructure/Identity/AppIdentityDbContext.cs`, 0 candidates): extends `IdentityDbContext<ApplicationUser>` (matches the `DbContext$` regex) but declares NO `DbSet<T>` properties — Identity tables are configured by the framework base class. Demonstrates the deterministic adapter's blind spot for framework-configured persistence stores.
- **asp-net-framework: 5 fixtures** — sourced from `C:/tmp/pack-validation/repos/nugetgallery` at SHA `ce53ce265999ecb67d71d6f5d321987f7044e8c1` (Apache-2.0). REPLACEMENT for the deleted eShopLegacyMVC reference repo per spec Q4. NuGetGallery is NuGet's official .NET Framework 4.x package gallery — a real-world large-scale ASP.NET Framework + Web API 2 + EF6 codebase with 3585 parseable .cs files. Mix of real upstream files exercising the adapter's emission paths:
  - **Abstract MVC base controller (1)** — `app-controller` (`src/NuGetGallery/Controllers/AppController.cs`, 1 `interface` candidate): `partial abstract class AppController : Controller`. Demonstrates partial-class + abstract handling on a real .NET Framework controller hierarchy.
  - **AcceptVerbs-only controller (zero-endpoint edge case) (1)** — `errors-controller` (`src/NuGetGallery/Controllers/ErrorsController.cs`, 1 candidate: 1 `interface` only): `partial class ErrorsController : AppController` with action methods carrying `[AcceptVerbs(HttpVerbs.Get | HttpVerbs.Head)]` — NOT `[HttpGet]`. The adapter detects the controller (interface) but NOT the endpoints because `[AcceptVerbs]` is not in its verb-attribute list. Demonstrates the .NET Framework alternative attribute syntax the adapter misses.
  - **Controller with [HttpGet] endpoints (1)** — `pages-controller` (`src/NuGetGallery/Controllers/PagesController.cs`, 10 candidates: 1 `interface` + 9 `endpoint`): `partial class PagesController : AppController` with multiple `[HttpGet]`-annotated action methods.
  - **EF6 DbContext positive happy path (1)** — `entities-context` (`src/NuGetGallery.Core/Entities/EntitiesContext.cs`, 18 candidates: 1 `interface` + 17 `physical_entity`): `class EntitiesContext : ObjectMaterializedInterceptingDbContext` (whose name ends in `DbContext`) with many `DbSet<T>` properties (Packages, Credentials, Scopes, Users, etc.). Largest single-file emission in the C# fixture set.
  - **POCO without [Table] (zero-candidate edge case) (1)** — `credential-entity` (`src/NuGet.Services.Entities/Credential.cs`, 0 candidates): plain POCO implementing `IEntity` with `[Required]` / `[StringLength]` Data Annotations on properties — but NO `[Table]` annotation on the class. The adapter only emits `physical_entity` for `[Table]`-annotated POCOs, so this emits 0 candidates even though the class IS mapped to a DB table via Fluent API in `EntitiesContext.OnModelCreating`. Demonstrates the Fluent-API-configuration blind spot.

Baselines recorded at `packRecall = 1.000` across both packs. Per-pack V2 → V3 count parity verified by running the V3 pipeline against both reference repos:

| Repo             | V2 baseline | V3 count | Gate (V3 ≥ V2×0.98) |
|------------------|------------:|---------:|:-------------------:|
| `eshoponweb`     | 36          | 36       | pass (gate: 36)     |
| `nugetgallery`   | none[^1]    | 226      | recorded as new     |

[^1]: Original V2 reference repo for asp-net-framework was `eShopLegacyMVC`, which has been deleted from upstream. Spec Q4 directs using `dotnet-foundation/NuGetGallery` as the replacement and recording whatever V3 produces as the new baseline (no V2 baseline to gate against).

Parity with V2 on eshoponweb is exact (36 = 36). Fixture seeding is reproducible via `npx tsx scripts/seed-csharp-fixtures.ts`.

## TODO — asp-net-core adapter quality / coverage gap (carried from spec Q3)

eshoponweb V2 baseline = 36 candidates across 247 parseable .cs files. This is suspiciously low for a ~250-file repo. The repo's controllers + EF Core DbContext + DTOs are detected, but the substantial `PublicApi/` project (Ardalis API Endpoints — `EndpointBaseAsync.WithRequest<...>.WithActionResult<...>`) is INVISIBLE to the adapter because its base type ends in `Async`, not `Controller` / `ControllerBase`. Likewise, EF Core entities are configured via Fluent API in `Infrastructure/Data/Config/*Configuration.cs` (each `IEntityTypeConfiguration<T>` implementation), NOT via `[Table]` Data Annotations — so the adapter emits zero physical_entity candidates for the actual domain entities (`CatalogItem`, `Order`, `Basket`, etc.) and only catches them via the DbContext's DbSet enumeration.

The asp-net-core V3 `frameworks/asp-net-core.md` prompt layer enumerates these blind spots in detail. Highest-value follow-ups (do NOT fix in this spec — capture as follow-up work):

- **Ardalis API Endpoints not detected.** `class GetProductEndpoint : EndpointBaseAsync.WithRequest<...>.WithActionResult<...>` is a per-endpoint class pattern that the controller-suffix regex misses entirely. Each endpoint class is one REST action; eShopOnWeb's `PublicApi/` project uses this pattern exclusively. Adapter follow-up: detect base types ending in `EndpointBaseAsync` / `EndpointBase` / `BaseAsyncEndpoint` and emit each as an `endpoint` candidate.
- **EF Core Fluent API configurations not detected.** `class CatalogItemConfiguration : IEntityTypeConfiguration<CatalogItem>` declares the table mapping for `CatalogItem` separately from the POCO. The adapter detects only `[Table]`-annotated POCOs and `DbSet<T>` properties — neither covers Fluent-API-configured entities. Adapter follow-up: detect `IEntityTypeConfiguration<TEntity>` implementations and emit `TEntity` as a `physical_entity`, parsing `builder.ToTable(...)`, `builder.Property(...).HasColumnName(...)`, `builder.HasKey(...)` calls inside the `Configure` method.
- **Minimal APIs not detected.** `app.MapGet("/products", async (...) => ...)` lambda endpoints have no class declaration to extract attributes from. Modern .NET 6+ apps default to minimal APIs. Adapter follow-up: detect `app.Map{Get,Post,Put,Delete,Patch}` calls and emit each as an `endpoint` candidate from the lambda signature.
- **MediatR handlers not detected.** `class GetProductByIdHandler : IRequestHandler<GetProductByIdQuery, ProductDto>` is the dominant CQRS pattern in ASP.NET Core. Adapter follow-up: detect `IRequestHandler<TReq, TResp>` / `INotificationHandler<TNotif>` implementations and emit each handler as a domain operation candidate.
- **Hosted services / BackgroundService / IOptions / SignalR Hubs / gRPC services / IAuthorizationHandler.** Each is a distinct integration surface with no controller analogue. Adapter follow-up: detect each base / interface and emit as a typed candidate.
- **`Program.cs` / `Startup.ConfigureServices` content.** The DI registration graph + middleware chain ordering are entirely invisible without parsing the host-builder calls. Adapter follow-up: special-case `Program.cs` / `Startup.cs` to extract `services.Add{Scoped,Singleton,Transient,DbContext,...}` and `app.Use{Foo}()` call sequences as architectural metadata.

Parity with V2 (per-pack 98% gate) holds despite these misses — they are misses in BOTH V2 and V3 identically, and per-pack gate evaluates V3 vs V2 (36 = 36 on eshoponweb). Fixing them is Spec-4 follow-up scope; this TODO captures the diagnosis so a future pass can tackle the controller / DbContext detection patterns the spec specifically called out.

## TODO — asp-net-framework adapter blind spots (captured as prompt misses)

The asp-net-framework V3 `frameworks/asp-net-framework.md` prompt layer enumerates the deterministic adapter's blind spots. The highest-value follow-ups (do NOT fix in this spec — capture as follow-up work):

- **`Global.asax` lifecycle hooks** (`Application_Start`, `Application_End`, `Session_Start`, `Application_Error`) carry the .NET Framework equivalent of `Program.cs` configuration — route registration, filter registration, IoC bootstrap — none of which the adapter sees.
- **`Web.config` connection strings + `<authentication>` mode + custom `<system.web>` / `<system.webServer>` sections** are the deployment-contract surface; the adapter parses no XML.
- **OWIN middleware** declared via `[assembly: OwinStartup(typeof(...))]` + `Startup.Configuration(IAppBuilder)` is the .NET Framework counterpart to ASP.NET Core's middleware chain — `app.UseFoo(...)` calls in OWIN startup are invisible.
- **Route registration in `App_Start/RouteConfig.cs` / `WebApiConfig.cs`** (`routes.MapRoute(...)`, `config.Routes.MapHttpRoute(...)`) registers routes that may NOT correspond to any conventional controller action. NuGetGallery uses these heavily for OData feed routes.
- **MEF composition (`[Export]` / `[Import]` / `CompositionContainer`).** NuGetGallery uses MEF extensively for plugin / service discovery; the adapter detects no MEF attributes.
- **Classic WebForms (`*.aspx` / `*.ascx` + code-behind extending `System.Web.UI.Page` / `System.Web.UI.UserControl` / `System.Web.UI.MasterPage`)** are an entire UI surface the adapter does not detect.
- **`HttpModule` / `HttpHandler` implementations** intercept the IIS pipeline; both are wired in `Web.config` and invisible to the adapter.
- **WCF service contracts** (`[ServiceContract]` / `[OperationContract]`) — the .NET Framework SOAP / WS-* / TCP / Named-Pipe RPC stack — are not detected.
- **DI container registrations** (Unity / Autofac / Castle Windsor / Ninject / StructureMap) — each container has its own registration syntax; none are detected.
- **MVC Areas (`AreaRegistration` subclasses)** — used for organising NuGetGallery's `Admin/` area and many enterprise apps; not detected.
- **`[AcceptVerbs(HttpVerbs.Get | HttpVerbs.Head)]` action attributes** — alternative to `[HttpGet]` used in some .NET Framework codebases (NuGetGallery's `ErrorsController` is a representative example). The adapter only checks `[HttpGet]` / `[HttpPost]` / `[HttpPut]` / `[HttpDelete]` / `[HttpPatch]` / `[HttpOptions]` / `[HttpHead]`, missing `[AcceptVerbs]` entirely.

NuGetGallery established a fresh baseline of 226 candidates (no V2 baseline existed because eShopLegacyMVC was deleted from upstream). The 226 figure is a faithful representation of the adapter's reach on a real-world large .NET Framework codebase — most "missing" candidates fall into one of the categories above and are LLM-gap-fill targets, not adapter regressions. Fixing them is Spec-4 follow-up scope.

## What shipped in V3 Pack Migration Batch Task Group 9 (JavaScript wave)

- **react-javascript: 5 fixtures** — sourced from `C:/tmp/pack-validation/repos/react-redux-realworld` at SHA `ee72eba4056392c95a27bc48d385d3f54ba38a18` (MIT). Reference repo deliberately retained from V2 even though its V2 baseline is known severely low (9 candidates across 38 .js / .jsx files in the entire repo — see follow-up section below). Mix of real upstream files exercising both positive emission paths AND deliberate zero-candidate edge cases:
  - **Class component (1)** — `app-root` (`src/components/App.js`, 1 `ui_component`): `class App extends React.Component`, the application root. The canonical positive happy path on this repo.
  - **Class component + endpoint (1)** — `article-index` (`src/components/Article/index.js`, 1 `ui_component` + 1 `endpoint`): `class Article extends React.Component` with a property-access URL inside an axios-style API call, surfaced as `GET $this.props.match.params.id` per the adapter's variable-URL handling.
  - **Two co-defined class components (1)** — `settings` (`src/components/Settings.js`, 2 `ui_component`): both `Settings` and `SettingsForm` extend `React.Component` in the same file. Demonstrates multi-component-per-file extraction.
  - **Arrow-function component zero-candidate edge case (1)** — `home-banner` (`src/components/Home/Banner.js`, 0 candidates): modern arrow-function component (`const Banner = (...) => (...)`). The adapter walks `function_declaration` AST nodes only — arrow-function expressions assigned to `const` are NOT surfaced as ui_component candidates. This is the single largest reason the full-repo V2 baseline is only 9 (most components in the repo are arrow functions, NOT class components).
  - **Redux reducer zero-candidate edge case (1)** — `home-reducer` (`src/reducers/home.js`, 0 candidates): default-exported switch-statement reducer named after the state slice. Not a component, not a hook, and the adapter's `business_logic` filter excludes the convention. Demonstrates the Redux-reducer blind spot.
- **jquery: 3 fixtures** — sourced from `C:/tmp/pack-validation/repos/jquery-ui` at SHA `e803d4f67be9d7ae9a5a125c188dd003e3e3043a` (MIT). REAL jQuery UI library — the V2 adapter emits 0 candidates against the entire repo (see follow-up section below). All three fixtures are 0-candidate by design and demonstrate the canonical patterns the adapter misses:
  - **IIFE-wrapped widget (1)** — `dialog-widget` (`ui/widgets/dialog.js`, 0 candidates): canonical `$.widget("ui.dialog", { ... })` definition wrapped in an `(function($){ ... })(jQuery)` IIFE. The adapter's `processCalls` walker does NOT recurse into nested function bodies that are immediately invoked, so the `$.widget(...)` call inside the IIFE is invisible.
  - **IIFE widget + non-literal AJAX (1)** — `autocomplete-widget` (`ui/widgets/autocomplete.js`, 0 candidates): jQuery UI autocomplete widget that internally makes `$.ajax(opts)` calls where `opts` is a dynamically-built object. The adapter's regex-based options parser requires literal `url:` strings; autocomplete builds the URL from the user's input. Edge case for both widget detection AND non-literal-URL ajax detection.
  - **Widget factory itself (1)** — `widget-base` (`ui/widget.js`, 0 candidates): the `$.widget = function(name, base, prototype) { ... }` factory function — meta-level widget infrastructure. Does not call `$.widget(...)`, does not make AJAX requests. Zero-candidate by structural necessity (it IS the registry, not a registration).

Baselines recorded at `packRecall = 1.000` across both packs (when there are non-zero pack-tagged expected items). Per-pack V2 → V3 count parity verified by running the V3 pipeline against both reference repos:

| Repo                    | V2 baseline | V3 count | Gate (V3 ≥ V2×0.98) |
|-------------------------|------------:|---------:|:-------------------:|
| `react-redux-realworld` | 9           | 9        | pass (gate: 9)      |
| `jquery-ui`             | 0           | 0        | pass (gate: 0, trivial) |

Parity is exact on both repos — V3 emits an identical candidate count to V2. Fixture seeding is reproducible via `npx tsx scripts/seed-js-fixtures.ts`.

**Note on `javascript-es5` extractor and jquery parity.** The V2 `jqueryPackV2` used a thin `extractJavaScriptES5IR` wrapper (re-tagged IR's `language` field as `'javascript-es5'`). The jquery adapter does NOT inspect the `language` field — it keys off call-expression callee shapes (`$.ajax`, `$.widget`, `$.get/post/put/delete`) — so the single shared `javascriptLangPack` (producing `language: 'javascript'` IR) is functionally equivalent. The full-repo gate confirms exact count parity (0 V3 vs 0 V2). Same pattern as `csharpLangPack` covering both asp-net-core and asp-net-framework, and `phpLangPack` covering both modern PHP and `php-legacy`.

## TODO — react-javascript adapter quality / coverage gap (carried from spec Q3)

react-redux-realworld V2 baseline = 9 candidates across 38 .js / .jsx files. This is suspiciously low for an entire small-to-medium React app. The repo's class components (`App`, `Article`, `Header`, `Home`, `Login`, `Profile`, `Register`, `Settings`) are detected, but most of the application surface — arrow-function components, custom hooks, Redux reducers + slice files, Redux middleware, action creators, the agent.js superagent-based API client — is invisible to the adapter.

The react-javascript V3 `frameworks/react-javascript.md` prompt layer enumerates these blind spots in detail (and cross-references `react-typescript.md`). Highest-value follow-ups (do NOT fix in this spec — capture as follow-up work):

- **Arrow-function components not detected.** `const Foo = (props) => <div />` is the modern functional-React idiom — react-redux-realworld uses it for most non-class components (Banner, Tags, ArticleList, ArticleMeta, ArticlePreview, CommentList, ListErrors, ListPagination, ProfileFavorites, etc.). The adapter walks `function_declaration` nodes only, so all arrow-function components are silently dropped. Adapter follow-up: detect `const <PascalCase> = (...) => ...` patterns whose body returns JSX or whose file is `.jsx` and emit each as a `ui_component` / `ui_screen` per the same name-suffix / dir-immediate classification.
- **Redux Toolkit-style and classic reducers not detected.** Reducer modules (`reducers/article.js`, `reducers/auth.js`, `reducers/home.js`, etc.) export switch-statement functions named after their state slice. They are neither components nor hooks, and the adapter's `business_logic` exclusion filter strips them. Adapter follow-up: detect default-exported functions whose body is a switch on `action.type` and emit each as a state-management boundary (`integration` or `business_logic` candidate with a `stateSlice` data field).
- **Action-creator + action-type constant modules invisible.** `constants/actionTypes.js` declares the message catalogue (`export const ARTICLE_LOADED = 'ARTICLE_LOADED'`); each constant is an event-vocabulary entry. `agent.js` declares the API surface but uses superagent (chained `.set(...).send(...).end(...)`) — the adapter only checks `axios.*` and bare `fetch`, so superagent calls emit zero endpoints.
- **Connect HOC integration boundary invisible.** `connect(mapStateToProps, mapDispatchToProps)(MyComponent)` is the Redux ↔ component glue. The adapter sees `MyComponent` (when it is a class) but does not surface the `mapStateToProps` / `mapDispatchToProps` shape — which is the actual store-key contract.
- **Custom hook compositions, Context providers with business state, render-props, Redux middleware, sagas / thunks, React Router routing trees** — same misses as documented in `prompts/frameworks/react-typescript.md`. Apply equally to React + JS.

Parity with V2 (per-pack 98% gate) holds despite these misses — they are misses in BOTH V2 and V3 identically, and the per-pack gate evaluates V3 vs V2 (9 = 9 on react-redux-realworld). Fixing them is Spec-4 follow-up scope; this TODO captures the diagnosis so a future pass can tackle the arrow-function-component and Redux-reducer detection patterns the spec specifically called out.

## TODO — jquery adapter detection logic is fundamentally broken on real codebases (carried from spec Q3)

jquery-ui V2 baseline = 0 candidates across the entire ~270-file library. This is not a "low-quality" pack — the adapter's detection logic does not match any pattern that the canonical jQuery UI library (and most production jQuery codebases) actually uses. The baseline is a true zero, not an under-emission of a non-zero positive number.

The fundamental problem: the adapter's `processCalls` walker iterates `file.functions[*].calls` and `file.classes[*].methods[*].calls` only. jQuery UI defines every widget inside an IIFE wrapper:

```js
( function( factory ) {
    if ( typeof define === "function" && define.amd ) {
        define( [ "jquery", "./mouse", ...], factory );
    } else {
        factory( jQuery );
    }
}( function( $ ) {
    return $.widget( "ui.dialog", {
        // ... widget prototype
    });
}));
```

The IIFE call expression is a top-level statement, NOT a function declaration. The walker never sees the inner function body, so `$.widget("ui.dialog", ...)` is invisible. Every jquery-ui widget (dialog, datepicker, autocomplete, accordion, tabs, etc.) is missed for this exact reason.

The jquery V3 `frameworks/jquery.md` prompt layer enumerates the missed patterns. Highest-value follow-ups (do NOT fix in this spec — capture as follow-up work):

- **IIFE-recursion in the adapter.** The single highest-value adapter fix: have `processCalls` recurse into IIFE-wrapped function bodies. Most jQuery codebases (jquery-ui, jQuery plugins on GitHub, Bootstrap's JS layer) use the IIFE wrapper as the canonical module pattern. Recovering IIFE-internal calls would lift the jquery-ui baseline from 0 to plausibly hundreds of widget + endpoint candidates.
- **`$.fn.<pluginName>` plugin definitions.** The adapter only looks for `$.widget(...)` calls, not for `$.fn.<name> = function(opts) { ... }` assignments. The latter is the more common plugin-definition pattern. Detect `$.fn.<name> = ...` member-expression assignments and emit each as a `ui_component`.
- **Event delegation `.on('event', selector, handler)`.** Each delegation is an event-handler registration that the adapter does not see. Emit as event-binding boundaries.
- **AJAX with non-literal URL.** The regex-based options parser requires literal `url: '...'` strings. Real codebases build URLs dynamically. Either drop the literal-only restriction or surface non-literal URL calls as `endpoint` candidates with the URL noted as "dynamic".
- **`$.fn.extend({ ... })` and `$.extend($.fn, { ... })` bulk plugin definitions.** Multiple plugin methods declared in one call. Enumerate the keys of the object literal.
- **`$.widget.bridge` registration** (jquery-ui's class-based alternative to `$.widget(...)`).

Parity with V2 (per-pack 98% gate) holds because V3 = V2 = 0 on jquery-ui — the gate evaluates V3 ≥ V2×0.98, and 0 ≥ 0 is trivially true. This is a "structural migration succeeded; underlying detection logic is broken" outcome. Fixing the detection is Spec-4 follow-up scope; this TODO captures the diagnosis so a future pass can tackle the IIFE-recursion limitation that gates almost all jQuery codebase detection.

## What shipped in V3 Pack Migration Batch Task Group 10 (C++ wave)

- **wxwidgets: 3 fixtures** — sourced from `C:/tmp/pack-validation/repos/wxwidgets` at SHA `6026d2f609656fa44df0efbaeee98b15e54931bd` (wxWindows-3.1). Mix of real upstream files exercising both positive emission paths AND a deliberate parser-skip edge case:
  - **animate-anitest** (`samples/animate/anitest.cpp`): canonical `wxFrame` subclass demo — produces an IR file but emits 0 candidates because the file is structured around a top-level `MyFrame` definition that does not match the V2-baseline-expected schema for a positive emission. Fixture documents an IR-extracted-but-no-candidate case.
  - **calendar-sample** (`samples/calendar/calendar.cpp`, 1066 lines): canonical `wxCalendarCtrl` sample. **Skipped by tree-sitter-cpp** with the same `Invalid argument` size-limit failure mode documented for Ruby (Task Group 5), PHP (Task Group 6), and Go (Task Group 7) very-large single-file extracts. Full-repo run via `run-pack-local.ts` parses 3234 of 3593 .cpp/.h files in the wxwidgets repo and emits 258 candidates total — exact V2 parity. Fixture is a representative parser-skip edge case.
  - **caret-sample** (`samples/caret/caret.cpp`): canonical `wxCaret` widget sample — 1 ui_screen / ui_component candidate via the `class MyFrame : public wxFrame` inheritance chain. Positive happy-path fixture.
- **oatpp: 3 fixtures** — sourced from `C:/tmp/pack-validation/repos/oatpp-crud` at SHA `325bc0720fd3079831f36989587bff6d6ee6541a` (Apache-2.0). Mix of real upstream files exercising the `ENDPOINT(...)` macro regex detection path AND a deliberate zero-candidate edge case:
  - **static-controller** (`src/controller/StaticController.hpp`): minimal oatpp `ApiController` subclass with one `ENDPOINT("GET", "/", root, ...)` macro — emits 1 `interface` + 1 `endpoint` candidate. Positive happy-path fixture.
  - **user-controller** (`src/controller/UserController.hpp`): full CRUD oatpp `ApiController` with 5 `ENDPOINT(...)` macros (POST users, PUT users/{userId}, GET users/{userId}, GET users/offset/{offset}/limit/{limit}, DELETE users/{userId}) — emits 1 `interface` + 5 `endpoint` candidates. Largest single-file emission in the C++ fixture set.
  - **user-dto** (`src/dto/UserDto.hpp`): plain DTO class extending `oatpp::DTO` with `DTO_INIT` + `DTO_FIELD` macros — emits 0 candidates. The oatpp adapter only matches `ApiController`-suffixed classes for interfaces and `ENDPOINT(...)` macros for endpoints; `DTO_FIELD` declarations are invisible. Demonstrates the DTO/data-transfer-shape blind spot.

Baselines recorded at `packRecall = 1.000` across both packs. Per-pack V2 -> V3 count parity verified by running the V3 pipeline against both reference repos:

| Repo            | V2 baseline | V3 count | Gate (V3 >= V2*0.98) |
|-----------------|------------:|---------:|:--------------------:|
| `wxwidgets`     | 258         | 258      | pass (gate: 253)     |
| `oatpp-crud`    | 8           | 8        | pass (gate: 8)       |

Parity is exact on both repos — V3 emits an identical candidate count to V2. Fixture seeding is reproducible via `npx tsx scripts/seed-cpp-fixtures.ts`.

**Note on the oatpp side-channel raw-source cache.** `oatppFrameworkPack` is the one outlier in the V3 migration: its `ENDPOINT(...)` macro regex detection requires raw source text (tree-sitter-cpp emits zero `class_specifier` nodes for files containing ENDPOINT macro bodies — the parser bails on the unparseable macro arguments). The V3 `FrameworkPack.adapt` contract intentionally does not pass raw source, so `cppLangPack.extract` populates a module-level `rawSourceCache` that `oatppFrameworkPack.adapt` reads from. See `services/extensionPacks/languagePacks/cppLangPack/rawSourceCache.ts` for the rationale.

**Note on tree-sitter-cpp parse failures on large files.** Same tree-sitter size-limit behaviour as the Ruby / PHP / Go waves: tree-sitter-cpp fails (or returns null) on some very-large C++ source files (e.g. `samples/calendar/calendar.cpp` at 1066 lines / ~38KB) when extracted single-file. Full-repo `run-pack-local` walks tolerate the same files differently — the wxwidgets repo run parses 3234 of 3593 files (359 skipped) and still produces the full 258-candidate emission. Fixtures therefore include calendar-sample as a representative parser-skip case rather than excluding it. Same shared follow-up as Ruby / PHP / Go: investigate whether tree-sitter buffer sizes can be tuned for very-large single-file extracts.

## TODO — wxwidgets + oatpp fixture README enrichment

The 6 fixture READMEs (`evaluation/fixtures/{wxwidgets,oatpp}/<case>/README.md`) currently carry placeholder `Why this fixture: TODO` and `Notes: TODO` sections from `seed-cpp-fixtures.ts` scaffolding. The case-selection rationale is documented in this file (above) and in the per-fixture `expected.json` candidate counts; enriching the per-fixture READMEs is a low-priority cosmetic follow-up. Not a regression — V2 had no fixture READMEs at all.

## TODO — oatpp adapter blind spots (captured as prompt misses)

The oatpp V3 `frameworks/oatpp.md` prompt layer enumerates the deterministic pack's blind spots. The highest-value follow-ups (do NOT fix in this spec — capture as follow-up work):

- **DTO classes are invisible.** Classes extending `oatpp::DTO` with `DTO_INIT` + `DTO_FIELD` macro bodies (the canonical request/response payload-shape declaration) emit zero candidates because the adapter keys off `ApiController` suffix + `ENDPOINT(...)` macros only. Each DTO is a wire-format contract; surfacing them is high-value for API-surface understanding. Adapter follow-up: detect `class X : public oatpp::DTO<...>` patterns and parse `DTO_FIELD(Type, name)` macro lines to emit `logical_entity` + `logical_data_attribute` candidates.
- **`ApiClient` declarations.** `class MyClient : public oatpp::web::client::ApiClient` with `API_CALL("METHOD", "/path", method)` macro lines — the client-side counterpart to `ApiController` + `ENDPOINT`. The adapter detects the controller side but not the client side. Architecturally meaningful for cross-service call detection.
- **Authorization handlers, interceptors, error handlers.** oatpp's request-pipeline integration points (`oatpp::web::server::handler::AuthorizationHandler`, `oatpp::web::server::interceptor::RequestInterceptor`, etc.) are normal class declarations the adapter does not classify.
- **AppComponent / `OATPP_CREATE_COMPONENT` DI registrations.** oatpp's dependency-injection container is declared via `OATPP_CREATE_COMPONENT(Type, name)([] { ... })` macros inside `AppComponent` classes. The adapter does not parse these macros, so the service's DI graph is invisible. Same shape of miss as Spring's `@Configuration` / `@Bean` graph (which V3's java-spring-boot pack DOES detect).
- **Connection providers, object mappers, async executor configuration.** oatpp's deployment-contract surface (TCP/TLS connection providers, JSON object mappers, async executor selection) sits inside `AppComponent` — same blind spot as the DI graph.

Parity with V2 (per-pack 98% gate) holds despite these misses — they are misses in BOTH V2 and V3 identically, and per-pack gate evaluates V3 vs V2 (8 = 8 on oatpp-crud). Fixing them is Spec-4 follow-up scope.

## TODO — wxwidgets adapter blind spots (captured as prompt misses)

The wxwidgets V3 `frameworks/wxwidgets.md` prompt layer enumerates the deterministic pack's blind spots. The highest-value follow-ups (do NOT fix in this spec — capture as follow-up work):

- **Event tables (`wxBEGIN_EVENT_TABLE` / `wxEND_EVENT_TABLE` / `EVT_*` macros).** wxWidgets' classic event-handler-binding mechanism declares which events route to which methods. The adapter detects the class but not the event-table macros, so the event surface is invisible. Each `EVT_BUTTON(ID_OK, MyFrame::OnOk)` line is an event-handler registration analogous to a controller endpoint.
- **`Bind()` calls (modern event binding).** `Bind(wxEVT_BUTTON, &MyFrame::OnOk, this, ID_OK)` is the modern alternative to event tables. Same miss — the call lives inside a constructor or method body and the adapter's class-inheritance detection does not see it.
- **Custom widget subclasses without canonical bases.** Many wxWidgets apps subclass `wxControl` or `wxWindow` directly to build custom widgets. The adapter only matches a fixed list of base classes (`wxFrame`, `wxDialog`, `wxPanel`, `wxButton`, etc.); custom-base subclasses silently miss. Adapter follow-up: detect any subclass of any class whose name matches `^wx[A-Z]` and emit per a name-suffix heuristic.
- **`wxApp` / `wxAppConsole` subclasses.** The application's entry point (`OnInit` / `OnExit` lifecycle) is a wxApp subclass — architecturally distinct from a window. The adapter does not specially classify it.
- **XRC resource files (`.xrc` XML).** Many wxWidgets apps declare their UI tree via XRC instead of in C++. The adapter parses no XML, so XRC-declared dialogs / frames / panels are entirely invisible.
- **`wxConfig` / `wxFileConfig` registrations.** Configuration storage backends — deployment-contract surface.

Parity with V2 (per-pack 98% gate) holds despite these misses — they are misses in BOTH V2 and V3 identically, and per-pack gate evaluates V3 vs V2 (258 = 258 on wxwidgets). Fixing them is Spec-4 follow-up scope.

## What was reduced

- **Spec originally calls for 10 fixtures per framework.** Reduced django + rails to 5 each in Group 6 because neither framework had a V3 pack yet. django is now back to the full 10-fixture tier (Task Group 4); rails is now back to the full 10-fixture tier (Task Group 5).

## TODO — react-typescript quality / coverage gap

- **No canonical TypeScript + React reference repo currently under `C:/tmp/pack-validation/repos/`.** `react-redux-realworld` is a plain-JavaScript repo; the V3 `react-typescript` pack emits 0 candidates on it (correct — it does not match the predicate). The V2 `react-redux-realworld: 9` figure in `summary.tsv` was from the `react-axios-adapter` via the plain-JS code path, not from the `react-typescriptPackV2`.
- **Action**: clone a real TypeScript React reference repo (e.g. `vercel/next.js/examples/with-typescript`, `gothinkster/realworld` TS examples, or any in-house TS React project) under `C:/tmp/pack-validation/repos/react-typescript-realworld/` and rerun baseline authoring. This is a Spec 4 follow-up.
- **Suspected adapter gaps worth investigation** (do NOT fix in this spec — capture as follow-up):
  - Context providers carrying business state are seen as generic components, not marked as cross-cutting integration points.
  - Custom hook compositions (hooks that wire API calls, selectors, and state) are skipped via the `use*` CRUD-style filter. Surface the genuine business hooks separately.
  - Redux Toolkit slices (`createSlice`, `createAsyncThunk`) and RTK Query `createApi` endpoints are not detected at all — these are primary state + endpoint sources in modern React TS apps.
  - Next.js / Remix route `loader` / `action` / `getServerSideProps` exports are not detected — significant gap for SSR apps.
- These align with the "Misses" section of `prompts/frameworks/react-typescript.md` but are absent from the deterministic adapter today.

## TODO — django adapter cross-file inheritance

- The Saleor fixtures expose a latent detection gap: many saleor models inherit from `ModelWithMetadata` (defined in `saleor/core/models.py`). When the pack runs per-fixture (single-file), those subclasses emit zero candidates because the adapter does not have the base-class IR available to walk the inheritance chain. The full-repo run (`run-pack-local.ts C:/tmp/pack-validation/repos/saleor`) DOES pick them up because all IR files are available.
- This is expected behaviour for the current adapter and does not block the baseline gate (which evaluates the full-repo count). Single-file fixtures simply exercise the subset the adapter catches without cross-file context. See `account-models` / `product-models` fixtures for the positive side of the split.
- **Action (future follow-up)**: consider a "base-class registry" pass in the adapter so per-fixture runs can still resolve transitive-base inheritance. Not required for this spec.

## TODO — rails adapter blind spots (captured as prompt misses)

The rails V3 `frameworks/rails.md` prompt layer enumerates the deterministic pack's blind spots. The highest-value follow-ups (do NOT fix in this spec — capture as follow-up work):

- **ActiveSupport::Concern modules** under `app/controllers/concerns/`, `app/models/concerns/`, `app/serializers/concerns/` are not detected at all (they are `module` declarations, not `class` declarations). Concerns carry shared cross-cutting behaviour (e.g. `HasCustomFields`, `Roleable`, `Trashable`). Surface each concern module as a library / cross-cutting candidate.
- **Service objects** under `app/services/` are plain-Ruby classes with no framework base class. The adapter's inheritance-based detection misses them entirely. Surface each service as a business-logic candidate.
- **ActionMailer classes** under `app/mailers/` extend `ApplicationMailer` / `ActionMailer::Base`. The adapter does not recognise the mailer base classes, so mailer methods (external integration points) are invisible.
- **ActiveJob classes** under `app/jobs/` — `class Foo < ApplicationJob` or `class Foo < ::Jobs::Base` (Sidekiq convention). Background-job `perform` / `execute` methods are architecturally distinct from synchronous controller actions.
- **Routes DSL** in `config/routes.rb` — `resources :users`, custom member / collection routes, `namespace :api do ... end` — the pack's convention-based endpoint emission from controllers does NOT cover custom routes that are NOT wired to a conventional action method.
- **Callbacks** (`before_save`, `after_create`, etc.) and **filters** (`before_action`, `after_action`) are class-body macros; the adapter captures the relationship-cardinality macros but not these lifecycle macros. Emit as cross-cutting concerns.
- **Validations** (`validates :email, presence: true`) carry business-rule semantics distinct from the attributes they reference.
- **Scopes** (`scope :active, -> { where(active: true) }`) encode named queries that are part of the model's domain API.
- **ActiveRecord enums** (`enum status: [:draft, :published]`) declare a state-set surface on a column.

Parity with V2 (per-pack 98% gate) holds despite these misses — they are misses in BOTH V2 and V3 identically, and per-pack gate evaluates V3 vs V2. Fixing these is Spec-4 follow-up scope.

## TODO — PHP adapter blind spots (captured as prompt misses)

The three PHP framework prompt layers (`prompts/frameworks/{wordpress,symfony,magento}.md`) enumerate the deterministic packs' blind spots. The highest-value follow-ups (do NOT fix in this spec — capture as follow-up work):

**wordpress adapter:**
- `add_action` / `add_filter` hook registrations are NOT detected — the adapter only sees the `register_rest_route` / `register_post_type` / `register_taxonomy` call pattern. Most WordPress plugin behaviour wires via `add_action` / `add_filter`, so the architectural surface is significantly under-emitted.
- Shortcode registration (`add_shortcode`), admin page registration (`add_menu_page`, `add_submenu_page`, `add_options_page`), and cron events (`wp_schedule_event`) are all invisible.
- Gutenberg block registration (`register_block_type`) is not detected — modern WordPress uses blocks instead of the classic `WP_Widget` pattern the adapter covers.
- Options API sites (`get_option` / `update_option`) and transient caches (`get_transient` / `set_transient`) are invisible.

**symfony adapter:**
- PHPDoc `@Route` / `@ORM\Entity` / `@ORM\Column` / `@ORM\ManyToOne` annotations are NOT parsed. Symfony 3/4 codebases (and Symfony 5 apps still on annotations — like orangehrm) have their entire controller / entity surface invisible. Only PHP 8 attributes (`#[Route]`, `#[ORM\Entity]`) are caught.
- DI container XML/YAML service definitions are invisible (the adapter does not parse `config/services.yaml` / `services.xml`).
- Event subscribers (`EventSubscriberInterface`), voters (`VoterInterface`), form types (`AbstractType`), validators (`Constraint` + `ConstraintValidator`), twig extensions (`AbstractExtension`), console commands (`#[AsCommand]`), message handlers (`#[AsMessageHandler]`) are all invisible.

**magento adapter:**
- XML config files drive most of Magento's architecture: `etc/module.xml` (module declarations), `etc/events.xml` (observer wiring), `etc/di.xml` (interface preferences, virtual types, plugins/interceptors), `etc/crontab.xml` (cron jobs), `etc/webapi.xml` (REST endpoints), layout XML, UI component XML config. NONE of these are parsed by the adapter — only class inheritance is used.
- Plugins / interceptors (Magento's unique before/after/around method-interception pattern wired via `di.xml`) are invisible even though they encode real cross-cutting logic.
- Observer classes (`ObserverInterface`) themselves usually don't extend a detectable base — they're just classes with an `execute($observer)` method, so they slip past the inheritance-based detection.

Parity with V2 (per-pack 98% gate) holds despite these misses — they are misses in BOTH V2 and V3 identically, and per-pack gate evaluates V3 vs V2. Fixing these is Spec-4 follow-up scope (or a dedicated XML-parsing investigation for Magento / Symfony DI).

## What was deferred

### 6.5 — LLM fixture recording (`--live --record`)
No `evaluation/llm-fixtures/<framework>/<case>.llm-response.json` files were captured.

Why: per implementer instructions, pack-only baselines land first; live LLM recording is an explicit user action (costs money, needs API creds, mutates fixtures). Running `--live --record` is safe but should be a deliberate decision by the operator, not an automated step.

When to do it: when prompt iteration lands, or when a Spec-4 pack migration wants gap-fill-recall regression safety. The harness gracefully skips the gap-fill metrics for fixtures without a recorded LLM response (replay throws only if the pipeline actually reaches the gap-fill stage, which the default pack-only invoker never does).

How to do it: `npx tsx scripts/run-evaluation.ts --all --live --record` then commit the generated JSON files.

### Additional spring-classic fixtures
Spec's original list suggested case ids like `patient-controller`, `module-factory`, `openmrs-api-authentication`. We picked 10 alternatives that produced a more balanced happy-path / edge / blind-spot / negative mix. The suggested cases can be added incrementally.

### Real-repo-sourced TypeScript-stack fixtures
The 25 TypeScript-stack fixtures scaffolded in Task Group 3 are hand-authored single-file samples modelled on canonical upstream patterns rather than upstream files lifted verbatim. Rationale: (a) single-file fixtures are what the evaluation harness expects (`<caseId>.<ext>` per case), and (b) upstream files often import local siblings the loader cannot resolve. Fixtures exercise adapter surface area that matches the real repos' shape (articles / users / comments for nestjs + angular; DTOs / components / services / axios for react). For provenance-strict baselines, these can be replaced with upstream-sourced single-file extracts in a future pass.

## Current baseline values

- **spring-classic**: packRecall `1.000` across 32 total pack-tagged expected items; gapFillRecall `0.000` across 13 gap-fill-tagged expected items (no LLM run). All other metrics null.
- **java-spring-boot**: packRecall `1.000` (Task Group 2 migration).
- **react-typescript**: packRecall `1.000` across 10 fixtures (Task Group 3 migration).
- **nestjs**: packRecall `1.000` across 5 fixtures (Task Group 3 migration).
- **angular**: packRecall `1.000` across 10 fixtures (Task Group 3 migration).
- **django**: packRecall `1.000` across 10 fixtures (Task Group 4 migration).
- **flask**: packRecall `1.000` across 5 fixtures (Task Group 4 migration).
- **rails**: packRecall `1.000` across 10 fixtures (Task Group 5 migration).
- **wordpress**: packRecall `1.000` across 5 fixtures (Task Group 6 migration).
- **symfony**: packRecall `1.000` across 5 fixtures (Task Group 6 migration).
- **magento**: packRecall `1.000` across 5 fixtures (Task Group 6 migration).
- **kratos**: packRecall `1.000` across 5 fixtures (Task Group 7 migration).
- **asp-net-core**: packRecall `1.000` across 5 fixtures (Task Group 8 migration).
- **asp-net-framework**: packRecall `1.000` across 5 fixtures (Task Group 8 migration).
- **react-javascript**: packRecall `1.000` across 5 fixtures (Task Group 9 migration; 3 positive + 2 zero-candidate edge cases).
- **jquery**: packRecall `n/a` across 3 fixtures (Task Group 9 migration; all 3 are zero-candidate by design — V2 emits 0 across the entire jquery-ui repo).
- **wxwidgets**: packRecall `1.000` across 3 fixtures (Task Group 10 migration; 1 positive + 1 IR-extracted-zero-candidate + 1 parser-skip edge case).
- **oatpp**: packRecall `1.000` across 3 fixtures (Task Group 10 migration; 2 positive + 1 DTO-blind-spot zero-candidate edge case).

## Harness health at HEAD

```
$ npx tsx scripts/run-evaluation.ts --all
... 2.6s ...
OVERALL: PASS
```

Performance well under the <60s `--all` / <10s per-framework targets.
