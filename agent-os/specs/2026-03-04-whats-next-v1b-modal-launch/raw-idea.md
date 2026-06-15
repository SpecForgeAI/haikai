title: "What's Next v1-B: Action execution router + Generate Standards modal launch"

intent:
Extend the clickable "What's Next" actions to support non-panel launch types, starting with "Define Tech Standards" which must open the existing Generate Standards modal (same behavior as menu Product -> Generate Standards). Keep all existing panel launches working unchanged. No implement work-item picker in this increment.

scope:
frontend:
  - Introduce a single action execution router used by "What's Next" action clicks:
      * Accepts an action payload with a launch type and target info.
      * Supported launch types in this increment:
        - launch: "panel"  (existing behavior: navigate -> open RHS panel -> select persona -> auto-send label)
        - launch: "modal"  (new: open Generate Standards modal)
  - Update "What's Next" action structured response contract usage:
      * "Define Tech Standards" action must be returned with:
        - launch: "modal"
        - modalId: "generate-standards"
        - label: "Define Tech Standards"
        - personaId: "architect" (informational for header, but modal is the action)
      * All other actions in v1 remain launch: "panel".
  - Implement modal launch behavior:
      * Clicking the "Define Tech Standards" action opens the existing Generate Standards modal without navigating away (or if navigation is required by current UI, navigate to Product tab then open modal).
      * The modal must be the same component/state path as the existing menu action "Product -> Generate Standards" (no duplicate modal implementation).
      * After modal opens, the RHS panel should remain as-is; no auto-message is required for this action.
  - Ensure the action click handler can execute across unmount boundaries:
      * If modal requires being on a specific view, use the same navigation mechanism already used by menu items, then open modal once mounted.

gateway:
  - Extend DeterministicNextActionsEvaluator to include "Define Tech Standards" as an action when techStandardsExists == false:
      * Provide action payload fields required for modal launch:
        - id: DEFINE_TECH_STANDARDS
        - label: "Define Tech Standards"
        - reason: string
        - priority: number
        - launch: "modal"
        - modalId: "generate-standards"
        - target: { screen?: "product" (optional), personaId: "architect" }
  - No other changes to signal computation or evaluator behavior.

constraints:
  - Do not implement implement-picker actions or any implement navigation in this increment.
  - Do not change how standards are generated/saved; only launch the existing modal.
  - Do not introduce new endpoints.
  - No streaming, summarisation, completion chips, artifact preview/save changes, or Implement screen changes.

acceptance_criteria:
  - In "What's Next" results, clicking any launch:"panel" action continues to work as before (navigate/open panel/select persona/auto-send label).
  - When tech standards are missing and "Define Tech Standards" appears:
      * Clicking it opens the same Generate Standards modal as the Product menu item.
      * No duplicate modal implementation exists; the same component is reused.
      * No navigation surprises: if navigation is necessary to open the modal, it is automatic and ends with the modal visible.
  - No regressions to existing Hub/RHS panel chat functionality.
