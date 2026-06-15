# Requirements: Meta-Model View - UI Domain Tab

## Title
Meta-Model View - add 5th "UI" domain tab (monitor-smartphone) with 4 UI entity tables and no relationships

## Scope
Frontend-only. One UI-domain navigation + tables increment in Meta-Model view (no Diagram View RHS yet)

## Goal
Add a new architecture domain "UI" to the Meta-Model view so users can manage UI-related entities.
- UI domain appears after Behavioural in the domain tab bar
- UI domain shows 4 entity tables:
  1) UI Screens (UIScreen)
  2) UI Workflow Transitions (UIWorkflowTransition)
  3) UI Components (UIComponent)
  4) UI Actions (UIAction)
- UI domain has NO Relationships section/tabs for now

## User Stories
- As an architect, I want to manage UI Screen entities in the Meta-Model view so I can define the screens in my application
- As an architect, I want to define UI Workflow Transitions to specify navigation flows between screens
- As an architect, I want to manage UI Components and UI Actions alongside other meta-model entities

## Acceptance Criteria
1) Meta-Model domain tabs show: Business, Application, Data, Behavioural, UI (UI is last).
2) UI domain tab uses lucide-react icon: monitor-smartphone.
3) When UI domain is selected:
   - Entities row shows exactly: UI Screens | UI Workflow Transitions | UI Components | UI Actions
   - Clicking each entity tab renders a table/grid view consistent with existing Meta-Model entity tables (Add Row/Delete Row/edit cells).
4) UI domain shows no Relationships row (or it is hidden/empty) and no relationship tabs are rendered.
5) Edits in UI tables persist via the existing "save model" pipeline and re-load correctly.

## Out of Scope
- No changes to Diagram View RHS palette/editor in this increment
- No new "UI Contract" entity (UI actions continue to reference existing Interface/InterfaceEndpoint where needed)
- No backend changes (assumes entities already exist and are loaded as part of the model)
- No relationship tabs or relationship management for UI domain
