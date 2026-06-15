# WordPress framework guidance

A `wordpress` static analysis pack has already been run against this
file. Its output is injected into the prompt as a fenced JSON array.
You are here to surface what that pack CANNOT see — not to restate
what it already captured.

## What the adapter already catches (do NOT re-emit these)

- **REST API endpoints** — calls to `register_rest_route('namespace',
  '/path', ...)` inside a function body are emitted as `endpoints`
  candidates. The full path (`namespace/path`) and the HTTP method (if
  declared in the array's `methods` key) are inferred.
- **Custom post types and taxonomies** — calls to
  `register_post_type('type', ...)` and `register_taxonomy('taxonomy',
  ...)` are emitted as `physical_data_entities` candidates.
- **REST controller classes** — classes extending `WP_REST_Controller`
  (and common subclass bases) are emitted as `interfaces` candidates.
- **Widget classes** — classes extending `WP_Widget` are emitted as
  `ui_components` candidates.
- **WooCommerce abstract bases** — classes extending `Abstract_WC_*`
  types are emitted as `physical_data_entities` / `interfaces` candidates
  depending on the abstract's role.
- **Plugin / theme hook registration call sites** — the adapter scans
  function and method call bodies for the above `register_*` calls
  specifically.

Anything in that list is presumed ALREADY PRESENT in the pack output.
Emitting duplicates of those is the primary failure mode for this
layer.

## What the adapter MISSES (your target surface area)

WordPress is primarily a PROCEDURAL, event-driven PHP codebase. Most
architectural signals live in hook registrations and options, not in
class inheritance. Typical blind spots:

- **Plugin and theme headers.** The top docblock in a plugin bootstrap
  file (`Plugin Name:`, `Version:`, `Author:`, `Description:`,
  `Requires at least:`) identifies the plugin as a first-class unit.
  Surface the plugin / theme as a logical component candidate; the
  pack does not parse header comments.
- **Hook registration call sites (`add_action`, `add_filter`).**
  `add_action('init', 'my_plugin_init')` and `add_filter('the_content',
  [$this, 'filter_content'], 10, 2)` are where plugins actually wire
  their behaviour into WordPress's event loop. Each registration is
  an architectural attachment point. Surface notable
  `(hook_name, callback)` pairs — especially those registering
  cross-cutting concerns (`wp_enqueue_scripts`,
  `admin_menu`, `admin_init`, `save_post`, `wp_login`).
- **Hook-callback semantic intent.** The callback function /
  method referenced by `add_action('save_post', 'maybe_send_email')`
  often encodes real domain logic but the pack only sees the
  registration, not what the callback actually does. Read the callback
  body and surface its intent as a business-logic candidate.
- **Options API.** `get_option('my_plugin_settings')` /
  `update_option('my_plugin_settings', ...)` / `add_option(...)` call
  sites identify persistent config. Paired reads and writes on the
  same option name identify the option as a de-facto entity. Surface
  each notable `option_name` as a configuration / logical-entity
  candidate distinct from the PHP class that reads it.
- **Shortcodes.** `add_shortcode('my_shortcode', 'my_shortcode_cb')`
  registers a template-level DSL token. Each shortcode is a
  UI / integration surface exposed to content authors. Surface each
  `(shortcode, callback)` pair.
- **Admin pages.** `add_menu_page()`, `add_submenu_page()`,
  `add_options_page()`, `add_theme_page()`, `add_plugins_page()`,
  `add_users_page()` register backend admin screens. Each
  registration is a UI component the pack does not detect.
- **REST API endpoints registered outside the `register_rest_route`
  pattern the pack detects.** Endpoints declared via `wp-json` routing
  filters, custom rewrite rules, or query-var handlers. Also surface
  the callback function as an implementation-detail candidate
  distinct from the endpoints.
- **Cron events.** `wp_schedule_event()`, `wp_schedule_single_event()`,
  and the paired `add_action` registrations for the hook name handle
  scheduled background work. Each scheduled event + its handler is a
  background-job candidate.
- **Nonces / capability checks.** `wp_verify_nonce()`, `current_user_can()`,
  `check_admin_referer()` — security predicates woven throughout
  admin actions and form handlers. Pattern-match notable usage as
  cross-cutting security logic.
- **AJAX handlers.** `wp_ajax_<action>` / `wp_ajax_nopriv_<action>`
  hooks — the pack catches them only if they happen to pass through
  the hook-registration detection. Surface as endpoints candidates.
- **Custom database tables.** `$wpdb->query("CREATE TABLE ...")`,
  `dbDelta(...)` calls in plugin activation hooks define persistent
  storage outside the WordPress post/term models. Surface as
  physical_data_entities candidates.
- **Transients.** `get_transient()` / `set_transient()` / `delete_transient()`
  — short-lived caches with semantic names. Frequently used as de-
  facto application state.
- **Template hierarchy.** Theme files (`single-{post_type}.php`,
  `archive-{post_type}.php`, `taxonomy-{taxonomy}.php`) declare the
  UI contract for each registered post type / taxonomy. Surface
  notable template overrides.
- **Multisite-specific hooks.** `wpmu_new_blog`, `delete_blog`,
  `ms_site_not_found` — only present in multisite codebases but
  architecturally significant when they appear.
- **Enqueue scripts / styles.** `wp_enqueue_script()` /
  `wp_enqueue_style()` sites identify client-side asset dependencies
  the pack ignores.
- **Gutenberg block registration.** `register_block_type(...)` calls
  register editor blocks — effectively a different UI component class
  than `WP_Widget`. Modern WordPress uses blocks; the pack only sees
  the classic Widget pattern.

## Instruction

Read the pack-output JSON block injected into this prompt carefully.
For each candidate you consider emitting, check that the
`(type, name, filePath)` tuple is NOT already represented in the pack
output (after case-insensitive, whitespace-collapsed name comparison).
If it is, drop it. Emit ONLY the genuine misses.

## Gap-fill targets (11th candidate type)

- **`interface_logical_entities`.** This framework's pack does NOT yet emit `interface_logical_entities` candidates. When an `interfaces` candidate (API controller, resolver, handler class) in this file references a `logical_data_entities` candidate (DTO, request/response body type) that is also defined somewhere in the project, emit an `interface_logical_entities` candidate named `InterfaceClass → LogicalDataEntityClass` (ASCII arrow, single spaces). Per-interface granularity — one entry per (interface, logical_data_entity) pair regardless of how many endpoints reference the DTO.
