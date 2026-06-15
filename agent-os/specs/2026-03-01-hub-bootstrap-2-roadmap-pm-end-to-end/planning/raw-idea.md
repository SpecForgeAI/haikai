# Raw Idea

**Title:** Hub Bootstrap 2 — Roadmap (PM) End-to-End

**Description:**
Increment 5: Hub Bootstrap 2 — Roadmap (PM) End-to-End

This is Increment 5 of the 11-increment unified conversation engine plan. Increments 1-4 are complete and verified. This increment implements the second bootstrap conversation in the Hub: the Product Manager "Define Roadmap" task that produces a roadmap artifact (initiatives & epics).

Key aspects:
1. PM "Define Roadmap" task registration in the task registry
2. Context injection: MISSION.md content, existing roadmap, JIRA awareness block
3. Reuse Increment 4's artifact preview → confirm → save pattern for roadmap artifacts
4. Dashboard integration: roadmap counts update after save
5. Completion chip (sealed segment) after successful save

This builds directly on Increment 4's patterns (ArtifactPreviewBubble, CompletionChip, transcript download, phase detection, generateArtifact/confirmArtifact/rejectArtifact) with minimal new code. The main new work is task registration, context injection, and wiring the roadmap-specific generation prompt and save tool.
