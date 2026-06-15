# Research Findings: Dashboard UX Improvements

## 1. Dashboard Component Structure

### Files Identified
- **Main Component**: `frontend/src/components/DashboardView/DashboardView.tsx` (553 lines)
- **Styles**: `frontend/src/components/DashboardView/DashboardView.module.css` (563 lines)
- **Skeleton**: `frontend/src/components/DashboardView/DashboardSkeleton.tsx` (72 lines)
- **Types (frontend)**: `frontend/src/types/dashboard.ts` (267 lines)
- **Types (gateway)**: `gateway/src/types/dashboard.ts` (280 lines)
- **Mock Service (gateway)**: `gateway/src/services/dashboardSummaryMockService.ts` (361 lines)
- **Chat Panel**: `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx` (744 lines)
- **Chat Panel Styles**: `frontend/src/components/UnifiedChat/UnifiedChatPanel.module.css` (293 lines)
- **App Entry**: `frontend/src/App.tsx` (202 lines)
- **App Styles**: `frontend/src/App.css` (25 lines)
- **TopBar**: `frontend/src/components/TopBar/TopBar.tsx` (1272 lines)

## 2. Current Dashboard Layout Structure

The dashboard has 3 sections:
1. **Header Summary Bar** - persona icon (Assistant), project name, mode badge, LLM summary placeholder text (~70 words), last updated chip
2. **Strategic Foundation** (bordered `.sectionContainer`) - heading, persona gutter (Product Manager + Architect), 4-column `.strategicGrid`:
   - Product Definition card (State, Mission Exists, Last Updated)
   - Roadmap card (State, Initiatives, Epics, Epics Completed)
   - Standards card (Company Standards: Generated/Not Generated, Product Standards: Generated/Not Generated)
   - High-Level Architecture card (Applications, Services, Interfaces, Data Stores)
3. **Detailed Definition & Delivery** (bordered `.sectionContainer`) - heading, scope control bar, persona gutter (Product Manager, Architect, UX Designer, Test Engineer, Software Developer):
   - **Definition** sub-section (`.subSectionGroup` with blue dashed border + label): Backlog, Detailed Architecture, Testing Suite cards
   - **Delivery** sub-section (`.subSectionGroup` with blue dashed border + label): Implementation, Verification, Summary Insight (disabled) cards

## 3. Current Sub-Section Pattern (Detailed Definition & Delivery)

The `.subSectionGroup` CSS class provides the bordered sub-section pattern:
- Blue dashed border: `border: 1.5px dashed #90caf9`
- Border radius: `border-radius: 6px`
- Padding: `padding: 12px 16px`
- A floating label via `.subSectionGroupLabel` positioned absolutely at `top: -8px, left: 12px` with white background

Currently used for "Definition" and "Delivery" sub-groups inside "Detailed Definition & Delivery".

## 4. Persona System

### PersonaIcon Component (in DashboardView.tsx)
- Renders a colored circle with `User` icon (from lucide-react) + label text below
- Colors defined in `PERSONA_COLORS` map:
  - Assistant: #5C6BC0
  - Product Manager: #C62828
  - Architect: #7B1FA2
  - UX Designer: #F57C00
  - **Test Engineer: #2E7D32** (already defined!)
  - Software Developer: #455A64

### Current Persona Gutter Layout
- Strategic Foundation section: **Product Manager** + **Architect** (2 personas)
- Detailed D&D section: **Product Manager** + **Architect** + **UX Designer** + **Test Engineer** + **Software Developer** (5 personas)

## 5. Summary Insight Card (Currently Disabled)

Located in the Delivery sub-group of Detailed D&D:
```tsx
<div className={`${styles.card} ${styles.cardDisabled}`} data-testid="card-summary-insight">
  <div className={styles.cardHeader}>
    <span className={styles.cardIcon}>bulb emoji</span>
    <span className={styles.cardTitle}>Summary Insight</span>
  </div>
  <div className={styles.disabledText}>AI insights coming soon</div>
</div>
```

CSS for disabled state:
- `.cardDisabled`: `opacity: 0.5; pointer-events: none;`
- `.disabledText`: `font-size: 12px; color: #888; font-style: italic;`

## 6. Default View / Tab Navigation

### Initial State (ArchitectureContext.tsx, line 256)
```typescript
const initialState: AppState = {
  currentView: 'metamodel',  // <-- Default is 'metamodel' (Architecture & Design)
  ...
};
```

### View Types
`currentView: 'product' | 'metamodel' | 'diagrams' | 'dashboard'`

### TopBar Navigation Buttons (order)
1. Dashboard
2. Product & Delivery (conditionally rendered)
3. Architecture & Design
4. Diagrams

## 7. Chat Panel Layout (Currently Overlay)

### UnifiedChatPanel Positioning (CSS)
```css
.panel {
  position: fixed;
  top: 60px;
  right: 0;
  height: calc(100vh - 60px);
  z-index: 900;
  /* ... */
}
```

The chat panel is **fixed-position, right-anchored** -- it overlays the main content rather than sitting side-by-side. Default width is 380px, min 280px, max 50vw. Collapsed state is a 32px wide vertical tab.

### Main Content Layout (App.css)
```css
.main-content {
  flex: 1;
  margin-top: 60px;
  height: calc(100vh - 60px);
  overflow: hidden;
}
```

### Chat Panel Rendered By DashboardView
The `UnifiedChatPanel` is rendered directly inside `DashboardView.tsx` (lines 534-549), not in `App.tsx`. It receives:
- `threadKey`, `initialPersonaId`, `defaultOpen={true}`, `onArtifactSaved`, `artifactExists`, `selectedScope`

## 8. Strategic Foundation Grid

Currently a 4-column grid:
```css
.strategicGrid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}
```
With responsive breakpoints at 1200px (2 columns) and 600px (1 column).

## 9. Mock Data Values (Gateway)

### Product Definition
- state: card('State', 45) -- rendered as "State: 45"
- missionExists: card('Mission Exists', 1) -- rendered as "Mission Exists: 1"
- lastUpdatedLabel: card('Last Updated', 0) -- rendered as "Last Updated: 0"

### Roadmap
- state: card('State', 30)
- initiativesCount: card('Initiatives', 5)
- epicsCount: card('Epics', 12)
- epicsCompletedCount: card('Epics Completed', 4)

### Standards
- companyStandards: card('Company Standards', 1) -- rendered as "Company Standards: Generated"
- productStandards: card('Product Standards', 1) -- rendered as "Product Standards: Generated"

### Implementation (Post-Coding)
- Single MetricCard: card('Implementation', 28) -- rendered as "Implementation: 28"

## 10. Type System Implications

### Current MetricCard Type
```typescript
interface MetricCard {
  label: string;
  value: number;
}
```
All metric values are **numeric**. The feature description requests metrics like "Exists? True", "Last Updated: 08/03/2026", "Org Tech Stack: Generated" which are **string values**. This will require either:
- A new type that supports string values
- Using the existing numeric type with rendering logic that maps numbers to display strings (e.g., value 1 = "True")
- Keeping the label to encode the display value (e.g., label: "Exists? True")

### StrategicFoundationSection
Currently no `testStrategy` field exists. Adding Test Strategy card requires extending this interface (both frontend and gateway types).

## 11. Key Observations for Spec Decisions

1. **Test Strategy Card**: No `testStrategy` field in `StrategicFoundationSection`. Needs new field + mock data. The Test Engineer persona color is already defined.

2. **Sub-section Split**: The `.subSectionGroup` pattern already exists and is used in Detailed D&D. Reusing it for Strategic Foundation ("Product" and "Technical" sub-sections) is straightforward. However, the grid needs to change from 4-column flat to accommodate cards in two different sub-groups.

3. **Metric Type Mismatch**: MetricCard has `value: number` but several requested metrics need string display values (e.g., "True", "01/03/2026", "Generated"). The Standards card already works around this by rendering "Generated" or "Not Generated" from the numeric value in the JSX. Similar approach could work.

4. **Chat Panel Layout Change**: Moving from `position: fixed` overlay to side-by-side requires restructuring App.css and/or DashboardView layout. The 30/70 split means the dashboard content area shrinks when chat is open. This also affects the UnifiedChatPanel CSS significantly.

5. **Default View Change**: Simple change from `currentView: 'metamodel'` to `currentView: 'dashboard'` in initial state.

6. **Summary Insight**: Currently disabled with `cardDisabled` CSS class and "AI insights coming soon" text. Enabling it means removing the class, adding an "Open" button, and displaying ~50 words of mock progress text.

7. **Header Summary Text**: Currently hardcoded placeholder: "This is a placeholder for an LLM-generated summary..." Needs replacement with ~70-word believable progress description.

8. **Implementation Card Metrics**: Currently displays a single MetricCard. Feature requests multiple metrics: "Features in Progress: 2", "Stories in Progress: 7", "Stories Complete: 5". This requires changing the `implementation` field from a single `MetricCard` to a structured type (similar to other cards).

9. **DashboardSkeleton**: Will need updating to reflect the new 5-card Strategic Foundation layout with sub-sections.
