# Raw Idea: Hub Bootstrap 1 — Product Definition (PM) End-to-End

## Title
Hub Bootstrap 1 — Product Definition (PM) End-to-End

## Increment Context
Increment 4: Hub Bootstrap 1 — Product Definition (PM) End-to-End

This is Increment 4 of the 11-increment unified conversation engine plan. Increments 1-3 are complete and verified:
- Increment 1: POST /api/chat/v2 endpoint, persona/task registries, thread persistence, prompt composition pipeline (88 tests passing)
- Increment 2: Reusable UnifiedChatPanel React component with ChatThread, ChatInputBar, MentionInput, TaskMenu, StructuredQuestionsRenderer, useChatThread hook, GET /api/chat/v2/thread endpoint, Dashboard integration (44 tests passing)
- Increment 3: Hub Chat MVP wiring — @-mention persona selection, message queuing, persona handoff system messages with backend persistence, PersonaHelperPanel removal, Dashboard card navigation-only behavior (24 tests passing)

## Description

### What to Build

1. PM "Define Product Definition" Task Registration - Wire the PM's "Define Product Definition" task through the task registry so it appears in the PM's task menu when @PM is mentioned in the Hub chat. Use the existing PRODUCT_MANAGER_PROMPT_TEMPLATE via the prompt composition pipeline.

2. Artifact Hook with Preview → Confirm → Save Flow - When the PM conversation produces an artifact (MISSION.md content), display a preview in the chat. User can confirm or reject. On confirm, save MISSION.md using existing save infrastructure. Content generated using existing MISSION_GENERATION_PROMPT_TEMPLATE.

3. Completion Chip (Sealed Segment) - After the PM bootstrap conversation completes, a completion chip appears marking the segment as sealed. Chip is clickable with summary and allows transcript download.

4. Dashboard Integration - MISSION.md saved from PM conversation reflected in Dashboard strategic foundation section. Dashboard shows updated state after artifact is saved.

### Key Constraint
This is the FIRST real bootstrap conversation flow, putting Increments 1-3 infrastructure to actual use. Focus on getting one complete end-to-end bootstrap flow working correctly as a template for subsequent bootstrap increments (5-7).
