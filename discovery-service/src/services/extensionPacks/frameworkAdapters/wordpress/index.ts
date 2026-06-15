/**
 * WordPress Framework Adapter
 *
 * WordPress is a primarily PROCEDURAL PHP codebase with an event-driven hook
 * system — a world away from Spring/Django/Rails. This adapter detects the
 * architectural signals that DO exist:
 *
 *   register_rest_route('ns', '/path', ...)   → endpoint (REST API routes)
 *   register_post_type('type', ...)           → physical_entity (custom post types)
 *   register_taxonomy('taxonomy', ...)        → physical_entity (custom taxonomies)
 *   add_action(hook, callback, ...)           → business_logic (hook handler)
 *   add_filter(hook, callback, ...)           → business_logic (filter handler)
 *   add_menu_page / add_submenu_page / ...    → ui_screen (admin pages)
 *   register_setting('group', 'option', ...)  → logical_data_entity (setting)
 *   register_sidebar(args)                    → ui_component (sidebar widget area)
 *   register_widget(class)                    → ui_component (widget registration)
 *   class X extends WP_REST_Controller        → interface (REST controller class)
 *   class X extends WP_Widget                 → ui_component
 *   class X extends WP_List_Table             → ui_component (admin list table)
 *   class X extends WP_Customize_Control      → ui_component (customizer control)
 *   Classes extending Abstract_WC_* (WooCommerce) → physical_entity / interface
 *
 * Both function bodies AND file-level statements are scanned (consumed via
 * `SourceFileIR.allCalls` populated by the PHP language extractor) — a lot
 * of WordPress core's architecture is wired up via top-level `add_action`
 * calls outside any function definition.
 *
 * Issues fixed by this iteration: see `discovery-service/perf/KNOWN_ISSUES.md`
 * — ISS-001 (wordpress framework pack didn't engage on real WordPress repo).
 */
import { v4 as uuidv4 } from 'uuid';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import type { SourceFileIR, CallIR, ClassIR } from '../../languageIR';

function makeCandidate(
  type: DiscoveryCandidate['candidateType'],
  name: string,
  filePath: string,
  data: Record<string, unknown>,
  runId: string,
  parentCandidateId?: string,
): DiscoveryCandidate {
  const c: DiscoveryCandidate = {
    id: uuidv4(), runId, candidateType: type, name, confidence: 0.85,
    status: 'proposed', sourceClusterIds: [filePath],
    data: { ...data, _addedBy: 'wordpress-adapter' },
    synthesizedAt: new Date().toISOString(),
  };
  if (parentCandidateId) c.parentCandidateId = parentCandidateId;
  return c;
}

function cleanStringLiteral(text: string): string | null {
  const t = text.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return null;
}

function inferHttpMethodFromRouteArgs(args: string[]): string {
  for (const a of args) {
    const m = a.match(/['"](GET|POST|PUT|DELETE|PATCH)['"]/i);
    if (m) return m[1].toUpperCase();
    const methodsM = a.match(/'methods'\s*=>\s*['"`]([A-Z,]+)['"`]/i);
    if (methodsM) return methodsM[1].split(',')[0].trim().toUpperCase();
  }
  return 'GET';
}

/** True for parent class names that look like REST controllers. Matches both
 *  bare names and namespace-qualified forms (`\WP_REST_Controller`). */
function isRestControllerParent(parent: string): boolean {
  const tail = parent.replace(/^\\+/, '').split('\\').pop() || parent;
  return tail === 'WP_REST_Controller' || /_REST_Controller$/.test(tail);
}

function tailName(qualified: string): string {
  return (qualified.replace(/^\\+/, '').split('\\').pop() || qualified).trim();
}

interface AdapterOutput {
  candidates: DiscoveryCandidate[];
  /** Names of WP_Widget subclasses — used to enrich `register_widget(...)` calls. */
  widgetClassNames: Set<string>;
}

function processWpClass(cls: ClassIR, file: SourceFileIR, runId: string, out: AdapterOutput): void {
  if (!cls.extends) return;
  const parent = tailName(cls.extends);
  if (isRestControllerParent(cls.extends)) {
    out.candidates.push(
      makeCandidate('interfaces', cls.name, file.filePath, {
        controllerType: 'WordPressRestController', className: cls.name,
        parentClass: parent,
      }, runId),
    );
    return;
  }
  if (parent === 'WP_Widget') {
    out.widgetClassNames.add(cls.name);
    out.candidates.push(
      makeCandidate('ui_components', cls.name, file.filePath, {
        className: cls.name, component_type: 'other', wpWidget: true,
      }, runId),
    );
    return;
  }
  if (parent === 'WP_List_Table') {
    out.candidates.push(
      makeCandidate('ui_components', cls.name, file.filePath, {
        className: cls.name, component_type: 'table', wpAdminScreen: true,
        parentClass: parent,
      }, runId),
    );
    return;
  }
  if (parent === 'WP_Screen') {
    out.candidates.push(
      makeCandidate('ui_components', cls.name, file.filePath, {
        className: cls.name, component_type: 'other', wpAdminScreen: true,
        parentClass: parent,
      }, runId),
    );
    return;
  }
  if (/^WP_Customize_(Control|Section|Panel|Setting)$/.test(parent)) {
    out.candidates.push(
      makeCandidate('ui_components', cls.name, file.filePath, {
        className: cls.name, component_type: 'other', wpCustomizer: true,
        parentClass: parent,
      }, runId),
    );
    return;
  }
}

/** Process a callee against the WordPress signal set. `siteFnLabel` is a
 *  display label for where the call occurs ("file-level" / "fnName" /
 *  "ClassName.methodName"). */
function processCall(
  siteFnLabel: string,
  call: CallIR,
  file: SourceFileIR,
  runId: string,
  out: AdapterOutput,
): void {
  const callee = call.callee;

  // ---------- REST routes ----------
  if (callee === 'register_rest_route') {
    const ns = cleanStringLiteral(call.args[0] || '');
    const path = cleanStringLiteral(call.args[1] || '');
    const httpMethod = inferHttpMethodFromRouteArgs(call.args);
    const fullPath = [ns, path].filter(Boolean).join('/').replace(/\/+/g, '/');
    if (fullPath) {
      out.candidates.push(
        makeCandidate('endpoints', `${httpMethod} /${fullPath.replace(/^\//, '')}`, file.filePath, {
          httpMethod, url: '/' + fullPath.replace(/^\//, ''),
          namespace: ns, route: path,
          apiLibrary: 'WordPress REST', endpoint_subtype: 'wp_rest',
          callingFunction: siteFnLabel, line: call.line,
        }, runId),
      );
    }
    return;
  }

  // ---------- Custom post types & taxonomies ----------
  if (callee === 'register_post_type') {
    const postType = cleanStringLiteral(call.args[0] || '');
    if (postType) {
      out.candidates.push(
        makeCandidate('physical_data_entities', postType, file.filePath, {
          entityClassName: postType, tableName: 'wp_posts',
          wpPostType: true, callingFunction: siteFnLabel, line: call.line,
        }, runId),
      );
    }
    return;
  }
  if (callee === 'register_taxonomy') {
    const taxonomy = cleanStringLiteral(call.args[0] || '');
    if (taxonomy) {
      out.candidates.push(
        makeCandidate('physical_data_entities', taxonomy, file.filePath, {
          entityClassName: taxonomy, tableName: 'wp_term_taxonomy',
          wpTaxonomy: true, callingFunction: siteFnLabel, line: call.line,
        }, runId),
      );
    }
    return;
  }

  // ---------- Hooks (the heart of WordPress) ----------
  if (callee === 'add_action' || callee === 'add_filter') {
    const hook = cleanStringLiteral(call.args[0] || '');
    const callback = call.args[1] ? call.args[1].trim() : '';
    if (hook && callback) {
      const cbLabel = cleanStringLiteral(callback) || callback;
      out.candidates.push(
        makeCandidate('business_logics', `${hook} → ${cbLabel}`, file.filePath, {
          hookName: hook, callback: cbLabel,
          hookType: callee === 'add_action' ? 'action' : 'filter',
          registeredIn: siteFnLabel, line: call.line,
          methodName: cbLabel, className: '',
        }, runId),
      );
    }
    return;
  }

  // ---------- Admin menu pages ----------
  const menuFns: Record<string, string> = {
    add_menu_page: 'top-level',
    add_submenu_page: 'submenu',
    add_options_page: 'settings',
    add_management_page: 'tools',
    add_dashboard_page: 'dashboard',
    add_users_page: 'users',
    add_plugins_page: 'plugins',
    add_theme_page: 'appearance',
    add_posts_page: 'posts',
    add_pages_page: 'pages',
    add_media_page: 'media',
    add_comments_page: 'comments',
    add_links_page: 'links',
  };
  if (callee in menuFns) {
    // First non-parent string arg is the page title; the menu slug is the slug arg.
    const isSubmenu = callee === 'add_submenu_page';
    // add_menu_page($page_title, $menu_title, $capability, $menu_slug, ...)
    // add_submenu_page($parent_slug, $page_title, $menu_title, $capability, $menu_slug, ...)
    const titleArg = cleanStringLiteral(call.args[isSubmenu ? 1 : 0] || '');
    const slugArg = cleanStringLiteral(call.args[isSubmenu ? 4 : 3] || '');
    const screenName = titleArg || slugArg;
    if (screenName) {
      out.candidates.push(
        makeCandidate('ui_screens', screenName, file.filePath, {
          screenName, slug: slugArg || '', menuKind: menuFns[callee],
          registeredIn: siteFnLabel, line: call.line,
        }, runId),
      );
    }
    return;
  }

  // ---------- Settings API ----------
  if (callee === 'register_setting') {
    // register_setting($option_group, $option_name, $args)
    const group = cleanStringLiteral(call.args[0] || '') || '';
    const option = cleanStringLiteral(call.args[1] || '');
    if (option) {
      out.candidates.push(
        makeCandidate('logical_data_entities', option, file.filePath, {
          entityName: option, settingsGroup: group,
          wpSetting: true, registeredIn: siteFnLabel, line: call.line,
        }, runId),
      );
    }
    return;
  }

  // ---------- Sidebars / widget areas ----------
  if (callee === 'register_sidebar') {
    // register_sidebar(['name' => 'Foo', 'id' => 'foo', ...]) — best-effort.
    let name: string | null = null;
    for (const a of call.args) {
      const m = a.match(/'name'\s*=>\s*['"]([^'"]+)['"]/);
      if (m) { name = m[1]; break; }
    }
    if (!name) name = 'sidebar';
    out.candidates.push(
      makeCandidate('ui_components', name, file.filePath, {
        component_type: 'other', wpSidebar: true,
        registeredIn: siteFnLabel, line: call.line,
      }, runId),
    );
    return;
  }

  // ---------- Widget registrations ----------
  if (callee === 'register_widget') {
    // register_widget('Foo_Widget') or register_widget(Foo_Widget::class)
    let cls = cleanStringLiteral(call.args[0] || '');
    if (!cls) {
      const raw = (call.args[0] || '').trim();
      const m = raw.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:::class)?$/);
      if (m) cls = m[1];
    }
    if (cls) {
      // If the class is already emitted from processWpClass we don't double-emit;
      // otherwise this is the only signal that the widget exists in this codebase.
      if (!out.widgetClassNames.has(cls)) {
        out.candidates.push(
          makeCandidate('ui_components', cls, file.filePath, {
            className: cls, component_type: 'other', wpWidget: true,
            registeredIn: siteFnLabel, line: call.line,
          }, runId),
        );
      }
    }
    return;
  }
}

export function runWordpressAdapter(files: SourceFileIR[], runId: string): DiscoveryCandidate[] {
  const out: AdapterOutput = { candidates: [], widgetClassNames: new Set() };
  for (const file of files) {
    // Class-based signals (REST controllers, widgets, list tables, customizer).
    for (const cls of file.classes) processWpClass(cls, file, runId, out);
  }
  // Second pass for calls so that widget-class signals from the first pass are
  // available when we deduplicate `register_widget(...)` calls.
  for (const file of files) {
    // File-level + nested calls (the PHP IR populates allCalls with every
    // function/member/scoped call in the file regardless of nesting).
    if (file.allCalls && file.allCalls.length > 0) {
      for (const call of file.allCalls) {
        processCall('file-level', call, file, runId, out);
      }
    } else {
      // Defensive fallback: if `allCalls` isn't populated (shouldn't happen
      // for php-lang IR after the 2026-04-25 update, but a stale extractor
      // build might still produce older shape), walk function/method bodies.
      for (const fn of file.functions) {
        if (fn.calls) {
          for (const call of fn.calls) processCall(fn.name, call, file, runId, out);
        }
      }
      for (const cls of file.classes) {
        for (const m of cls.methods) {
          if (m.calls) {
            for (const call of m.calls) {
              processCall(`${cls.name}.${m.name}`, call, file, runId, out);
            }
          }
        }
      }
    }
  }
  return out.candidates;
}
