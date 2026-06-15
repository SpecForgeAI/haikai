# Task Breakdown: Implement Assistant Stage 1 - Fix Implement Context Resolution Plumbing

## Overview
Total Tasks: 6 (across 2 task groups)

This is a **minimal fix** - the backend plumbing already exists and works. Only 2 code changes are needed in the frontend to pass the `filename` field that the Gateway already expects.

## Problem Summary
- Frontend's `buildContext()` in `ImplementationAssistantPanel.tsx` does NOT include `filename` (projectId)
- Gateway checks for `context.filename` but receives `undefined`
- Resolution never happens - Gateway logs "Cannot resolve implement context: no filename provided"

## What Already Works (No Changes Needed)
- Gateway's `tryResolveImplementContext()` in `gateway/src/routes/chat.ts`
- Gateway's `resolveImplementContext()` client in `gateway/src/services/architectureModelClient.ts`
- architecture-model-service resolution endpoint at `POST /api/projects/{projectId}/implement-context/resolve`
- Error handling and graceful fallback

## Task List

### Frontend Layer

#### Task Group 1: Add filename to Chat API Context
**Dependencies:** None

- [x] 1.0 Complete frontend API and component changes
  - [x] 1.1 Update `ImplementChatContext` interface in `frontend/src/api/chatApi.ts`
    - Add `filename?: string` field to the interface
    - Place field logically near other context identifiers
    - Field is optional to maintain backwards compatibility
  - [x] 1.2 Update `buildContext()` in `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Add `filename: projectId` to the returned `ImplementChatContext` object
    - The `projectId` prop is already available (passed from `ProductImplementPage.tsx` as `loadedFileName`)

**Acceptance Criteria:**
- `ImplementChatContext` interface includes `filename?: string` field
- `buildContext()` returns an object that includes `filename: projectId`
- No TypeScript compilation errors
- Existing functionality remains unchanged

### Verification Layer

#### Task Group 2: Manual Verification and Test Updates
**Dependencies:** Task Group 1

- [x] 2.0 Verify end-to-end context resolution flow
  - [x] 2.1 Update existing tests to include filename in mock contexts
    - Update any existing tests in `frontend/src/__tests__/` that mock `ImplementChatContext`
    - Update any existing tests in `gateway/src/__tests__/context-resolution.test.ts` if needed
    - Do NOT create new test files
  - [x] 2.2 Verify TypeScript compilation
    - Run `npm run build` or `tsc` in frontend directory
    - Ensure no type errors related to the changes
  - [x] 2.3 Manual verification (if dev environment available)
    - Start the frontend, gateway, and architecture-model-service
    - Navigate to a work item in the Implement Assistant
    - Select architecture entities and/or diagrams as context
    - Send a chat message
    - Verify Gateway logs show context resolution being called (not "no filename provided")
    - Verify LLM receives resolved entity/diagram summaries
  - [x] 2.4 Verify graceful fallback still works
    - If resolution fails (e.g., service unavailable), chat should continue without resolved context
    - Gateway should log WARN level message but not expose error to user

**Acceptance Criteria:**
- Existing tests pass with updated mock contexts
- No TypeScript compilation errors
- Gateway receives `filename` in the context (visible in logs)
- Context resolution is called when filename is present
- LLM receives resolved entity/diagram summaries
- Graceful fallback still works when resolution fails

## Execution Order

Recommended implementation sequence:
1. Frontend API and Component Changes (Task Group 1)
2. Verification and Test Updates (Task Group 2)

## Files to Modify

| File | Change |
|------|--------|
| `frontend/src/api/chatApi.ts` | Add `filename?: string` to `ImplementChatContext` interface |
| `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` | Add `filename: projectId` to `buildContext()` return object |
| Existing test files (if any mock `ImplementChatContext`) | Update mocks to include `filename` field |

## Files NOT to Modify

The following files already have the correct implementation and should NOT be changed:
- `gateway/src/routes/chat.ts` - `tryResolveImplementContext()` already checks for `context.filename`
- `gateway/src/services/architectureModelClient.ts` - `resolveImplementContext()` client is complete
- `gateway/src/types/chat.ts` - Already has `filename?: string` field defined
- architecture-model-service - Resolution endpoint is fully implemented
