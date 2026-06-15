# Raw Idea: Feature Shaping UI Consumes Planner JSON

## Goal
Update the Implement screen to render a Feature Definition area driven by the Planner's structured JSON output (PlannerResponse), with a separate Team Chat area for conversation.

## User Decisions
1. **Layout:** Left panel (Feature Definition 60%) / Right panel (Team Chat 40%)
2. **Styling:** Card-based sections (Description, Understanding, Scope, etc.)
3. **State Management:** Local state in ImplementationAssistantPanel

## Key Changes

### Layout Restructure
- Split panel: Feature Definition (left) + Team Chat (right)
- Feature header with work item title
- Card sections for each planner field

### Feature Definition Sections (from PlannerResponse)
- Description (work item - immutable)
- Product Owner Understanding (featureUnderstanding)
- Scope / Out of Scope (scope.in/out)
- Acceptance Criteria (acceptanceCriteria[])
- Assumptions (assumptions[])

### Team Chat
- Shows only message field from planner responses
- Keeps conversation separate from feature definition
- Personas: Tool User, Product Owner

### State Management
- Track latest valid plannerResponse locally
- Fall back to previous valid response if current is invalid
- Empty states for missing sections
