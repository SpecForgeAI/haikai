title: Implement Click Triggers Implementation Plan Generation (Product Owner)

intent: |
  When the user explicitly chooses to proceed with implementation, invoke the Planner (Product Owner)
  LLM to generate an Implementation Plan that decomposes the finalized feature into one or more
  implementation increments. This plan becomes the authoritative structure for subsequent
  Software Architect clarification and execution.

User decisions from shaping:
- Plan Display: New section in Feature Definition panel (after existing sections)
- Trigger Flow: Replace proceedWithImplementation (Implement click now generates plan)
- Active Indicator: Highlighted card with blue left border and light blue background
- Loading State: Show 'Generating Plan...' in button
- Chat Integration: Yes, show plan summary message in Team Chat
