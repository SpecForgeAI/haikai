# Specification: Add Package Sets Screen in Architecture & Design Navigation

## Goal
Expose Package Sets in the Architecture & Design UI so users can view available package sets and their embedded packages, without adding Packages as a separate top-level navigation item.

## User Stories
- As an architect, I want to view all package sets in a dedicated screen so that I can understand the available package structures for service design
- As a developer, I want to select a package set and see its packages so that I can understand which packages are included without navigating to a separate Packages table

## Specific Requirements

**Add "Package Sets" to Navigation**
- Add "Package Sets" as a new selectable item in the Architecture domain within domainGroupings
- Place it after existing application-structure entities (Services, Interfaces, Endpoints, Classes, Methods)
- Do NOT add "Packages" as a separate navigation tab - packages are only shown embedded within a selected package set
- Update tabToEntityType mapping: 'Package Sets' -> 'package_sets'
- Update DOMAIN_ENTITY_TYPES for 'application' to include 'package_sets' and 'packages'

**Package Sets Master List Grid**
- When "Package Sets" tab is selected, show a read-only grid listing all package sets from metaModel.entities.package_sets
- Required columns: Name (string, from package_set.name), Package Count (derived: count of packages where package_set_id matches)
- Grid rows must be selectable (click to select, highlight selected row)
- Use existing Grid component pattern but in read-only mode (no Add/Delete buttons, no inline editing)

**Package Set Detail Panel**
- When a package set row is selected, display a detail panel showing embedded packages
- Panel position: Right side (consistent with existing Inspector panel pattern) or below the grid
- Detail panel header: Package Set name (read-only display)
- Embedded packages table columns: Package Name (name), Purpose (purpose), Order (sort_order, optional)
- Sort packages by sort_order when available, else by stable array index

**Package Count Derivation**
- Compute package count per set dynamically: packages.filter(p => p.package_set_id === set.id).length
- Use useMemo for performance optimization to avoid recalculation on every render
- Display count in the master grid's "Package Count" column

**Empty States**
- If metaModel.entities.package_sets is empty or undefined, display: "No package sets available yet."
- If selected package set has zero packages, display in detail panel: "No packages defined for this package set."
- Empty state messages should be styled consistently with existing empty states in the application

## Visual Design
No mockups provided - follow existing MetaModelView patterns for layout and styling.

## Existing Code to Leverage

**`frontend/src/types/model.ts` - PackageSet and Package interfaces**
- PackageSet: { id: string, name: string }
- Package: { id: string, package_set_id: string, name: string, purpose?: string, sort_order?: number }
- MetaModelEntities already includes package_sets and packages arrays
- ENTITY_TYPES includes PACKAGE_SET and PACKAGE constants

**`frontend/src/config/gridConfigs.ts` - Tab and Domain Configuration**
- tabToEntityType: Add 'Package Sets': 'package_sets' mapping
- domainGroupings.application: Add 'Package Sets' to the array
- DOMAIN_ENTITY_TYPES.application: Add 'package_sets' and 'packages'
- Do NOT add entries for 'Packages' tab

**`frontend/src/components/MetaModelView/MetaModelView.tsx` - View Component Pattern**
- Uses useArchitecture() hook to access state.model.metaModel.entities
- Uses domainGroupings to filter visible tabs per domain
- Grid component renders entity data based on selected tab
- Pattern for conditionally rendering different components based on selected tab

**`frontend/src/components/Grid/Grid.tsx` - Grid Component**
- Uses gridConfigs[entityType] for column definitions
- Renders entities from state.model.metaModel.entities[entityType]
- Supports row selection via selectedRowId state
- Can be used with modification for read-only rendering (hide action buttons)

**`frontend/src/contexts/ArchitectureContext.tsx` - State Access**
- useArchitecture() provides access to state.model.metaModel.entities.package_sets and packages
- No new actions required - this is a read-only view

## Out of Scope
- Creating new package sets (future iteration)
- Cloning existing package sets (future iteration)
- Editing package set names (future iteration)
- Adding, editing, or deleting packages within a package set (future iteration)
- Assigning package sets to services (future iteration)
- Inline editing capabilities in the Package Sets grid
- Adding "Packages" as a separate navigation item
- Backend schema changes or API modifications
- Any changes to the existing model load/save functionality
- Palette integration for Package Sets (diagrams view)
