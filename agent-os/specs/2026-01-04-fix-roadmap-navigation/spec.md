# Specification: Fix ProductRoadmapPage Navigation Error

## Goal
Resolve the runtime error "useNavigate() may be used only in the context of a <Router> component" on the Roadmap tab by replacing the react-router-dom navigation with a callback prop that integrates with ProductView's existing URL-query-param tab system.

## User Stories
- As a user, I want to click "Go to Backlog" on the Roadmap page and be taken to the Backlog tab without encountering a runtime error.
- As a developer, I want navigation between tabs to use the existing URL-based routing pattern consistently across all ProductView child pages.

## Specific Requirements

**Remove useNavigate hook from ProductRoadmapPage**
- Remove the import statement: `import { useNavigate } from 'react-router-dom';`
- Remove the hook call: `const navigate = useNavigate();`
- This eliminates the runtime error caused by missing Router context

**Add onNavigateToBacklog callback prop to ProductRoadmapPage**
- Add prop type definition: `onNavigateToBacklog: () => void`
- This follows the same callback pattern used by ProductBacklogPage's `onNavigateToRoadmap` prop
- Prop is required since the "Go to Backlog" button depends on it

**Update handleGoToBacklog to use callback prop**
- Replace `navigate('/product/backlog')` with `onNavigateToBacklog()` call
- Update useCallback dependency array from `[navigate]` to `[onNavigateToBacklog]`
- Maintain the existing function signature and button event binding

**Wire callback prop in ProductView**
- Pass `onNavigateToBacklog={() => handleTabChange('backlog')}` when rendering ProductRoadmapPage
- Use the existing `handleTabChange` function which already handles state and URL updates
- This ensures URL sync and state management happen through the established pattern

**Update TypeScript interface**
- Add `ProductRoadmapPageProps` interface with `onNavigateToBacklog: () => void`
- Update the component function signature to accept props parameter
- Ensure clean compilation with no type errors

**Update existing tests**
- Modify ProductRoadmapPage.test.ts to mock or provide the `onNavigateToBacklog` prop
- Verify the callback is invoked when "Go to Backlog" button is clicked
- Ensure all existing test assertions continue to pass

## Existing Code to Leverage

**ProductBacklogPage callback pattern (ProductBacklogPage.tsx lines 43-48)**
- Uses identical interface pattern with optional callback: `onNavigateToRoadmap?: () => void`
- Shows how to define props interface and destructure in component function
- Demonstrates fallback behavior when callback not provided (though not needed here)

**ProductView handleTabChange function (ProductView.tsx lines 108-118)**
- Existing function that manages tab state and URL updates via `updateUrl()`
- Already used for tab bar button clicks, should be reused for child page navigation
- Handles workItemId clearing logic when switching away from implement tab

**ProductView child component wiring (ProductView.tsx lines 169-180)**
- Shows existing pattern for passing callbacks to ProductBacklogPage and ProductImplementPage
- ProductRoadmapPage at line 179 currently passes no props - this needs updating
- Pattern: `<ProductBacklogPage onWorkOnThis={handleWorkOnThis} />`

**updateUrl helper function (ProductView.tsx lines 64-72)**
- Used internally by handleTabChange to sync URL with tab state
- Uses `window.history.pushState` for URL updates without page reload
- Ensures browser back/forward works correctly via popstate listener

## Out of Scope
- Wrapping the application in BrowserRouter or adding React Router routes
- Changing the global navigation model to path-based routing
- Removing the react-router-dom dependency from package.json
- Adding new navigation methods or patterns beyond the callback prop
- Modifying ProductImplementPage or ProductBacklogPage navigation
- Changing the URL parameter format (?tab=backlog|implement|roadmap)
- Adding new tabs or modifying the tab bar UI
- Refactoring ProductView's existing URL parsing or popstate handling
- Adding unit tests beyond updating existing ones for the prop change
- Performance optimizations or code cleanup unrelated to the navigation fix
