title: Two-Flag Workflow State Machine — plannerReadyForSpec + implementationMode

intent: |
  Introduce and enforce a two-flag workflow model on the Implement screen:
    1) plannerReadyForSpec: explicit Product Owner (Planner) signal of readiness
    2) implementationMode: user-controlled phase switch indicating implementation has begun
  Use these flags to drive role selection, UI behavior, and transition warnings, without blocking
  user progress.

User decisions from shaping:
- State Storage: ImplementChatUiState (add to existing per-work-item state in ProductUiStateContext)
- Ready Indicator: Badge in Feature Header (small badge/chip next to feature title)
- Modal Style: Warning style (yellow/amber warning icon, neutral buttons)
- Button State: Show 'In Implementation' disabled when implementationMode=true
- Question Count: Yes, show count of unanswered questions in modal
