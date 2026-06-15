# Specification: Implement Screen Change 1 - Remove RHS WorkItemSummaryPanel

## Goal
Remove the redundant right-hand "Work Item" panel from the Implement screen and relocate Epic display and Context selector into the left Feature Definition area, producing a clean 2-column layout (Feature Definition + Team Chat).

## User Stories
- As a product owner, I want to see the Epic and Feature context directly in the Feature header so that I understand the work item hierarchy without a separate panel
- As a developer, I want a cleaner 65/35 split layout so that I have more space for the Feature Definition content and Chat interaction

## Specific Requirements

**Remove WorkItemSummaryPanel from ProductImplementPage**
- Stop rendering WorkItemSummaryPanel in the rightPane div of ProductImplementPage.tsx
- Remove the rightPane div entirely from ProductImplementPage.tsx
- Remove the import statement for WorkItemSummaryPanel from ProductImplementPage.tsx
- Remove onBackToBacklog prop from ProductImplementPageProps (no longer needed)
- Clean up any unused state/callbacks related to WorkItemSummaryPanel (e.g., context chip removal handlers if moved)

**Update Layout to 65/35 Two-Column Split**
- Modify ProductImplementPage.module.css to remove rightPane styles
- The leftPane should occupy 100% width (it becomes the only pane in ProductImplementPage)
- The inner 65/35 split is already handled inside ImplementationAssistantPanel via splitContainer (60/40 currently)
- Update ImplementationAssistantPanel.module.css to change featurePanel from 60% to 65% and chatPanel from 40% to 35%

**Add Epic Display to FeatureHeader**
- Extend FeatureHeader.tsx to accept optional epicName prop
- Display format: "Epic: [name max 30 chars] -> Feature: [name]"
- If epicName exceeds 30 characters, truncate with ellipsis (e.g., "Epic: Very Long Epic Name Tru...")
- Epic display is read-only with no interactivity
- If epicName is undefined/null, show only "Feature: [name]" (current behavior)
- Update FeatureHeader.module.css to add styling for the epicLabel and arrow separator

**Move Context Selector into FeatureDefinitionPanel**
- Add a new FeatureSectionCard for "Context" in FeatureDefinitionPanel.tsx
- Position the Context section below Description and above Product Owner Understanding
- Extract ContextSection component from WorkItemSummaryPanel.tsx into a shared location or duplicate the logic
- Pass contextState, contextLoading, onAddContext, onRemoveEntityChip, onRemoveDiagramChip as new props to FeatureDefinitionPanel

**Style Context Header to Match Feature Headers**
- Context section header should match FeatureSectionCard header styling (14px, 600 weight, #333333)
- Position "Add context" button on the right side of the header (flex with justify-content: space-between)
- Chip styling (entity, diagram, relationship) remains unchanged from current WorkItemSummaryPanel styles
- Reuse existing chip components (EntityChip, DiagramChip, RelationshipChip, aggregated variants)

**Remove Back to Backlog Button**
- Do not relocate the "Back to Backlog" button - remove it entirely
- Remove onBackToBacklog callback from all component props where it was passed

**Delete Unused Code in WorkItemSummaryPanel**
- WorkItemSummaryPanel.tsx can be deleted or left as unused code
- If deleting, also remove WorkItemSummaryPanel.module.css
- Remove any unused exports from index files

## Visual Design
No visual assets provided.

## Existing Code to Leverage

**FeatureHeader.tsx and FeatureHeader.module.css**
- Current implementation renders dark banner with "Feature:" label and title
- Has existing isReadyForSpec badge pattern that can inform epic label placement
- Styling uses #2D2D2D background, white text, 12px 16px padding, flex with baseline alignment

**FeatureSectionCard.tsx and FeatureSectionCard.module.css**
- Reusable card wrapper with title header and content area
- Already handles empty states with customizable messages
- Section header styling: 14px, 600 weight, #333333, bottom border #F0F0F0
- Use this pattern for the Context section card

**WorkItemSummaryPanel.tsx ContextSection component**
- Contains all context chip logic (EntityChip, DiagramChip, RelationshipChip)
- Contains aggregation functions (aggregateEntityChips, aggregateDiagramChips, aggregateRelationshipChips)
- Contains getChipDisplayLabel helper for fallback display
- Has contextHeader with label and Add context button pattern

**ProductImplementPage.tsx context state management**
- All context state (contextState, contextLoading, isContextModalOpen) lives here
- Handlers (handleAddContext, handleContextApply, handleRemoveEntityChip, handleRemoveDiagramChip) already exist
- ContextPickerModal integration already implemented - can reuse as-is

**ImplementationAssistantPanel.module.css splitContainer layout**
- Already has 60/40 split between featurePanel and chatPanel
- Has responsive breakpoints for tablet (stacked 50/50) and mobile (tab layout)
- Simply update percentages from 60/40 to 65/35

## Out of Scope
- Any changes to backend endpoints or response shapes
- Any changes to context selection logic or persistence semantics
- Any changes to Team Chat behavior or ChatMessageList component
- Changes to loading or error states
- Any interactivity for the Epic display (it is display-only)
- Parent chain breadcrumb display (removed with WorkItemSummaryPanel)
- Children list display (removed with WorkItemSummaryPanel)
- Title, Type badge, Status badge display (removed with WorkItemSummaryPanel)
- Description field from WorkItemSummaryPanel (workItemDescription already shown in FeatureDefinitionPanel)
