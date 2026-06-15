# Task Breakdown: Fix Implement Conversation Rehydration Path Alignment

## Overview
Total Tasks: 14

This spec fixes a path mismatch bug where the GET endpoint for conversation rehydration computes a different on-disk location than the PUT endpoint, causing conversations to fail to restore after app restart.

**Root Cause:** The GET endpoint uses `deriveFolderName('', featureId)` with `config.conversationPersistBasePath`, while PUT uses `deriveFolderName(featureTitle, featureId)` with `projectParentFolder`. This results in different folder paths.

**Solution:** Update GET endpoint to accept `projectParentFolder` and `featureTitle` as required query parameters, then use them identically to PUT for path derivation.

## Task List

### Gateway Layer

#### Task Group 1: GET Endpoint Validation and Path Derivation
**Dependencies:** None

- [x] 1.0 Complete GET endpoint path alignment
  - [x] 1.1 Write 4-6 focused tests for GET endpoint changes
    - Test 1: GET returns 400 when projectParentFolder is missing
    - Test 2: GET returns 400 when featureTitle is missing
    - Test 3: GET returns 400 when projectParentFolder is empty string
    - Test 4: GET with all params finds conversation at correct path (matching PUT path)
    - Test 5: GET with all params returns exists:false when file not found at correct path
    - Test 6: Verify GET path matches PUT path for same inputs (integration)
    - Test file: `gateway/src/__tests__/implement-conversations-rehydration.test.ts`
  - [x] 1.2 Update validateGetParams function to require additional parameters
    - File: `gateway/src/routes/implementConversations.ts` (lines 30-38)
    - Add validation for projectParentFolder (string, required, non-empty after trim)
    - Add validation for featureTitle (string, required, non-empty after trim)
    - Return clear error messages: 'projectParentFolder is required', 'featureTitle is required'
    - Follow existing pattern from validatePutBody (lines 46-66)
  - [x] 1.3 Update GET handler to extract new query parameters
    - File: `gateway/src/routes/implementConversations.ts` (lines 117-118)
    - Extract projectParentFolder from req.query
    - Extract featureTitle from req.query
    - Add to logging at lines 120-124
  - [x] 1.4 Fix path derivation to match PUT endpoint
    - File: `gateway/src/routes/implementConversations.ts` (line 128)
    - Change from: `deriveFolderName('', featureId)`
    - Change to: `deriveFolderName(featureTitle, featureId)`
    - This matches PUT behavior at line 216
  - [x] 1.5 Remove fallback to config.conversationPersistBasePath
    - File: `gateway/src/routes/implementConversations.ts` (lines 132-134)
    - Remove: `const config = getConfig();` and `const basePath = config.conversationPersistBasePath;`
    - Change to: `const basePath = projectParentFolder;`
    - This matches PUT behavior at line 217
  - [x] 1.6 Ensure GET endpoint tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify all validation scenarios work correctly
    - Verify path derivation matches PUT endpoint
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- GET endpoint returns 400 with clear message when projectParentFolder missing
- GET endpoint returns 400 with clear message when featureTitle missing
- GET endpoint uses `deriveFolderName(featureTitle, featureId)` (same as PUT)
- GET endpoint uses projectParentFolder as basePath (same as PUT)
- Final path format: `<projectParentFolder>/conversations/<derivedFolderName>/conversation.json`
- No fallback to config.conversationPersistBasePath

### Frontend API Layer

#### Task Group 2: Frontend API Client Updates
**Dependencies:** Task Group 1

- [x] 2.0 Complete frontend API client updates
  - [x] 2.1 Write 3-4 focused tests for API client changes
    - Test 1: getImplementConversation includes projectParentFolder in URL
    - Test 2: getImplementConversation includes featureTitle in URL
    - Test 3: getImplementConversation properly URL-encodes all parameters
    - Test 4: getImplementConversation handles missing optional params gracefully
    - Test file: `frontend/src/__tests__/implement-conversation-rehydration-api.test.ts`
  - [x] 2.2 Update getImplementConversation function signature
    - File: `frontend/src/api/chatApi.ts` (lines 336-339)
    - Add parameter: projectParentFolder: string
    - Add parameter: featureTitle: string
    - Updated signature: `getImplementConversation(projectId: string, featureId: string, projectParentFolder: string, featureTitle: string)`
  - [x] 2.3 Update URL construction to include new query params
    - File: `frontend/src/api/chatApi.ts` (line 340)
    - Add `&projectParentFolder=${encodeURIComponent(projectParentFolder)}`
    - Add `&featureTitle=${encodeURIComponent(featureTitle)}`
    - Full URL format: `/api/implement-conversations?projectId=...&featureId=...&projectParentFolder=...&featureTitle=...`
  - [x] 2.4 Ensure API client tests pass
    - Run ONLY the 3-4 tests written in 2.1
    - Verify URL construction is correct
    - Verify encoding handles special characters
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Function signature includes projectParentFolder and featureTitle
- URL query string includes all four parameters
- All parameters are properly URL-encoded
- Existing return type unchanged: `Promise<GetConversationResponse>`

### Frontend Component Layer

#### Task Group 3: Frontend Hydration useEffect Updates
**Dependencies:** Task Group 2

- [x] 3.0 Complete frontend hydration useEffect updates
  - [x] 3.1 Write 3-4 focused tests for hydration behavior
    - Test 1: Hydration skipped when projectParentFolder is undefined
    - Test 2: Hydration calls getImplementConversation with all required params
    - Test 3: Hydration succeeds and populates messages when file exists
    - Test 4: Hydration gracefully handles missing file (falls back to bootstrap)
    - Test file: `frontend/src/__tests__/implement-conversation-rehydration-component.test.ts`
  - [x] 3.2 Add guard clause for undefined projectParentFolder
    - File: `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` (line 292-301)
    - Add condition: `!activeProject?.projectParentFolder` to the early return
    - This prevents disk hydration attempt when project path is unknown
  - [x] 3.3 Update getImplementConversation call to pass new parameters
    - File: `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` (line 313)
    - Change from: `getImplementConversation(projectId, workItemId)`
    - Change to: `getImplementConversation(projectId, workItemId, activeProject.projectParentFolder, workItemTitle)`
    - Note: workItemTitle comes from props (already available in scope)
  - [x] 3.4 Add activeProject and workItemTitle to useEffect dependencies
    - File: `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` (line 337)
    - Add `activeProject?.projectParentFolder` to dependency array
    - Add `workItemTitle` to dependency array
    - Ensures re-hydration if these values change
  - [x] 3.5 Ensure hydration tests pass
    - Run ONLY the 3-4 tests written in 3.1
    - Verify guard clause prevents hydration when path undefined
    - Verify correct parameters passed to API
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Disk hydration skipped when activeProject?.projectParentFolder is undefined
- getImplementConversation called with: projectId, workItemId, projectParentFolder, workItemTitle
- Hydration properly restores conversation when file exists
- Hydration gracefully falls back to bootstrap when file not found

### Integration Testing

#### Task Group 4: End-to-End Path Alignment Verification
**Dependencies:** Task Groups 1-3

- [x] 4.0 Verify end-to-end path alignment
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review 4-6 tests from Task Group 1 (gateway GET endpoint)
    - Review 3-4 tests from Task Group 2 (frontend API client)
    - Review 3-4 tests from Task Group 3 (frontend hydration)
    - Total existing tests: approximately 10-14 tests
  - [x] 4.2 Write up to 3 integration tests for path alignment
    - Test 1: PUT then GET returns same conversation (round-trip test)
    - Test 2: Path derivation produces identical result for GET and PUT with same inputs
    - Test 3: Real file system test - PUT writes, GET reads from exact same location
    - Test file: `gateway/src/__tests__/implement-conversations-path-alignment-integration.test.ts`
  - [x] 4.3 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature
    - Expected total: approximately 13-17 tests maximum
    - Verify GET/PUT path alignment works correctly
    - Do NOT run the entire application test suite

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 13-17 tests total)
- PUT then GET round-trip works correctly
- GET and PUT derive identical paths for identical inputs
- No more than 3 additional integration tests added

## Execution Order

Recommended implementation sequence:
1. **Gateway Layer** (Task Group 1) - GET endpoint validation and path derivation fixes
2. **Frontend API Layer** (Task Group 2) - API client function signature and URL updates
3. **Frontend Component Layer** (Task Group 3) - Hydration useEffect parameter passing
4. **Integration Testing** (Task Group 4) - End-to-end path alignment verification

## Key File References

| File | Lines | Change |
|------|-------|--------|
| `gateway/src/routes/implementConversations.ts` | 30-38 | Update validateGetParams |
| `gateway/src/routes/implementConversations.ts` | 117-124 | Extract new query params |
| `gateway/src/routes/implementConversations.ts` | 128 | Fix deriveFolderName call |
| `gateway/src/routes/implementConversations.ts` | 132-134 | Use projectParentFolder as basePath |
| `frontend/src/api/chatApi.ts` | 336-340 | Update function signature and URL |
| `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` | 292-301 | Add guard clause |
| `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` | 313 | Pass new params to API |
| `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` | 337 | Update dependencies |

## Existing Code to Leverage

- `gateway/src/services/transcriptWriter.ts` - `deriveFolderName()` (lines 61-92) - Already used correctly by PUT
- `gateway/src/services/transcriptWriter.ts` - `buildTranscriptPath()` (lines 101-105) - Already used correctly by PUT
- `gateway/src/routes/implementConversations.ts` - `validatePutBody()` (lines 46-66) - Pattern for validation
- `frontend/src/contexts/ProjectContext.tsx` - `useProject` hook - Already imported in component
