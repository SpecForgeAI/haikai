# Requirements: Architecture Domain Selectors in Meta-Model Header and Diagram Palette

## Title
Introduce Architecture Domain selectors in Meta-Model header and Diagram Palette (plus Behavioural "Event" starter entity)

## Intent
- Reduce UI clutter by showing ONE Architecture Domain at a time in:
  1. Meta-Model View top header rows (Entities + Relationships)
  2. Diagram View RHS Palette panel
- Make relationship tab visibility future-proof and dynamic:
  - Relationship tabs shown for a domain are derived from relationship grid FK targets
  - Relationships may appear in multiple domains
- Apply "enterprise density" styling:
  - Reduce tab font size from 13px -> 12px
  - Reduce tab padding from "8px 12px" -> "4px 8px"
- Add Behavioural Architecture domain now, with a single starter entity/table:
  - Behavioural -> Events (minimal grid; attributes can be refined later)

## Scope

### In Scope
- Frontend only (React/TS)
- Meta-Model view header UX changes (domain selector + single-domain tabs)
- Diagram RHS Palette domain selector UX changes
- Dynamic relationship filtering by FK targets (meta-model relationships only)
- Add Behavioural "Events" entity tab + minimal grid config + entity type wiring
- Show separators " | " between ALL tabs within the active domain row (entities and relationships)

### Out of Scope
- Diagram rendering changes (sequence/state/activity/ER visuals)
- Adding the other 11 new entities (Class/Method + remaining Behavioural entities)
- Adding Infrastructure Architecture domain
- Backend persistence / APIs for Events beyond what's needed to keep UI working

---

## Acceptance Criteria

### Meta-Model View
- Adds a domain selector control using lucide-react icons:
  - Business: Users
  - Application: Boxes
  - Data: Database
  - Behavioural: Workflow
- Domain selector is placed on the LEFT of the Entities row (replacing the "Entities:" label area), and shows the active domain name inline (e.g. "🧩 Application") once selected
- Only entity tabs for the selected domain are displayed
- Entity tabs are separated by a visible "|" separator between each tab (no grouping separators)
- Relationships row shows only relationship tabs whose FK endpoints intersect the selected domain's entity types
- Relationship tabs are separated by "|" between each tab
- Clicking a domain switches the visible entity/relationship tabs, and auto-selects a valid tab if current selection is not in the domain

### Diagram View RHS Palette
- Adds an icon-tab domain selector at the TOP of the palette panel (above existing palette content)
- Selector filters the palette's sections to the selected domain (initially using existing palette groupings; do not add diagram-type awareness yet)
- Uses same 4 icons; tooltips on hover

### Styling
- Meta-model header tabs and relationship tabs use font-size 12px and padding "4px 8px"
- Palette selector and section/tab items adopt comparable tighter spacing so the overall UI reads "enterprise-dense"

### Behavioural Domain + Event Starter
- Behavioural domain exists and is selectable in both Meta-Model header and RHS palette
- Meta-Model Entities row for Behavioural contains a single entity tab: "Events"
- Events grid renders successfully (even if empty) without runtime errors

---

## Implementation Plan

### 1) Add ArchitectureDomain Concept (Frontend)

Create a simple enum/type and mapping utilities:

**src/types/architectureDomain.ts (or equivalent):**
```typescript
export type ArchitectureDomain = 'business' | 'application' | 'data' | 'behavioural'

export const DOMAIN_LABELS = {
  business: 'Business',
  application: 'Application',
  data: 'Data',
  behavioural: 'Behavioural'
}

export const DOMAIN_ICONS = {
  business: Users,
  application: Boxes,
  data: Database,
  behavioural: Workflow
} // using lucide-react
```

**Update src/config/gridConfigs.ts:**
- Extend domainGroupings with:
  - business: include existing + any already-supported-but-hidden business entities
  - application: include existing + any already-supported-but-hidden application entities
  - data: unchanged
  - behavioural: ['Events'] (new)

**IMPORTANT NOTE (for relationship cross-domain visibility):**
- application_points and business_points are already present in gridConfigs, but currently not in entityTabNames/domainGroupings
- Add these existing entity tabs now (this is not "adding new entities", just making existing ones visible):
  - Add entity tabs:
    - 'Application Points' -> 'application_points'
    - 'Business Points' -> 'business_points'
  - Add to domainGroupings:
    - application includes 'Application Points'
    - business includes 'Business Points'
  - This enables dynamic relationship filtering to correctly surface:
    - 'App Point <-> Business Point' in BOTH Business and Application domains

### 2) Add Behavioural Events Entity (Minimal, Frontend Model Wiring)

**Update src/config/gridConfigs.ts:**
- Add gridConfigs['events'] with minimal columns:
  - id (autoGenerate)
  - name (required)
  - description (optional)
  - tags (optional) if consistent with other entities
- Add tabToEntityType:
  - 'Events': 'events'
- Add entityTabNames entry for 'Events' ONLY if domain-scoped rendering still relies on entityTabNames globally

**Update src/types/model.ts:**
- Add EntityType union entry for 'events'

**Events Data Behavior (to avoid backend dependency now):**
- If ArchitectureContext expects all entity types to exist in state, initialize state.events = []
- Ensure CRUD actions do not crash when operating on 'events'
- If the API layer currently fetches entity collections by type, add a safe fallback:
  - For now, Events can be "frontend-only" (no network calls)
  - Grid can display empty and allow local add/edit if architecture state pattern allows it
- Do NOT implement server persistence in this spec

### 3) Meta-Model Header: Replace Domain Grouping UI with Domain Selector + Single-Domain Tabs

**Update src/components/MetaModelView/MetaModelView.tsx:**

Introduce selectedDomain in UI state:
- Prefer storing in ArchitectureContext so Diagram palette can share it; otherwise keep local and later lift

**Domain Selector UI:**
- Left side of the Entities row contains:
  - Icon segmented selector (4 icons)
  - Active domain label inline once selected (e.g. "Application")
  - Example: [Boxes icon] Application
  - On hover of each icon: tooltip with full domain name

**Entity Tabs Rendering:**
- Instead of rendering all domainGroupings, render ONLY domainGroupings[selectedDomain]
- Render separators " | " between each tab (not just between domain groups)

**Relationship Tabs Rendering:**
- Replace static relationshipTabNames render with a computed list:
  - relationshipTabNamesForDomain(selectedDomain)
- Render separators " | " between each relationship tab

**Relationship Filtering Algorithm (dynamic, future-proof):**
```
Let domainEntityTypeKeys = domainGroupings[selectedDomain].map(tab => tabToEntityType[tab])

For each relationship tabName in relationshipTabNames:
  relTypeKey = relationshipTabToType[tabName]
  Inspect gridConfigs[relTypeKey] columns:
    collect fk targets from any column where cellType === 'fk_typeahead' and fkTarget is defined
    these fkTarget values are entity type keys (e.g. 'business_users', 'application_points', etc.)
  Include relationship tab if intersection(fkTargets, domainEntityTypeKeys) is non-empty
```
- This automatically allows relationships to appear in multiple domains

**Tab Selection Behavior:**
- When domain changes:
  - If current selectedTab is not valid in that domain (not in entity tabs and not in filtered relationship tabs), auto-select the first entity tab of that domain (preferred), else first relationship tab if domain has no entities
- Keep existing behavior for selecting tabs (SELECT_TAB action)

**Update src/components/MetaModelView/MetaModelView.module.css:**
- Tab font-size: 12px
- Tab padding: 4px 8px
- Reduce header row padding/margins to match enterprise density
- Add styles for:
  - Domain icon selector container
  - Active domain "pill" or inline label
  - Separator styling (domainSeparator reused or new "tabSeparator")

### 4) Diagram RHS Palette: Add Domain Icon Tabs and Filter Palette Sections by Domain

**Update src/components/DiagramsView/PalettePanel.tsx (and/or PaletteSection wiring):**

Add domain selector row at very top of palette:
- Icon tabs: Users / Boxes / Database / Workflow
- Tooltip on hover
- Selected state highlighted

Use the same selectedDomain state as Meta-Model:
- If ArchitectureContext is updated to hold selectedDomain, read from there
- Otherwise, introduce a lightweight UI context or prop drilling from DiagramsView root

Filter which palette sections are shown based on selectedDomain:
- Map existing palette section ids to domains
- Do NOT introduce diagram-type awareness in this spec

Ensure selection persists when switching between Meta-Model View and Diagrams View

Apply density styling to palette selector:
- Match 12px and tighter padding where applicable
- Ensure icons remain readable (use 16px icons if needed while text is 12px)

### 5) Update ArchitectureContext to Store selectedDomain (Shared State)

**Update src/contexts/ArchitectureContext.tsx:**
- Add selectedDomain to state with default:
  - Derive from current selectedTab on initial load if possible
  - Else default to 'business'
- Add action:
  - SET_DOMAIN(domain)
- Update reducer:
  - SET_DOMAIN updates selectedDomain and may also adjust selectedTab to a valid tab (or delegate that to MetaModelView logic—choose one place, not both)
- Ensure no regression to existing tests

---

## Tests
- Add/update unit tests where appropriate:
  - MetaModelView:
    - Switching domain updates visible entity tabs
    - Relationship tabs are filtered dynamically based on fkTargets (use a relationship known to match two domains: App Point <-> Business Point)
    - Separators render between tabs
  - PalettePanel:
    - Switching domain filters palette sections (at least one assertion per domain)
- Update snapshots if any exist for these components

---

## Notes
- Do not implement "domain badges" on relationship tabs in this spec
- "Events" entity is intentionally minimal; the full Behavioural model (12 entities) will be designed in a subsequent spec
- Ensure no breaking change to existing diagram interactions or grid behavior outside of header/palette filtering

---

## Deliverables
- Updated MetaModelView header UX with domain icon selector + active label + single-domain tabs + separators
- Dynamic relationship tab filtering by FK target inspection
- RHS palette domain icon tabs and domain filtering
- Enterprise density CSS adjustments (12px, 4px 8px, reduced row padding)
- Behavioural domain enabled with "Events" entity tab and minimal grid config
