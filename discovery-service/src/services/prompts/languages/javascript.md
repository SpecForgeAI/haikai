# JavaScript language guidance

JavaScript spans a much wider stylistic range than TypeScript: ES5
prototype-based classes, ES6+ class declarations, CommonJS, ESM,
mixed-module hybrids, IIFE-wrapped libraries, jQuery-style chaining,
and modern React all appear in real codebases — sometimes in the same
project. Type information is absent from the source; the LLM must
infer architectural roles from naming conventions, call-site shapes,
and module structure rather than from type annotations.

## Idioms to recognize

- **Prototype-based "classes" (ES5).** `function Foo() { this.x = 1; }`
  followed by `Foo.prototype.bar = function() { ... };` is the ES5
  class idiom. Constructor functions are PascalCase by convention;
  `new Foo()` produces an instance whose `__proto__` is
  `Foo.prototype`. The tree-sitter grammar surfaces these as
  `function_declaration` nodes — the extractor will NOT see a class.
  Treat capitalised function declarations whose body assigns to
  `this.*` as prototype-class constructors when the file also contains
  `Foo.prototype.* = ...` assignments. Inheritance is set up by
  `Foo.prototype = Object.create(Bar.prototype)` followed by
  `Foo.prototype.constructor = Foo` — verbose, easy to miss.
- **`Object.create` + factory pattern.** `function makeFoo(opts) {
  return Object.create(fooProto, { ... }); }` is the prototype-based
  factory idiom that pre-dates `class`. The factory function is
  lowercase + `make*` / `create*` / `*Factory` by convention; the
  prototype object is a sibling top-level `const fooProto = { ... }`.
  Surface the factory as a constructor-equivalent.
- **ES6+ `class` declarations.** Modern code uses `class Foo extends
  Bar { constructor() { super(); } method() { ... } }`. The extractor
  sees these via `class_declaration`. `static` methods, getters /
  setters (`get x() { ... }`), and private `#field` declarations are
  all standard. A `class` whose name ends in `Component` and which
  imports `react` is almost certainly a React class component, even
  without a `render()` method visible in single-file extraction.
- **CommonJS vs ESM.** CommonJS uses `require('foo')` +
  `module.exports = ...` / `exports.foo = ...`. ESM uses
  `import { foo } from 'foo'` + `export const foo = ...` /
  `export default foo`. A single project can mix both
  (e.g. `.mjs` is ESM, `.cjs` is CommonJS, `.js` is whatever the
  package.json `"type"` field says — `"module"` for ESM, `"commonjs"`
  for CJS). When extracting imports, walk both `import` declarations
  AND `require(...)` call expressions. CommonJS-only codebases
  (legacy Node, jQuery plugins) often use `module.exports = function
  (root, factory) { ... }` UMD wrappers — the actual exported value
  is hidden inside the IIFE.
- **IIFE module pattern.** `(function() { var private = ...; window.
  publicThing = function() { ... }; })();` was the pre-ES6 way to get
  module-level scoping. The IIFE body declares "private" vars; what
  it attaches to `window` / `global` / a passed-in namespace argument
  is the public surface. jQuery plugins almost universally wrap in
  `(function($) { ... })(jQuery);` — the `$` parameter is the jQuery
  reference; everything attached to `$.fn.*` inside the IIFE is a
  plugin method. The extractor sees the IIFE as a single anonymous
  function call; the contents are NOT separately surfaced as
  top-level declarations.
- **Closures as data hiding.** `function counter() { var n = 0;
  return { inc: function() { n++; }, get: function() { return n; }
  }; }` — the returned object's methods close over `n`, hiding it
  from the outside world. Recognise the closure-over-variable idiom
  as JavaScript's pre-ES6 equivalent of private fields.
- **Duck typing.** No type annotations. Functions accept whatever
  the caller passes; failures surface at runtime as `TypeError:
  undefined is not a function`. Convention compensates: a parameter
  named `cb` / `callback` / `done` / `next` is a function;
  `opts` / `options` / `config` is an object literal;
  `el` / `$el` / `node` / `target` is a DOM element / jQuery
  wrapper. Naming carries meaning the extractor cannot enforce.
- **Method chaining.** `arr.filter(p).map(f).reduce(g, 0)` — every
  array / string / promise method returns a new value of the same
  shape so calls chain. jQuery takes this further: `$('.foo').
  addClass('bar').on('click', handler).fadeIn(200)` mutates and
  returns the same wrapper, enabling fluent DOM manipulation.
  Underscore / lodash chains start with `_(arr).filter(...).
  map(...).value()` — the terminating `.value()` materialises the
  lazy chain.
- **Dynamic require / lazy import.** Inside a function body,
  `const foo = require('./foo')` runs lazily on first call.
  ESM equivalent is `const foo = await import('./foo')` (returns a
  Promise of the module namespace). Dynamic imports are how code is
  split for lazy loading; surface each unique dynamic-import target
  as a deferred-loading boundary.
- **Function expressions vs arrow functions.** `function() { ... }`
  binds its own `this` (set by the caller); `() => { ... }` captures
  `this` lexically (no rebinding). Arrow functions cannot be used as
  constructors (no `new`). Methods on objects-as-classes
  (`obj.method = function() { return this.x; }`) MUST be
  function-expressions, not arrows; arrows make `this` point at
  whatever enclosed the assignment.
- **`var` hoisting (legacy).** `var` declarations are hoisted to the
  top of their enclosing function (NOT block) scope. Old code
  declares `var` at the top of a function and reassigns later;
  newer code uses `let` / `const` (block-scoped, no hoisting). Mixed
  `var` / `let` / `const` in the same file usually signals a
  partially-modernised codebase.
- **Async patterns: callbacks, promises, async/await.** Three
  generations of async coexist:
  - **Callbacks (Node-style)**: `fs.readFile(path, function(err,
    data) { ... })`. Error always first.
  - **Promises**: `fetch(url).then(r => r.json()).then(data => ...).
    catch(err => ...)`.
  - **async/await**: `async function() { const r = await fetch(url);
    return r.json(); }`.
  A single file may use all three — function naming
  (`*Async`, `*Sync`, `*Cb`) sometimes hints, but not reliably.
- **JSX in plain JS (`.jsx`).** Same syntax as TSX, no type
  annotations. PascalCase function returning JSX = component;
  PascalCase + `*Page`/`*Screen`/`*View` = page component;
  inside `pages/` / `routes/` / `views/` directories also = page.
  Hooks are `use*` lowercase exports. Same conventions as React +
  TS, just without the type layer.

## Extraction nuances

- **Tree-sitter grammar selection.** The `extractJavaScriptIR`
  extractor rewrites file paths so `.jsx` → `.tsx` and `.js` /
  `.mjs` / `.cjs` → `.ts` before invoking the underlying
  tree-sitter-typescript parser. The TS grammar is a superset of
  ES6+ JavaScript so this works for modern code; ES5-only code
  also parses (TS accepts pre-ES6 syntax). After extraction, the
  IR's `language` field is re-tagged to `'javascript'` so
  downstream adapters can dispatch.
- **No type information.** `FunctionIR.returnType` will be the
  empty string `''` for almost all JS functions (no return-type
  annotation in the source). Adapters that key off return types
  (`react-axios-adapter` checking for `JSX.Element` /
  `ReactNode`) fall back to file-extension heuristics
  (`.jsx` + PascalCase + exported = treated as a component).
- **No interface declarations.** JS has no `interface` keyword. The
  extractor's `ClassIR.isInterface` field will always be `false`
  for JS IR. Logical-entity / DTO detection that relies on
  `isInterface` (the react-axios adapter does for TS) will not
  fire on JS files — DTOs in JS are typically plain object
  literals or JSDoc-typed classes; neither is detected.
- **JSDoc as type system.** Pre-TypeScript codebases used JSDoc
  `/** @type {Foo} */` / `@param {string} name` / `@returns
  {Promise<User>}` for type contracts. JSDoc is parsed by the
  TypeScript compiler when `--checkJs` is on and by IDEs for
  intellisense, but the tree-sitter extractor does NOT parse
  JSDoc. Consumers should read JSDoc blocks above declarations as
  business documentation, not as enforced types.
- **`module.exports` vs `export`.** CommonJS exports never appear
  as `export_statement` nodes. The extractor's `modifiers` field
  on classes / functions does NOT include `'export'` for
  `module.exports = Foo;` or `exports.bar = bar;` — those are
  simple assignment expressions. CommonJS-heavy codebases
  therefore appear under-exported to adapters that key off
  `modifiers.includes('export')`.
- **Bundled / minified files.** The fileFilter excludes `*.min.js`
  but other bundle outputs (`dist/bundle.js`, `lib/index.js`
  produced by webpack/rollup/parcel) typically slip through.
  Bundles concatenate many sources into one giant file with
  munged names — they emit lots of false candidates. Treat large
  files (>5000 lines) under `dist/` / `lib/` / `build/` /
  `.next/` / `out/` with skepticism.
- **Test files to skip.** `*.test.js` / `*.test.jsx` /
  `*.spec.js` / `*.spec.jsx` filename patterns; `__tests__/` /
  `tests/` / `test/` directories. Mocha / Jasmine / Jest /
  Vitest tests use `describe(...)` / `it(...)` /
  `test(...)` blocks at the top level — these emit no
  architectural candidates but are skipped by `isJsTestFile` so
  they never reach the adapter.
- **`node_modules` exclusion.** `filterJsFiles` excludes paths
  containing `/node_modules/` outright. Vendor code under
  `vendor/` or `external/` (jquery-ui style) is NOT excluded by
  default and may slip through; consumers should check the file
  path before treating a candidate as application code.
- **UMD wrapper boilerplate.** A common pre-ES6 export pattern is
  `(function(root, factory) { if (typeof define === 'function'
  && define.amd) define(factory); else if (typeof module ===
  'object' && module.exports) module.exports = factory(); else
  root.MyLib = factory(); }(this, function() { return MyLib; }));`.
  The extractor will see the outer IIFE as a function call and
  the inner `function MyLib() { ... }` as a nested function
  declaration. The actual library surface is whatever the inner
  factory returns — the extractor cannot trace that data flow.

## Confidence calibration for JavaScript

- PascalCase function in a `.jsx` file with `import React`: 0.9
  — almost certainly a React component, treat as `ui_components`
  / `ui_screens` per name convention.
- PascalCase function declaration whose body assigns to
  `this.*` AND whose name has a sibling
  `Foo.prototype.* = function...` assignment: 0.85 —
  prototype-class constructor, equivalent to an ES6 class.
- Plain function exported via `module.exports.foo = foo;` whose
  name has a domain verb: 0.7-0.8 as `business_logics` —
  conservative because CommonJS exports do not surface as the
  `'export'` modifier in IR.
- `$.fn.<name> = function(...)` assignment: 0.9 as a jQuery
  plugin definition (the adapter sees this as a
  `member_expression` assignment, NOT a class — surface
  separately).
- IIFE call site `(function($) { ... })(jQuery);` at file top
  level: signal that the file is a jQuery plugin. The adapter
  does not see "inside" the IIFE — surface the IIFE itself as
  a module boundary.
- `React.createClass({ ... })` call expression with object
  literal first argument: 0.85 as a legacy React class component
  (pre-class-syntax React, deprecated in 16+ but still found in
  old codebases).
- Module-level `const Foo = require('./Foo')` followed by
  `Foo.prototype.method = ...` re-opening: 0.7 as a
  cross-module prototype extension (rare, usually a code smell).
- File under `pages/` / `routes/` / `views/` exporting a
  PascalCase function: 0.85 as a `ui_screens` regardless of JSX
  presence in the visible source (the extractor may have
  inlined the JSX into a `React.createElement` call that no
  longer matches the JSX-return-type regex).
