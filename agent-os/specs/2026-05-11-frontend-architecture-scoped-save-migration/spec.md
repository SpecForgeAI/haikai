# Frontend Architecture-Scoped Save Migration

**Date:** 2026-05-11
**Type:** Hotfix completing an older multi-architecture migration

## Problem

The frontend's `saveModelByFilename` calls the legacy `PUT /api/model?filename=X` endpoint. AMS Javadoc on the architecture-scoped replacement explicitly warns:

> "Architecture-scoped save endpoint. Required for the post-clone scenario where two model_files rows share the same filename across architectures. **Without this endpoint the legacy filename-only lookup is non-deterministic and corrupts the wrong architecture on save.**"

Symptom: starting a discovery run on a service in a brand-new project (PetClinic2) produces a 404 from the discovery service: "Service svc-mp1nqdk5-5w8nw not found in project ... (architecture ...)". The auto-save before the run uses the legacy URL, lands the model in a `model_file` not pinned to the architecture being queried, so `getService`'s architecture-scoping check fails.

## Server side (already in place)

```java
// architecture-scoped — already exists, just unused by frontend
@PutMapping("/api/model/projects/{projectId}/architectures/{architectureId}")
public saveModelForArchitecture(
    @PathVariable UUID projectId,
    @PathVariable UUID architectureId,
    @RequestParam(required = false) String filename,
    @RequestBody ArchitectureModelDto model)
```

## Decisions (user-confirmed 2026-05-11)

1. **Change the signature** of `saveModelByFilename` so `projectId` and `architectureId` are required arguments. No parallel function.
2. **Delete the legacy function entirely.** Do NOT keep a deprecated wrapper. Every caller MUST migrate. Compile errors are the migration roadmap.

## Scope

**Modify:**
- `frontend/src/api/modelApi.ts` — `saveModelByFilename(projectId, architectureId, filename, model)` calling the new URL
- `frontend/src/utils/saveUtils.ts` — `saveModelToBackend` thread `projectId` and `architectureId` through
- All callers of `saveModelToBackend` and any direct callers of `saveModelByFilename` — must source the IDs (via `useActiveArchitectureId()` hook + project context, or wherever they live in the existing architecture context plumbing)

**Caller files (~6 source + ~17 test):**
- `frontend/src/components/Grid/Grid.tsx`
- `frontend/src/components/TopBar/TopBar.tsx`
- `frontend/src/components/DiagramsView/DiagramsView.tsx`
- `frontend/src/components/DiagramsView/DiagramSelector.tsx`
- `frontend/src/components/Project/CreateProjectModal.tsx`
- `frontend/src/utils/importMergeUtils.ts`
- Various test files that mock or call these functions

**Tests:**
- `frontend/src/api/__tests__/modelApi.saveModelByFilename.errorParsing.test.ts` — update URL assertions
- `frontend/src/__tests__/saveUtils.test.ts` — update signature in mocks
- All test files using `saveModelToBackend` — update mock signatures and assertions

## Acceptance criteria

1. `saveModelByFilename(projectId, architectureId, filename, model)` is the only signature; no deprecated overload exists
2. URL hit is `PUT /api/model/projects/{projectId}/architectures/{architectureId}?filename={filename}`
3. All callers pass real `projectId` and `architectureId` values (no `null`/`undefined` defaults)
4. PetClinic2 reproduction (the original bug): start a discovery run on a freshly-created service → no 404, run starts cleanly
5. All existing modelApi + saveUtils tests pass with updated assertions
6. No call site still references the legacy URL (`grep` for `/api/model?filename` and `'api/model?'` returns zero hits in `frontend/src/`)
7. Compile clean (`tsc --noEmit` no new errors in touched files)

## Test plan

- Update existing modelApi tests for new URL
- Update existing saveUtils tests for new signature
- Add one new focused test: `saveModelByFilename` builds the architecture-scoped URL with the supplied IDs
- Existing caller-side tests update their mocks but should otherwise pass unchanged (they were testing the save outcome, not the URL)
- Manual smoke: start a discovery run on a freshly-created service in a freshly-created project (the original repro)

## Out of scope

- Backend changes (the architecture-scoped endpoint already exists)
- The `getService` / `ModelEntityController` architecture-scoping check (works correctly when the save targets the right model_file)
- Refactoring how `useActiveArchitectureId` propagates (it works today; we just consume its existing value)
