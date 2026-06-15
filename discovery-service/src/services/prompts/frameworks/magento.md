# Magento framework guidance

A `magento` static analysis pack has already been run against this
file. Its output is injected into the prompt as a fenced JSON array.
You are here to surface what that pack CANNOT see — not to restate
what it already captured.

## What the adapter already catches (do NOT re-emit these)

- **Controllers** — classes whose `extends` clause matches a Magento
  1 LTS or Magento 2 controller base (`Mage_Core_Controller_*`,
  `\Magento\Framework\App\Action\Action`, or an `extends` name ending
  in `Action` / `AbstractAction`). Emitted as `interfaces` candidates
  with `controllerType: 'MagentoController'`.
- **Models / entities** — classes whose `extends` clause matches
  `Mage_Core_Model_Abstract`, `AbstractModel`, or
  `Framework.*AbstractModel` (Magento 2). Emitted as `physical_data_entities`
  candidates with a naive lowercase table-name inference.
- **Blocks / UI components** — classes whose `extends` clause matches
  `Mage_Core_Block_*`, `AbstractBlock`, or `Template`. Emitted as
  `ui_components` candidates with `component_type: 'other'` and
  `magentoBlock: true`.

Anything in that list is presumed ALREADY PRESENT in the pack output.
Emitting duplicates of those is the primary failure mode for this
layer.

## What the adapter MISSES (your target surface area)

Magento is notoriously convention-over-code — the vast majority of
architectural signals live in XML config files, NOT class inheritance.
The adapter deliberately does NOT parse XML, so a large surface area
is invisible to it. Typical blind spots:

- **`etc/module.xml`** — declares the module's name, version, and
  sequence (load-order dependencies). Each `<module name="...">`
  registration identifies a first-class feature unit. Surface each
  module as a logical-component candidate.
- **`etc/events.xml` observers.** `<event name="...">` +
  `<observer instance="Vendor\Module\Observer\Foo" />`
  wire up event listeners across the platform. Each
  `(event_name, observer_class)` pair is a cross-cutting attachment
  point the adapter cannot see because the observer class itself
  usually doesn't extend a detectable base.
- **`etc/di.xml`** — the dependency-injection wiring file declares
  interface preferences (`<preference for="X" type="Y" />`), virtual
  types (`<virtualType name="..." type="..." />`), and plugins /
  interceptors (`<plugin name="..." type="Vendor\Module\Plugin\Foo"
  />`). Interceptors run before / after / around existing class
  methods — they are a uniquely Magento architectural pattern with no
  equivalent in other frameworks. Each `<plugin>` declaration is a
  cross-cutting concern candidate.
- **Plugins / interceptors.** The plugin classes themselves expose
  `beforeMethodName(...)`, `aroundMethodName(...)`, and
  `afterMethodName(...)` methods that intercept calls on the target
  class declared in `di.xml`. These methods encode real cross-cutting
  logic (logging, authorization, cache invalidation, audit
  trails). The adapter sees the class but cannot know which target
  methods it intercepts.
- **Observers.** Observer classes implementing `ObserverInterface`
  (Magento 2) or responding to `Mage::dispatchEvent(...)` calls
  (Magento 1). Each observer's `execute($observer)` method
  encodes domain logic (order state transitions, inventory updates,
  audit trails). Surface as business-logic candidates.
- **`etc/crontab.xml` cron jobs.** `<group id="default"><job
  name="my_job" instance="Vendor\Module\Cron\Foo" method="execute"
  /></group>` registers scheduled background work. Each
  `(cron_job_name, handler_class.method, schedule)` triple is a
  background-job candidate.
- **Layout XML.** `view/frontend/layout/<handle>.xml` and
  `view/adminhtml/layout/<handle>.xml` wire blocks into page
  layouts. Each `<referenceContainer name="...">` +
  `<block class="..." />` pair is a UI-composition candidate the
  block-class detection alone cannot surface.
- **UI component XML.** `view/*/ui_components/*.xml` declares
  data grids, forms, and other admin UI components
  declaratively. Each component is a UI-component candidate
  distinct from any PHP class.
- **`etc/webapi.xml` REST endpoints.** Magento 2 REST API routes are
  declared in `webapi.xml`: `<route url="/V1/products/:sku"
  method="GET"> <service class="Vendor\Module\Api\ProductRepositoryInterface"
  method="get" /> ...`. Each route + service-interface pair is an
  `endpoints` candidate.
- **`etc/acl.xml` ACL resources.** Access control list entries for
  admin menu items and operations. Each ACL resource is a
  cross-cutting security candidate.
- **`etc/config.xml` / `etc/system.xml`.** Default module configuration
  and admin configuration form definitions. Each `<section>` in
  `system.xml` exposes an admin configuration surface.
- **`Setup/InstallSchema.php` / `Setup/UpgradeSchema.php` / `db_schema.xml`.**
  Declarative schema definitions — the source of truth for table
  and column layout. Not PHP-class inheritance but architecturally
  critical. The adapter's entity detection sees the PHP model class
  but not the underlying table / column definitions.
- **Resource models (`Vendor\Module\Model\ResourceModel\Foo`).**
  Classes extending `Mage_Core_Model_Mysql4_Abstract` (M1) or
  `\Magento\Framework\Model\ResourceModel\Db\AbstractDb` (M2) handle
  persistence for a given entity. The adapter's `MODEL_BASE_RE`
  pattern may miss these — they are a separate architectural layer
  from the domain model.
- **Collection classes (`Model\ResourceModel\Foo\Collection`).**
  Classes extending `Mage_Core_Model_Mysql4_Collection_Abstract`
  (M1) or `\Magento\Framework\Model\ResourceModel\Db\Collection\AbstractCollection`
  (M2) encapsulate reusable query logic. Each collection is a
  domain-query candidate.
- **Service contracts (M2).** Interfaces under `Api/` and
  `Api/Data/` declare the public REST-safe API surface of a module
  (repositories, data DTOs). The adapter does not specifically
  detect these.
- **`registration.php`.** Each module ships a `registration.php`
  that calls `\Magento\Framework\Component\ComponentRegistrar::register(...)`
  to register the module. Functional equivalent of a bundle
  declaration.

## Instruction

Read the pack-output JSON block injected into this prompt carefully.
For each candidate you consider emitting, check that the
`(type, name, filePath)` tuple is NOT already represented in the pack
output (after case-insensitive, whitespace-collapsed name comparison).
If it is, drop it. Emit ONLY the genuine misses.

## Gap-fill targets (11th candidate type)

- **`interface_logical_entities`.** This framework's pack does NOT yet emit `interface_logical_entities` candidates. When an `interfaces` candidate (API controller, resolver, handler class) in this file references a `logical_data_entities` candidate (DTO, request/response body type) that is also defined somewhere in the project, emit an `interface_logical_entities` candidate named `InterfaceClass → LogicalDataEntityClass` (ASCII arrow, single spaces). Per-interface granularity — one entry per (interface, logical_data_entity) pair regardless of how many endpoints reference the DTO.
