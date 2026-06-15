# Requirements: Project-level Standards Generation

## Clarifications and Decisions

### 1. External Service Response Format
**Decision:** The external service handles persistence internally
- POST /api/v1/standards/product/generate returns generated standards data
- The service persists/refreshes standards automatically
- Frontend/gateway just needs to call the endpoint correctly (fire-and-forget)
- No additional backend persistence work needed on our side

### 2. Gateway Configuration
**Decision:** Reuse existing gateway configuration
- Reuse `STANDARDS_SERVICE_BASE_URL` (same service)
- Reuse `STANDARDS_SERVICE_BEARER_TOKEN` (same auth)
- Only the endpoint path differs: `/api/v1/standards/product/generate`

### 3. Button Label
**Decision:** "Generate Standards"
- Matches the menu item label
- Consistent and clear

### 4. Success Toast Message
**Decision:** "Project standards generated successfully"
- Simple, clear feedback

### 5. Error Handling
**Decision:** Generic message with retry hint
- Message: "Project standards generation failed. You can retry or cancel."
- No raw API error details exposed to user
- Modal stays open for retry

### 6. Loading State
**Decision:** Button spinner with disabled inputs
- Button text changes to "Generating..." with spinner
- Button disabled during generation
- All inputs disabled during generation
- No full overlay spinner

### 7. Organisation Name Source
**Decision:** Look up via getOrganisationById
- Call `getOrganisationById(activeProject.organisationId)` to get organisation name
- Use the returned organisation.name for the `company` field in the payload
- Handle case where organisation lookup fails (show error, don't proceed)

## Existing Code to Leverage

### MultiValueChipsInput Component
- File: `frontend/src/components/common/MultiValueChipsInput.tsx`
- Reuse as-is for Sources field
- Use ref pattern for flush() before submit

### Toast Component
- File: `frontend/src/components/common/Toast.tsx`
- Reuse existing component
- Success type with auto-dismiss (~5s)

### Gateway Standards Service Client
- File: `gateway/src/services/standardsServiceClient.ts`
- Reuse `standardsServiceFetch` for authenticated requests
- Same service, different endpoint path

### FileMenu Pattern
- File: `frontend/src/components/TopBar/FileMenu.tsx`
- Existing menu item pattern with disabled styling
- Insert between Open and Save

### CreateOrganisationModal Pattern
- File: `frontend/src/components/Organisation/CreateOrganisationModal.tsx`
- Modal structure, loading state, error handling
- MultiValueChipsInput with ref/flush pattern

### Organisation API
- File: `frontend/src/api/organisationsApi.ts`
- Use `getOrganisationById` to resolve organisation name

## File Summary

### New Files
- `frontend/src/components/Project/GenerateProjectStandardsModal.tsx`
- `frontend/src/components/Project/GenerateProjectStandardsModal.module.css`
- `gateway/src/routes/projectStandardsGenerate.ts`

### Modified Files
- `frontend/src/components/TopBar/TopBar.tsx` - Add modal state, handler, mount modal
- `frontend/src/components/TopBar/FileMenu.tsx` - Add Generate Standards menu item
- `frontend/src/api/organisationsApi.ts` - Add generateProjectStandards function (or new file)
- `gateway/src/routes/index.ts` - Export new router
- `gateway/src/server.ts` - Mount new route

## Request Body Contract

Frontend sends to Gateway, Gateway forwards to external service:

```json
{
  "company": "<organisation name from getOrganisationById>",
  "project": "<activeProject.name>",
  "sources": ["<url-or-path>", "..."]
}
```

## Visual Design
No mockups provided - follow CreateOrganisationModal styling exactly with:
- Modal header: "Generate Project Standards"
- Body text (primary): "Choose the input documents (local files, external URLs) that will generate the project standards."
- Body text (note, smaller grey): "Note - project standards override your company standards if the same topic, otherwise company standards remain."
- Single Sources field with MultiValueChipsInput
- Cancel and "Generate Standards" buttons
