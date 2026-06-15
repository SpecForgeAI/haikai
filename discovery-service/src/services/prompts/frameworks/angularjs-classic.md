# AngularJS 1.x (classic) framework guidance

An `angularjs-classic` static analysis pack has already been run
against this file. Its output is injected into the prompt as a fenced
JSON array. You are here to surface what that pack CANNOT see — not
to restate, recategorise, or "improve" what it already captured.

## The pack's classification is authoritative — DO NOT change it

Two HARD RULES specific to AngularJS 1.x. Violations are the single
worst failure mode for this layer:

1. **A controller is `ui_screens` ONLY when an explicit route binds
   it.** The pack scans every file in the repository for
   `$routeProvider.when(path, {controller})` and
   `$stateProvider.state(name, {url, controller})` (and their
   routes-as-data variant `routes.forEach(r => $routeProvider.when(r.url, r.config))`).
   If a controller is bound by any of those, the pack has already
   emitted a `ui_screens` candidate carrying the controller's name in
   its `data.controllerName` field — and removed the controller from
   the `ui_components` set. If a controller is NOT bound by any of
   those, the pack has emitted it as `ui_components`. Do not
   second-guess this. You see one file at a time; the pack saw
   every file.

2. **You may not change a pack candidate's TYPE.** If the pack
   output contains
   `{"type":"ui_components","name":"MeasureDetailModalCtrl",…}`,
   you are FORBIDDEN from emitting
   `{"type":"ui_screens","name":"MeasureDetailModalCtrl",…}` from
   any file. The dedup pass is type-aware, so a type-swap looks like
   a "new" candidate to the dedup, but it is the same element with
   a different label. This is a duplicate by every architectural
   measure. Drop it.

A name suffix is NOT a route binding. `*Ctrl`, `*Controller`,
`*Modal`, `*Btn`, `*Widget`, `*Page`, `*View`, `*Screen` — none of
these tell you whether a controller is a screen. Only an explicit
`$routeProvider.when` / `$stateProvider.state` reference does. The
pack already considered every suffix; if it emitted as
`ui_components`, that is the final answer.

## What the adapter already catches (do NOT re-emit these)

- **Modules.** `angular.module('name', [deps])` (setter form, 2+
  args) → `interfaces`. The getter form (`angular.module('name')`)
  is intentionally skipped.
- **Controllers.** `.controller(name, fn)` →
  - `ui_screens` if a route binds it (the route carrier holds
    `controllerName` on its `data`).
  - `ui_components` otherwise. Component-type subclassification
    (`button`, `modal`, `table`, `form`, `card`, `layout`, `chart`,
    `widget`, `input`, `other`) is inferred from the name suffix
    after stripping `Ctrl` / `Controller`.
- **Directives + components.** `.directive(name, fn)` /
  `.component(name, {...})` → `ui_components` with the same suffix
  → component-type inference.
- **Services + factories + providers + filters.** `.service(...)` /
  `.factory(...)` / `.provider(...)` / `.filter(...)` →
  `business_logics`.
- **Routes.** `$routeProvider.when(path, {controller, templateUrl})`
  + `$stateProvider.state(name, {url, controller, templateUrl})` +
  the routes-as-data array pattern → `ui_screens`.
- **HTTP endpoints.**
  - `$http.<verb>(url, …)` for `get` / `post` / `put` / `delete` /
    `patch` / `head` / `options` → `endpoints`.
  - Aliased `$http` invocations (`this._$http(config)`,
    `self.$http(config)`, `that.$http(config)`) — both inline
    object-literal config AND variable-bound config (the
    "let req = {url, method}; $http(req)" pattern).
  - `$resource('/path/:id', …)` → expanded to GET / POST / PUT /
    DELETE endpoints, plus a `logical_data_entities` candidate for
    the resource entity.
- **Logical entities.** `$resource(...)` URL → naive singularised
  entity name (`/users/:id` → `User`). Names ending in
  `*Ctrl` / `*Controller` / `*Service` / `*Factory` / `*Provider` /
  `*Filter` / `*Directive` / `*Component` / `*Config` / `*Run` are
  rejected at source; you SHOULD NOT re-emit any of those as
  `logical_data_entities` either.
- **Interface ↔ logical entity bindings.** When a file declares both
  controllers AND `$http` / `$resource` calls referencing logical
  entities, the pack emits `interface_logical_entities` linking them.

Anything in the list above is presumed ALREADY PRESENT in the pack
output. Emit `[]` rather than re-stating any of it.

## What the adapter MISSES (your target surface area)

Surface candidates the pack does not see. Typical AngularJS 1.x
blind spots:

- **`$broadcast` / `$emit` / `$on` event flows.** The architectural
  pub/sub between scopes — auth events, navigation events, modal
  open/close signalling — does not surface as a method-level
  candidate but is real cross-cutting wiring. Surface significant
  named events as `business_logics` candidates with a note about
  the publish/subscribe topology.
- **`$watch` / `$watchCollection` / `$watchGroup` with non-trivial
  callbacks.** Reactive computations the pack does not extract.
  Surface only when the watcher implements domain logic, not
  view-only refresh.
- **Promise pipelines via `$q`.** `$q.all`, `$q.race`,
  `$q.defer()`, long `.then(…).then(…).catch(…)` chains encoding
  workflow orchestration — those are `business_logics`.
- **`resolve:` blocks on routes/states.** The data-preload contract
  per route (`resolve: { user: function(UserService) { … } }`).
  The pack captures the route itself but NOT the resolve
  dependencies. Surface each named resolve as a `business_logics`
  candidate when it implements non-trivial logic.
- **Form validators.** `$parsers`, `$formatters`, `$validators` on
  `ngModel` controllers — domain validation rules that don't appear
  as service methods. Each significant validator is a
  `business_logics` candidate.
- **Custom interceptors.** `$httpProvider.interceptors.push(...)`
  registrations — auth-token injection, error-surface mapping,
  retry logic. Each interceptor is an architectural cross-cutter;
  surface as `business_logics` (or `interfaces` if it represents
  a distinct adapter boundary).
- **Authentication / authorization pipelines.** Custom guard
  functions invoked from `$routeChangeStart` / `$stateChangeStart`
  listeners. Each guard is a `business_logics` candidate.
- **Templates referencing controllers / directives the pack did not
  see.** If the file is a template (`*.html` / `*.ng`), the pack's
  HTML scanner only REINFORCES existing `.js`-side findings; it
  never creates new candidates. If a template references a
  controller name that has no `.controller(...)` registration, you
  may emit it as `ui_components` — but only if you can locate a
  declaration somewhere in the source.
- **`$rootScope` mutations.** Cross-cutting state on root scope is
  effectively global state — surface as a `business_logics`
  candidate when the same property is set in multiple files.

## Instruction

Read the pack-output JSON block injected into this prompt carefully.
For each candidate you consider emitting:

1. Check whether `(name)` (case-insensitive, whitespace-collapsed)
   appears anywhere in the pack output, regardless of `type`. If it
   does, drop the candidate. Type swaps are duplicates.
2. Check whether the candidate matches the "what the adapter already
   catches" list above. If it does, drop the candidate.
3. Otherwise, verify your candidate falls under the "blind spots"
   list. If it does not, drop it.

Emit ONLY genuine misses. If every plausible candidate is already in
the pack output, emit `[]`.
