# Raw Idea: Hub Chat MVP v1 (Frontend + Backend Wiring)

**Name:** Hub Chat MVP v1 (Frontend + Backend Wiring)

**Description:**
Increment 3 of the 11-increment unified conversation engine plan. Increments 1 (Backend) and 2 (Frontend) are complete and verified:
- Increment 1: POST /api/chat/v2 endpoint, persona/task registries, thread persistence, prompt composition pipeline (88 tests passing)
- Increment 2: Reusable UnifiedChatPanel React component with ChatThread, ChatInputBar, MentionInput, TaskMenu, StructuredQuestionsRenderer, useChatThread hook, GET /api/chat/v2/thread endpoint, Dashboard integration (44 tests passing)

This increment wires everything together for a working Hub Chat experience on the Dashboard:

1. Hub Chat as Primary Dashboard Experience — Replace PersonaHelperPanel placeholder with the real UnifiedChatPanel as the primary chat experience.
2. @-Mention Persona Selection Flow (End-to-End) — Wire the full @-mention → persona selection → task menu → task selection → conversation flow.
3. Persona Handoff Protocol — When user @-mentions a different persona mid-conversation, switch persona, reset task, show system message.
4. Remove/Replace PersonaHelperPanel — Remove placeholder panel, clean up PersonaPanelContext if no longer used.
5. Hub Thread Identity — Hub threads use ThreadKey { type: 'hub', projectId }, one per project, persist across refreshes.

Key Constraint: This is about WIRING — connecting Increment 2 components to create a working end-to-end chat experience. Minimal new component creation; mostly integration, flow validation, and cleanup.
