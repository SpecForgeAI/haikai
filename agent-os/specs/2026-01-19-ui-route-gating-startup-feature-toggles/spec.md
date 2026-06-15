# Specification: UI Route Gating for Startup Feature Toggles

## Goal
Conditionally compose the UI and protect views based on startup-time feature toggles (`includeDelivery`, `includeDatabase`) to enable deployment configurations where delivery features and/or database-dependent features are disabled without any user-facing indication.

## User Stories
- As a deployment administrator, I want to disable Product & Delivery features via configuration so that users see only Architecture & Design capabilities without knowing features are gated.
- As a deployment administrator, I want to disable database-dependent operations (Create/Open/Save/Save As/Delete) while keeping import/export so that users can work in file-only mode.

## Specific Requirements

**Read feature toggles from AppConfig**
- Use existing `useIncludeDelivery()` hook from `AppConfigContext` to read `includeDelivery` toggle
- Use existing `useIncludeDatabase()` hook from `AppConfigContext` to read `includeDatabase` toggle
- Toggles are loaded at startup from `/runtime-config.json` and are immutable during the application session
- Both toggles default to `true` when config file is missing or values are invalid

**Conditionally render Product & Delivery tab**
- When `includeDelivery=false`, the "Product & Delivery" button in `TopBar.tsx` must not render at all (not hidden, not disabled - completely absent)
- When `includeDelivery=true`, the "Product & Delivery" button renders normally as the first navigation option
- Use conditional rendering (`{includeDelivery && <button>...}`) pattern, not CSS-based hiding

**Redirect gated view navigation attempts**
- The app uses state-based navigation via `currentView` in `ArchitectureContext` with values: `'product'`, `'metamodel'`, `'diagrams'`
- When `includeDelivery=false` and `currentView` is `'product'`, automatically redirect to `'metamodel'` (the default allowed view)
- Implement a `useEffect` hook in `AppContent` (or create a `ViewGuard` wrapper component) that watches `currentView` and redirects if gated
- Ensure the redirect is deterministic and does not cause infinite loops

**Prevent initial state violation**
- On app load, if `includeDelivery=false` and `initialState.currentView` would be `'product'`, ensure the view starts at `'metamodel'`
- This handles edge cases where persisted state or deep-links might set an invalid initial view
- Consider checking the toggle value when `ArchitectureProvider` initializes or in a top-level guard

**Conditionally render Project menu items based on includeDatabase**
- When `includeDatabase=false`, the following `FileMenu` items must not render: Create, Open, Save, Save As, Delete
- When `includeDatabase=false`, the following `FileMenu` items must still render: Import as JSON, Export as JSON, Import as XLSX, Export as XLSX
- When `includeDatabase=true`, all menu items render as they do today
- Conditional rendering in `FileMenu.tsx` using `{includeDatabase && <div>...}` pattern

**No UI indicators of gated features**
- There must be no tooltips, badges, banners, greyed-out buttons, or mode indicators revealing that features are disabled
- Absence is the only effect - the UI should appear complete to the user with the available features
- Do not add any "limited mode" or "file-only mode" labels anywhere

**Support mixed-mode configurations**
- `includeDelivery` and `includeDatabase` are independent boolean toggles with no coupling logic
- All four combinations must work correctly:
  - `(true, true)`: Full platform, no gating
  - `(true, false)`: Delivery UI present, DB menu items removed
  - `(false, true)`: Architecture-only UI, DB menu items present
  - `(false, false)`: Architecture-only UI, file-only menu (import/export only)

**Handle separator visibility in FileMenu**
- When `includeDatabase=false`, the separator between Delete and Import as JSON should still appear (it separates DB actions from file actions)
- If all DB items are hidden, the separator may need to be removed or adjusted to avoid orphaned separators
- Ensure clean visual appearance regardless of toggle state

## Existing Code to Leverage

**AppConfigContext (`frontend/src/contexts/AppConfigContext.tsx`)**
- Already provides `useIncludeDelivery()` and `useIncludeDatabase()` hooks
- `AppConfig` interface already defines `includeDelivery: boolean` and `includeDatabase: boolean`
- Configuration loads from `/runtime-config.json` at startup with proper fallback handling

**ArchitectureContext (`frontend/src/contexts/ArchitectureContext.tsx`)**
- `AppState` interface defines `currentView: 'product' | 'metamodel' | 'diagrams'`
- `SET_VIEW` action already handles view changes
- Initial state sets `currentView: 'metamodel'` which is the default allowed view

**TopBar.tsx (`frontend/src/components/TopBar/TopBar.tsx`)**
- Contains the navigation buttons for Product & Delivery, Architecture & Design, and Diagrams
- Already uses `handleViewChange` function to dispatch `SET_VIEW` actions
- Navigation buttons are in a `div.viewToggle` container

**FileMenu.tsx (`frontend/src/components/TopBar/FileMenu.tsx`)**
- Contains all Project menu items: Create, Open, Save, Save As, Delete, Import/Export
- Already has conditional disabled states for various items
- Uses portal rendering for proper z-index stacking

**App.tsx (`frontend/src/App.tsx`)**
- `AppContent` component renders views based on `state.currentView`
- `AppConfigProvider` already wraps the entire app as the outermost provider
- Good location for adding view guard logic

## Out of Scope
- Backend JPA/database silencing configuration (handled by separate spec)
- Export "Project Name" modal behavior and file naming conventions
- Changes to import/export data formats or payload content
- URL-based routing (the app uses state-based navigation, not React Router)
- Persisting user preferences for which view to start on
- Any visual indicators, mode labels, or tooltips about disabled features
- Runtime toggle changes (toggles are startup-only)
- Authentication or authorization logic
- Feature toggle admin UI
- Telemetry or analytics for toggle usage
