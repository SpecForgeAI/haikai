# ASP.NET Framework (MVC 3/4/5 + Web API 2) framework guidance

An `asp-net-framework` static analysis pack has already been run
against this file. Its output is injected into the prompt as a
fenced JSON array. You are here to surface what that pack CANNOT
see — not to restate what it already captured.

ASP.NET Framework is the LEGACY .NET Framework 3.5 / 4.x web stack
— the predecessor to ASP.NET Core. It still powers many large
production codebases (NuGetGallery, Umbraco 7, Sitefinity, classic
SharePoint, in-house enterprise apps). Architecturally it differs
from ASP.NET Core in several load-bearing ways that the
deterministic adapter (which reuses the asp-net-core controller-
detection logic) cannot see: Global.asax lifecycle hooks,
Web.config-driven configuration, OWIN middleware, classic WebForms
code-behind, HttpModules / HttpHandlers, route registration in
`App_Start/`, MEF composition. Your gap-fill targets all of these.

## What the adapter already catches (do NOT re-emit these)

The asp-net-framework adapter delegates to the same controller +
endpoint detection logic as `asp-net-core`, with the same
attribute / base-type rules. Specifically:

- **Classes extending `Controller` / `ControllerBase`** (MVC
  3/4/5: `class FooController : Controller`) — emitted as
  `interfaces` candidates.
- **Classes extending `ApiController`** (Web API 2:
  `class FooController : ApiController`) — emitted as `interfaces`
  candidates. Note that `ApiController` ENDS in `Controller`, so
  the suffix regex catches it.
- **Classes annotated `[ApiController]`** (rare on .NET
  Framework — primarily an ASP.NET Core convention) — same
  `interfaces` emission.
- **Action methods with `[HttpGet]` / `[HttpPost]` /
  `[HttpPut]` / `[HttpDelete]` / `[HttpPatch]` attributes** —
  emitted as `endpoints` candidates with composed routes from
  class-level `[Route]` (with `[controller]` token substitution)
  + method-level verb attribute argument.
- **Methods with `[Authorize]` / `[Authorize(Roles = "...")]` /
  `[AllowAnonymous]` annotations** appear in the action-method
  attribute capture but the adapter does NOT separately emit
  authorization candidates — the authorization role / policy is
  captured as part of the method's attribute set in IR but not
  surfaced as a distinct candidate.
- **`DbSet<T>` properties on `DbContext` subclasses** (EF6 and
  EF Core both follow this pattern; .NET Framework uses EF6
  exclusively) — emitted as `physical_data_entities` candidates.
- **`[Table("name")]`-annotated POCO entities with `[Key]` /
  `[Column]` Data Annotations** — emitted as `physical_data_entities`
  + `physical_data_attributes` candidates.

The adapter explicitly swaps the `_addedBy` tag from
`aspnetcore-adapter` to `aspnet-framework-adapter` so provenance
stays distinguishable when both packs run against the same repo.

Anything in the list above is presumed ALREADY PRESENT in the pack
output. Emitting duplicates of those is the primary failure mode
for this layer.

## What the adapter MISSES (your target surface area)

Surface candidates the pack does not see. ASP.NET Framework's
typical blind spots — most are .NET-Framework-specific
infrastructure with no ASP.NET Core analogue:

- **`Global.asax` application lifecycle.** `class MvcApplication :
  HttpApplication { protected void Application_Start() { ... }
  protected void Application_End() { ... } protected void
  Session_Start(...) { ... } protected void Session_End(...) { ... }
  protected void Application_Error(...) { ... } }`. The
  `Application_Start` method is the .NET Framework equivalent of
  `Program.cs` — it registers routes (`RouteConfig.RegisterRoutes
  (RouteTable.Routes);`), filters (`FilterConfig.RegisterGlobal
  Filters(GlobalFilters.Filters);`), bundles (`BundleConfig.
  RegisterBundles(BundleTable.Bundles);`), and bootstraps the
  IoC container (`UnityConfig.RegisterComponents();` /
  `AutofacConfig.Register();` / etc.). The adapter sees NONE of
  this — surface each `Application_Start`'s configuration calls
  as architectural setup candidates.
- **`Web.config` connection strings + authentication mode +
  configuration sections.** `<connectionStrings>` declares every
  database / cache / external-service URL. `<authentication
  mode="Forms">` / `<authentication mode="Windows">` /
  `<authentication mode="None">` declares the framework-level
  auth scheme. `<system.web>`, `<system.webServer>`,
  `<appSettings>`, `<sessionState>`, `<membership>`,
  `<roleManager>` carry deployment-contract configuration. The
  adapter does NOT parse XML — surface each `<connectionString>`
  as a database integration; surface the `<authentication>` mode
  + any custom membership provider as a security-contract; surface
  custom config sections as configuration boundaries.
- **OWIN middleware.** `[assembly: OwinStartup(typeof(MyApp.
  Startup))] public class Startup { public void Configuration
  (IAppBuilder app) { app.UseCookieAuthentication(...); app.
  UseOAuthAuthorizationServer(...); app.MapSignalR(); ... } }`.
  The OWIN startup class is the .NET Framework counterpart to
  ASP.NET Core's middleware chain — `IAppBuilder.UseFoo(...)`
  registers a middleware. Order matters. Common middlewares:
  cookie auth, OAuth auth, SignalR mapping, CORS, custom
  middleware. The adapter does NOT detect OWIN startup —
  surface the Configuration method's middleware-chain calls as
  cross-cutting concerns with order metadata.
- **Route registration in `App_Start/RouteConfig.cs` /
  `WebApiConfig.cs` / `BundleConfig.cs` / `FilterConfig.cs`.**
  `public static void RegisterRoutes(RouteCollection routes) {
  routes.IgnoreRoute("{resource}.axd/{*pathInfo}"); routes.
  MapRoute(name: "Default", url: "{controller}/{action}/{id}",
  defaults: new { controller = "Home", action = "Index", id =
  UrlParameter.Optional });`. Custom MapRoute calls register
  routes that may NOT correspond to any conventional controller
  action (e.g. an attribute-routed catch-all, a custom-handler
  route, an HTTP handler route). For Web API 2, `WebApiConfig.
  Register(HttpConfiguration config) { config.MapHttpAttribute
  Routes(); config.Routes.MapHttpRoute(name: "DefaultApi", route
  Template: "api/{controller}/{id}", defaults: new { id =
  RouteParameter.Optional }); }`. The adapter does NOT inspect
  `App_Start/` — surface each MapRoute / MapHttpRoute call as
  an endpoint group.
- **MEF composition (`System.ComponentModel.Composition`).**
  `[Export(typeof(IPlugin))] public class FooPlugin : IPlugin
  { ... }` plus `[Import(typeof(IPlugin))] public IEnumerable
  <Lazy<IPlugin>> Plugins { get; set; }`. MEF is .NET Framework's
  built-in plugin / extensibility system; the
  `CompositionContainer` discovers `[Export]`-annotated types
  at runtime via assembly catalogs. The adapter does NOT detect
  `[Export]` / `[Import]` attributes — surface each `[Export]`
  as a plugin contract and each `[Import]` as a dependency
  injection point. NuGetGallery uses MEF heavily.
- **Classic WebForms (`*.aspx` / `*.ascx` / `*.master` +
  code-behind).** `<%@ Page Language="C#" AutoEventWireup="true"
  CodeBehind="Default.aspx.cs" Inherits="MyApp.Default" %>`
  links a WebForms page to a code-behind class. The code-behind
  class extends `System.Web.UI.Page` and declares lifecycle
  handlers (`Page_Load`, `Page_Init`, `Page_PreRender`). User
  controls extend `System.Web.UI.UserControl`. Master pages
  extend `System.Web.UI.MasterPage`. The adapter does NOT detect
  Page / UserControl / MasterPage subclasses — surface each as
  a UI component.
- **`HttpModule` / `HttpHandler` implementations.** `class MyModule
  : IHttpModule { public void Init(HttpApplication context)
  { context.BeginRequest += OnBeginRequest; context.EndRequest
  += OnEndRequest; } public void Dispose() { } }`. HTTP modules
  intercept every request at the IIS pipeline level — they're
  the .NET Framework equivalent of OWIN / ASP.NET Core
  middleware but at a deeper layer (before MVC routing). HTTP
  handlers (`class MyHandler : IHttpHandler { public void
  ProcessRequest(HttpContext context) { ... } public bool
  IsReusable => false; }`) handle specific URLs / extensions
  (e.g. `*.ashx`). Both are wired in `Web.config`'s
  `<httpModules>` / `<httpHandlers>` sections (or
  `<system.webServer><modules>` / `<handlers>` for IIS 7+
  integrated mode). The adapter does NOT detect IHttpModule /
  IHttpHandler implementations — surface each as a cross-cutting
  request-pipeline component.
- **WCF service contracts.** `[ServiceContract] public interface
  IFooService { [OperationContract] FooResponse GetFoo(FooRequest
  req); }` plus `[ServiceBehavior(...)] public class FooService :
  IFooService { ... }` plus `<system.serviceModel>` config. WCF
  is the .NET Framework SOAP / WS-* / TCP / Named-Pipe RPC stack
  — distinct from ASP.NET Web API. The adapter does NOT detect
  `[ServiceContract]` / `[OperationContract]` attributes —
  surface each operation contract as an RPC endpoint.
- **ASP.NET Identity (older versions).** Pre-Identity 2.x
  membership uses the `<membership>` provider in Web.config.
  Identity 1.x / 2.x uses `class ApplicationUser : IdentityUser
  { ... }` plus `class ApplicationDbContext : IdentityDbContext
  <ApplicationUser> { ... }` (similar to ASP.NET Core but with
  EF6 instead of EF Core). The adapter detects the
  `IdentityDbContext` subclass via the `DbContext` ancestor
  match but NOT the user-type customisation as a separate
  security-contract candidate.
- **DI container registration files.** Unity (`UnityConfig.cs`),
  Autofac (`AutofacConfig.cs`), Castle Windsor (`Windsor
  Installer` implementations), Ninject (`NinjectWebCommon.cs`),
  StructureMap (`IoC.cs`). Each container has its own
  registration syntax but they all bind interfaces to
  implementations at app start. The adapter does NOT detect any
  of these — surface each binding as a DI registration.
- **Areas (MVC organisational unit).** `public class AdminArea
  Registration : AreaRegistration { public override string
  AreaName => "Admin"; public override void RegisterArea
  (AreaRegistrationContext context) { context.MapRoute(...); } }`.
  Areas group controllers / views into logical sub-applications
  (e.g. `/Admin/Users`, `/Api/...`). The adapter detects
  controllers but NOT the area-level routing. Surface each
  AreaRegistration as a structural module.
- **`[ChildActionOnly]` / `[OutputCache]` / `[ValidateAntiForgery
  Token]` / `[HandleError]` filters.** Action method attributes
  that affect rendering / caching / security but don't translate
  to endpoint semantics. The adapter captures them in IR but
  does NOT emit candidates. Surface as cross-cutting metadata
  on the relevant action method when meaningful.

## Instruction

Read the pack-output JSON block injected into this prompt carefully.
For each candidate you consider emitting, check that the
`(type, name, filePath)` tuple is NOT already represented in the
pack output (after case-insensitive, whitespace-collapsed name
comparison). If it is, drop it. Emit ONLY the genuine misses.

The .NET Framework codebase shape skews HEAVILY toward
infrastructure / configuration / lifecycle code (Global.asax,
Web.config, App_Start/, OWIN Startup, MEF composition) that the
deterministic adapter cannot see. Prioritise these over
controller-internal logic — controllers themselves are the one
thing the adapter DOES catch.

## Gap-fill targets (11th candidate type)

- **`interface_logical_entities`.** This framework's pack does NOT yet emit `interface_logical_entities` candidates. When an `interfaces` candidate (API controller, resolver, handler class) in this file references a `logical_data_entities` candidate (DTO, request/response body type) that is also defined somewhere in the project, emit an `interface_logical_entities` candidate named `InterfaceClass → LogicalDataEntityClass` (ASCII arrow, single spaces). Per-interface granularity — one entry per (interface, logical_data_entity) pair regardless of how many endpoints reference the DTO.
