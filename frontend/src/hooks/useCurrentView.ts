/**
 * useCurrentView
 *
 * Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 4
 *
 * Returns the current view ("metamodel" / "diagrams" / "product" / "dashboard")
 * derived from the URL pathname via `useLocation`. Replaces the removed
 * `state.currentView` reducer field.
 *
 * The canonical URL shape is:
 *   /projects/:projectId/architectures/:architectureId/<view>
 *
 * Falls back to "dashboard" if the pathname does not contain a recognised
 * trailing view segment. Returns "dashboard" for unmatched URLs (notably
 * the root URL `/`) so any consumer that reads the view in pre-routing UI
 * gets a sensible default.
 *
 * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 1
 *
 * Co-locates `parseArchitectureIdFromPathname`, a pure helper that extracts
 * the `:architectureId` segment from the canonical URL shape. Used by
 * `ArchitectureProvider` (which is mounted outside the route tree, so a
 * `useParams()` read returns `{}` and breaks every downstream consumer of
 * `useActiveArchitectureId`). Mirrors the matching pattern of
 * `parseViewFromPathname` so the two parsers stay in lockstep.
 *
 * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 4
 *
 * Co-locates `parseDomainFromPathname` + `useMetaModelDomain` for the
 * metamodel sub-route. Domain selection migrates from a reducer field
 * (`SET_DOMAIN`) to the URL `:domain` segment under
 * `/.../metamodel/:domain`. The URL contract uses kebab-case names from
 * the spec (`application` / `data` / `business` / `behavioural` / `ui`);
 * the codebase ArchitectureDomain enum is the same set. URL ↔ internal
 * is now a 1:1 mapping (Package Sets is intentionally NOT a URL token
 * — it remains a tab inside the application domain, accessible via the
 * tab bar but not deep-linkable; previously a `/metamodel/package-sets`
 * URL was supported but it broke intra-tab navigation, so it was removed).
 *
 * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 6
 *
 * Co-locates `parseProductTabFromPathname` + `parseWorkItemIdFromPathname`
 * + `useProductTab` + `useWorkItemId` for the product sub-routes:
 *   - `/.../product/mission`
 *   - `/.../product/roadmap`
 *   - `/.../product/backlog`
 *   - `/.../product/backlog/:workItemId`
 *   - `/.../product/implement/:workItemId`
 * The URL is the source of truth for tab selection and work-item selection;
 * `ProductView` becomes a layout that renders `<Outlet/>` and uses these
 * hooks for tab-bar styling.
 *
 * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 7
 *
 * Co-locates `parseDiscoveryRunIdFromPathname` + `useDiscoveryRunId` for the
 * discovery sub-routes:
 *   - `/.../discovery`              (run list page)
 *   - `/.../discovery/runs/:runId`  (run detail page, deep-linkable)
 * The URL is the source of truth for the selected run id; the
 * DiscoveryRunDetailView reads the URL via this hook instead of holding
 * an internal `selectedRunId` state.
 */

import { useLocation } from 'react-router-dom';
import { ArchitectureDomain } from '../types/architectureDomain';

export type CurrentView = 'metamodel' | 'diagrams' | 'product' | 'dashboard' | 'discovery' | 'target-architecture' | 'security';

const KNOWN_VIEWS: ReadonlySet<CurrentView> = new Set([
  'metamodel',
  'diagrams',
  'product',
  'dashboard',
  'discovery',
  // Spec 2026-05-20 Target Architecture Authoring Flow -- Task Group 6
  // New peer top-level view; lives at /.../target-architecture.
  'target-architecture',
  // Spec 2026-06-24 Vulnerability store + manual capture -- Task Group 5
  // New top-level "Security" view; lives at /.../security.
  'security',
]);

/**
 * Parse the trailing view segment from a pathname. Recognises both the
 * canonical architecture-scoped shape and the legacy
 * `/projects/:projectId/<view>` shape (still possible during a missing-arch
 * redirect render).
 */
export function parseViewFromPathname(pathname: string): CurrentView {
  if (!pathname) return 'dashboard';
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return 'dashboard';

  // Canonical shape: /projects/:projectId/architectures/:architectureId/<view>
  const archIdx = segments.indexOf('architectures');
  if (archIdx >= 0 && segments.length > archIdx + 2) {
    const candidate = segments[archIdx + 2];
    if (KNOWN_VIEWS.has(candidate as CurrentView)) {
      return candidate as CurrentView;
    }
  }

  // Legacy shape: /projects/:projectId/<view>
  const projIdx = segments.indexOf('projects');
  if (projIdx >= 0 && segments.length > projIdx + 2) {
    const candidate = segments[projIdx + 2];
    if (KNOWN_VIEWS.has(candidate as CurrentView)) {
      return candidate as CurrentView;
    }
  }

  return 'dashboard';
}

/**
 * Hook variant of {@link parseViewFromPathname} bound to the current router
 * location. Re-renders consumers when the URL changes.
 */
export function useCurrentView(): CurrentView {
  const location = useLocation();
  return parseViewFromPathname(location.pathname);
}

/**
 * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 1
 *
 * Parse the `:architectureId` path segment from a canonical URL of the form
 *   `/projects/:projectId/architectures/:architectureId/...`
 *
 * Returns the architecture id when one is present and non-empty; otherwise
 * returns null. Per spec, validation is intentionally lenient -- we only
 * reject the empty string and the literal sentinel "undefined" (which can
 * leak into URLs from naive template-string concatenations). Strict UUID
 * format validation is NOT applied: the URL shape is the contract here, not
 * the id format.
 *
 * Used by `ArchitectureProvider` in place of `useParams().architectureId`
 * because the provider is mounted above the `<Routes>` tree in `App.tsx`,
 * which means `useParams()` returns `{}` and `params.architectureId` is
 * permanently undefined. `useLocation()` works at any nesting depth as long
 * as it sits inside `<BrowserRouter>` (or `<MemoryRouter>` in tests), which
 * the provider already does.
 */
export function parseArchitectureIdFromPathname(pathname: string): string | null {
  if (!pathname) return null;
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return null;

  // Canonical shape: /projects/:projectId/architectures/:architectureId/...
  const archIdx = segments.indexOf('architectures');
  if (archIdx >= 0 && segments.length > archIdx + 1) {
    const candidate = segments[archIdx + 1];
    if (candidate && candidate !== 'undefined') {
      return candidate;
    }
  }

  return null;
}

// ============================================================================
// Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 4
// Metamodel domain URL parsing
// ============================================================================

/**
 * The kebab-case URL domain values per the locked URL list in spec.md
 * (line 29). These are the legal values for the `:domain` segment of
 * `/.../metamodel/:domain`. Any other value triggers a default-redirect
 * fallback (handled inside MetaModelView).
 */
export type MetaModelDomainUrlValue =
  | 'application'
  | 'data'
  | 'business'
  | 'behavioural'
  | 'ui'
  | 'infrastructure';  // Spec 2026-05-04: Infrastructure Domain Frontend Types

export const META_MODEL_DOMAIN_URL_VALUES: ReadonlyArray<MetaModelDomainUrlValue> = [
  'application',
  'data',
  'business',
  'behavioural',
  'ui',
  'infrastructure',  // Spec 2026-05-04: Infrastructure Domain Frontend Types
];

/**
 * The canonical default domain a bare `/.../metamodel` URL redirects to.
 */
export const DEFAULT_META_MODEL_DOMAIN_URL: MetaModelDomainUrlValue = 'application';

/**
 * URL -> internal ArchitectureDomain enum mapping (1:1).
 */
const URL_TO_INTERNAL_DOMAIN: Record<MetaModelDomainUrlValue, ArchitectureDomain> = {
  application: 'application',
  data: 'data',
  business: 'business',
  behavioural: 'behavioural',
  ui: 'ui',
  infrastructure: 'infrastructure',  // Spec 2026-05-04: Infrastructure Domain Frontend Types
};

/**
 * Reverse mapping: internal ArchitectureDomain -> URL value (1:1).
 */
const INTERNAL_DOMAIN_TO_URL: Record<ArchitectureDomain, MetaModelDomainUrlValue> = {
  application: 'application',
  data: 'data',
  business: 'business',
  behavioural: 'behavioural',
  ui: 'ui',
  infrastructure: 'infrastructure',  // Spec 2026-05-04: Infrastructure Domain Frontend Types
};

/**
 * True when the supplied value is one of the six legal URL domain tokens.
 */
export function isMetaModelDomainUrlValue(
  value: string | undefined | null
): value is MetaModelDomainUrlValue {
  return !!value && (META_MODEL_DOMAIN_URL_VALUES as ReadonlyArray<string>).includes(value);
}

/**
 * Convert a URL domain token to the internal ArchitectureDomain enum.
 * Returns null if the value is not a recognised token.
 */
export function urlDomainToInternal(
  urlValue: string | undefined | null
): ArchitectureDomain | null {
  if (!isMetaModelDomainUrlValue(urlValue)) return null;
  return URL_TO_INTERNAL_DOMAIN[urlValue];
}

/**
 * Convert an internal ArchitectureDomain enum value to the canonical URL
 * token used in `/metamodel/:domain` URLs.
 */
export function internalDomainToUrl(
  domain: ArchitectureDomain
): MetaModelDomainUrlValue {
  return INTERNAL_DOMAIN_TO_URL[domain];
}

/**
 * Pure parser. Extracts the `:domain` segment from a canonical metamodel
 * URL of the form `/projects/:p/architectures/:a/metamodel/:domain`.
 * Returns the raw URL token when present (not validated -- callers should
 * use `isMetaModelDomainUrlValue` if validation is required); returns null
 * when the URL has no `:domain` segment or no `metamodel` segment at all.
 *
 * Mirrors the matching pattern of `parseArchitectureIdFromPathname` so the
 * two stay in lockstep.
 */
export function parseDomainFromPathname(pathname: string): string | null {
  if (!pathname) return null;
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return null;

  // Canonical shape: /projects/:p/architectures/:a/metamodel/:domain
  const archIdx = segments.indexOf('architectures');
  if (archIdx >= 0 && segments.length > archIdx + 3) {
    const view = segments[archIdx + 2];
    if (view === 'metamodel') {
      const candidate = segments[archIdx + 3];
      if (candidate && candidate !== 'undefined') {
        return candidate;
      }
    }
  }

  return null;
}

/**
 * Hook returning the URL-derived metamodel domain as an internal
 * ArchitectureDomain enum value. Falls back to the internal value for
 * `DEFAULT_META_MODEL_DOMAIN_URL` ('application') when
 * the URL has no `:domain` segment OR when the segment is not a recognised
 * URL token. (The MetaModelView component additionally renders a redirect
 * to the default URL when the segment is invalid -- this hook returns a
 * sensible default in the meantime so dependent rendering does not crash.)
 */
export function useMetaModelDomain(): ArchitectureDomain {
  const location = useLocation();
  const raw = parseDomainFromPathname(location.pathname);
  const mapped = urlDomainToInternal(raw);
  if (mapped) return mapped;
  return URL_TO_INTERNAL_DOMAIN[DEFAULT_META_MODEL_DOMAIN_URL];
}

/**
 * Hook returning the raw URL token (or null) for the metamodel domain
 * segment. Useful for tests and components that need the unvalidated
 * URL value.
 */
export function useMetaModelDomainUrlToken(): string | null {
  const location = useLocation();
  return parseDomainFromPathname(location.pathname);
}

// ============================================================================
// Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 5
// Diagrams selected-diagram URL parsing
// ============================================================================

/**
 * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 5
 *
 * Pure parser. Extracts the `:diagramId` segment from a canonical diagrams
 * URL of the form `/projects/:p/architectures/:a/diagrams/:diagramId`.
 * Returns the raw URL token when present; returns null when the URL has no
 * `:diagramId` segment or no `diagrams` segment at all (e.g. bare
 * `/.../diagrams` URL).
 *
 * Mirrors the matching pattern of `parseDomainFromPathname` so the two stay
 * in lockstep. Validation is intentionally lenient -- we only reject the
 * empty string and the literal sentinel "undefined" (which can leak into
 * URLs from naive template-string concatenations). Strict id-format
 * validation is NOT applied here: the URL shape is the contract, not the id
 * format. DiagramsView is responsible for handling the case where the id
 * does not exist in the loaded model (per spec, no redirect; the canvas
 * shows an empty state instead).
 */
export function parseDiagramIdFromPathname(pathname: string): string | null {
  if (!pathname) return null;
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return null;

  // Canonical shape: /projects/:p/architectures/:a/diagrams/:diagramId
  const archIdx = segments.indexOf('architectures');
  if (archIdx >= 0 && segments.length > archIdx + 3) {
    const view = segments[archIdx + 2];
    if (view === 'diagrams') {
      const candidate = segments[archIdx + 3];
      if (candidate && candidate !== 'undefined') {
        return candidate;
      }
    }
  }

  return null;
}

/**
 * Hook returning the URL-derived diagram id from the current pathname, or
 * null when the URL has no `:diagramId` segment (i.e. the bare diagram-list
 * URL `/projects/:p/architectures/:a/diagrams`).
 *
 * Used by `DiagramsView` to drive the URL -> reducer sync effect that keeps
 * `state.selectedDiagramId` in step with the URL. The URL leads; the
 * reducer follows. All existing Canvas / palette / inspector consumers
 * continue to read from `state.selectedDiagramId` and need no change.
 *
 * Mirrors the `useMetaModelDomain` pattern from Group 4: pure parser plus a
 * `useLocation()`-based hook so the value is robust even when consumers are
 * mounted outside the route tree (the same bug class fixed by Group 1).
 */
export function useSelectedDiagramId(): string | null {
  const location = useLocation();
  return parseDiagramIdFromPathname(location.pathname);
}

// ============================================================================
// Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 6
// Product tab + work-item URL parsing
// ============================================================================

/**
 * The legal product tab tokens per the locked URL list in spec.md (lines
 * 32-37). Each maps to its own sub-route under the product parent route:
 *   - `mission`   -> `/.../product/mission`
 *   - `roadmap`   -> `/.../product/roadmap`
 *   - `backlog`   -> `/.../product/backlog` (+ optional `/:workItemId`)
 *   - `implement` -> `/.../product/implement/:workItemId`
 *
 * Note: the 'product' tab from the legacy reducer-based `?tab=product` URLs
 * (which mounted ProductPage) is NOT in this list -- in the new sub-route
 * world, the Product Definition page is reached as a sub-route of `mission`
 * (or kept as an in-component decision inside MissionTab) and is no longer
 * a first-class tab. For now we treat 'mission' as the canonical home for
 * the product-definition body.
 */
export type ProductTabUrlValue =
  | 'mission'
  | 'roadmap'
  | 'backlog'
  | 'implement';

export const PRODUCT_TAB_URL_VALUES: ReadonlyArray<ProductTabUrlValue> = [
  'mission',
  'roadmap',
  'backlog',
  'implement',
];

/**
 * The default product tab a bare `/.../product` URL redirects to.
 */
export const DEFAULT_PRODUCT_TAB_URL: ProductTabUrlValue = 'backlog';

/**
 * True when the supplied value is one of the four legal product tab tokens.
 */
export function isProductTabUrlValue(
  value: string | undefined | null
): value is ProductTabUrlValue {
  return !!value && (PRODUCT_TAB_URL_VALUES as ReadonlyArray<string>).includes(value);
}

/**
 * Pure parser. Extracts the product tab segment from a canonical product
 * URL of the form `/projects/:p/architectures/:a/product/(mission|roadmap|backlog|implement)/...`.
 * Returns the raw URL token when present and recognised; returns null when
 * the URL has no recognised tab segment (i.e. bare `/.../product`) or is
 * not a product URL at all.
 *
 * Mirrors the matching pattern of `parseDomainFromPathname` so the parsers
 * stay in lockstep.
 */
export function parseProductTabFromPathname(pathname: string): ProductTabUrlValue | null {
  if (!pathname) return null;
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return null;

  // Canonical shape: /projects/:p/architectures/:a/product/<tab>/...
  const archIdx = segments.indexOf('architectures');
  if (archIdx >= 0 && segments.length > archIdx + 3) {
    const view = segments[archIdx + 2];
    if (view === 'product') {
      const candidate = segments[archIdx + 3];
      if (isProductTabUrlValue(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

/**
 * Hook returning the URL-derived product tab token, or null for the bare
 * `/.../product` URL (which is redirected to `/.../product/backlog` by an
 * index route -- the null-return covers the brief render before the
 * redirect fires).
 *
 * Used by `ProductView` to drive tab-bar active styling (NavLink also
 * provides this via its own `isActive` callback, but this hook is exposed
 * for consumers that need the parsed value programmatically).
 */
export function useProductTab(): ProductTabUrlValue | null {
  const location = useLocation();
  return parseProductTabFromPathname(location.pathname);
}

/**
 * Pure parser. Extracts the `:workItemId` segment from a canonical product
 * sub-route URL of one of the forms:
 *   - `/projects/:p/architectures/:a/product/backlog/:workItemId`
 *   - `/projects/:p/architectures/:a/product/implement/:workItemId`
 *
 * Returns the raw URL token when present; returns null when the URL has no
 * `:workItemId` segment, or is on a tab that does not accept one (mission,
 * roadmap), or is not a product URL at all.
 *
 * Validation is intentionally lenient (mirrors `parseDiagramIdFromPathname`):
 * we only reject the empty string and the literal sentinel "undefined".
 */
export function parseWorkItemIdFromPathname(pathname: string): string | null {
  if (!pathname) return null;
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return null;

  // Canonical shape: /projects/:p/architectures/:a/product/(backlog|implement)/:workItemId
  const archIdx = segments.indexOf('architectures');
  if (archIdx >= 0 && segments.length > archIdx + 4) {
    const view = segments[archIdx + 2];
    const tab = segments[archIdx + 3];
    if (view === 'product' && (tab === 'backlog' || tab === 'implement')) {
      const candidate = segments[archIdx + 4];
      if (candidate && candidate !== 'undefined') {
        return candidate;
      }
    }
  }

  return null;
}

/**
 * Hook returning the URL-derived work item id from the current pathname, or
 * null when the URL has no `:workItemId` segment. Used by `BacklogTab` to
 * pre-open the details panel for a deep-linked work item, and by
 * `ImplementTab` to drive the Implementation Assistant's target work item.
 */
export function useWorkItemId(): string | null {
  const location = useLocation();
  return parseWorkItemIdFromPathname(location.pathname);
}

// ============================================================================
// Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 7
// Discovery selected-run URL parsing
// ============================================================================

/**
 * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 7
 *
 * Pure parser. Extracts the `:runId` segment from a canonical discovery
 * detail URL of the form
 *   `/projects/:p/architectures/:a/discovery/runs/:runId`.
 *
 * Returns the raw URL token when present; returns null when the URL has no
 * `:runId` segment (e.g. the bare list URL `/.../discovery`) or is not a
 * discovery detail URL at all.
 *
 * Mirrors the matching pattern of `parseDiagramIdFromPathname` so the two
 * stay in lockstep. Validation is intentionally lenient -- we only reject
 * the empty string and the literal sentinel "undefined". The detail page
 * is responsible for handling the case where the id does not match a
 * known run (it shows a "run not found" placeholder rather than redirecting).
 */
export function parseDiscoveryRunIdFromPathname(pathname: string): string | null {
  if (!pathname) return null;
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return null;

  // Canonical shape: /projects/:p/architectures/:a/discovery/runs/:runId
  const archIdx = segments.indexOf('architectures');
  if (archIdx >= 0 && segments.length > archIdx + 4) {
    const view = segments[archIdx + 2];
    const subSegment = segments[archIdx + 3];
    if (view === 'discovery' && subSegment === 'runs') {
      const candidate = segments[archIdx + 4];
      if (candidate && candidate !== 'undefined') {
        return candidate;
      }
    }
  }

  return null;
}

/**
 * Hook returning the URL-derived discovery run id from the current pathname,
 * or null when the URL has no `:runId` segment (the bare list URL
 * `/.../discovery`).
 *
 * Used by `DiscoveryRunDetailPage` to drive the selected run instead of
 * holding internal `selectedRunId` state. Mirrors the `useSelectedDiagramId`
 * pattern from Group 5: pure parser plus a `useLocation()`-based hook so
 * the value is robust even when consumers are mounted outside the route
 * tree (the same bug class fixed by Group 1).
 */
export function useDiscoveryRunId(): string | null {
  const location = useLocation();
  return parseDiscoveryRunIdFromPathname(location.pathname);
}
