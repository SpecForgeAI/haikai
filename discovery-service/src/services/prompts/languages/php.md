# PHP language guidance

## Idioms to recognize

- **Magic methods as role markers.** PHP supports a family of magic
  methods that make a class's runtime surface opaque to static
  extraction:
  - `__call($name, $args)` / `__callStatic($name, $args)` — method
    dispatch for undefined methods. Heavily used by ActiveRecord-style
    ORMs (Eloquent, Doctrine repositories), Laravel Facades, and
    service-locator patterns. A class with `__call` likely exposes many
    more methods than its `def` / `function` lines suggest.
  - `__get($name)` / `__set($name, $value)` — property accessors for
    undefined properties. Used by Eloquent attribute access, CodeIgniter
    loaders, and dynamic config objects. The field list you see is a
    lower bound, not a ceiling.
  - `__invoke($args)` — makes a class callable as a function. Common
    for command objects, middleware pipelines, validators, and DI
    container factories (`$result = $handler($request)`).
  - `__isset` / `__unset` — paired with `__get` / `__set` for
    `isset($obj->foo)` semantics on dynamic properties.
- **Traits for horizontal composition.** `trait Timestampable { public
  function touch() { ... } } class Article { use Timestampable; }` —
  traits inject methods and properties into classes at compile time.
  `use TraitA, TraitB;` composes multiple traits. Treat `use`
  declarations at class-body top as behaviour wiring, not imports.
- **Namespaces and `use` as imports.** PHP uses `\` as the namespace
  separator (`namespace App\Controller; use Symfony\Component\Routing\Route;`).
  Unqualified class references in a namespaced file resolve against
  the file's `use` declarations first, then the current namespace.
  When the extractor reports `extends AbstractController`, the real
  fully-qualified name is determined by the file's `use` list — look
  there to disambiguate Symfony vs Laravel vs a domain-local
  `AbstractController`.
- **Closures with `Closure::bind` / `bindTo`.** `$closure = function ()
  { return $this->secret; }; $bound = Closure::bind($closure,
  $someObject, SomeClass::class);` — lets closures access private /
  protected members. Used by testing helpers, DSL builders, and some
  framework internals. Behaviour flows through closures that may not
  appear as methods on the class they operate on.
- **Anonymous classes.** `new class extends AbstractCommand { public
  function execute() { ... } }` — inline class definitions, common for
  testing doubles, short-lived command objects, and one-off
  implementations of single-method interfaces. The anonymous class has
  no name the extractor can surface as a class candidate; treat the
  enclosing expression's role as the meaningful surface.
- **PHP 8 attributes.** `#[Route('/api/users')]`, `#[ORM\Entity]`,
  `#[AsController]`, `#[AsCommand(name: 'app:sync')]` — declarative
  metadata replacing the older PHPDoc `@Annotation` style. Each
  attribute is a class constructor call; arguments can be positional
  or named (`methods: ['POST']`). The extractor surfaces attributes
  on classes, methods, properties, and parameters.
- **PHPDoc annotations (legacy but widespread).** `/** @Route("/items")
  @ORM\Entity */` — older Symfony / Doctrine / OpenAPI tooling reads
  metadata from PHPDoc comments rather than PHP 8 attributes. The
  current extractor does NOT parse PHPDoc — classes that rely on
  `@Route` / `@ORM\Entity` annotations in comments will appear
  unannotated. Surface them as gap-fill candidates based on docblock
  conventions.
- **Static factories / singletons.** `MyModel::create([...])`,
  `Mage::getModel('catalog/product')`, `Container::getInstance()`,
  `App::make(...)` — static methods that return new objects. Common
  in Magento, Laravel, CodeIgniter. Follow the return type (or
  `@return` in PHPDoc) to resolve the produced class.
- **Variadic `...$args` / splat unpacking.** `function handle(...$args)
  { return $this->pipe(...$args); }` — used extensively in framework
  plumbing. A variadic method is often a fan-out dispatcher.
- **Type hints and return types.** Modern PHP (7.4+) supports
  parameter types, return types, nullable `?Type`, union `Type|null`,
  intersection `TypeA&TypeB`, and `self` / `static` / `mixed` /
  `never` pseudo-types. Their presence signals a modern codebase and
  makes role inference more reliable than typeless legacy code.
- **Enums (PHP 8.1+).** `enum Status: string { case Active = 'active';
  case Inactive = 'inactive'; }` — first-class type-safe enums,
  replacing the older `class Status { const ACTIVE = 'active'; }`
  pattern. Recognize enum classes as state / option candidates.

## Extraction nuances

- **Tree-sitter-php class bodies.** Class-level PHP 8 attributes
  render as `attribute_list` nodes preceding the class declaration.
  Method / property attributes render the same way. The extractor
  captures these into the `annotations` arrays on the class, method,
  and field IR nodes.
- **Vendor code.** Packages installed via Composer live under
  `vendor/`. Skip it unconditionally — these are third-party
  dependencies, not the project's architecture. The `filterPhpFiles`
  helper already drops `vendor/` from the source-file map.
- **Test files.** PHPUnit / Codeception / Pest test suites live under
  `tests/`, `test/`, or ship `*Test.php` / `*Spec.php` suffixes.
  Skip.
- **Template files.** `.phtml` files and theme partials (WordPress
  `wp-content/themes/*.php`, Magento `app/design/*/*.phtml`) mix HTML
  and PHP. The pack filter includes `.phtml`, but these files
  frequently contain too much presentation noise to usefully extract —
  treat candidates from templates with lower confidence unless there
  is clear business logic embedded.
- **Generated code.** Doctrine proxies (`Proxies/__CG__*.php`), Symfony
  cache (`var/cache/`), framework-generated config caches. Skip.
- **`switch` / `match` statements on string keys.** PHP match
  expressions (`match ($type) { 'user' => ..., 'admin' => ... }`) are
  architectural — each arm is often a state or command. Legacy
  `switch` statements on string-enum-like values carry the same
  signal.
- **Global functions.** `function register_my_plugin() { ... }` at
  module scope — procedural functions outside any class. Common in
  WordPress plugins / themes and legacy PHP (CodeIgniter 2.x
  controllers). Emit top-level functions when they are registered as
  hook callbacks or REST endpoints.
- **File includes.** `require`, `require_once`, `include`,
  `include_once` — dynamic file loading, frequently used in legacy
  PHP to wire plugins. The extractor does NOT follow includes; files
  must be present in the source map to contribute IR.

## Confidence calibration for PHP

- Class with a PHP 8 attribute matching a known framework vocabulary
  (`#[Route]`, `#[ORM\Entity]`, `#[AsController]`) AND a conforming
  name pattern (`*Controller`, `*Entity`): 0.9+.
- Class extending a well-known framework base (`AbstractController`,
  `AbstractModel`, `WP_REST_Controller`, `WP_Widget`,
  `Mage_Core_Model_Abstract`, `Eloquent\Model`): 0.85-0.95.
- Class extending a base whose name ends with `Controller` / `Model`
  / `Block` in a framework-conventional directory: 0.75-0.85.
- PHPDoc `@Route` / `@ORM\Entity` annotation only (no PHP 8
  attribute): 0.6-0.75 (the pack misses these; emit as gap-fill).
- Class using `__call` / `__get` / `__invoke` — opaque surface: 0.55
  -0.7; state the assumption and lower confidence.
- Anonymous class or function inside a closure — context-dependent:
  0.5-0.7.
- Legacy procedural function outside any class in a non-WordPress
  codebase: 0.5-0.65 (may or may not be architectural).
