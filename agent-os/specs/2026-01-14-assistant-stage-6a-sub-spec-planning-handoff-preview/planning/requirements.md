---
title: Implement Assistant Stage 6a — Sub-Spec Planning and Handoff Plan Preview

context:
  The Implement Assistant supports feature refinement and a handoff action ("Implement").
  Some features are too large to implement as a single write-spec and should be split into
  multiple sub-feature intents. A consistent, deterministic approach is needed so that on
  Implement click the Planner LLM decides whether to produce one final intent or a list of
  sub-feature intents, and the UI shows a brief preview of that plan to the user.

goal:
  When the user clicks Implement, the Planner LLM must produce either:
    - a single "final intent" (array size 1), or
    - multiple "final sub-feature intents" (array size > 1),
  using explicit heuristics to decide whether splitting is required.
  The UI must display a short, view-only summary such as:
    "This will be implemented as 3 sub-specs: [A, B, C]"
  before any execution/handoff to the implementing LLM occurs.

scope:
  - Frontend + Gateway changes
  - Planner LLM output shape and presentation changes
  - No execution/handoff to implementing LLM in this stage
  - No persistence or status tracking in this stage (only prepares for future tracking)

requirements:
  planner_heuristics:
    - The Planner LLM MUST decide whether splitting is needed using these initial heuristics:
        1. If the change spans more than one service boundary (e.g., frontend + gateway + backend),
           splitting is likely required unless the change is trivially small.
        2. If the change combines multiple independent user-visible behaviors, split by behavior.
        3. If the change includes both data/schema concerns and non-trivial UI/UX changes, split.
        4. If the change includes non-trivial prompt/LLM orchestration changes plus other concerns,
           split so orchestration is isolated from other feature work.
    - The Planner LLM MUST keep the number of sub-intents minimal while ensuring each is implementable
      as a single write-spec-sized unit.

  gateway:
    - For mode=implement_feature and phase=handoff:
        - Use a dedicated handoff-planning system prompt that instructs the Planner LLM to output
          a machine-parseable JSON object ONLY (no prose outside JSON).
        - The JSON schema MUST be:

          {
            "is_split": boolean,
            "handoff_plan_summary": string,
            "handoff_intents": [
              {
                "id": string,
                "title": string,
                "intent": string,
                "in_scope": [string],
                "out_of_scope": [string],
                "acceptance_criteria": [string],
                "dependencies": [string]
              }
            ]
          }

        - Constraints:
            - handoff_intents length must be >= 1
            - If length == 1 then is_split must be false
            - If length > 1 then is_split must be true
            - Each "intent" must be self-contained and implementation-ready (no open questions)
            - "id" must be stable within the response (e.g., "S1", "S2", ...)

    - The Gateway MUST validate the Planner response:
        - If valid JSON and schema-compliant: proceed to return it to the frontend.
        - If invalid: log an error and return a safe fallback response that treats the entire
          feature as a single intent (length 1) using the best available final definition.

  frontend:
    - When the user clicks Implement:
        - Send mode=implement_feature, phase=handoff as currently designed.
        - Expect the response to be the JSON schema defined above.
    - Display a view-only "Handoff Plan" preview panel that includes:
        - handoff_plan_summary text (e.g., "This will be implemented as 3 sub-specs: [A, B, C]")
        - A simple list of the sub-intents (id + title)
      The preview must NOT trigger execution in this stage.

acceptance_criteria:
  - On Implement click, the system returns a validated JSON object containing handoff_intents.
  - The UI shows a clear view-only summary of whether the work will be implemented as 1 or N sub-specs.
  - For N > 1, the UI lists the titles of each sub-intent.
  - No implementing LLM is invoked in this stage.

non_goals:
  - No status tracking, persistence, or work-item creation for sub-specs
  - No execution/handoff to implementing LLM
  - No new conversation phases beyond existing ones
---
