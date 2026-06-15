# C# language guidance

## Idioms to recognize

- **Partial classes.** `partial class Foo` lets a single class
  declaration be split across multiple files. Generated code
  (Entity Framework migrations, WPF / WinForms designers, source
  generators, ASP.NET MVC scaffolding) commonly emits one half of a
  partial class so users can extend behaviour in a sibling file.
  Treat partial declarations as a SINGLE logical class — the
  type identity is `(namespace, typename)`, not `(namespace, typename,
  filePath)`. The extractor surfaces each declaration separately;
  consumers must merge across files when reasoning about a single
  class's full surface area.
- **Source generators.** C# 9+ source generators (Roslyn analyzers
  with the `[Generator]` attribute) emit additional `.cs` files at
  compile time. These files are typically written to
  `obj/Debug/.../Generated/` (excluded by the language pack) but the
  TRIGGER is a partial class or interface in source plus an
  attribute (e.g. `[GenerateSerializer]`, `[ApiController]` is NOT
  a generator trigger but `[Mapper]` for Mapperly is, `[INotify
  PropertyChanged]` for CommunityToolkit.Mvvm is). When you see a
  partial class with no body or a partial method declared with no
  implementation, a source generator is supplying the missing half.
- **LINQ and deferred execution.** `IEnumerable<T>` chains
  (`Where(...).Select(...).OrderBy(...)`) build a query expression
  tree but do NOT execute until materialised by `.ToList()` /
  `.ToArray()` / `.First()` / `.Count()` / `foreach` enumeration.
  `IQueryable<T>` (typed against EF DbSets) translates the
  expression tree to SQL on materialisation — every condition added
  with `.Where(...)` becomes a SQL WHERE clause. Recognising the
  `IQueryable` vs `IEnumerable` distinction is how you tell
  "happens in the database" from "happens in process memory". A
  late `.ToList()` after a complex chain is the materialisation
  point; before it, the expression tree is still mutable.
- **async / await + Task.** Every modern .NET I/O surface returns
  `Task` or `Task<T>`. The `async` keyword opts a method into the
  state-machine rewrite; `await` suspends until the awaited task
  completes. Method names ending `Async` are convention. The
  framework pack treats `async Task<ActionResult<T>>` as
  semantically equivalent to `ActionResult<T>` for the purpose of
  inferring response types. `ConfigureAwait(false)` is library-
  surface convention to avoid capturing the synchronisation
  context.
- **Nullable reference types (NRT).** C# 8+ `<Nullable>enable
  </Nullable>` makes reference types non-nullable by default;
  `string?` / `Foo?` opts back into nullability. The compiler
  warns on potential null dereferences. NRT-aware codebases use the
  `?` suffix as a contract — `Foo?` says "this can be null", `Foo`
  says "this is guaranteed non-null". When extracting domain
  semantics, treat the `?` annotation as a business-meaningful
  optionality marker (especially on entity fields and DTO
  properties).
- **Pattern matching.** Switch expressions (`x switch { Foo f =>
  ..., Bar b => ..., _ => default }`), property patterns
  (`{ Status: "Active", Count: > 0 }`), tuple patterns,
  positional patterns with deconstructors. Pattern matching is the
  modern replacement for `if (x is Foo f) { ... }` chains. When
  matching on enum-like discriminated state, the patterns enumerate
  the domain's state set.
- **Record types.** `record Foo(string Name, int Age)` (positional
  records) and `record Foo { public string Name { get; init; }
  public int Age { get; init; } }` (init-only records) are
  immutable value-equality types. Idiomatic for DTOs, value
  objects, and domain primitives. The extractor treats `record`
  declarations as classes (the C# AST surfaces them via
  `record_declaration` nodes); consumers should treat records as
  value objects, NOT as services or controllers.
- **Attributes (annotations).** C# attributes wrap a class /
  method / property / parameter / field with declarative metadata:
  `[ApiController]`, `[Route("api/[controller]")]`, `[HttpGet]`,
  `[Authorize(Roles = "Admin")]`, `[Required]`, `[Column("name")]`,
  `[Key]`, `[FromBody]`, `[Inject]`, `[Test]`, `[Fact]`,
  `[Theory]`. Attributes can take positional and named arguments
  (`[Route("api/foo", Name = "FooApi")]`). The extractor captures
  the attribute name + arguments; downstream adapters key off
  specific attribute names to surface controllers, endpoints,
  entities, etc.
- **Properties vs fields.** `public string Name { get; set; }` is
  a property (compiler-generated backing field); `public string
  Name;` is a field. Properties dominate modern C# style — fields
  are typically reserved for `private readonly` injected
  dependencies inside controllers / services. Auto-properties
  (`{ get; set; }`), expression-bodied properties (`=>`), and
  init-only setters (`{ get; init; }`) are all property variants.
  The extractor surfaces both as `FieldIR` entries.
- **Namespaces.** `namespace Foo.Bar.Baz { ... }` (block-scoped)
  or `namespace Foo.Bar.Baz;` (file-scoped, C# 10+). Namespaces
  align with directory structure by convention but the namespace
  declaration is authoritative — file path is a hint, not a
  contract. The extractor reads the declared namespace from the
  AST, not from the file path.
- **Generic types and constraints.** `class Repo<T> where T :
  class, IEntity, new()` declares a generic type with constraints.
  Common in repository / handler / mediator patterns. When
  unwrapping `ActionResult<List<ProductDto>>` to find the inner
  domain type, walk through `ActionResult<...>` → `Task<...>` →
  `IActionResult<...>` → `List<...>` / `IEnumerable<...>` until
  reaching the concrete leaf. The asp-net-core adapter does
  exactly this for response-type inference.
- **`using` directives.** `using Microsoft.AspNetCore.Mvc;` brings
  a namespace into scope. `using static System.Math;` brings static
  members directly into scope. `global using Foo;` (C# 10+) makes
  the import effective project-wide. `using Foo = Bar.Baz;` is an
  alias. Imports are how you tell what frameworks a file is using
  WITHOUT inspecting its types — `using Microsoft.EntityFrameworkCore;`
  signals EF Core; `using System.Web.Mvc;` signals classic ASP.NET
  Framework MVC.

## Extraction nuances

- **Tree-sitter-c-sharp method return-type field.** Methods name
  the return-type field `'returns'` (not `'type'`). The extractor
  checks `'returns'` first, falling back to `'type'`. Constructors
  have no return-type field — they're caught via the
  `constructor_declaration` node type rather than
  `method_declaration`.
- **Attribute lists.** Attributes attach via `attribute_list`
  children of the declaration node (class, method, property,
  field, parameter). Each `attribute_list` may contain multiple
  attributes (`[HttpGet, Route("/x"), Authorize]`). The extractor
  flattens these into a single `annotations: AnnotationIR[]` array
  per declaration.
- **Property vs field declarations.** Properties live in
  `property_declaration` nodes; fields in `field_declaration`. Both
  are surfaced as `FieldIR`. Fields wrap a `variable_declaration`
  → `variable_declarator` chain — the extractor walks down to find
  the name. Properties have a direct `name` field.
- **Base list (inheritance).** `class Foo : BaseClass, IInterface1,
  IInterface2` exposes the inheritance via a `base_list` child
  node. The first entry is `extends`; remaining entries are
  `implements`. C# does NOT distinguish syntactically between a
  base class and an interface in the base list — convention
  (interfaces usually start with `I`) is the heuristic. The
  asp-net-core adapter uses the FIRST base-list entry as `extends`,
  the rest as `implements`.
- **Namespace declaration.** Block-scoped (`namespace Foo { ... }`)
  uses `namespace_declaration`; file-scoped (`namespace Foo;`)
  uses `file_scoped_namespace_declaration`. The extractor handles
  both.
- **Records.** Tree-sitter surfaces records as `record_declaration`
  nodes — the extractor treats them as classes. Positional record
  parameters (`record Foo(string Name)`) are NOT extracted as
  fields by the current extractor; only the explicit
  `{ ... }` body fields are picked up. This is a known gap on
  positional records.
- **Test files to skip.** `/tests?/` (lowercase) directories,
  `*Tests.cs` / `*Test.cs` filename patterns. xUnit / NUnit /
  MSTest test classes carry `[Fact]` / `[Test]` / `[TestMethod]`
  attributes — the extractor doesn't filter on attributes, only on
  the conventional path / filename patterns.
- **Build outputs to skip.** `/bin/` and `/obj/` directories
  contain compiled `.dll` / `.exe` plus generated migrations and
  reference assemblies. The fileFilter excludes these.
- **Source-generated files.** Files under `obj/Debug/.../Generated/`
  are skipped by the `/obj/` filter. Files under `Generated/`
  outside `obj/` may slip through — most carry an
  `// <auto-generated />` header. The extractor doesn't filter on
  this header; consumers should treat large files inside
  `Generated/` directories with skepticism.
- **EF Core migrations.** Migration files
  (`{timestamp}_{description}.cs`) under
  `Infrastructure/Data/Migrations/` are runtime artefacts, not
  domain logic — they encode schema changes as `migrationBuilder.
  CreateTable(...)` calls. The extractor doesn't filter these out
  by default; consumers should de-prioritise them. EF Core's
  `*ModelSnapshot.cs` files describe the full current schema and
  are similarly machine-generated.
- **`.csproj` / `.sln` files.** XML project files declare framework
  target (`<TargetFramework>net8.0</TargetFramework>`), package
  references (`<PackageReference Include="Microsoft.EntityFramework
  Core" Version="..."/>`), and project references. The extractor
  does NOT process `.csproj` files — they're a richer signal
  (target framework version, package set) that prompt-layer logic
  could exploit if surfaced separately.

## Confidence calibration for C#

- Class with `[ApiController]` attribute: very high confidence
  (0.95+) it's an HTTP-exposed controller (REST API surface).
- Class extending `Controller` / `ControllerBase` (with no
  `[ApiController]`): 0.85-0.9 — most likely an MVC controller,
  occasionally a base class for shared controller behaviour.
- Class extending `DbContext`: 0.95 — definitively the EF Core /
  EF6 persistence boundary. Each `DbSet<T>` property is a
  table-mapped entity at 0.95.
- Class with `[Table("name")]` annotation: 0.9 as a physical
  entity. Each `[Column]`/`[Key]`-annotated field is a physical
  attribute at 0.9.
- Class extending `IEntityTypeConfiguration<TEntity>`: 0.85 as an
  EF Core Fluent API configuration declaration — the FILE that
  configures `TEntity`'s schema, distinct from `TEntity` itself.
  The current adapter does NOT detect these; they're a known gap.
- Record types under `Domain/`, `Models/`, `Dto/`, `Contracts/`,
  `*ViewModels/`, `*Endpoints/`: 0.8-0.85 as DTOs / value objects.
- Class with `MediatR.IRequestHandler<TReq, TResp>` implementation
  or `MediatR.IRequest<TResp>` declaration: 0.9 as a CQRS handler
  / request type — domain operation boundary. The adapter does
  NOT detect MediatR; it's a known gap.
- Class with `Ardalis.ApiEndpoints.EndpointBaseAsync.WithRequest<...>
  .WithActionResult<...>` base: 0.9 as an endpoint (Ardalis
  pattern — minimal-API alternative). The adapter does NOT
  detect this pattern; it's a known gap.
- Class with `[Authorize]` / `[Authorize(Roles = "...")]` /
  `[AllowAnonymous]`: 0.85 carries security contract
  significance — surface the role / policy as part of the
  candidate's data.
- Class extending `IHostedService` / `BackgroundService`: 0.9 as a
  long-running background worker — distinct from
  request/response controllers. The adapter does NOT detect
  hosted services.
- Static class with `[Mapper]` (Mapperly) or `Profile` subclass
  (AutoMapper): 0.8 as object-mapping infrastructure.
