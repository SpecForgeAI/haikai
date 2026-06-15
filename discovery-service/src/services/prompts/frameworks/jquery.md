# jQuery framework guidance

A `jquery` static analysis pack has already been run against this
file. Its output is injected into the prompt as a fenced JSON array.
You are here to surface what that pack CANNOT see — not to restate
what it already captured.

jQuery is a DOM-manipulation library, not an MVC framework. Its
"architecture" is whatever conventions a particular codebase
imposes — there is no canonical structure. The deterministic adapter
covers a tiny slice of the typical jQuery codebase: literal-string
`$.ajax` / `$.get` / `$.post` calls and the `$.widget('namespace.
name', ...)` widget-factory syntax. Most real jQuery codebases (and
in particular the `jquery-ui` library itself, which the adapter emits
0 candidates against — see `evaluation/FIXTURES-TODO.md`) use
patterns the adapter does NOT match. Your job is to surface those
patterns.

## What the adapter already catches (do NOT re-emit these)

- **`$.ajax({url, method})` calls** with literal options object —
  emitted as `endpoints` candidates with `httpMethod`, `url`,
  `apiLibrary: 'jQuery'`, `callingFunction`, and
  `endpoint_subtype: 'api_call'`. The adapter parses the options
  object via regex (very loose) — it requires the literal `url:`
  key with a string-literal value.
- **`$.get(url)` / `$.post(url)` / `$.put(url)` / `$.delete(url)` /
  `$.patch(url)` / `$.getJSON(url)` calls** with a string-literal
  first argument — emitted as `endpoints` candidates with the
  inferred HTTP method.
- **`$.widget('namespace.name', { ... })` calls** — emitted as
  `ui_components` candidates with the widget name. Requires the
  first argument to be a string literal.

That is the entire deterministic surface — three call-site shapes,
all requiring literal first arguments. Anything outside this list is
your target surface area.

## What the adapter MISSES (your target surface area)

This pack misses almost everything. The `jquery-ui` library itself
emits 0 candidates because every pattern jquery-ui uses falls into
one of the categories below.

- **`$.fn.<pluginName> = function() { ... }` plugin definitions.**
  The canonical jQuery plugin pattern: `$.fn.myPlugin = function(
  options) { return this.each(function() { ... }); };`. Each
  plugin is a UI behaviour attached to the jQuery wrapper. The
  adapter does NOT detect these — it only sees `$.widget(...)`
  call expressions. Surface each `$.fn.<name>` assignment as a
  `ui_components` candidate. The plugin-options object passed in
  (when documented at the top of the file or via JSDoc) is the
  plugin's configuration contract.
- **`$.widget.bridge` and prototype-based widget definitions.**
  jquery-ui defines widgets via `$.widget("ui.dialog", $.ui.
  mouse, { ... })` (with a base prototype, three-argument form)
  AND via `$.widget("ui.dialog", { ... })` (single base, two-
  argument form). The adapter ONLY matches the `$.widget('ns.
  name', proto)` pattern when the first argument is a literal
  string AND the call is detected at the top level of a function
  body. Inside an IIFE wrapper (`(function($) { $.widget(...);
  }(jQuery));`) — the canonical jquery-ui pattern — the call is
  nested inside an anonymous function call expression and the
  adapter's `processCalls` walker does NOT recurse into nested
  function bodies that are immediately invoked. **Every jquery-
  ui widget is missed for this reason.** Surface each widget by
  recognising the `$.widget('ui.<name>', ...)` call inside an
  IIFE.
- **Event delegation via `.on('event', selector, handler)`.**
  `$('.parent').on('click', '.child', function(e) { ... })` is
  the modern delegated-event pattern. The handler runs whenever
  a click lands on `.child` even if `.child` is added to the
  DOM after the binding. Each `.on(event, selector, handler)`
  call is an event-handler registration. The adapter does NOT
  see `.on(...)` calls — they emit zero candidates. Surface
  each as an event-binding boundary with the event type +
  delegated selector.
- **Direct event method calls.** `$('.btn').click(handler)`,
  `$('.input').change(handler)`, `$('form').submit(handler)`,
  `$('.tab').hover(enterFn, leaveFn)`, `$(document).ready(fn)`.
  Each is shorthand for `.on(eventName, handler)`. Same as
  above — none are surfaced.
- **DOM-ready handlers.** `$(document).ready(function() { ... })`
  / `$(function() { ... })` (shorthand) is the canonical "run
  this when the DOM is ready" wrapper. Almost every jQuery
  codebase has at least one. The adapter does not recognise
  it as a lifecycle hook. Surface as a top-level
  initialisation boundary.
- **`$.ajaxSetup(...)` global AJAX defaults.** Configures
  default options (error handlers, headers, beforeSend
  interceptors) for ALL subsequent `$.ajax` calls in the
  page. Cross-cutting; surface as application-wide
  configuration.
- **`$.fn.extend({ ... })` and `$.extend($.fn, { ... })`
  bulk plugin definitions.** Equivalent to multiple `$.fn.<name>
  = ...` assignments at once. The adapter sees the call
  expression but does not enumerate the keys of the object
  literal — each key is a separate plugin method.
- **`$.extend($.foo, { ... })` namespace augmentation.** Adds
  helpers under the `$.foo.*` namespace. Cross-cutting library
  surface; the adapter ignores this.
- **AJAX with non-literal URL or method.** `$.ajax(opts)` where
  `opts` is a previously-built object, or `$.ajax({url: baseUrl
  + '/' + id, method: getMethodFor(action)})` — the regex-based
  options parser fails because the values are not string
  literals. Surface as `endpoints` candidates with the
  expression-derived URL pattern (e.g. `${baseUrl}/<id>`).
- **`$.ajax` callback-driven success/error handlers.** The
  options object includes `success: function(data) { ... }`,
  `error: function(xhr, status, err) { ... }`, `complete:
  function(...) { ... }`, `beforeSend: function(xhr) { ... }`.
  Each callback is a side-effect surface — `success` typically
  invokes the next state mutation; `error` typically shows a
  user-visible error. Surface significant callbacks as the
  endpoint's downstream behaviour.
- **Promise-style chained AJAX.** `$.ajax(opts).done(handler).
  fail(handler).always(handler)` is the post-1.5 jQuery
  promise-chain idiom. The adapter does not walk
  `.done` / `.fail` / `.always` / `.then` chains.
- **`$.getJSON / $.getScript / $.load` shorthand.** `$.getJSON
  ('/api/x', function(data) { ... })` matches the adapter's
  shorthand list — verify your output does not duplicate it.
  `$.getScript('/lib/foo.js')` and `$.fn.load('/template.html')`
  load remote assets and are NOT detected.
- **Custom HTML data attributes (`data-*`).** `$('[data-toggle=
  "modal"]').on('click', handler)` — the `data-toggle` attribute
  is a JS-side convention for marking UI elements. Bootstrap's
  entire JS layer is built on `data-toggle` / `data-target` /
  `data-dismiss`. Surface significant `data-*` attribute
  selectors as an HTML / JS interaction contract.
- **jQuery UI widget instantiation.** `$('.dialog').dialog({
  title: 'Foo', modal: true });` — the second-argument options
  object is the widget's configuration. Each instantiation is
  a UI element with a specific configuration; the options
  object encodes business-meaningful settings (modal vs
  modeless, draggable vs fixed, autoOpen on/off).
- **Widget factory registration patterns.** `$.widget.bridge(
  'myPlugin', $.MyPluginClass)` adds a `$.fn.myPlugin` shim that
  delegates to a class. `$.widget` itself returns a constructor
  function that callers can `new`. Classes registered this way
  are widgets even though no `$.widget(...)` call directly
  defines them.
- **Traversal chain patterns.** `$('.foo').find('.bar').
  closest('.baz').parents('.qux').children('.quux').
  siblings('.corge').first()` — long traversal chains often
  encode an HTML structural assumption that is brittle to
  template changes. The adapter does not surface traversal
  chains; surface significant ones as a coupling between JS
  and the HTML structure.
- **`$(this)` context capture inside event handlers.** Inside
  `function(e) { var $this = $(this); ... }`, the `$(this)`
  reference is the DOM element that triggered the event —
  jQuery-wrapped. The adapter does not surface this pattern.
- **Animation chain DSL.** `$('.el').fadeIn(200).delay(500).
  slideUp(300).queue(function() { $(this).remove(); next(); })`
  — animation queues encode timed UI behaviour. The adapter
  does not surface animations.
- **`$.Deferred()` (legacy promise).** `var d = $.Deferred(); ...
  d.resolve(value); ... return d.promise();` — pre-ES6 promise
  pattern still used in some plugin code. The adapter does not
  detect Deferred returns; treat them as promise-returning
  surface.

## Instruction

Read the pack-output JSON block injected into this prompt carefully.
For each candidate you consider emitting, check that the
`(type, name, filePath)` tuple is NOT already represented in the pack
output (after case-insensitive, whitespace-collapsed name comparison).
If it is, drop it. Emit ONLY the genuine misses.

Note: this pack is known severely under-emitting on real-world repos
(`jquery-ui` baseline: 0 candidates across the entire library). The
LLM gap-fill stage is responsible for nearly the entire jQuery
detection surface — prioritise widget definitions
(`$.fn.<name>` and `$.widget('ui.<name>', ...)` inside IIFEs),
event delegation (`.on(event, selector, handler)`), and AJAX with
non-literal arguments, in that order.

## Gap-fill targets (11th candidate type)

- **`interface_logical_entities`.** This framework's pack does NOT yet emit `interface_logical_entities` candidates. When an `interfaces` candidate (API controller, resolver, handler class) in this file references a `logical_data_entities` candidate (DTO, request/response body type) that is also defined somewhere in the project, emit an `interface_logical_entities` candidate named `InterfaceClass → LogicalDataEntityClass` (ASCII arrow, single spaces). Per-interface granularity — one entry per (interface, logical_data_entity) pair regardless of how many endpoints reference the DTO.
