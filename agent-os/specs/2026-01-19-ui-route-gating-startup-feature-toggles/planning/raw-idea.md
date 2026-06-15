# UI + Route Gating for Startup Feature Toggles (Include Delivery, Include Database)

## Intent

Use startup-time feature toggles to conditionally compose the UI and protect routes.
When includeDelivery is false, remove all Product & Delivery entry points and block deep-links.
When includeDatabase is false, operate in file-only mode by removing DB-only Product menu actions.
Toggles are independent; mixed-mode is allowed. No user-facing indication that toggles are off.

## Scope

### In Scope
- Read includeDelivery/includeDatabase from the startup configuration surface exposed in the frontend (AppConfig).
- Conditionally render top-level navigation, tabs, and routes based on includeDelivery.
- Conditionally render Product/Project menu items based on includeDatabase.
- Add route guards so gated routes cannot be accessed via deep-links/URL navigation.
- Ensure gated features are absent (not disabled/greyed-out) and there are no UI indicators/badges.

### Out of Scope
- Backend boot wiring / JPA silencing (handled by a separate spec).
- Export "Project Name" modal behaviour and file naming (handled by a separate spec).
- Any change to import/export data formats or payload content (beyond menu presence).

## Behaviour

### includeDelivery=true
- The "Product & Delivery" top-level tab is visible.
- Product & Delivery screens and navigation remain accessible as they are today.

### includeDelivery=false
- The "Product & Delivery" top-level tab does NOT appear anywhere in the UI.
- All Product & Delivery navigation entry points are removed (including shortcuts/links outside the tab).
- Any attempt to access a Product & Delivery route via URL/deep-link is redirected to an always-available default route (Architecture/Design landing screen or equivalent).
- The active tab selection must never point to a gated tab; if it would, force selection to the default tab.

### includeDatabase=true
- The Product/Project menu includes DB-oriented actions:
  - Create
  - Open
  - Save
  - Save As
  - Delete
- Plus file actions:
  - Import as JSON
  - Export as JSON
  - Import as XLSX
  - Export as XLSX

### includeDatabase=false
- The Product/Project menu must NOT show the following items at all (not disabled/greyed-out):
  - Create
  - Open
  - Save
  - Save As
  - Delete
- The Product/Project menu must still show file actions:
  - Import as JSON
  - Export as JSON
  - Import as XLSX
  - Export as XLSX

## Mixed Mode Support

- includeDelivery and includeDatabase are evaluated independently (no coupling logic).
- Allowed combinations and expected UI results:
  - (includeDelivery=true, includeDatabase=true): Full platform (no gating beyond current behaviour).
  - (includeDelivery=true, includeDatabase=false): Delivery UI present; DB-only Product menu actions removed.
  - (includeDelivery=false, includeDatabase=true): Architecture-only UI present; DB still enabled (menu unchanged).
  - (includeDelivery=false, includeDatabase=false): Architecture-only UI present; file-only Product menu.

## Routing and Defaults

- Define one "always-available" default route that is not in the Product & Delivery area.
- Implement a config-aware route guard:
  - If includeDelivery=false and the route is within Product & Delivery => redirect to default route.
- Ensure redirects are deterministic and do not loop.

## Startup Constraints

- Toggles are applied at startup; they are not intended to be changed live while the app is running.
- The UI must not expose any hint that features are gated by toggles; absence is the only effect.

## Acceptance Criteria

- With includeDelivery=false, "Product & Delivery" is not visible anywhere and cannot be reached by deep-link.
- With includeDatabase=false, Create/Open/Save/Save As/Delete do not appear in the Product menu at all.
- With includeDatabase=false, Import/Export JSON/XLSX remain visible and usable.
- No "mode" indicators, banners, badges, or tooltips reveal that features are disabled.
- Mixed-mode combinations behave as described (independent toggles, no coupling).

## Notes

- This spec gates UI and routes only. Backend DB/JPA silencing is handled separately but is assumed necessary for includeDatabase=false deployments.
- Export "Project Name" prompting remains a separate spec.
