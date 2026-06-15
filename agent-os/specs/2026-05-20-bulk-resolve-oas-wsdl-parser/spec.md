# Specification: Bulk-Resolve OAS/WSDL Parser

## Goal
Wire real OpenAPI 2.0/3.0/3.1 and WSDL 1.1/2.0 parsing into the existing bulk-resolve modal so users can upload one or more contract files, preview every operation matched against insufficient-context stories, and commit all matched resolutions in one transaction. Closes the v1 shim left by the Missing Input Resolver Flow (2026-05-20).

## User Stories
- As a migration architect, I want to upload an OpenAPI or WSDL file and have every operation inside it auto-resolve any matching missing-input keys, so I do not type service/operation pairs by hand for dozens of operations.
- As a migration architect, I want to upload several contract files at once and see a per-file + per-operation preview before any DB writes, so I can spot misnamed services, empty files, or unsupported formats before committing.
- As a project administrator, I want to set the maximum contract upload file size on the project settings screen, so my project can accept (or reject) large OAS bundles without a global config change.

## Specific Requirements

**Multi-file upload endpoint (`POST /api/projects/{projectId}/missing-input-resolutions/parse-files`)**
- Accepts multipart/form-data with one or more `files[]` parts plus an optional `serviceNameOverrides` JSON map keyed by filename.
- Query/form param `commit` (default `false`): preview mode returns parse results + per-operation match status without persisting anything; commit mode persists `ProjectArtifact` rows for each successfully parsed file and creates `missing_input_resolutions` rows for each matched-and-not-already-resolved operation, all in one transaction.
- File-size cap enforced before parsing: each file checked against `project.max_contract_upload_file_size_mb` (default 10MB); over-cap files marked `failed` with reason `file_size_exceeded` and never read into memory beyond the cap.
- Per-file failure isolation: a malformed or unsupported file is marked `failed` with a reason string but never aborts processing of sibling files.
- Response shape: `{ files: [OasWsdlParseResult, ...], summary: { totalOperations, matched, alreadyResolved, noMatch, willCreateResolutions, affectedSpecCount }, previewOnly: bool }`.
- On commit, delegates each per-file matched-and-not-already-resolved operation to the existing `MissingInputResolutionBulkService` (extended) so the existing unique-active-per-(project,key) precheck and audit-stamping flows untouched.

**Format auto-detection (`ContractFormatDetector`)**
- Sniffs the first ~2KB of file bytes for telltale markers: OAS via `openapi:`, `swagger:`, `"openapi":`, `"swagger":`; WSDL 1.1 via `<wsdl:definitions` or `<definitions xmlns="...wsdl..."`; WSDL 2.0 via `<description xmlns="...wsdl/2.0..."`.
- Returns one of `oas_2_0`, `oas_3_0`, `oas_3_1`, `wsdl_1_1`, `wsdl_2_0`, or `unknown`.
- For OAS, post-detection refinement reads the `openapi`/`swagger` version field to pin the minor version.
- Detection failure ends with format `unknown` and status `failed`, reason `unrecognised_contract_format`; no user-picked type dropdown in the UI.
- No content-type sniffing; relies on file bytes only (the multipart `Content-Type` header is ignored).

**OAS parsing (`OasWsdlParserService.parseOas`)**
- Uses `io.swagger.parser.v3:swagger-parser` (handles both JSON and YAML transparently; covers 2.0, 3.0, 3.1 in one library).
- Auto-suggested service name = `info.title` (lowercased + trimmed); user-supplied per-file override wins when present.
- Per operation: identifier = `operationId` when present, else lowercased(`method + ' ' + path`); strict case-only normalisation matches `MissingInputKeyHasher.canonicalDescriptorForApiContract` so OAS-parsed keys line up with manual-entry keys.
- Operation identifier MUST NOT collapse slashes, strip query strings, or rewrite path parameters; only lowercase + trim.
- Out-of-scope (NOT parsed): schemas, types, security definitions, servers, examples, callbacks.

**WSDL parsing (`OasWsdlParserService.parseWsdl11` and `parseWsdl20`)**
- WSDL 1.1 path uses `wsdl4j`; WSDL 2.0 path uses the Apache CXF WSDL 2.0 reader. The trio (`swagger-parser` + `wsdl4j` + CXF) is fixed and no fallback library is wired.
- Auto-suggested service name = first `<service name>` (1.1) or `<service name>` of the `<description>` element (2.0); user-supplied per-file override wins.
- Per operation: identifier = `<operation name>`, lowercased + trimmed; no message/type traversal.
- Out-of-scope (NOT parsed): messages, types, bindings (beyond reading operation names), policies.

**Match-and-classify per operation**
- Each parsed operation hashed via the existing `MissingInputKeyHasher.computeKey('api_contract', canonicalDescriptorForApiContract(serviceName, operationName))` so OAS/WSDL keys are byte-identical to manual-entry keys.
- Cross-reference against project-scoped `missing_input_keys_json` on `migration_story_spec_generations` with status `insufficient_context` (same intersection logic already in `MissingInputResolutionBulkService`).
- Cross-reference against active rows in `missing_input_resolutions` (project_id + missing_input_key + soft_deleted=false) to flag `already_resolved` with the existing `resolutionId`.
- Per-operation status one of: `matched` (will create), `already_resolved` (skipped on commit), `no_match` (will not create), `parse_skipped` (operation could not be normalised to a key).
- Empty files (parse succeeds, zero operations) get file-level status `parsed`, operation-count `0`, and a yellow info row "No operations found in this file - nothing to resolve" - NOT `failed`, contributes zero rows to commit.

**Persistence model extensions (new changeset 151)**
- Add to `missing_input_resolutions`: `resolution_source VARCHAR(32) NULL` (vocabulary `manual` / `oas_wsdl_upload`; new rows from the parse-files endpoint stamped `oas_wsdl_upload`, pre-existing rows backfilled to `manual`) and `project_artifact_id UUID NULL` FK to `project_artifact(id)` ON DELETE SET NULL.
- Add to `project`: `max_contract_upload_file_size_mb INTEGER NULL` DB DEFAULT 10 (additive, nullable, boxed `Integer` on the entity per `project_primitive_double_dto_overwrite.md`).
- `project_artifact` reused as-is with new `artifact_type` value `missing_input_contract_upload`; no schema migration to the artifact table itself; the `ALLOWED_ARTIFACT_TYPES` set in `ProjectArtifactService` extended to include the new value.
- One ProjectArtifact row per uploaded file on commit; the raw file bytes stored in the existing `content` column (UTF-8 string for text-based OAS/WSDL).
- New `resolution_source` value enforced cooperatively at service layer (no DB CHECK constraint to keep the column open-vocabulary).

**Frontend bulk-resolve modal upgrade**
- Replace the greyed-out upload widget in `MigrationDeliveryBulkResolveModal.tsx` with `<input type="file" multiple accept=".json,.yaml,.yml,.wsdl,.xml">`.
- Render a per-file panel after selection: filename + size; auto-detected format chip (populated after preview returns); editable "Service name" input pre-filled from the parser's `suggestedServiceName`; file-level status chip (`queued` / `parsing` / `parsed` / `failed`); operation count.
- Under each file panel render one row per operation showing the identifier, the missing-input-key (truncated 8 hex chars for display), a status chip (`matched` / `already_resolved` / `no_match`), and the matched-spec count.
- For `already_resolved` operations render a small inline "view existing resolution" link that opens a read-only side panel; never an inline accordion.
- "Preview" button calls the endpoint with `commit=false`; "Apply" button calls with `commit=true` using the SAME selected files (re-uploaded - the modal does not persist files across the preview/commit boundary, the user re-confirms intent).
- Summary banner before the Apply button: "This will create N new resolutions across M stories" (matched-and-not-already-resolved counts), updated live from the preview response.
- Service-name override field is per-file ONLY; no per-operation override input in v1.

**View-existing-resolution side panel (`MigrationDeliveryExistingResolutionSidePanel.tsx`)**
- New small read-only side panel (NOT a modal) shown when the user clicks the "view existing resolution" link on an `already_resolved` operation row.
- Displays: resolution id, missing-input-key, type (`api_contract`), service+operation descriptor, resolved_at, resolved_by, resolution_source, project_artifact_id back-reference (with filename if available).
- No reset/edit actions inside the side panel; users navigate to the existing dashboard list to manage active resolutions.
- Closes via X button or click-outside.

**Gateway thin proxy route**
- New route in `gateway/src/routes/missingInputResolutions.ts`: `POST /api/projects/:projectId/missing-input-resolutions/parse-files`.
- Multipart pass-through: use `multer` (or equivalent existing dependency) configured with `memoryStorage` and a `limits.fileSize` matching the project cap (read via `fetchProjectConfigWithDefaults`); re-stream the multipart body to AMS verbatim with `Content-Type` preserved.
- No body parsing, no JSON transformation, no LLM tasks; mirrors the existing thin-proxy pattern in this router.
- Forward `?commit=true|false` query string verbatim; AMS owns the persistence semantics.

**Project settings: max contract file size field**
- Add a new "Uploads" section to `ProjectConfigModal.tsx` (frontend) with a single number input "Max contract file size (MB)" bound to the new `maxContractUploadFileSizeMb` field on the project DTO (default 10, min 1, max 200 client-side cap).
- Wire the field through the existing `projectService.updateProject` path; no new endpoint, no new screen.
- AMS reads the per-project value in the parse-files endpoint; null falls back to default 10MB (defence-in-depth fallback in code, not solely from DB DEFAULT).

## Existing Code to Leverage

**`MissingInputResolutionBulkService.java` (AMS, Task Group 3.5)**
- Already implements key-hashing, intersection-with-project-specs, dedup-by-key, and the all-or-nothing commit transaction with delegation to `MissingInputResolutionService.create`.
- Extend with a new entry point `bulkResolveFromParsedFiles(projectId, parseResults, commit, resolvedBy, artifactIds)` that walks the per-file parsed operations and reuses the existing `BulkResolveItem` shape internally. No edits to the existing `bulkResolve(...)` signature.

**`MissingInputKeyHasher.java`**
- Unchanged. Parse-files endpoint feeds it via `canonicalDescriptorForApiContract(serviceName, operationName)` exactly the same way manual-entry does today - guarantees OAS/WSDL-parsed keys match manual-entry keys byte-for-byte.

**`MissingInputResolutionEntity.java` + `MissingInputResolutionService.create`**
- Existing audit columns (`resolved_at`, `resolved_by`, soft-delete chain) reused unchanged; the new `resolution_source` and `project_artifact_id` columns added via changeset 151 are stamped by the service layer when called from the parse-files commit path.

**`ProjectArtifactEntity` + `ProjectArtifactService` + `project_artifact` table**
- Reuse the existing artifact table by adding `missing_input_contract_upload` to the allowed `ALLOWED_ARTIFACT_TYPES` set; uploaded file bytes go in the existing `content` column with `source='TOOL'`. No new entity, no new repository.

**`MigrationDeliveryBulkResolveModal.tsx` (frontend, Task Group 7.5/7.6)**
- Already implements the preview-then-commit two-step flow, the `BulkResolveItem` API client integration, the affected-spec table renderer, and the dashboard refresh on success. Extend with file-upload UI; the new file upload path produces its own preview rows (operation-level) that render alongside the existing manual-entry preview rows.

## Out of Scope
- OAS schema, type, security, or server-block parsing.
- WSDL message, type, or binding (beyond operation-name) parsing.
- Runtime API discovery from traffic (handled by `api-migration-validation-service`).
- Editing uploaded OAS/WSDL inside the product (no in-browser editor, no re-upload-of-edited-file flow).
- Re-parsing stored artefacts when the parser algorithm or library changes.
- Other contract formats: GraphQL SDL, gRPC `.proto`, RAML, AsyncAPI.
- Auto-applying resolutions without a user-clicked commit (preview is always required, even for single-file uploads).
- Per-operation service-name overrides (file-level only; users must split files to get heterogeneous service names).
- Cost / effort preview in this flow (no LLM in the path; per-file and per-operation status counts are sufficient).
- A synthesised `resolved_by='oas_wsdl_upload_bot'` identity; uploads continue to use the current user identifier.
