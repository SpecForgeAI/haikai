/**
 * AngularJS 1.x HTML template scanner.
 *
 * Pack-17 (2026-04-22): legacy AngularJS codebases keep a lot of
 * architectural signal in HTML templates — `ng-controller="FooCtrl"` tells
 * us a controller is bound to that template, custom element tags like
 * `<my-directive>` tell us the directive is actually used, and
 * `ng-view` / `ui-view` mark the app shell. A tiny regex-based scan over
 * `.html` files gives us the reinforcing data without pulling in a full
 * HTML/SGML parser. We deliberately do NOT try to parse interpolation
 * expressions (`{{ foo.bar }}`) — those aren't architectural signals.
 *
 * Tag normalisation: directive usage spans the kebab→camelCase boundary
 * (Angular convention: `<my-directive>` ↔ `myDirective`). This module
 * normalises kebab-case tag/attribute names to camelCase so the
 * framework adapter can match against directive names emitted from
 * `.js`.
 */

export interface HtmlTemplateScanResult {
  /** Controllers referenced via `ng-controller="X"`, deduped. */
  controllers: Set<string>;
  /**
   * Directives referenced via `<my-directive>` custom element OR as
   * attributes `<div my-directive="...">`. Names are camelCased. Deduped.
   *
   * NOTE: well-known built-in AngularJS directives (`ng-if`, `ng-repeat`,
   * `ng-click` etc.) are filtered out — they're framework plumbing, not
   * user-defined architecture.
   */
  directives: Set<string>;
  /** True if this template contains `<ng-view>`, `<div ng-view>`, or `<ui-view>`. */
  hasViewOutlet: boolean;
}

/**
 * Convert `kebab-case-name` → `kebabCaseName`.
 */
export function kebabToCamel(kebab: string): string {
  return kebab.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * Common AngularJS 1.x built-in directives we never want to emit as
 * user directives (they're framework plumbing).
 */
const BUILTIN_NG_DIRECTIVES = new Set([
  'ngApp', 'ngBind', 'ngBindHtml', 'ngBindTemplate', 'ngBlur',
  'ngChange', 'ngChecked', 'ngClass', 'ngClassEven', 'ngClassOdd',
  'ngClick', 'ngCloak', 'ngController', 'ngCopy', 'ngCsp', 'ngCut',
  'ngDblclick', 'ngDisabled', 'ngFocus', 'ngForm', 'ngHide', 'ngHref',
  'ngIf', 'ngInclude', 'ngInit', 'ngKeydown', 'ngKeypress', 'ngKeyup',
  'ngList', 'ngMaxlength', 'ngMinlength', 'ngModel', 'ngModelOptions',
  'ngMousedown', 'ngMouseenter', 'ngMouseleave', 'ngMousemove',
  'ngMouseover', 'ngMouseup', 'ngNonBindable', 'ngOpen', 'ngOptions',
  'ngPaste', 'ngPattern', 'ngPluralize', 'ngReadonly', 'ngRepeat',
  'ngRequired', 'ngSelected', 'ngShow', 'ngSrc', 'ngSrcset', 'ngStyle',
  'ngSubmit', 'ngSwitch', 'ngSwitchWhen', 'ngSwitchDefault', 'ngTransclude',
  'ngValue', 'ngView',
  // Additional UI-router directive
  'uiView', 'uiSref', 'uiSrefActive',
]);

/**
 * Scan a single HTML template file's contents and return the structured
 * signals found. Pure-regex; does NOT depend on tree-sitter.
 */
export function scanHtmlTemplate(contents: string): HtmlTemplateScanResult {
  const controllers = new Set<string>();
  const directives = new Set<string>();
  let hasViewOutlet = false;

  // Strip HTML comments to avoid false-positive matches inside
  // `<!-- <div ng-controller="X"> -->`.
  const stripped = contents.replace(/<!--[\s\S]*?-->/g, '');

  // ng-controller="X [as Y]"
  const controllerRe = /\bng-controller\s*=\s*"([^"]+)"|\bng-controller\s*=\s*'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = controllerRe.exec(stripped)) !== null) {
    // `FooCtrl as vm` → FooCtrl
    const raw = (m[1] ?? m[2] ?? '').trim();
    const name = raw.split(/\s+/)[0];
    if (name) controllers.add(name);
  }

  // View outlets.
  if (
    /\bng-view\b/.test(stripped) ||
    /<ng-view\b/.test(stripped) ||
    /<ui-view\b/.test(stripped) ||
    /\bui-view\b/.test(stripped)
  ) {
    hasViewOutlet = true;
  }

  // Custom-element directives: `<my-directive ...>` where the tag is
  // kebab-case AND contains a hyphen (HTML5 custom-element convention).
  const customElementRe = /<([a-z][a-z0-9]*(?:-[a-z0-9]+)+)\b/g;
  while ((m = customElementRe.exec(stripped)) !== null) {
    const camel = kebabToCamel(m[1]);
    if (!BUILTIN_NG_DIRECTIVES.has(camel)) {
      directives.add(camel);
    }
  }

  // Attribute-bound directives: hyphenated attributes on standard elements,
  // excluding the `ng-*` / `data-*` / `aria-*` families.
  const attrRe = /\s([a-z][a-z0-9]*(?:-[a-z0-9]+)+)\s*=\s*"/g;
  while ((m = attrRe.exec(stripped)) !== null) {
    const attr = m[1];
    if (
      attr.startsWith('ng-') ||
      attr.startsWith('data-') ||
      attr.startsWith('aria-') ||
      attr === 'ui-view' ||
      attr === 'ui-sref' ||
      attr === 'ui-sref-active'
    ) {
      continue;
    }
    const camel = kebabToCamel(attr);
    if (!BUILTIN_NG_DIRECTIVES.has(camel)) {
      directives.add(camel);
    }
  }

  return { controllers, directives, hasViewOutlet };
}

/** Filename test — `.html` anywhere in the scanned tree. */
export function isHtmlTemplateFile(filePath: string): boolean {
  return /\.html?$/i.test(filePath);
}
