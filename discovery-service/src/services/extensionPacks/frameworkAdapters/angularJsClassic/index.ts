/**
 * AngularJS 1.x (classic) Framework Adapter.
 *
 * Distinct from the Angular 2+ pack (`frameworkAdapters/angular`). Targets
 * legacy AngularJS 1.x codebases where:
 *   - Modules are declared via `angular.module('name', [deps])`.
 *   - Controllers / services / factories / providers / directives / filters
 *     are registered via chained `.controller(...)` / `.service(...)` etc.
 *   - Routes come from `$routeProvider.when(...)` or (much more commonly)
 *     UI-Router's `$stateProvider.state(...)`.
 *   - HTTP access goes through `$http.get/post/...` or `$resource(url)`.
 *   - Module wiring often uses RequireJS AMD (`define([deps], function(...){
 *     return angular.module(...); })`).
 *
 * These patterns live almost exclusively in module-level call expressions
 * rather than declared functions. We therefore walk `SourceFileIR.allCalls`
 * (the flat file-wide call list populated by the TS/JS extractor) rather
 * than per-function `fn.calls[]`.
 *
 * HTML template signals (`ng-controller`, custom directive tags, view
 * outlets) are collected by a sister module and used to *reinforce* the
 * .js-side detections — we never emit a candidate that only appears in a
 * template.
 *
 * Meta-model emission map (per user spec, 2026-04-22):
 *   interfaces                          → `angular.module('X', [...])`
 *   endpoints                           → `$http.<verb>(url)` / `$resource(url)` CRUD expansion
 *   ui_screens                          → `$routeProvider.when(path, {controller})` /
 *                                         `$stateProvider.state(name, {url, controller})`
 *   ui_components                       → `.directive(name, fn)` / `.component(name, {...})`
 *                                         + controllers bound via template <ng-controller>
 *   business_logics                     → `.service(name, fn)` / `.factory(name, fn)` /
 *                                         `.provider(name, fn)` / `.filter(name, fn)`
 *                                         + controller constructor function body methods
 *   logical_data_entities               → `$resource('/path/:id')` names
 *   logical_data_attributes             → currently N/A (no field shape inferred)
 *   interface_logical_entities          → controller → DTO binding (from $http/$resource call sites)
 *   logical_data_entity_relationships   → N/A
 *   physical_*                          → N/A (frontend)
 */

import { v4 as uuidv4 } from 'uuid';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import type { SourceFileIR, CallIR } from '../../languageIR';
import { scanHtmlTemplate, isHtmlTemplateFile, type HtmlTemplateScanResult } from './htmlTemplateScan';

// ---------------------------------------------------------------------------
// Candidate factory
// ---------------------------------------------------------------------------

function makeCandidate(
  type: DiscoveryCandidate['candidateType'],
  name: string,
  filePath: string,
  data: Record<string, unknown>,
  runId: string,
  parentCandidateId?: string,
): DiscoveryCandidate {
  const c: DiscoveryCandidate = {
    id: uuidv4(),
    runId,
    candidateType: type,
    name,
    confidence: 0.9,
    status: 'proposed',
    sourceClusterIds: [filePath],
    data: { ...data, _addedBy: 'angularjs-classic-adapter' },
    synthesizedAt: new Date().toISOString(),
  };
  if (parentCandidateId) c.parentCandidateId = parentCandidateId;
  return c;
}

// ---------------------------------------------------------------------------
// Helpers — parse call arguments
// ---------------------------------------------------------------------------

/** Strip surrounding quotes from a string literal arg text. Returns null if not a literal. */
function asStringLiteral(arg: string | undefined): string | null {
  if (!arg) return null;
  const t = arg.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  if (t.startsWith('`') && t.endsWith('`')) {
    // Template literal without `${}` interpolation → treat as literal.
    const inner = t.slice(1, -1);
    if (!inner.includes('${')) return inner;
  }
  return null;
}

/**
 * Split a "chain call" callee like `angular.module('x').controller` into
 * { head: 'angular.module', tail: 'controller' }. Because the TS extractor
 * captures each nested call expression independently, the tail is usually
 * visible directly as the `callee` string of an outer call (it includes
 * the preceding `.something()` in the text). We use the last dot to
 * split.
 *
 * PhoneCat (and similarly-styled code) uses multi-line chained calls:
 *     angular.
 *       module('x').
 *       component('y', {...})
 * The callee source text preserves those newlines/whitespace. We strip
 * all whitespace (not just trim) so the returned segment is a clean
 * identifier suitable for Set/string lookups.
 */
function lastMemberSegment(callee: string): string {
  // Drop everything up to (and including) the final `.` that isn't inside
  // a parenthesised sub-expression. Quick heuristic: find the last `.`
  // that is outside any matching `()` / `[]`.
  let depth = 0;
  let lastDot = -1;
  for (let i = 0; i < callee.length; i++) {
    const ch = callee[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === '.' && depth === 0) lastDot = i;
  }
  const tail = lastDot >= 0 ? callee.slice(lastDot + 1) : callee;
  return tail.replace(/\s+/g, '');
}

/** Normalise a raw callee by stripping all whitespace — for exact-match checks. */
function normalizeCallee(callee: string): string {
  return callee.replace(/\s+/g, '');
}

/**
 * AngularJS registration methods chained off a module reference.
 * Each maps to a candidate emission strategy.
 */
const REGISTRATION_METHODS = new Set([
  'controller',
  'service',
  'factory',
  'provider',
  'directive',
  'component',
  'filter',
  'config',
  'run',
]);

/** HTTP verbs recognised on `$http.<verb>` and `$resource(...)` CRUD expansion. */
const HTTP_METHOD_VERBS = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'];

/**
 * Infer a `component_type` for a `ui_components` candidate from its name.
 *
 * AngularJS 1.x naming idioms differ from React / modern Angular in two
 * ways:
 *   1. Controllers are pervasive and routinely suffixed `Ctrl` /
 *      `Controller` — and the meaningful type-noun (Modal, Form, Table,
 *      Btn, Widget) sits BEFORE that suffix. Strip the role suffix first
 *      so `MeasureDetailModalCtrl` resolves as `modal`, not `other`.
 *   2. AngularJS apps often expose chart/histogram/graph widgets and
 *      treat `Widget` as a category in its own right; we surface those
 *      explicitly rather than collapsing them into `other`.
 *
 * Order matters: the more-specific suffixes (`Btn`, `Modal`, `Histogram`)
 * are tested before generic ones (`Widget`, `Layout`) so the right type
 * wins when names compose multiple suffixes.
 */
function inferComponentType(rawName: string): string {
  const name = rawName.replace(/(Ctrl|Controller)$/u, '');
  const lower = name.toLowerCase();
  if (/button$/i.test(name) || lower.endsWith('btn')) return 'button';
  if (/input$|field$|select$|textarea$/i.test(name)) return 'input';
  if (/form$|edit(or)?$/i.test(name)) return 'form';
  if (/modal$|dialog$|popover$|popup$/i.test(name)) return 'modal';
  if (/table$|grid$|list$/i.test(name)) return 'table';
  if (/card$|tile$|item$/i.test(name)) return 'card';
  if (/header$|footer$|sidebar$|nav(bar)?$|layout$|shell$|menu$/i.test(name)) return 'layout';
  if (/chart$|histogram$|graph$|plot$/i.test(name)) return 'chart';
  if (/widget$/i.test(name)) return 'widget';
  return 'other';
}

// ---------------------------------------------------------------------------
// Emission passes
// ---------------------------------------------------------------------------

interface AdapterOutput {
  candidates: DiscoveryCandidate[];
  /** Controllers declared via `.controller(...)`, keyed by name → candidate id. */
  controllersByName: Map<string, string>;
  /** Modules declared via `angular.module(...)`, keyed by name → candidate id. */
  modulesByName: Map<string, string>;
  /** HTTP endpoint call sites, for interface_logical_entities emission. */
  endpointCallSites: Array<{ controller: string | null; targetEntity: string | null }>;
  /** Logical data entity names (from `$resource(...)`). */
  logicalEntityNames: Set<string>;
  /**
   * Factory names that turned out to be model classes (PascalCase
   * non-service name + constructor-pattern body). Populated by
   * `emitModelFactoryEntities` BEFORE `emitRegistrations` runs so the
   * latter skips emitting a `business_logics` row for these names —
   * they're data carriers, not service-layer methods.
   */
  modelFactoryNames: Set<string>;
}

/**
 * Detect `angular.module('name', [deps])` calls and emit `interfaces`.
 * The setter form `angular.module('x', [])` declares a module; the getter
 * form `angular.module('x')` just retrieves it and MUST NOT emit.
 */
function emitModules(file: SourceFileIR, runId: string, out: AdapterOutput): void {
  const calls = file.allCalls ?? [];
  for (const c of calls) {
    if (normalizeCallee(c.callee) !== 'angular.module') continue;
    // Setter form requires 2+ args (name + deps array).
    if (c.args.length < 2) continue;
    const name = asStringLiteral(c.args[0]);
    if (!name) continue;
    if (out.modulesByName.has(name)) continue;
    const cand = makeCandidate(
      'interfaces',
      name,
      file.filePath,
      {
        // Rubric (`RUBRIC.md` line 44) requires `name` plus AT LEAST ONE of
        // `controllerType` / `springConfigKind` / `serviceInterfaceKind` /
        // `feignName` / `className`. Emit the rubric-required names AND
        // keep the historical `interfaceClassName` / `interfaceKind` for
        // any consumers still keyed off them.
        className: name,
        serviceInterfaceKind: 'angularjs-module',
        interfaceClassName: name, // legacy
        interfaceKind: 'angularjs-module', // legacy
        dependencies: c.args[1],
      },
      runId,
    );
    out.candidates.push(cand);
    out.modulesByName.set(name, cand.id);
  }
}

/**
 * Detect `.controller(name, fn)` / `.service(...)` / `.factory(...)` /
 * `.provider(...)` / `.directive(...)` / `.component(...)` / `.filter(...)`
 * calls and emit the appropriate candidate type.
 *
 * A `.controller(...)` call emits a `ui_components` candidate; it becomes
 * a `ui_screens` instead if a route-provider binding later names it as a
 * page controller (reclassified in `emitRoutes`).
 */
function emitRegistrations(file: SourceFileIR, runId: string, out: AdapterOutput): void {
  const calls = file.allCalls ?? [];
  for (const c of calls) {
    const tail = lastMemberSegment(c.callee);
    if (!REGISTRATION_METHODS.has(tail)) continue;
    if (c.args.length < 1) continue;
    const name = asStringLiteral(c.args[0]);
    if (!name) continue;
    // Skip two wiring-only registrations — they don't map to a candidate
    // type. `.config(fn)` / `.run(fn)` are framework hooks.
    if (tail === 'config' || tail === 'run') continue;
    switch (tail) {
      case 'controller': {
        const cand = makeCandidate(
          'ui_components',
          name,
          file.filePath,
          {
            controllerName: name,
            registrationMethod: 'controller',
            component_type: inferComponentType(name),
          },
          runId,
        );
        out.candidates.push(cand);
        out.controllersByName.set(name, cand.id);
        break;
      }
      case 'service':
      case 'factory':
      case 'provider':
      case 'filter': {
        // 2026-04-29 (improvement #4a): a `.factory()` whose body looks
        // like a model class (PascalCase non-service name +
        // constructor-pattern `this.x = …` assignments) is emitted as
        // `logical_data_entities` by `emitModelFactoryEntities` instead.
        // Skip the `business_logics` row in that case so the same name
        // isn't classified as both a service and a data carrier.
        if (tail === 'factory' && out.modelFactoryNames.has(name)) break;
        const cand = makeCandidate(
          'business_logics',
          name,
          file.filePath,
          {
            // Rubric (`RUBRIC.md` line 52) requires `business_logics`
            // rows to have `className` AND `name`. The AngularJS
            // service IS the class — at the registration level, the
            // registration row's `name` is both the class name and the
            // public-API entry point, so set `className: name` and let
            // method-level rows (from `emitServiceMethods`) carry the
            // individual method names. (2026-04-29 improvement #2.)
            className: name,
            registrationMethod: tail,
            beanKind: tail,
            parameterCount: 0,
          },
          runId,
        );
        out.candidates.push(cand);
        break;
      }
      case 'directive':
      case 'component': {
        const cand = makeCandidate(
          'ui_components',
          name,
          file.filePath,
          {
            registrationMethod: tail,
            component_type: inferComponentType(name),
          },
          runId,
        );
        out.candidates.push(cand);
        break;
      }
    }
  }
}

/**
 * Detect `$routeProvider.when(path, {controller, templateUrl})` and
 * `$stateProvider.state(name, {url, controller, templateUrl})`. Emit
 * a `ui_screens` candidate. If the referenced controller was previously
 * emitted as `ui_components`, reclassify it to `ui_screens` so the
 * meta-model sees route-bound controllers as screens.
 */
function emitRoutes(file: SourceFileIR, runId: string, out: AdapterOutput): void {
  const calls = file.allCalls ?? [];
  for (const c of calls) {
    const tail = lastMemberSegment(c.callee);
    const isRouter = tail === 'when' && /\$routeProvider\b/.test(c.callee);
    const isState = tail === 'state' && /\$stateProvider\b/.test(c.callee);
    if (!isRouter && !isState) continue;

    const configArgIdx = isRouter ? 1 : 1;
    const configText = c.args[configArgIdx];
    if (!configText) continue;

    // Parse out `controller:` / `url:` / `templateUrl:` from the config
    // object literal text (regex — tree-sitter would be overkill here).
    const controllerMatch =
      /\bcontroller\s*:\s*['"]([^'"]+)['"]/.exec(configText) ??
      /\bcontroller\s*:\s*([A-Za-z_$][A-Za-z0-9_$]*)/.exec(configText);
    const urlMatch =
      /\burl\s*:\s*['"]([^'"]+)['"]/.exec(configText) ??
      /\btemplateUrl\s*:\s*['"]([^'"]+)['"]/.exec(configText);

    // For $routeProvider.when the path is arg[0]; for $stateProvider.state
    // the state name is arg[0] and url is inside the config object.
    const firstArgLit = asStringLiteral(c.args[0]);

    // Bug 24 fix (2026-04-22): skip emission when we cannot identify the
    // route/state name from the call args. This happens when routes are
    // declared as data (array of {url, config} objects) and iterated via
    // `routes.forEach(r => $routeProvider.when(r.url, r.config))` — the
    // args are bare identifiers we can't resolve per-call. The
    // routes-array pattern is handled by `emitRoutesArrayPattern`
    // AFTER this per-call loop. Without this skip, we emitted a single
    // useless `unknown-route` placeholder per forEach callsite.
    if (!firstArgLit) continue;

    const screenName = firstArgLit;
    const routePath = isRouter
      ? firstArgLit
      : urlMatch?.[1] ?? null;

    const controllerName = controllerMatch?.[1] ?? null;
    const cand = makeCandidate(
      'ui_screens',
      screenName,
      file.filePath,
      {
        route: routePath,
        controllerName,
        routerKind: isRouter ? 'ngRoute' : 'uiRouter',
      },
      runId,
    );
    out.candidates.push(cand);

    // Bug 18 fix (2026-04-22): the route's screen candidate already
    // carries `controllerName` in its data, so the controller itself does
    // NOT need a second `ui_screens` / `ui_components` row. Remove the
    // controller's prior emission entirely — the route's screen is the
    // canonical carrier. Previously we promoted the controller to
    // `ui_screens` which left BOTH the route AND the controller as
    // separate ui_screens rows (e.g. `app.home` AND `HomeCtrl` both
    // appeared as screens for the same route).
    if (controllerName) {
      const ctrlId = out.controllersByName.get(controllerName);
      if (ctrlId) {
        const idx = out.candidates.findIndex((x) => x.id === ctrlId);
        if (idx >= 0) {
          out.candidates.splice(idx, 1);
          out.controllersByName.delete(controllerName);
        }
      }
    }
  }

  // Bug 24 fix (2026-04-22) — routes-as-data pattern.
  //
  // HotTowel (and many John-Papa-style AngularJS 1.x apps) declare
  // routes in a `getRoutes()` function returning an array, then iterate
  // via `routes.forEach(r => $routeProvider.when(r.url, r.config))`.
  // The per-call loop above can't resolve `r.url`. Instead, scan the
  // raw file source for the patterns:
  //   { url: '/dashboard', config: { templateUrl: '...', controller: '...' } }
  //   { url: '/admin',     config: { templateUrl: '...' } }
  // and emit one ui_screens per object.
  //
  // Only fires on files that actually invoke `$routeProvider.when(...)`
  // OR `$stateProvider.state(...)` — avoids false positives on random
  // array-of-object data that happens to have `url:` keys.
  const fileUsesRouter = (file.allCalls ?? []).some((c) => {
    const tail = lastMemberSegment(c.callee);
    const normalized = normalizeCallee(c.callee);
    return (
      (tail === 'when' && /\$routeProvider\b/.test(normalized)) ||
      (tail === 'state' && /\$stateProvider\b/.test(normalized))
    );
  });
  if (fileUsesRouter && file.rawContent) {
    const seenScreens = new Set<string>();
    for (const rt of scanRoutesArrayPattern(file.rawContent)) {
      if (seenScreens.has(rt.url)) continue;
      seenScreens.add(rt.url);
      out.candidates.push(
        makeCandidate(
          'ui_screens',
          rt.url,
          file.filePath,
          {
            route: rt.url,
            controllerName: rt.controllerName,
            templateUrl: rt.templateUrl,
            routerKind: 'ngRoute',
            source: 'routes-array',
          },
          runId,
        ),
      );
      // Mirror the controller cleanup from the per-call loop so the
      // controller doesn't linger as a separate ui_components row.
      if (rt.controllerName) {
        const ctrlId = out.controllersByName.get(rt.controllerName);
        if (ctrlId) {
          const idx = out.candidates.findIndex((x) => x.id === ctrlId);
          if (idx >= 0) {
            out.candidates.splice(idx, 1);
            out.controllersByName.delete(rt.controllerName);
          }
        }
      }
    }
  }
}

/**
 * Bug 24 fix — find every `{ url: '/path', config: {...} }` or
 * `{ url: '/path', templateUrl: '...' }` block in a file source that
 * participates in a routes-as-data pattern. Returns structured route
 * info per block.
 *
 * Heuristic: any top-level object literal that has BOTH a `url:` key
 * with a quoted-string value AND either a `config:` key OR a
 * `templateUrl:` key counts as a route declaration.
 */
function scanRoutesArrayPattern(
  src: string,
): Array<{ url: string; controllerName: string | null; templateUrl: string | null }> {
  const out: Array<{ url: string; controllerName: string | null; templateUrl: string | null }> = [];
  // Match outer-level {url:..., config:{...}} — non-greedy, allowing one
  // level of nesting inside the config.
  const routeRe =
    /\{\s*url\s*:\s*['"`]([^'"`]+)['"`]\s*,\s*(?:config\s*:\s*\{([\s\S]*?)\}|templateUrl\s*:\s*['"`]([^'"`]+)['"`])/g;
  let m: RegExpExecArray | null;
  while ((m = routeRe.exec(src)) !== null) {
    const url = m[1];
    const configBody = m[2] ?? '';
    const directTemplateUrl = m[3] ?? null;
    let templateUrl: string | null = directTemplateUrl;
    if (!templateUrl && configBody) {
      const t = /\btemplateUrl\s*:\s*['"`]([^'"`]+)['"`]/.exec(configBody);
      templateUrl = t?.[1] ?? null;
    }
    const ctrlMatch =
      (configBody && /\bcontroller\s*:\s*['"`]([^'"`]+)['"`]/.exec(configBody)) || null;
    const controllerName = ctrlMatch ? ctrlMatch[1] : null;
    out.push({ url, controllerName, templateUrl });
  }
  return out;
}

/**
 * Detect HTTP client calls:
 *   $http.get/post/put/delete/patch/head/options(url, ...)
 *   $resource('/url/:id', ...) → expand to GET + POST + PUT + DELETE
 */
function emitEndpoints(file: SourceFileIR, runId: string, out: AdapterOutput): void {
  const calls = file.allCalls ?? [];
  const emittedKeys = new Set<string>();

  /**
   * Bug 22 fix (2026-04-22): match `$http` both directly AND when aliased
   * to an instance field (`this._$http`, `self.$http`, `this.$http`, etc.).
   * Class-style factory services in AngularJS 1.x commonly alias the
   * injected `$http` in the constructor (`this._$http = $http`) then
   * invoke `this._$http(config)` as a plain function call throughout
   * methods. Without alias tracking the pack would see zero endpoints on
   * those codebases (e.g. gothinkster/angularjs-realworld-example-app).
   *
   * We do NOT implement full alias tracking — this regex heuristic covers
   * the common cases: `$http`, `this.$http`, `this._$http`, `self.$http`,
   * `self._$http`, `that.$http`, `that._$http`. Any suffix that ends with
   * `$http` after an optional underscore prefix and an optional
   * `this.`/`self.`/`that.` prefix.
   */
  const HTTP_ALIAS_SUFFIX = /(^|\.)_?\$http$/;
  const isHttpAliased = (callee: string): boolean => HTTP_ALIAS_SUFFIX.test(normalizeCallee(callee));

  for (const c of calls) {
    const tail = lastMemberSegment(c.callee);
    const normalized = normalizeCallee(c.callee);

    // $http.<verb>(url, ...) — the verb-method form.
    if (HTTP_METHOD_VERBS.includes(tail) && /\$http\b/.test(normalized)) {
      const url = asStringLiteral(c.args[0]);
      if (!url) continue;
      const canonicalUrl = canonicaliseUrl(url);
      if (!isLikelyHttpUrl(canonicalUrl)) continue;
      const key = `${tail.toUpperCase()} ${canonicalUrl}`;
      if (emittedKeys.has(key)) continue;
      emittedKeys.add(key);
      const cand = makeCandidate(
        'endpoints',
        key,
        file.filePath,
        {
          httpMethod: tail.toUpperCase(),
          url,
          canonicalUrl,
          apiLibrary: '$http',
          endpoint_subtype: 'api_call',
        },
        runId,
      );
      out.candidates.push(cand);
      out.endpointCallSites.push({ controller: null, targetEntity: null });
      continue;
    }

    // Bug 21 fix (2026-04-22): $http(configObject) direct-function form.
    // `this._$http({method:'GET', url:'/foo'})` OR `$http({method, url})`.
    // Parse the config object literal text for `url:` and `method:`.
    if (isHttpAliased(c.callee) && c.args.length >= 1) {
      const rawArg = c.args[0];
      if (!rawArg) continue;
      // Direct inline object literal — parse it here. Indirect bare
      // identifier (e.g. `request`) falls through to the file-wide scan
      // handled AFTER this loop (see `emitIndirectHttpEndpoints`).
      const configText = extractConfigObjectText(rawArg);
      if (!configText) continue;
      const endpoint = parseHttpConfigText(configText);
      if (!endpoint) continue;
      const key = `${endpoint.httpMethod} ${endpoint.canonicalUrl}`;
      if (emittedKeys.has(key)) continue;
      emittedKeys.add(key);
      out.candidates.push(
        makeCandidate(
          'endpoints',
          key,
          file.filePath,
          {
            httpMethod: endpoint.httpMethod,
            url: endpoint.url,
            canonicalUrl: endpoint.canonicalUrl,
            apiLibrary: '$http',
            endpoint_subtype: 'api_call',
            invocationStyle: 'configObject',
          },
          runId,
        ),
      );
      const entityName = extractResourceEntityName(endpoint.canonicalUrl);
      if (entityName) out.logicalEntityNames.add(entityName);
      continue;
    }

    // $resource('/path/:id', ...) — expand to CRUD endpoints + emit logical entity.
    if (tail === 'resource' && /\$resource\b/.test(c.callee) || c.callee === '$resource') {
      const rawUrl = asStringLiteral(c.args[0]);
      if (!rawUrl) continue;
      const canonicalUrl = canonicaliseUrl(rawUrl);
      if (!isLikelyHttpUrl(canonicalUrl)) continue;
      for (const verb of ['GET', 'POST', 'PUT', 'DELETE']) {
        const key = `${verb} ${canonicalUrl}`;
        if (emittedKeys.has(key)) continue;
        emittedKeys.add(key);
        out.candidates.push(
          makeCandidate(
            'endpoints',
            key,
            file.filePath,
            {
              httpMethod: verb,
              url: rawUrl,
              canonicalUrl,
              apiLibrary: '$resource',
              endpoint_subtype: 'api_call',
            },
            runId,
          ),
        );
      }
      // Extract a resource entity name from the URL if possible
      // (`/users/:id` → `User`, `/orders` → `Order`). Singularise naively.
      const entityName = extractResourceEntityName(canonicalUrl);
      if (entityName) {
        out.logicalEntityNames.add(entityName);
      }
    }
  }

  // Bug 23 fix (2026-04-22) — indirect config-via-variable pass.
  //
  // Only fires if the file contains ANY `$http`-aliased call. For those
  // files, regex-scan the raw source for every inline object literal or
  // incrementally-built config that has a `url:` property (explicit or
  // concatenated). Emit one endpoint per unique (method, canonical URL).
  // This is deliberately over-eager — a config object that's never
  // actually invoked through `$http` still emits — but in practice such
  // objects exist precisely to feed `$http`, and the risk of a false
  // positive is far less costly than the alternative (missing half of
  // the Conduit codebase's endpoints).
  const fileUsesHttpAliased = (file.allCalls ?? []).some((c) =>
    isHttpAliased(c.callee),
  );
  if (fileUsesHttpAliased && file.rawContent) {
    for (const endpoint of scanFileForHttpConfigs(file.rawContent)) {
      const key = `${endpoint.httpMethod} ${endpoint.canonicalUrl}`;
      if (emittedKeys.has(key)) continue;
      emittedKeys.add(key);
      out.candidates.push(
        makeCandidate(
          'endpoints',
          key,
          file.filePath,
          {
            httpMethod: endpoint.httpMethod,
            url: endpoint.url,
            canonicalUrl: endpoint.canonicalUrl,
            apiLibrary: '$http',
            endpoint_subtype: 'api_call',
            invocationStyle: endpoint.invocationStyle,
          },
          runId,
        ),
      );
      const entityName = extractResourceEntityName(endpoint.canonicalUrl);
      if (entityName) out.logicalEntityNames.add(entityName);
    }
  }

  // Wrapper-service config-object scan (2026-04-29 improvement #1b).
  //
  // The $http-aliased trigger above doesn't fire for files that go
  // through a custom HTTP service (`DataService.request({url: '/x', method: 'GET'})`).
  // Broaden the trigger to fire when the file contains a call to one of
  // the common wrapper method names (`request`, `execute`, `send`,
  // `call`, `invoke`, `fetch`, `ajax`) where the first arg is a config-
  // object literal. Strict mode is on for this path (HTTP-shape signal
  // required: `method:` / `data:` / `body:` / `headers:` / `params:` /
  // …) so that route configs like `$stateProvider.state('x',
  // {url: '/profile', controller: 'X', templateUrl: ...})` aren't
  // misclassified as GET endpoints.
  const WRAPPER_CONFIG_METHODS = new Set([
    'request', 'execute', 'send', 'call', 'invoke', 'fetch', 'ajax',
  ]);
  const fileUsesWrapperConfigMethod = (file.allCalls ?? []).some((c) => {
    if (!WRAPPER_CONFIG_METHODS.has(lastMemberSegment(c.callee))) return false;
    if (c.args.length < 1) return false;
    const firstArg = (c.args[0] ?? '').trim();
    return firstArg.startsWith('{');
  });
  if (fileUsesWrapperConfigMethod && !fileUsesHttpAliased && file.rawContent) {
    for (const endpoint of scanFileForHttpConfigs(file.rawContent, { requireHttpShape: true })) {
      const key = `${endpoint.httpMethod} ${endpoint.canonicalUrl}`;
      if (emittedKeys.has(key)) continue;
      emittedKeys.add(key);
      out.candidates.push(
        makeCandidate(
          'endpoints',
          key,
          file.filePath,
          {
            httpMethod: endpoint.httpMethod,
            url: endpoint.url,
            canonicalUrl: endpoint.canonicalUrl,
            apiLibrary: 'http-wrapper',
            endpoint_subtype: 'api_call',
            invocationStyle: endpoint.invocationStyle,
          },
          runId,
        ),
      );
      const entityName = extractResourceEntityName(endpoint.canonicalUrl);
      if (entityName) out.logicalEntityNames.add(entityName);
    }
  }

  // Wrapper-service endpoint detection (2026-04-29 — improvements item 2(b)).
  //
  // Many enterprise AngularJS apps wrap `$http` behind a custom service
  // (`ApiService.get('/api/trades')`, `dataClient.post('/api/save', body)`).
  // The wrapper itself isn't `$http`, so the detector above misses the
  // call. This pass picks up any `<caller>.<verb>(<URL_LITERAL>, …)` shape
  // where `<verb>` is a real HTTP method and the URL literal looks like a
  // URL. The strict URL-shape gate (`/...` or `http://...`) is what keeps
  // false positives out — `localStorage.get('user-id')`, `_.get(obj, 'a.b')`,
  // `Promise.get(...)` etc. all fail the URL test.
  //
  // The shared `emittedKeys` set means rows already emitted by the
  // `$http` / `$resource` paths above are not duplicated.
  for (const c of calls) {
    const tail = lastMemberSegment(c.callee);
    if (!HTTP_METHOD_VERBS.includes(tail)) continue;
    const normalized = normalizeCallee(c.callee);
    // Already covered by the $http / $resource branches above.
    if (/\$http\b/.test(normalized)) continue;
    if (/\$resource\b/.test(normalized)) continue;
    if (isHttpAliased(c.callee)) continue;
    // Use the concatenation-aware extractor (2026-04-29 improvement #1a)
    // for both the simple-literal and the concatenation cases. We do NOT
    // delegate the simple-literal case to `asStringLiteral` here because
    // its naive `t.startsWith("'") && t.endsWith("'")` check matches the
    // outer quotes of `'/api/v1' + '/trades'` and returns a bogus inner
    // string. `extractUrlFromArgExpr` parses the expression character
    // by character and resolves both shapes correctly.
    const recovered = extractUrlFromArgExpr(c.args[0] || '');
    if (!recovered) continue;
    const url = recovered.url;
    const partial = recovered.partial;
    const canonicalUrl = canonicaliseUrl(url);
    if (!isLikelyHttpUrl(canonicalUrl)) continue;
    // Identify the calling service for `data.callingService` metadata.
    const dotIdx = c.callee.lastIndexOf('.');
    const callerExpr = dotIdx >= 0 ? c.callee.slice(0, dotIdx) : '';
    if (!callerExpr) continue; // `get(URL)` standalone is too ambiguous to attribute
    const verb = tail.toUpperCase();
    const key = `${verb} ${canonicalUrl}`;
    if (emittedKeys.has(key)) continue;
    emittedKeys.add(key);
    const cand = makeCandidate(
      'endpoints',
      key,
      file.filePath,
      {
        httpMethod: verb,
        url,
        canonicalUrl,
        apiLibrary: 'http-wrapper',
        endpoint_subtype: 'api_call',
        callingService: callerExpr,
        ...(partial ? { urlIsPartial: true } : {}),
      },
      runId,
    );
    if (partial) cand.confidence = 0.75; // partial URL recovered from concatenation
    out.candidates.push(cand);
    const entityName = extractResourceEntityName(canonicalUrl);
    if (entityName) out.logicalEntityNames.add(entityName);
  }
}

interface ResolvedEndpoint {
  httpMethod: string;
  url: string;
  canonicalUrl: string;
  invocationStyle: 'configObject' | 'variableResolved' | 'incremental';
}

/**
 * Parse a config-object literal text — returns null if no usable URL
 * can be recovered. Tolerates string concatenation (`BASE + '/path'`)
 * by extracting the FIRST `/`-prefixed quoted-or-template string.
 *
 * `requireHttpShape` (added 2026-04-29 — improvement #1b): when true,
 * also require at least one HTTP-shape signal in the config text
 * (`method:` / `data:` / `body:` / `headers:` / `params:` /
 * `responseType:` / `timeout:` / `type:` / `verb:`). Without that
 * guard, a `$stateProvider.state(...)` route config like
 * `{url: '/profile', controller: 'X', templateUrl: ...}` would be
 * misclassified as a GET endpoint when this function is called from
 * the broadened wrapper-service trigger.
 */
function parseHttpConfigText(
  configText: string,
  options: { requireHttpShape?: boolean } = {},
): ResolvedEndpoint | null {
  // Permissive url extraction — tolerates concatenation and template literals.
  const urlKeyMatch = /\burl\s*:\s*([^,}]+?)(?:,|\s*})/.exec(configText);
  if (!urlKeyMatch) return null;
  const urlExpr = urlKeyMatch[1];
  // Quoted literal
  let url: string | null = null;
  const q = /['"`](\/[^'"`]*)['"`]/.exec(urlExpr);
  if (q) url = q[1];
  // Plain quoted literal even without leading slash — covers full URLs
  if (!url) {
    const q2 = /['"`](https?:\/\/[^'"`]+)['"`]/.exec(urlExpr);
    if (q2) url = q2[1];
  }
  if (!url) return null;
  const canonicalUrl = canonicaliseUrl(url);
  if (!isLikelyHttpUrl(canonicalUrl)) return null;
  const methodMatch = /\bmethod\s*:\s*['"`]([A-Za-z]+)['"`]/.exec(configText);
  // HTTP-shape guard: when strict, require at least one of the listed
  // keys. Route configs typically only have `url`/`controller`/`templateUrl`,
  // failing this gate. Real HTTP configs always have at least one.
  if (options.requireHttpShape) {
    const httpShape = /\b(method|data|body|headers|params|responseType|timeout|type|verb)\s*:/.test(configText);
    if (!httpShape) return null;
  }
  const httpMethod = (methodMatch?.[1] ?? 'GET').toUpperCase();
  return { httpMethod, url, canonicalUrl, invocationStyle: 'configObject' };
}

/**
 * Find every $http config in the file source.
 *
 * Two shapes:
 *   (a) Inline / variable-bound object literals — `{ url: ..., method: ... }`
 *   (b) Incremental assignments — `X.url = '/foo'; X.method = 'POST';`
 *
 * Emits one ResolvedEndpoint per distinct shape found. Deduplication on
 * `(method, canonicalUrl)` happens at the caller level.
 */
function scanFileForHttpConfigs(
  src: string,
  options: { requireHttpShape?: boolean } = {},
): ResolvedEndpoint[] {
  const out: ResolvedEndpoint[] = [];

  // (a) Inline object literals — match every `{ ... url: ... }` block.
  // Non-greedy `.*?` stops at the first `}` so nested objects aren't
  // merged. This DOES over-emit for unused config-shaped literals but
  // that's tolerable vs under-emitting real endpoints.
  const objRe = /\{[^{}]*?\burl\s*:[^{}]*?\}/g;
  let m: RegExpExecArray | null;
  while ((m = objRe.exec(src)) !== null) {
    const block = m[0];
    const parsed = parseHttpConfigText(block, options);
    if (parsed) {
      out.push({ ...parsed, invocationStyle: 'variableResolved' });
    }
  }

  // (b) Incremental builds — look for `X.url = '...'` assignments and
  // cross-reference `X.method = '...'` assignments for the same X.
  // Scan once, keyed by variable name.
  const incUrlRe = /\b([A-Za-z_$][A-Za-z0-9_$]*)\.url\s*=\s*(?:['"`](\/[^'"`]+)['"`]|['"`](https?:\/\/[^'"`]+)['"`]|([^;\n]+))/g;
  const incMethodRe = /\b([A-Za-z_$][A-Za-z0-9_$]*)\.method\s*=\s*['"`]([A-Za-z]+)['"`]/g;
  const varUrls = new Map<string, string>();
  const varMethods = new Map<string, string>();
  while ((m = incUrlRe.exec(src)) !== null) {
    const varName = m[1];
    let url: string | null = m[2] ?? m[3] ?? null;
    if (!url && m[4]) {
      // Fall back to finding a /-prefixed literal in an expression like
      // `BASE + '/articles/' + slug`.
      const inner = /['"`](\/[^'"`]*)['"`]/.exec(m[4]);
      if (inner) url = inner[1];
    }
    if (url && !varUrls.has(varName)) varUrls.set(varName, url);
  }
  while ((m = incMethodRe.exec(src)) !== null) {
    const varName = m[1];
    if (!varMethods.has(varName)) varMethods.set(varName, m[2].toUpperCase());
  }
  for (const [varName, url] of varUrls) {
    // Skip variables that aren't plausibly HTTP config builders — those
    // without a sibling `.method = ...` AND not invoked via $http.
    // We approximate "invoked via $http" by searching the source.
    const invoked = new RegExp(`\\$http\\s*\\(\\s*${varName}\\s*\\)`).test(src);
    if (!invoked && !varMethods.has(varName)) continue;
    const canonicalUrl = canonicaliseUrl(url);
    if (!isLikelyHttpUrl(canonicalUrl)) continue;
    out.push({
      httpMethod: varMethods.get(varName) ?? 'GET',
      url,
      canonicalUrl,
      invocationStyle: 'incremental',
    });
  }

  return out;
}

/**
 * Names with these suffixes are NEVER logical data entities — they're
 * AngularJS building blocks (controllers, services, factories, filters,
 * directives, components, providers). Used both here (pack-side filter)
 * and shared with the LLM output validator (see `isDefinitelyNotEntity`
 * below) to reject LLM hallucinations like `EditorCtrl` being classified
 * as a data entity.
 */
const NON_ENTITY_NAME_SUFFIXES =
  /(Ctrl|Controller|Service|Factory|Provider|Filter|Directive|Component|Config|Run)$/;

/** True if the given name is almost certainly a framework role, not a data entity. */
export function isDefinitelyNotEntity(name: string): boolean {
  return NON_ENTITY_NAME_SUFFIXES.test(name);
}

/**
 * Emit `logical_data_entities` for every unique `$resource`-derived
 * entity name collected during endpoint processing.
 */
function emitLogicalEntities(file: SourceFileIR, runId: string, out: AdapterOutput): void {
  // 2026-04-29: skip names that have already been emitted as
  // `logical_data_entities` by an earlier pass (e.g. model-factory
  // detection). Without this guard, the same name would appear twice
  // in the candidate set.
  const alreadyEmitted = new Set<string>();
  for (const c of out.candidates) {
    if (c.candidateType === 'logical_data_entities') alreadyEmitted.add(c.name);
  }
  for (const name of out.logicalEntityNames) {
    if (alreadyEmitted.has(name)) continue;
    if (isDefinitelyNotEntity(name)) continue;
    const cand = makeCandidate(
      'logical_data_entities',
      name,
      file.filePath,
      {
        className: name,
        source: '$resource',
      },
      runId,
    );
    out.candidates.push(cand);
  }
}

/**
 * Bug 23 fix (2026-04-22) — if the call-arg text is already an object
 * literal (`{ url: '...', method: 'GET' }`), return it as-is. Otherwise
 * return null; the file-wide scan (`scanFileForHttpConfigs`) handles
 * variable-indirect cases separately in a second pass.
 */
function extractConfigObjectText(argText: string): string | null {
  const t = argText.trim();
  if (t.startsWith('{') && t.endsWith('}')) return t;
  return null;
}

/**
 * URL canonicalisation — strip query strings and trailing slashes.
 */
function canonicaliseUrl(url: string): string {
  const q = url.indexOf('?');
  const trimmed = q >= 0 ? url.slice(0, q) : url;
  return trimmed.replace(/\/+$/, '') || '/';
}

/**
 * Extract a URL from an argument expression that might be a string
 * concatenation (`BASE + '/trades'`, `'/api/v1' + '/trades'`) or a
 * direct literal. Returns the recovered URL, or null if no
 * URL-shaped literal is present anywhere in the expression.
 *
 * Rules:
 *   - If the first segment is a quoted-literal AND it starts with `/`
 *     or `http(s)://`, it's the URL prefix.
 *   - Subsequent `+ 'literal'` continuations are appended verbatim.
 *   - A `+ <variable>` continuation stops the chain — the URL returned
 *     is the literal-prefix-only partial URL (still architecturally
 *     significant per Kiro's analysis).
 *   - If the FIRST segment is a variable (`BASE + '/trades'`), find the
 *     first `/`-prefixed quoted literal anywhere in the expression and
 *     use that as the partial URL. Lower confidence — the caller can
 *     mark it.
 *
 * Added 2026-04-29 (improvement #1a — Kiro/Opus 4.6 analysis).
 */
function extractUrlFromArgExpr(argText: string): { url: string; partial: boolean } | null {
  const t = argText.trim();
  // Direct quoted literal at the start.
  const directRe = /^['"`]((?:\/|https?:\/\/)[^'"`]*)['"`]/;
  const direct = directRe.exec(t);
  if (direct) {
    let url = direct[1];
    let rest = t.slice(direct[0].length);
    // Greedily consume `+ 'literal'` continuations.
    let partial = false;
    while (true) {
      const concatLit = /^\s*\+\s*['"`]([^'"`]*)['"`]/.exec(rest);
      if (concatLit) {
        url += concatLit[1];
        rest = rest.slice(concatLit[0].length);
        continue;
      }
      // Any further `+ <something>` is a non-literal — record as partial
      // and stop building.
      const concatNonLit = /^\s*\+\s*\S/.exec(rest);
      if (concatNonLit) partial = true;
      break;
    }
    return { url, partial };
  }
  // First segment isn't a literal. Scan the whole expression for any
  // URL-shaped literal anywhere.
  const anyUrlLit = /['"`]((?:\/|https?:\/\/)[^'"`]+)['"`]/.exec(t);
  if (anyUrlLit) return { url: anyUrlLit[1], partial: true };
  return null;
}

/**
 * Reject bare identifier "URLs" like `id` / `key` / `name` / `initialTab`
 * that aren't actually URLs (this was Bug 11 on the React adapter — same
 * class of issue applies here).
 */
function isLikelyHttpUrl(url: string): boolean {
  return (
    url.startsWith('/') ||
    /^https?:\/\//i.test(url) ||
    /^\$\{/.test(url) ||
    /\/\$\{/.test(url) ||
    /\/:/.test(url)
  );
}

/**
 * Naive entity name extraction from a REST path: `/users/:id` → `User`,
 * `/v1/orders/:id/items` → `Item` (last collection segment). Returns null
 * if we can't confidently derive a name.
 */
function extractResourceEntityName(url: string): string | null {
  const parts = url.split('/').filter((p) => p && !p.startsWith(':') && !p.startsWith('$'));
  if (parts.length === 0) return null;
  const last = parts[parts.length - 1];
  if (!/^[a-z][a-z0-9_-]*$/i.test(last)) return null;
  // Singularise: trim trailing 's' unless it's 'ss' / 'us' / 'is'.
  let base = last;
  if (
    base.endsWith('s') &&
    !base.endsWith('ss') &&
    !base.endsWith('us') &&
    !base.endsWith('is')
  ) {
    base = base.slice(0, -1);
  }
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/**
 * Emit `interface_logical_entities` bindings — link every controller to
 * every logical entity it appears to reference via $http / $resource
 * calls within the same file.
 *
 * Heuristic: if a file declares a controller AND contains any endpoint
 * emissions for a logical entity, link them. Multiple controllers in one
 * file get linked to all entities in that file (best effort).
 */
function emitInterfaceLogicalEntities(
  file: SourceFileIR,
  runId: string,
  out: AdapterOutput,
  fileControllerNames: string[],
  fileEntityNames: string[],
): void {
  if (fileControllerNames.length === 0 || fileEntityNames.length === 0) return;
  for (const ctrl of fileControllerNames) {
    for (const ent of fileEntityNames) {
      out.candidates.push(
        makeCandidate(
          'interface_logical_entities',
          `${ctrl} → ${ent}`,
          file.filePath,
          {
            interfaceClassName: ctrl,
            logicalEntityName: ent,
          },
          runId,
        ),
      );
    }
  }
}

/**
 * Walk service / factory / controller function bodies and emit one
 * `business_logics` candidate per public method, attributed to its parent
 * service or controller. Without this pass the adapter emitted only ONE
 * candidate per registration (capturing the service name but not its
 * methods) — a 28-method enterprise file produced 1 candidate while the
 * LLM gap-fill emitted 28, dragging the per-type Provenance score to 1.
 *
 * Implementation strategy (2026-04-29 — improvements item 1):
 *
 *   - Build a sorted list of `service`/`factory`/`provider`/`controller`
 *     registrations in this file from `allCalls`. Each carries its
 *     `call.line` (1-based source line).
 *   - Regex-scan `rawContent` for the AngularJS 1.x method-emission
 *     patterns:
 *       (a) `this.<methodName> = function`           — service ctor
 *       (b) `<ServiceName>.prototype.<methodName> = function` — prototype
 *       (c) `$scope.<methodName> = function`         — controller scope
 *       (d) `vm.<methodName> = function` /
 *           `self.<methodName> = function` /
 *           `that.<methodName> = function`           — controllerAs aliases
 *       (e) `<methodName>: function`                 — factory return-object
 *           (only fires when the nearest preceding registration is a
 *           `.factory()` call)
 *   - Attribute each method to the registration whose `call.line` is the
 *     greatest line ≤ the match's line. This is positional attribution —
 *     correct for the common one-service-per-file shape and the
 *     several-services-per-IIFE shape; wrong only when a service
 *     registration doesn't actually contain the matched method (rare in
 *     real AngularJS code).
 *   - Dedupe on `(className, methodName)` so overloads / shadowed
 *     definitions don't double-emit.
 *
 * The IR doesn't expose nested function bodies in a structured way, so we
 * regex over `rawContent` rather than walking the AST. The patterns are
 * specific enough (member-assignment to a function literal) that
 * false-positive risk is low.
 */
function emitServiceMethods(file: SourceFileIR, runId: string, out: AdapterOutput): void {
  if (!file.rawContent) return;

  // 1) Collect registration sites in this file.
  type Reg = { name: string; line: number; method: string };
  const registrations: Reg[] = [];
  for (const c of file.allCalls ?? []) {
    const tail = lastMemberSegment(c.callee);
    if (
      tail !== 'service' &&
      tail !== 'factory' &&
      tail !== 'provider' &&
      tail !== 'controller'
    ) {
      continue;
    }
    if (c.args.length < 2) continue; // need name + fn
    const name = asStringLiteral(c.args[0]);
    if (!name) continue;
    registrations.push({ name, line: c.line, method: tail });
  }
  if (registrations.length === 0) return;
  registrations.sort((a, b) => a.line - b.line);

  // 2) Regex patterns. Each entry: regex, label, optional explicit
  // className-from-match (for prototype patterns). Ordering doesn't
  // matter except for inspection; dedup is keyed on (className, method).
  type Pat =
    | { kind: 'this' | 'scope' | 'ctrl-as' | 'return-object'; re: RegExp }
    | { kind: 'prototype'; re: RegExp; classFromGroup: number; methodFromGroup: number };
  const patterns: Pat[] = [
    { kind: 'this', re: /\bthis\s*\.\s*(\w+)\s*=\s*function\b/g },
    { kind: 'scope', re: /\$scope\s*\.\s*(\w+)\s*=\s*function\b/g },
    { kind: 'ctrl-as', re: /\b(?:vm|self|that|ctrl|ctrlInst|controller)\s*\.\s*(\w+)\s*=\s*function\b/g },
    { kind: 'prototype', re: /\b([A-Z]\w*)\s*\.\s*prototype\s*\.\s*(\w+)\s*=\s*function\b/g, classFromGroup: 1, methodFromGroup: 2 },
    { kind: 'return-object', re: /^\s*(\w+)\s*:\s*function\b/gm },
  ];

  // Map char-index → 1-based line number for fast lookup. Compute once.
  const lineStartOffsets: number[] = [0];
  for (let i = 0; i < file.rawContent.length; i++) {
    if (file.rawContent.charCodeAt(i) === 10) lineStartOffsets.push(i + 1);
  }
  const offsetToLine = (off: number): number => {
    // Binary search for the last lineStartOffsets entry ≤ off.
    let lo = 0;
    let hi = lineStartOffsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStartOffsets[mid] <= off) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1; // 1-based
  };

  const seen = new Set<string>();
  const META_NAMES = new Set([
    'constructor', 'toString', 'hasOwnProperty', 'isPrototypeOf',
    'propertyIsEnumerable', 'valueOf',
  ]);

  for (const pat of patterns) {
    pat.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pat.re.exec(file.rawContent)) !== null) {
      let methodName: string;
      let explicitClass: string | null = null;
      if (pat.kind === 'prototype') {
        explicitClass = m[pat.classFromGroup];
        methodName = m[pat.methodFromGroup];
      } else {
        methodName = m[1];
      }
      if (!methodName || META_NAMES.has(methodName)) continue;

      const matchLine = offsetToLine(m.index);
      // Find owning registration: greatest line ≤ matchLine.
      let owner: Reg | null = null;
      for (const reg of registrations) {
        if (reg.line <= matchLine) owner = reg;
        else break;
      }
      // If the prototype pattern names a class explicitly and that class
      // matches a registration name, prefer that — overrides positional
      // attribution.
      if (explicitClass) {
        const explicit = registrations.find((r) => r.name === explicitClass);
        if (explicit) owner = explicit;
        else continue; // prototype on a class we don't recognise — skip
      }
      if (!owner) continue;

      // Gate: factory-return-object pattern fires only when the owning
      // registration is `.factory()` — `<name>: function` is too generic
      // otherwise (object literals can be event-handler maps, jQuery
      // plugins, etc.).
      if (pat.kind === 'return-object' && owner.method !== 'factory') continue;

      const dedupKey = `${owner.name}::${methodName}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      out.candidates.push(
        makeCandidate(
          'business_logics',
          methodName,
          file.filePath,
          {
            className: owner.name,
            registrationMethod: `${owner.method}-method`,
            extractionPattern: pat.kind,
            line: matchLine,
            parameterCount: 0, // not extractable from regex; LLM gap-fill can refine
          },
          runId,
        ),
      );
    }
  }
}

/**
 * Detect AngularJS `.constant('NAME', { KEY: '/api/...', … })` URL bundles
 * and emit each URL-valued entry as an `endpoints` candidate.
 *
 * Enterprise AngularJS apps frequently centralise their API URL surface in
 * a single `.constant()` registration. The actual HTTP verb isn't known
 * from the constant alone, so the emitted candidate defaults to `GET`
 * with a `confidence` of 0.75 (vs. the 0.85 default — flagged to
 * reviewers via `endpoint_subtype: 'api-constant'`).
 *
 * Skipped: non-URL values (`VERSION: '1.0'`), keys whose value isn't a
 * literal string. The dedup keys with the run's `emittedKeys` are not
 * available here (this pass runs per-file; emittedKeys is local to
 * `emitEndpoints`). To keep this pass simple and side-effect-free, we
 * emit independently and rely on the LLM scorer to recognise duplicates
 * — they'd be rare since constant-defined URLs are typically the
 * authoritative source.
 *
 * Added 2026-04-29 (improvement #1c — Kiro/Opus 4.6 analysis).
 */
function emitApiConstantEndpoints(
  file: SourceFileIR,
  runId: string,
  out: AdapterOutput,
): void {
  for (const c of file.allCalls ?? []) {
    if (lastMemberSegment(c.callee) !== 'constant') continue;
    if (c.args.length < 2) continue;
    const constantName = asStringLiteral(c.args[0]);
    if (!constantName) continue;
    const objText = c.args[1].trim();
    if (!objText.startsWith('{') || !objText.endsWith('}')) continue;
    // Walk the object literal text for `KEY: '/url'` pairs. `\w+` keys
    // include both UPPER_SNAKE and camelCase. Quoted-string values must
    // start with `/` or `http(s)://` to qualify as URLs.
    const re = /(\w+)\s*:\s*['"`]((?:\/|https?:\/\/)[^'"`]*)['"`]/g;
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(objText)) !== null) {
      const key = m[1];
      const url = m[2];
      const canonicalUrl = canonicaliseUrl(url);
      if (!isLikelyHttpUrl(canonicalUrl)) continue;
      const dedupeKey = `GET ${canonicalUrl}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const cand = makeCandidate(
        'endpoints',
        `GET ${canonicalUrl}`,
        file.filePath,
        {
          httpMethod: 'GET',
          url,
          canonicalUrl,
          apiLibrary: 'api-constant',
          endpoint_subtype: 'api-constant',
          definedIn: constantName,
          constantKey: key,
        },
        runId,
      );
      cand.confidence = 0.75; // lower than the 0.85 default — verb is inferred
      out.candidates.push(cand);
    }
  }
}

/**
 * Detect AngularJS 1.x "model factory" pattern — `.factory(<PascalName>, fn)`
 * where the function body declares a constructor-style class with
 * `this.<field> = …` assignments. These are *data classes*, not service
 * factories. Without this pass they'd be emitted as `business_logics`
 * just like any other registration.
 *
 * Two-signal gate (single-signal would noise up most apps):
 *
 *   1. Factory name matches PascalCase and is NOT a service-suffix
 *      shape (`*Service` / `*Controller` / `*Factory` / `*Provider` /
 *      `*Manager` / etc.).
 *   2. Body contains AT LEAST 2 `this.<field> = …` assignments where
 *      the right-hand side is NOT a `function` literal. (Method
 *      assignments are extracted as `business_logics` by
 *      `emitServiceMethods`; pure data fields are what qualify a class
 *      as a model.)
 *
 * On match:
 *   - The factory name is added to `out.modelFactoryNames` so
 *     `emitRegistrations` knows to skip its `business_logics` emission.
 *   - One `logical_data_entities` candidate is emitted with
 *     `data.source = 'model-factory'`.
 *   - One `logical_data_attributes` candidate is emitted per detected
 *     field, parented to the entity.
 *   - The name is also added to `out.logicalEntityNames` so the
 *     `emitInterfaceLogicalEntities` cross-link pass can see it (the
 *     deduped `emitLogicalEntities` won't re-emit because the entity
 *     candidate already exists).
 *
 * Added 2026-04-29 (improvement #4a — Kiro/Opus 4.6 analysis).
 */
const MODEL_FACTORY_NAME_RE = /^[A-Z][A-Za-z0-9]*$/;
const MODEL_FACTORY_NAME_NEGATIVE_SUFFIX_RE =
  /(Service|Controller|Factory|Provider|Manager|Validator|Resolver|Helper|Utils?|Adapter|Mapper|Builder|Resource|Endpoint|Listener|Filter|Interceptor|Directive|Component|Module|Config|Run|App|Api|Client|Gateway)$/;

function emitModelFactoryEntities(
  file: SourceFileIR,
  runId: string,
  out: AdapterOutput,
): void {
  if (!file.rawContent) return;

  // 1) Find all `.factory(<PascalCaseNonService>, fn)` registrations.
  type Reg = { name: string; line: number };
  const factories: Reg[] = [];
  for (const c of file.allCalls ?? []) {
    if (lastMemberSegment(c.callee) !== 'factory') continue;
    if (c.args.length < 2) continue;
    const name = asStringLiteral(c.args[0]);
    if (!name) continue;
    if (!MODEL_FACTORY_NAME_RE.test(name)) continue;
    if (MODEL_FACTORY_NAME_NEGATIVE_SUFFIX_RE.test(name)) continue;
    factories.push({ name, line: c.line });
  }
  if (factories.length === 0) return;
  factories.sort((a, b) => a.line - b.line);

  // 2) Char-index → 1-based line lookup for the rawContent regex matches.
  const lineStartOffsets: number[] = [0];
  for (let i = 0; i < file.rawContent.length; i++) {
    if (file.rawContent.charCodeAt(i) === 10) lineStartOffsets.push(i + 1);
  }
  const offsetToLine = (off: number): number => {
    let lo = 0;
    let hi = lineStartOffsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStartOffsets[mid] <= off) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  // 3) Match `this.<attr> = <rhs>` and post-filter out method assignments.
  // The RHS is captured up to `;` or newline so we can inspect it cheaply
  // — function literals (`function() {…}`, `new Function(…)`, arrow
  // functions `(x) => …`) all start with recognisable tokens. Pure data
  // assignments (`this.id = data.id;`) don't match those patterns.
  const fieldRe = /\bthis\s*\.\s*(\w+)\s*=\s*([^;\n]+)/g;
  const fieldsByFactory = new Map<string, Set<string>>();
  for (const f of factories) fieldsByFactory.set(f.name, new Set());
  let m: RegExpExecArray | null;
  while ((m = fieldRe.exec(file.rawContent)) !== null) {
    const attr = m[1];
    const rhs = (m[2] || '').trim();
    if (!attr || attr === 'constructor' || attr === 'prototype') continue;
    // Skip function-valued RHS (those are methods, picked up by
    // emitServiceMethods as business_logics).
    if (/^function\b/.test(rhs)) continue;
    if (/^new\s+(?:Function|function)\b/.test(rhs)) continue;
    if (/^\([^)]*\)\s*=>/.test(rhs)) continue; // arrow function `(x) => …`
    if (/^\w+\s*=>/.test(rhs)) continue;        // arrow function `x => …`
    if (/^async\s+function\b/.test(rhs)) continue;

    const matchLine = offsetToLine(m.index);
    let owner: Reg | null = null;
    for (const reg of factories) {
      if (reg.line <= matchLine) owner = reg;
      else break;
    }
    if (!owner) continue;
    fieldsByFactory.get(owner.name)!.add(attr);
  }

  // 4) Emit. Gate: ≥ 2 fields per factory (single field is too weak a
  // signal — a service factory could happen to do `this.cache = {}` once).
  for (const f of factories) {
    const attrs = fieldsByFactory.get(f.name)!;
    if (attrs.size < 2) continue;
    if (out.modelFactoryNames.has(f.name)) continue; // duplicate guard across files

    out.modelFactoryNames.add(f.name);
    out.logicalEntityNames.add(f.name);

    const entityCand = makeCandidate(
      'logical_data_entities',
      f.name,
      file.filePath,
      {
        className: f.name,
        source: 'model-factory',
      },
      runId,
    );
    out.candidates.push(entityCand);

    for (const attr of attrs) {
      out.candidates.push(
        makeCandidate(
          'logical_data_attributes',
          attr,
          file.filePath,
          {
            fieldName: attr,
            logicalEntityName: f.name,
          },
          runId,
          entityCand.id,
        ),
      );
    }
  }
}

/**
 * Apply HTML template scan results: for each HTML file, add any
 * directives/controllers it references to the pack's output. Template
 * findings only REINFORCE — they never create standalone candidates for
 * names the .js side didn't also declare.
 */
function reinforceFromTemplates(
  htmlResults: Map<string, HtmlTemplateScanResult>,
  runId: string,
  out: AdapterOutput,
): void {
  void runId; // reserved for future: maybe promote controllers here
  // For each template, if it references a controller we DID detect in .js,
  // append the template's path to that candidate's sourceClusterIds so
  // reviewers can navigate between both source surfaces.
  for (const [templatePath, res] of htmlResults) {
    for (const ctrl of res.controllers) {
      const id = out.controllersByName.get(ctrl);
      if (!id) continue;
      const cand = out.candidates.find((c) => c.id === id);
      if (cand && !cand.sourceClusterIds.includes(templatePath)) {
        cand.sourceClusterIds.push(templatePath);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

/**
 * Run the AngularJS 1.x classic adapter over a set of IR files + raw HTML
 * templates. Returns a flat array of DiscoveryCandidate.
 *
 * The second parameter is the raw source-file map so we can find `.html`
 * templates — the IR map doesn't include them (language pack only extracts
 * `.js`). Callers pass the unfiltered map straight through.
 */
export function runAngularJsClassicAdapter(
  files: SourceFileIR[],
  runId: string,
  rawSourceFiles?: Map<string, string>,
): DiscoveryCandidate[] {
  const out: AdapterOutput = {
    candidates: [],
    controllersByName: new Map(),
    modulesByName: new Map(),
    endpointCallSites: [],
    logicalEntityNames: new Set(),
    modelFactoryNames: new Set(),
  };

  // Pass 1 — module declarations.
  for (const f of files) emitModules(f, runId, out);
  // Pass 1b — model-factory detection (2026-04-29 improvement #4a). Must
  // run BEFORE emitRegistrations so the latter can skip the
  // `business_logics` emission for factory names that turn out to be
  // model classes.
  for (const f of files) emitModelFactoryEntities(f, runId, out);
  // Pass 2 — registrations (controllers / services / directives / filters / etc.).
  for (const f of files) emitRegistrations(f, runId, out);
  // Pass 2b — methods inside registered service / factory / controller bodies
  // (2026-04-29 improvement #1). Must run after Pass 2 because attribution
  // uses the registration list collected here, but doesn't depend on it
  // having candidate ids — only the (name, line) pairs.
  for (const f of files) emitServiceMethods(f, runId, out);
  // Pass 3 — routes (also reclassifies controllers → screens).
  for (const f of files) emitRoutes(f, runId, out);

  // Pass 3b — `.constant('API', {KEY: '/url', ...})` URL bundles
  // (2026-04-29 improvement #1c). Runs before the main endpoint pass so
  // the api-constant rows are present in `out.candidates` for any
  // downstream interface_logical_entities cross-link logic.
  for (const f of files) emitApiConstantEndpoints(f, runId, out);

  // Pass 4 — HTTP endpoints + logical entity collection. We also track
  // per-file maps so the interface_logical_entity pass can link them.
  const perFileControllers = new Map<string, string[]>();
  const perFileEntities = new Map<string, string[]>();
  for (const f of files) {
    const before = new Set(out.logicalEntityNames);
    emitEndpoints(f, runId, out);
    const added: string[] = [];
    for (const n of out.logicalEntityNames) if (!before.has(n)) added.push(n);
    if (added.length > 0) perFileEntities.set(f.filePath, added);
    // Controllers declared in this file (scan allCalls again cheaply).
    const ctrlsInFile: string[] = [];
    for (const c of f.allCalls ?? []) {
      if (lastMemberSegment(c.callee) === 'controller' && c.args.length >= 2) {
        const name = asStringLiteral(c.args[0]);
        if (name) ctrlsInFile.push(name);
      }
    }
    if (ctrlsInFile.length > 0) perFileControllers.set(f.filePath, ctrlsInFile);
  }

  // Pass 5 — emit logical_data_entities for $resource names.
  if (out.logicalEntityNames.size > 0 && files.length > 0) {
    emitLogicalEntities(files[0], runId, out);
  }

  // Pass 6 — interface_logical_entities per file.
  for (const f of files) {
    const ctrls = perFileControllers.get(f.filePath) ?? [];
    const ents = perFileEntities.get(f.filePath) ?? [];
    emitInterfaceLogicalEntities(f, runId, out, ctrls, ents);
  }

  // Pass 7 — HTML template reinforcement.
  if (rawSourceFiles) {
    const htmlResults = new Map<string, HtmlTemplateScanResult>();
    for (const [path, contents] of rawSourceFiles) {
      if (!isHtmlTemplateFile(path)) continue;
      try {
        htmlResults.set(path, scanHtmlTemplate(contents));
      } catch {
        // best-effort — a malformed template shouldn't kill the pack run
      }
    }
    reinforceFromTemplates(htmlResults, runId, out);
  }

  return out.candidates;
}

/**
 * Returns `CallIR[]` (unused export) — helper for tests to verify the
 * extractor's call capture. Kept here to avoid a circular dep; test
 * modules import from the adapter.
 */
export function _debugCalls(file: SourceFileIR): CallIR[] {
  return file.allCalls ?? [];
}
