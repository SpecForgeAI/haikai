# Specification: Implement Triggers Plan Generation

## Goal
When the user clicks "Implement" after the confirmation modal, trigger implementation plan generation via the gateway using phase: 'implementation_planning', display the resulting plan in the Feature Definition panel, and show a summary message in Team Chat.

## User Stories
- As a product owner, I want to see an implementation plan with increments when I click Implement so that I can understand how the feature will be broken down for development.
- As a product owner, I want the first increment to be highlighted as active so that I know where implementation will begin.

## Specific Requirements

**Add 'implementation_planning' phase to frontend ImplementChatPhase type**
- Extend ImplementChatPhase in chatApi.ts from 'bootstrap' | 'refine' | 'handoff' to include 'implementation_planning'
- This aligns the frontend type with the gateway ImplementChatPhase which already includes 'implementation_planning'
- No changes needed in gateway since the phase already exists there

**Replace proceedWithImplementation with generateImplementationPlan**
- Remove or rename the existing proceedWithImplementation function in ImplementationAssistantPanel
- Create new generateImplementationPlan async function that sends phase: 'implementation_planning' to gateway
- Call postChatMessage with context including phase: 'implementation_planning' (not intent: 'generate_specs')
- Gateway already supports this phase and uses IMPLEMENT_PLANNING_PROMPT_TEMPLATE
- Gateway validation expects implementationPlan with >= 1 increment when expectImplementationPlan is true

**Update handleImplementClick flow to call generateImplementationPlan**
- After modal confirmation (or if no open questions), call generateImplementationPlan instead of proceedWithImplementation
- Change button text to "Generating Plan..." during the API call using isImplementing state
- On success: store implementationPlan in latestPlannerResponse, auto-select first increment
- On failure: display non-blocking error message in chat (do not break the flow)

**Add activeIncrementId state to ImplementationAssistantPanel**
- Add new state: const [activeIncrementId, setActiveIncrementId] = useState<string | null>(null)
- On successful plan generation, auto-set to first increment ID: plan.increments[0].id
- This state determines which IncrementCard has the active visual indicator

**Create ImplementationPlanSection component**
- New file: frontend/src/components/ProductView/ImplementationPlanSection.tsx
- Receives implementationPlan (ImplementationPlan | null), activeIncrementId (string | null), and onIncrementSelect callback
- Renders plan title and list of IncrementCard components
- Hidden when implementationPlan is null
- Display after existing FeatureDefinitionPanel sections (after Assumptions)

**Create IncrementCard component**
- New file: frontend/src/components/ProductView/IncrementCard.tsx
- Props: increment (Increment), isActive (boolean), onClick callback
- Display: id, title, shortDescription, status badge ("Not Started")
- Active indicator: left blue border (4px, #2196F3) and light blue background (#E3F2FD)
- Non-active: standard card styling with subtle border
- Click handler to allow selecting different increments as active

**Add plan summary message to Team Chat on success**
- After successful plan generation, append a system-style message to chat messages
- Message format: "Implementation plan generated with N increment(s): [list of increment titles]"
- Use role: 'assistant' for the message so it displays in the chat bubble format

**Update FeatureDefinitionPanel to include ImplementationPlanSection**
- Import and render ImplementationPlanSection after existing sections
- Pass latestPlannerResponse?.implementationPlan, activeIncrementId, and onIncrementSelect handler
- The section handles its own visibility (hidden when plan is null)

**Store plan in latestPlannerResponse (replace previous plan if re-triggered)**
- On successful response, update latestPlannerResponse with the full PlannerResponse from gateway
- This naturally includes the implementationPlan field
- If user re-triggers Implement, the new plan replaces the old one (standard state update behavior)

**Error handling for plan generation failure**
- If gateway returns error or validation fails, display error in chat as assistant message
- Error message format: "Failed to generate implementation plan: [error details]"
- Do not block UI or prevent further actions - feature definition and chat remain visible
- User can retry by clicking Implement again

## Visual Design
No visual mockups provided. Design follows existing codebase patterns.

**IncrementCard Active State**
- Active: 4px left border in blue (#2196F3), light blue background (#E3F2FD)
- Hover: subtle shadow elevation on non-active cards
- Status badge: gray pill with "Not Started" text

**ImplementationPlanSection**
- Section title: "Implementation Plan" with plan title as subtitle
- Card list with vertical spacing matching existing FeatureSectionCard margins

## Existing Code to Leverage

**ImplementationAssistantPanel.tsx (frontend/src/components/ProductView/)**
- Contains proceedWithImplementation function to be replaced with generateImplementationPlan
- Has latestPlannerResponse state already storing PlannerResponse
- Has implementationMode state for tracking implementation phase
- Has isImplementing state for loading indicator on button

**chatApi.ts (frontend/src/api/)**
- Contains ImplementChatPhase type that needs 'implementation_planning' added
- Has ImplementationPlan and Increment types already defined
- postChatMessage function for sending API requests

**plannerResponseValidator.ts (gateway/src/services/)**
- validatePlannerResponse already validates implementationPlan when expectImplementationPlan is true
- validateImplementationPlan ensures planTitle exists and increments array is non-empty
- All increment statuses must be "NOT_STARTED"

**FeatureSectionCard.tsx (frontend/src/components/ProductView/)**
- Reusable card component for section content
- Use for consistent styling in ImplementationPlanSection

**implementationPlanningPrompt.ts (gateway/src/services/)**
- IMPLEMENT_PLANNING_PROMPT_TEMPLATE already exists and instructs LLM to generate implementation plan
- Gateway chat route already handles phase: 'implementation_planning' and calls validatePlannerResponse with expectImplementationPlan: true

## Out of Scope
- Increment status changes (all remain "NOT_STARTED" in this spec)
- Persisting activeIncrementId to context state or disk
- Executing individual increments
- Editing or modifying the generated implementation plan
- Drag-and-drop reordering of increments
- Collapsing/expanding increment details
- Progress tracking or completion percentages
- Integration with external project management tools
- Sending increment details to the Software Architect
- Starting actual code implementation from increments
