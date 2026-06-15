# Angular framework guidance

An `angular` static analysis pack has already been run against this
file. Its output is injected into the prompt as a fenced JSON array.
You are here to surface what that pack CANNOT see - not to restate
what it already captured.

## What the adapter already catches (do NOT re-emit these)

- **Components** annotated with `@Component({ selector,
  templateUrl? })` — emitted as `ui_screens` when the class name
  ends with `*Page` / `*Screen` / `*View`, otherwise as
  `ui_components`.
- **Injectable services** annotated with `@Injectable({ providedIn })` —
  their non-CRUD methods surface as `business_logics`. CRUD-prefixed
  methods (`get*`, `create*`, `update*`, `delete*`, `find*`,
  `list*`, `save*`) are filtered out.
- **HttpClient endpoints** — `this.http.get(url)`, `this.http.post`,
  `this.http.put`, `this.http.delete`, `this.http.patch` call sites
  inside service classes, with URL + method captured.
- **DTO logical entities** — exported `interface X { ... }` and
  object-type aliases, plus their public fields as
  `logical_data_attributes` children.

Anything in that list is presumed ALREADY PRESENT in the pack output.
Emitting duplicates of those is the primary failure mode for this
layer.

## What the adapter MISSES (your target surface area)

Surface candidates the pack does not see. Typical Angular blind
spots:

- **NgModules.** `@NgModule({ declarations, imports, providers,
  exports, bootstrap })` — the module boundary is the architectural
  unit. Each feature module (lazy-loaded or eager), each shared
  module, each core module describes a distinct slice. Surface
  modules as `interfaces` / `service` candidates with imports as
  dependencies.
- **Routing configuration.** `RouterModule.forRoot(routes)`,
  `RouterModule.forChild(routes)`, standalone component routes
  (`provideRouter` + `Routes` arrays). Each `Route` object
  (path / component / loadChildren / canActivate / resolve /
  children) is navigational architecture. Surface the route tree
  separately from the components it points at.
- **Guards + resolvers.** `CanActivate`, `CanActivateChild`,
  `CanDeactivate`, `CanLoad`, `CanMatch` implementations — authz /
  route-protection boundary. `Resolve<T>` implementations — data
  pre-fetching per route. Surface each as an architectural
  candidate.
- **Interceptors.** `HttpInterceptor` implementations registered via
  `HTTP_INTERCEPTORS` or `withInterceptors` (standalone). These
  encode auth tokens, retry logic, logging, error-surface mapping —
  cross-cutting concerns the per-service adapter does not see.
- **Injection tokens + custom providers.** `InjectionToken<T>`
  exports + `{ provide: TOKEN, useValue / useClass / useFactory /
  useExisting }` registrations. Often the seam where external
  clients (REST base URL, feature flags, analytics SDK, auth
  config) enter the application. Surface each as an integration /
  configuration candidate.
- **Change-detection strategies.** Components with
  `changeDetection: ChangeDetectionStrategy.OnPush` have different
  runtime semantics (immutable inputs + explicit `markForCheck`).
  This is architectural metadata worth noting on the component
  candidate.
- **Directives + pipes.** `@Directive({ selector })` (structural +
  attribute) and `@Pipe({ name })` — reusable UI building blocks
  the adapter may not surface today (it focuses on
  `@Component`). Surface significant directives / pipes as
  `ui_components` candidates.
- **Forms.** Reactive forms (`FormGroup`, `FormControl`,
  `FormArray`, `FormBuilder`, `Validators.*`), template-driven
  forms (`ngModel`, `NgForm`). Each significant form is a UI
  boundary with validation rules the adapter does not extract.
- **RxJS observable pipelines.** Services that compose `Subject` /
  `BehaviorSubject` / `ReplaySubject` into a state-management
  surface, or long operator chains (`switchMap`, `mergeMap`,
  `combineLatest`, `withLatestFrom`, `debounceTime`, `shareReplay`)
  on API streams. These are architectural state + event pipelines
  the method-level adapter flattens out. Surface as
  `business_logics` with a note about the stream topology.
- **NgRx / Signal state.** `createFeature`, `createReducer`,
  `createAction`, `createSelector`, `createEffect`, NgRx component
  store (`ComponentStore`), or the new `signal` / `computed` /
  `effect` primitives (Angular 16+). Each feature slice is a
  state-management boundary; each effect is a side-effect
  integration.
- **Standalone components + dependency imports.** Angular 14+
  `standalone: true` components with their own `imports: [...]`
  array — the adapter may miss the dependency graph edges because
  there is no NgModule to traverse.
- **Environment + build targets.** `environment.ts` /
  `environment.prod.ts` / `environment.*.ts` files encode API
  base URLs, feature flags, third-party SDK keys per deployment
  target. `angular.json` build configurations (`budgets`,
  `fileReplacements`, `assets`) describe output shape. Each
  environment-specific integration is a distinct candidate.
- **i18n bundles.** `@angular/localize` + `messages.*.xlf` /
  `*.json` translation files describe a localization boundary.
- **Testing scaffolding the adapter already skips.** `TestBed`,
  `ComponentFixture`, `*.spec.ts` — mention these only as
  confirmation; do NOT emit candidates for them.

## Instruction

Read the pack-output JSON block injected into this prompt carefully.
For each candidate you consider emitting, check that the
`(type, name, filePath)` tuple is NOT already represented in the pack
output (after case-insensitive, whitespace-collapsed name comparison).
If it is, drop it. Emit ONLY the genuine misses.

## Gap-fill targets (11th candidate type)

- **`interface_logical_entities`.** This framework's pack does NOT yet emit `interface_logical_entities` candidates. When an `interfaces` candidate (API controller, resolver, handler class) in this file references a `logical_data_entities` candidate (DTO, request/response body type) that is also defined somewhere in the project, emit an `interface_logical_entities` candidate named `InterfaceClass → LogicalDataEntityClass` (ASCII arrow, single spaces). Per-interface granularity — one entry per (interface, logical_data_entity) pair regardless of how many endpoints reference the DTO.
