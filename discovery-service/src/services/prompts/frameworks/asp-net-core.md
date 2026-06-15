# ASP.NET Core framework guidance

An `asp-net-core` static analysis pack has already been run against
this file. Its output is injected into the prompt as a fenced JSON
array. You are here to surface what that pack CANNOT see — not to
restate what it already captured.

ASP.NET Core is the cross-platform .NET 5/6/7/8+ web framework.
Modern apps blend several distinct integration surfaces (controllers,
minimal APIs, SignalR hubs, gRPC services, hosted services) and
configure them through a `Program.cs` host builder + dependency-
injection container that the deterministic adapter cannot inspect.
The pack's reach is intentionally narrow — Controller-derived
classes, attribute-driven endpoints, EF Core `DbSet<T>` entities,
and `[Table]` Data Annotations POCOs. Everything else is your
target surface.

## What the adapter already catches (do NOT re-emit these)

- **Classes annotated `[ApiController]`** — emitted as `interfaces`
  candidates with `controllerType: 'AspNetCoreController'` plus
  the base path extracted from `[Route("api/[controller]")]` (with
  `[controller]` token substitution to the class name minus
  `Controller` suffix).
- **Classes annotated `[Controller]`** OR whose base type ends in
  `Controller` / `ControllerBase` — same `interfaces` emission as
  above, even without `[ApiController]`. Covers MVC controllers
  returning `View()` results.
- **Action methods carrying `[HttpGet]` / `[HttpPost]` / `[HttpPut]`
  / `[HttpDelete]` / `[HttpPatch]` / `[HttpOptions]` / `[HttpHead]`
  attributes** — emitted as `endpoints` candidates with
  `httpMethod`, `fullPath` (composed from class-level `[Route]` +
  method-level verb-attribute argument), `methodName`,
  `controllerClassName`, `returnType`. `[FromBody]` parameter
  types and unwrapped generic return types
  (`ActionResult<List<ProductDto>>` → `ProductDto`) are added as
  `requestBodyType` and `responseType` respectively.
- **`DbSet<T>` properties on classes extending `DbContext`** —
  emitted as `physical_data_entities` candidates with `entityClassName`
  = `T`, `tableName` = the property name (convention), and
  `sourceDbContext` = the DbContext class name.
- **Classes annotated `[Table("name")]`** — emitted as
  `physical_data_entities` candidates plus a `physical_data_attributes` per
  field. `[Key]` flags primary key, `[Column("name")]` overrides
  column name, `[NotMapped]` skips the field entirely.
- **DTO classes referenced from controllers** — classes whose
  names appear in a `[FromBody]` parameter type or in an unwrapped
  generic return type are emitted as `logical_data_entities` candidates
  with each field as a `logical_data_attributes`.

Anything in that list is presumed ALREADY PRESENT in the pack
output. Emitting duplicates of those is the primary failure mode
for this layer.

## What the adapter MISSES (your target surface area)

Surface candidates the pack does not see. ASP.NET Core's typical
blind spots:

- **`Program.cs` host configuration.** Modern .NET 6+ apps use the
  minimal-host pattern: `var builder = WebApplication.CreateBuilder
  (args); builder.Services.Add...; var app = builder.Build();
  app.UseRouting(); app.MapControllers(); app.Run();`. The
  service registrations between `CreateBuilder` and `Build`
  describe the entire DI graph; the middleware chain between
  `Build` and `Run` describes request-pipeline behaviour. The
  adapter sees NONE of this. Surface each `builder.Services.Add
  Foo()` call as an integration point, each `app.UseFoo()` as a
  cross-cutting middleware, and the order between them as
  load-bearing metadata.
- **Dependency injection registration.** `services.AddScoped<IFoo,
  Foo>()`, `services.AddSingleton<IBar, Bar>()`, `services.
  AddTransient<...>()`, `services.AddDbContext<MyDbContext>(opts
  => opts.UseSqlServer(...))`, `services.AddHttpClient<IClient,
  Client>()`, `services.Configure<MyOptions>(config.GetSection
  ("MyOptions"))`. Each registration binds an interface (or
  concrete class) to a lifetime + factory. The adapter does NOT detect
  these — every interface-to-implementation binding the framework
  resolves at runtime is invisible without parsing
  `Program.cs` / `Startup.ConfigureServices`.
- **Middleware chain order.** `app.UseExceptionHandler(...)`,
  `app.UseHttpsRedirection()`, `app.UseStaticFiles()`,
  `app.UseRouting()`, `app.UseAuthentication()`,
  `app.UseAuthorization()`, `app.UseEndpoints(...)`,
  `app.UseCors(...)`, custom `app.UseMiddleware<MyMiddleware>()`.
  The CHAIN ORDER is architecturally meaningful (auth before
  authz; routing before endpoints; exception handling at the
  top). Each middleware is a cross-cutting concern; surface each
  one and capture the ordering as metadata. Custom `IMiddleware`
  / `IMiddlewareFactory` implementations are domain-meaningful
  cross-cutting code the adapter cannot see.
- **Authorization policies.** `services.AddAuthorization(opts =>
  { opts.AddPolicy("AdminOnly", p => p.RequireRole("Admin"));
  opts.AddPolicy("CanRead", p => p.Requirements.Add(new
  CanReadRequirement())); })`. Plus custom `AuthorizationHandler
  <TRequirement>` implementations and `IAuthorizationRequirement`
  declarations. Methods carrying `[Authorize(Policy = "Foo")]`
  reference these policies but the policy DEFINITIONS live in
  `Program.cs`. Surface each policy as a security-contract
  candidate.
- **SignalR hubs.** `class ChatHub : Hub` declares a real-time
  bidirectional WebSocket / Server-Sent-Events endpoint. Hub
  methods (`public async Task SendMessage(string user, string
  message)`) are RPC-callable from clients;
  `Clients.All.SendAsync(...)` / `Clients.Group(...).SendAsync
  (...)` are server→client broadcasts. Hubs are mapped via
  `app.MapHub<ChatHub>("/chathub")`. The adapter does NOT detect
  Hubs — they're a distinct endpoint surface from controllers.
- **gRPC services.** `class GreeterService : Greeter.GreeterBase`
  declares a gRPC service implementation (the base class is
  generated from a `.proto` file). Service methods override the
  generated abstract methods and accept `IServerStreamWriter
  <TResponse>` / `IAsyncStreamReader<TRequest>` for streaming
  RPCs. Mapped via `app.MapGrpcService<GreeterService>()`. The
  adapter does NOT detect gRPC services. Surface each `*Base`
  inheritance as a gRPC contract; surface streaming methods
  distinctly from unary methods.
- **Hosted services.** `class MyWorker : BackgroundService` (or
  `IHostedService`) is a long-running background task started by
  the host. `protected override async Task ExecuteAsync(Cancellation
  Token stoppingToken) { while (!stoppingToken.IsCancellationRequested)
  { ... await Task.Delay(...); } }` is the canonical pattern.
  Hosted services are registered via `services.AddHostedService
  <MyWorker>()`. The adapter does NOT detect hosted services —
  they're an entirely separate runtime surface from request /
  response controllers.
- **Options pattern binding.** `public class MyOptions { public
  string ConnectionString { get; set; } public int Timeout { get;
  set; } }` plus `services.Configure<MyOptions>(builder.Configuration
  .GetSection("MyOptions"))` plus `IOptions<MyOptions>` /
  `IOptionsSnapshot<MyOptions>` / `IOptionsMonitor<MyOptions>`
  injection. The Options class describes the deployment-contract
  surface (typed configuration). The adapter does NOT detect
  Options classes — surface each `Configure<TOptions>(...)`
  binding as a configuration contract.
- **Minimal APIs without controllers.** `app.MapGet("/products",
  async (IProductService svc) => await svc.GetAll()); app.MapPost
  ("/products", async ([FromBody] CreateProductDto dto,
  IProductService svc) => await svc.Create(dto));`. Lambda
  endpoints registered directly on `WebApplication`. The adapter
  CANNOT see these — there's no class declaration to extract
  attributes from. Each `MapGet` / `MapPost` / `MapPut` /
  `MapDelete` / `MapPatch` call is an endpoint; the lambda
  parameters are the request shape; the lambda return type (or
  `Results.Ok(...)` / `Results.BadRequest(...)` calls inside) is
  the response shape. Minimal APIs are the modern .NET 6+
  default for new APIs — this is potentially the LARGEST
  detection gap in modern codebases.
- **Health checks.** `services.AddHealthChecks().AddCheck<MyDb
  HealthCheck>("my-db").AddSqlServer(connStr).AddRedis(redisConn)`
  plus `app.MapHealthChecks("/health")`. Each check is a
  monitored integration point. The adapter does NOT detect
  health checks.
- **EF Core Fluent API configurations.** `class CatalogItem
  Configuration : IEntityTypeConfiguration<CatalogItem> { public
  void Configure(EntityTypeBuilder<CatalogItem> builder) { builder.
  ToTable("CatalogItems"); builder.Property(ci => ci.Name)
  .HasMaxLength(50).IsRequired(); builder.HasOne(...).WithMany
  (...).HasForeignKey(...); } }`. These configuration classes
  declare entity-to-table mappings that POCOs WITHOUT `[Table]`
  attributes still get configured against. The adapter detects
  Data Annotations (`[Table]` / `[Key]` / `[Column]`) but NOT
  Fluent API configurations — many large codebases (eShopOnWeb
  included) use Fluent API exclusively. Surface each
  `IEntityTypeConfiguration<T>` implementation as the schema-
  contract for `T`.
- **EF Core relationships and navigation properties.** Even when
  POCOs ARE detected via `[Table]`, the relationships expressed
  via navigation properties (`public CatalogBrand? CatalogBrand
  { get; private set; }` plus `public int CatalogBrandId { get;
  private set; }`) and Fluent API configuration (`HasOne` /
  `HasMany` / `WithOne` / `WithMany` / `HasForeignKey`) are NOT
  emitted. Surface each navigation property as an
  `logical_data_entity_relationships`.
- **MediatR handlers (CQRS pattern).** `class GetProductByIdQuery
  : IRequest<ProductDto>` declares a query; `class GetProductByIdHandler
  : IRequestHandler<GetProductByIdQuery, ProductDto>` declares
  the handler. Plus `INotificationHandler<TNotification>` for
  events. MediatR is the dominant CQRS / mediator library in
  ASP.NET Core; the adapter does NOT detect it. Each handler is
  a domain operation boundary distinct from the controller that
  invokes `_mediator.Send(...)`.
- **Ardalis API Endpoints (one-class-per-endpoint pattern).**
  `class GetProductEndpoint : EndpointBaseAsync.WithRequest<Get
  ProductRequest>.WithActionResult<GetProductResponse> { [HttpGet
  ("api/products/{id}")] public override async Task<ActionResult
  <GetProductResponse>> HandleAsync(GetProductRequest request,
  CancellationToken ct = default) { ... } }`. The base type
  ends `Async`, NOT `Controller` / `ControllerBase`, so the
  adapter's controller-detection regex misses it entirely. Each
  endpoint is a single REST action — surface as an `endpoints`
  candidate plus a request / response DTO. eShopOnWeb's
  `PublicApi/` project uses this pattern exclusively.
- **Filters.** `IActionFilter`, `IAsyncActionFilter`,
  `IExceptionFilter`, `IAuthorizationFilter`, `IResultFilter`
  implementations PLUS `[ServiceFilter(typeof(MyFilter))]` /
  `[TypeFilter(typeof(MyFilter))]` attribute usage. Filters
  intercept the request pipeline at the action level — distinct
  from middleware which intercepts at the request level. Each
  filter is a cross-cutting concern.
- **Validation.** FluentValidation `class CreateProductValidator
  : AbstractValidator<CreateProductDto> { public Create
  ProductValidator() { RuleFor(x => x.Name).NotEmpty().MaximumLength(50);
  } }` plus `services.AddValidatorsFromAssemblyContaining<...>()`.
  The validator declares business rules separately from the DTO.
  Data Annotations validation (`[Required]`, `[StringLength]`)
  on DTO properties is similarly business-meaningful but not
  surfaced by the adapter today.
- **Identity + authentication schemes.** `services.AddAuthentication
  (JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(opts =>
  { opts.Authority = ...; opts.Audience = ...; })` configures
  JWT validation. `services.AddDefaultIdentity<ApplicationUser>()`
  pulls in ASP.NET Identity. `class ApplicationUser : Identity
  User` extends the framework user type. Each authentication
  scheme + identity-store choice is a security-contract
  decision.

## Instruction

Read the pack-output JSON block injected into this prompt carefully.
For each candidate you consider emitting, check that the
`(type, name, filePath)` tuple is NOT already represented in the pack
output (after case-insensitive, whitespace-collapsed name comparison).
If it is, drop it. Emit ONLY the genuine misses.

Note: this pack is known low-coverage on real-world repos
(eShopOnWeb baseline: 36 candidates across the entire repo). The
LLM gap-fill stage is doing the heavy lifting on this stack —
prioritise minimal APIs, MediatR handlers, Ardalis endpoints, EF
Fluent configurations, and `Program.cs` integration surface, in
that order.

## Gap-fill targets (11th candidate type)

- **`interface_logical_entities`.** This framework's pack does NOT yet emit `interface_logical_entities` candidates. When an `interfaces` candidate (API controller, resolver, handler class) in this file references a `logical_data_entities` candidate (DTO, request/response body type) that is also defined somewhere in the project, emit an `interface_logical_entities` candidate named `InterfaceClass → LogicalDataEntityClass` (ASCII arrow, single spaces). Per-interface granularity — one entry per (interface, logical_data_entity) pair regardless of how many endpoints reference the DTO.
