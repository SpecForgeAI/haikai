title: Execute Increment Pipeline + Status Tracking (Per Implementation Plan Increment)

intent: |
  For each increment in the Implementation Plan, run the delivery pipeline sequentially once
  Software Architect clarification is complete:
    1) Shape Spec
    2) Write Spec
    3) Create Tasks
    4) Implement Tasks
  Track and display per-increment execution status in the UI.

User decisions from shaping:
- Execution Trigger: Manual 'Start Implementation' button (user clicks when READY_TO_EXECUTE)
- Progress Display: Step indicator + chat messages (badge shows current step, messages in Team Chat)
- Auto-Advance: Show completion, manual advance (no auto-select of next increment)
- Button Position: Below Implementation Plan section
- Failure Handling: No automatic retry (user manually triggers re-execution)
