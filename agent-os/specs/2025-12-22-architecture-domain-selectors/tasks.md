# Task Breakdown: Architecture Domain Selectors

## Overview
Total Tasks: 53 tasks across 7 task groups

This feature adds domain selectors (Business, Application, Data, Behavioural) to filter entity/relationship tabs in Meta-Model View and palette sections in Diagram View. It includes adding the Behavioural domain with an Events entity, dynamic relationship filtering by FK targets, and enterprise-density styling.

## Task List

### Task Group 1: Add ArchitectureDomain Concept (Types & Config)
**Dependencies:** None

- [x] 1.0 Complete ArchitectureDomain type system and configuration
  - [x] 1.1 Write 4 focused tests for ArchitectureDomain types and utilities
    - Test ArchitectureDomain type includes all 4 domains ('business', 'application', 'data', 'behavioural')
    - Test DOMAIN_LABELS mapping returns correct display names
    - Test DOMAIN_ICONS mapping returns correct lucide-react icon components
    - Test domainGroupings includes all entity tab mappings per domain
  - [x] 1.2 Create `frontend/src/types/architectureDomain.ts` with domain type and constants
    - Define `ArchitectureDomain = 'business' | 'application' | 'data' | 'behavioural'`
    - Export `DOMAIN_LABELS` record mapping domain keys to display names (Business, Application, Data, Behavioural)
    - Export `DOMAIN_ICONS` record mapping domain keys to lucide-react icons (Users, Boxes, Database, Workflow)
    - Export `ALL_DOMAINS` array for iteration: `['business', 'application', 'data', 'behavioural']`
  - [x] 1.3 Update `frontend/src/config/gridConfigs.ts` to extend domainGroupings
    - Add 'behavioural' domain: `behavioural: ['Events']`
    - Add 'Application Points' to application domain grouping
    - Add 'Business Points' to business domain grouping
    - Update domainGroupings type to be `Record<ArchitectureDomain, string[]>`
  - [x] 1.4 Update `frontend/src/config/gridConfigs.ts` tabToEntityType mapping
    - Add `'Application Points': 'application_points'` mapping
    - Add `'Business Points': 'business_points'` mapping
    - Add `'Events': 'events'` mapping for Behavioural domain
  - [x] 1.5 Ensure ArchitectureDomain tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify type exports work correctly
    - Verify configuration mappings are complete

**Acceptance Criteria:**
- ArchitectureDomain type exports correctly
- DOMAIN_LABELS and DOMAIN_ICONS are accessible
- domainGroupings includes all 4 domains with correct entity tabs
- tabToEntityType includes Application Points, Business Points, and Events mappings

---

### Task Group 2: Add Behavioural Events Entity (Model & Grid Config)
**Dependencies:** Task Group 1

- [x] 2.0 Complete Behavioural Events entity integration
  - [x] 2.1 Write 4 focused tests for Events entity functionality
    - Test Event interface has required fields (id, name, description, tags)
    - Test gridConfigs['events'] exists with correct column definitions
    - Test EntityType union includes 'events'
    - Test MetaModelEntities includes events array
  - [x] 2.2 Update `frontend/src/types/model.ts` with Event entity
    - Add `Event` interface with fields: id (string), name (string), description (string), tags (string)
    - Add 'events' to EntityType union type
    - Add `events: Event[]` to MetaModelEntities interface
    - Add Event to AnyEntity union type
  - [x] 2.3 Add Events grid configuration in `frontend/src/config/gridConfigs.ts`
    - Add gridConfigs['events'] with columns:
      - id: autoGenerate, required, width 120
      - name: text, required, width 200
      - description: text, optional, width 300
      - tags: tags cell type, optional, width 200
  - [x] 2.4 Update `frontend/src/config/defaults.ts` emptyModel
    - Initialize `events: []` in emptyModel.metaModel.entities
    - Ensure empty events array is included in default model structure
  - [x] 2.5 Update `frontend/src/contexts/ArchitectureContext.tsx` for Events support
    - Ensure LOAD_MODEL action initializes events array if missing (backward compatibility)
    - Events entity should work with existing ADD_ENTITY, UPDATE_ENTITY, DELETE_ENTITY actions
    - No server persistence needed - frontend-only for this spec
  - [x] 2.6 Ensure Events entity tests pass
    - Run ONLY the 4 tests written in 2.1
    - Verify Events tab renders in Behavioural domain
    - Verify Events grid displays correctly (even if empty)

**Acceptance Criteria:**
- Event interface is defined with all required fields
- gridConfigs['events'] provides valid column configuration
- Events array initializes correctly in state
- Events tab appears when Behavioural domain is selected
- Events grid renders without runtime errors

---

### Task Group 3: Update ArchitectureContext (Shared Domain State)
**Dependencies:** Task Groups 1, 2

- [x] 3.0 Complete shared domain state in ArchitectureContext
  - [x] 3.1 Write 4 focused tests for selectedDomain state management
    - Test initial selectedDomain defaults to 'business'
    - Test SET_DOMAIN action updates selectedDomain correctly
    - Test selectedDomain persists across view switches (metamodel <-> diagrams)
    - Test SET_DOMAIN with invalid tab auto-selects first valid tab for new domain
  - [x] 3.2 Update `frontend/src/contexts/ArchitectureContext.tsx` AppState interface
    - Add `selectedDomain: ArchitectureDomain` to AppState interface
    - Import ArchitectureDomain type from `../types/architectureDomain`
  - [x] 3.3 Add SET_DOMAIN action to AppAction union
    - Define `{ type: 'SET_DOMAIN'; payload: ArchitectureDomain }` action type
  - [x] 3.4 Update initialState in ArchitectureContext
    - Set `selectedDomain: 'business'` as default
    - Optionally derive initial domain from selectedTab if it maps to a known domain
  - [x] 3.5 Add SET_DOMAIN case to appReducer
    - Update selectedDomain in state
    - If current selectedTab is not valid for new domain, auto-select first entity tab of new domain
    - Use domainGroupings to determine valid tabs for the selected domain
  - [x] 3.6 Create helper function `getDomainForTab(tabName: string): ArchitectureDomain | null`
    - Iterate domainGroupings to find which domain contains the given tab
    - Return the domain key or null if not found
    - Export from ArchitectureContext or a utility module
  - [x] 3.7 Ensure ArchitectureContext tests pass
    - Run ONLY the 4 tests written in 3.1
    - Verify domain state changes work correctly
    - Verify tab auto-selection on domain change

**Acceptance Criteria:**
- selectedDomain is part of AppState
- SET_DOMAIN action updates domain and handles tab selection
- Domain state persists when switching between Meta-Model View and Diagrams View
- Invalid tab triggers auto-selection of first valid tab in new domain

---

### Task Group 4: Meta-Model View Header (Domain Selector UI & Tab Filtering)
**Dependencies:** Task Group 3

- [x] 4.0 Complete Meta-Model View domain selector and filtering
  - [x] 4.1 Write 6 focused tests for Meta-Model View domain selector
    - Test domain selector renders 4 icon buttons (Users, Boxes, Database, Workflow)
    - Test clicking domain icon dispatches SET_DOMAIN action
    - Test entity tabs filter to show only selected domain's tabs
    - Test relationship tabs filter based on FK target intersection with domain entities
    - Test tab separators "|" render between individual tabs (not domain groups)
    - Test tooltip shows domain name on icon hover
  - [x] 4.2 Update `frontend/src/components/MetaModelView/MetaModelView.tsx` imports
    - Import ArchitectureDomain, DOMAIN_LABELS, DOMAIN_ICONS from types/architectureDomain
    - Import lucide-react icons: Users, Boxes, Database, Workflow
    - Import domainGroupings, relationshipTabNames, relationshipTabToType, gridConfigs
  - [x] 4.3 Create DomainSelector component in MetaModelView
    - Render 4 icon buttons horizontally
    - Highlight active domain with visual indicator (background color or border)
    - Display active domain label inline next to icons (e.g., "Application")
    - Add onClick handler to dispatch SET_DOMAIN action
    - Add tooltip on hover showing full domain name
  - [x] 4.4 Replace "Entities:" label with DomainSelector in header row
    - Remove `<span className={styles.headerLabel}>Entities:</span>`
    - Add DomainSelector component in its place
    - Maintain horizontal layout with tabs container
  - [x] 4.5 Update entity tabs rendering to filter by selectedDomain
    - Replace multi-domain rendering with single-domain rendering
    - `const entityTabs = domainGroupings[selectedDomain]`
    - Render only tabs from selected domain
    - Render "|" separator between ALL individual tabs (no domain groups)
  - [x] 4.6 Create `getRelationshipTabsForDomain(domain: ArchitectureDomain): string[]` utility
    - For each relationship tab in relationshipTabNames:
      - Get relTypeKey from relationshipTabToType
      - Inspect gridConfigs[relTypeKey] columns
      - Collect fkTarget values from columns where cellType === 'fk_typeahead'
      - Include tab if intersection(fkTargets, domainEntityTypeKeys) is non-empty
    - domainEntityTypeKeys = domainGroupings[domain].map(tab => tabToEntityType[tab])
    - Return filtered array of relationship tab names
  - [x] 4.7 Update relationship tabs rendering to use filtered list
    - Call `getRelationshipTabsForDomain(selectedDomain)` to get visible tabs
    - Render only filtered relationship tabs
    - Render "|" separator between ALL individual relationship tabs
  - [x] 4.8 Ensure Meta-Model View tests pass
    - Run ONLY the 6 tests written in 4.1
    - Verify domain selector renders correctly
    - Verify tab filtering works for both entities and relationships

**Acceptance Criteria:**
- Domain selector shows 4 icons with active state indicator
- Clicking domain icon switches selectedDomain
- Entity tabs show only tabs for selected domain
- Relationship tabs dynamically filter based on FK targets
- Separators appear between individual tabs
- Tooltip shows domain name on hover

---

### Task Group 5: Diagram Palette (Domain Selector & Section Filtering)
**Dependencies:** Task Group 3

- [x] 5.0 Complete Diagram Palette domain selector and filtering
  - [x] 5.1 Write 4 focused tests for Palette domain selector
    - Test domain selector renders at TOP of palette panel (above search)
    - Test clicking domain icon updates selectedDomain via dispatch
    - Test palette sections filter based on selected domain
    - Test domain state syncs between Meta-Model View and Palette
  - [x] 5.2 Update `frontend/src/components/DiagramsView/PalettePanel.tsx` imports
    - Import ArchitectureDomain, DOMAIN_LABELS, DOMAIN_ICONS from types/architectureDomain
    - Import useArchitecture, useArchitectureDispatch for shared state
    - Import lucide-react icons: Users, Boxes, Database, Workflow
  - [x] 5.3 Create PaletteDomainSelector component
    - Render horizontal row of 4 icon buttons
    - Read selectedDomain from ArchitectureContext
    - Dispatch SET_DOMAIN on click
    - Highlight active domain icon
    - Add tooltip on hover showing domain name
    - Style with 16px icons for readability
  - [x] 5.4 Add PaletteDomainSelector to PalettePanel layout
    - Position ABOVE the search input (between header and searchContainer)
    - Add appropriate styling container for domain selector row
  - [x] 5.5 Create domain-to-palette-section mapping
    - Map business domain to: business_users, business_processes, process_activities, business_points, business_user_business_points, interactions
    - Map application domain to: applications, app_components, services, interfaces, endpoints, application_points, application_point_business_points, data_movements
    - Map data domain to: logical_data_entities, logical_data_attributes, physical_data_entities, physical_data_attributes, logical_data_entity_relationships, logical_data_entity_physical_data_entities, logical_data_attribute_physical_data_attributes, interface_logical_entities
    - Map behavioural domain to: events (initially just events entity section)
  - [x] 5.6 Update getPaletteSections to accept domain filter
    - Modify `getPaletteSections(metaModel, searchQuery, selectedDomain?)` signature
    - Filter returned sections based on domain mapping
    - If no domain specified, show all sections (backward compatibility)
  - [x] 5.7 Update PalettePanel to pass selectedDomain to getPaletteSections
    - Read selectedDomain from context
    - Pass to getPaletteSections call
    - Sections will automatically filter based on domain
  - [x] 5.8 Ensure Palette tests pass
    - Run ONLY the 4 tests written in 5.1
    - Verify domain selector appears above search
    - Verify section filtering works correctly

**Acceptance Criteria:**
- Domain selector appears at top of palette panel
- Clicking domain icon changes selectedDomain
- Palette sections filter to show only relevant entities/relationships for domain
- Domain selection persists when switching between views
- Icons remain 16px for readability

---

### Task Group 6: Enterprise Density Styling
**Dependencies:** Task Groups 4, 5

- [x] 6.0 Complete enterprise density styling
  - [x] 6.1 Write 3 focused tests for enterprise density styling
    - Test Meta-Model header tabs have font-size 12px and padding "4px 8px"
    - Test Meta-Model header row has reduced padding
    - Test Palette selector uses consistent enterprise-dense styling
  - [x] 6.2 Update `frontend/src/components/MetaModelView/MetaModelView.module.css` tab styles
    - Change .tab font-size from 13px to 12px
    - Change .tab padding from "8px 12px" to "4px 8px"
    - Reduce .headerRow padding to match enterprise density (e.g., "4px 12px")
    - Update .headerLabel font-size to 12px if needed
  - [x] 6.3 Add domain selector styles to MetaModelView.module.css
    - Add .domainSelector container styles (flex, gap, alignment)
    - Add .domainIcon button styles (padding, border, cursor, hover state)
    - Add .domainIconActive styles for selected state
    - Add .domainLabel styles for inline domain name text
    - Use 16px icons for readability while text is 12px
  - [x] 6.4 Create or update `.tabSeparator` style (reuse/rename from .domainSeparator)
    - Padding: 0 4px (tighter than before)
    - Color: #999
    - Font-size: 14px
  - [x] 6.5 Add PaletteDomainSelector styles to PalettePanel.module.css
    - Add .domainSelectorRow container styles
    - Add .domainIconButton styles with hover and active states
    - Match enterprise density: 12px text, tighter spacing
    - Keep icons at 16px for readability
  - [x] 6.6 Ensure styling tests pass
    - Run ONLY the 3 tests written in 6.1
    - Visually verify reduced density across components

**Acceptance Criteria:**
- Meta-Model tabs use 12px font and 4px 8px padding
- Header rows have reduced padding
- Palette domain selector matches enterprise density
- Icons remain readable at 16px
- Overall UI appears more compact/dense

---

### Task Group 7: Testing and Verification
**Dependencies:** Task Groups 1-6

- [x] 7.0 Complete testing and verification
  - [x] 7.1 Review all tests from Task Groups 1-6
    - Review 4 tests from Task Group 1 (ArchitectureDomain types)
    - Review 4 tests from Task Group 2 (Events entity)
    - Review 4 tests from Task Group 3 (ArchitectureContext state)
    - Review 6 tests from Task Group 4 (Meta-Model View)
    - Review 4 tests from Task Group 5 (Palette)
    - Review 3 tests from Task Group 6 (Styling)
    - Total existing tests: 25 tests
  - [x] 7.2 Identify critical integration gaps
    - Focus on end-to-end workflows for domain switching
    - Verify domain state sync between Meta-Model View and Diagram Palette
    - Verify relationship filtering algorithm correctness
    - Verify Events tab functionality in Behavioural domain
  - [x] 7.3 Write up to 8 additional integration tests if needed
    - Test: Switching domain in Meta-Model View updates Palette domain selector
    - Test: Switching domain in Palette updates Meta-Model View tabs
    - Test: App Point <-> Business Point relationship appears in BOTH Business and Application domains
    - Test: Events grid renders and accepts row additions
    - Test: Tab auto-selection when current tab not in new domain
    - Test: Application Points tab visible in Application domain
    - Test: Business Points tab visible in Business domain
    - Test: Domain selector persists selection after page interaction
  - [x] 7.4 Run all feature-specific tests
    - Run all 25-33 tests related to this feature
    - Verify all tests pass
    - Do NOT run the entire application test suite
  - [x] 7.5 Manual verification checklist
    - [x] Verify Meta-Model View domain selector shows 4 icons
    - [x] Verify clicking Business shows Users, Processes, Activities, Business Points tabs
    - [x] Verify clicking Application shows Applications, App Components, Services, Interfaces, Endpoints, Application Points tabs
    - [x] Verify clicking Data shows Logical Entities, Logical Attributes, Physical Entities, Physical Attributes tabs
    - [x] Verify clicking Behavioural shows Events tab
    - [x] Verify relationship tabs filter dynamically per domain
    - [x] Verify Palette domain selector syncs with Meta-Model View
    - [x] Verify enterprise density styling is applied
    - [x] Verify Events grid works (add/edit/delete rows)
    - [x] Verify no console errors during domain switching

**Acceptance Criteria:**
- All 25-33 feature-specific tests pass
- Domain switching works correctly in both views
- State syncs between Meta-Model View and Diagram Palette
- Relationship filtering correctly includes cross-domain relationships
- Events entity functions correctly in Behavioural domain
- No regressions to existing functionality

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: ArchitectureDomain Concept** - Foundation types and config
2. **Task Group 2: Behavioural Events Entity** - New entity type for new domain
3. **Task Group 3: ArchitectureContext State** - Shared domain state management
4. **Task Group 4: Meta-Model View** - Domain selector UI and tab filtering
5. **Task Group 5: Diagram Palette** - Palette domain selector and section filtering
6. **Task Group 6: Enterprise Density Styling** - CSS updates for compact UI
7. **Task Group 7: Testing and Verification** - Integration tests and manual verification

---

## File Summary

### Files to Create
- `frontend/src/types/architectureDomain.ts` - ArchitectureDomain type and constants
- `frontend/src/components/MetaModelView/DomainSelector.tsx` - Domain selector component
- `frontend/src/components/MetaModelView/DomainSelector.module.css` - Domain selector styles
- `frontend/src/components/DiagramsView/PaletteDomainSelector.tsx` - Palette domain selector component
- `frontend/src/components/DiagramsView/PaletteDomainSelector.module.css` - Palette domain selector styles

### Files to Modify
- `frontend/src/types/model.ts` - Event interface, EntityType union, MetaModelEntities
- `frontend/src/config/gridConfigs.ts` - domainGroupings, tabToEntityType, gridConfigs['events']
- `frontend/src/config/defaults.ts` - emptyModel with events array
- `frontend/src/contexts/ArchitectureContext.tsx` - selectedDomain state, SET_DOMAIN action
- `frontend/src/components/MetaModelView/MetaModelView.tsx` - Domain selector UI, tab filtering
- `frontend/src/components/MetaModelView/MetaModelView.module.css` - Enterprise density styles
- `frontend/src/components/DiagramsView/PalettePanel.tsx` - Domain selector, section filtering
- `frontend/src/components/DiagramsView/PalettePanel.module.css` - Domain selector styles
- `frontend/src/utils/paletteData.ts` - getPaletteSections domain filtering
- `frontend/src/utils/validation.ts` - ENTITY_TYPE_DISPLAY_NAMES mapping
- `frontend/src/utils/sanitize.ts` - events entity in sanitization
- `frontend/src/utils/fileOperations.ts` - events entity in file operations

### Test Files to Create/Update
- `frontend/src/__tests__/architectureDomain.test.ts`
- `frontend/src/__tests__/events-entity.test.ts`
- `frontend/src/__tests__/domain-selector.test.ts`
- `frontend/src/__tests__/metamodel-domain-filtering.test.ts`
- `frontend/src/__tests__/palette-domain-filtering.test.ts`
- `frontend/src/__tests__/enterprise-density-styling.test.ts`
