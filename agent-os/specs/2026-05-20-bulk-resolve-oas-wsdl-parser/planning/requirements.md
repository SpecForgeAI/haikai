The Missing-input resolver flow (2026-05-20-missing-input-resolver-flow, just shipped) introduced a bulk-resolve modal in which users can resolve multiple missing API-contract inputs in one transaction. In v1 the file-upload widget is GREYED OUT and only manual entry of (service, operation) pairs is supported.

This feature wires up real OAS/WSDL parsing: the user uploads one or more contract files, the system enumerates every operation inside each, hashes each into the stable missing-input key (via the existing MissingInputKeyHasher), matches the keys against the project's outstanding insufficient_context stories, and previews/commits all matched resolutions in one transaction.

This closes the remaining v1 shim in the missing-input resolver and unlocks the dominant real-world workflow: "I have an OAS file, resolve every missing contract it covers in one go".

Working assumptions (already agreed with user, treat as decided unless a real product question arises):

1. OAS version support: OpenAPI 2.0 (Swagger), 3.0, and 3.1 — all three in v1.
2. WSDL version support: WSDL 1.1 AND WSDL 2.0 — both in v1.
3. Parse scope: operations only. No schemas, no types, no security definitions in v1.
4. Service-name extraction: OAS requires user to specify (auto-suggest from info.title); WSDL extracts from <service name>. User may override either default.
5. Operation identifier: OAS prefer operationId; fall back to method + ' ' + path lowercased. WSDL: <operation name>. Both flow into existing MissingInputKeyHasher.
6. File storage: reuse existing ProjectArtifact table with a new type value (e.g., 'missing_input_contract_upload'). Resolution rows carry back-reference to artefact.
7. Preview behaviour: per-operation status (matched/no-match/already-resolved) + per-file status (parsed/failed). Show everything before commit.
8. Multi-file upload: yes — one bulk-apply transaction across N files. Failed files skipped, not blocking.
9. Per-file error isolation: malformed/unsupported file doesn't fail the whole upload; marked failed in preview with reason.
10. Parsing happens AMS-side (Java). Gateway proxy thin pass-through. File-size cap 10MB default, configurable per project.

Out of scope:
- OAS schema / type parsing
- WSDL message / type parsing
- Runtime API discovery
- Editing uploaded OAS / WSDL inside the product
- Re-parsing stored artefacts when algorithm changes
- Other contract formats (GraphQL SDL, gRPC .proto, RAML, AsyncAPI)
- Auto-applying resolutions without user-clicked commit

Services touched:
- architecture-model-service: new OasWsdlParser service; extends MissingInputResolutionBulkService; persists ProjectArtifact rows; new POST /api/projects/{projectId}/missing-input-resolutions/parse-files (multipart preview).
- gateway: thin multipart proxy. No new LLM tasks.
- frontend: bulk-resolve modal wired up with real multi-file uploader; per-file status display; service-name override field; preview-then-commit preserved.

## Visual Assets

No visual assets provided. The visuals folder check returned no files.

## Confirmed product decisions (from clarifying answers)

The user reviewed all 10 open product questions in `clarifying-questions.md` on 2026-05-20 and confirmed every recommended default verbatim. Full text of each answer is in `clarifying-answers.md`. Summary for spec-writer reference:

1. **Service-name override granularity** — PER-FILE override only. One editable "Service name" field per file, every parsed operation inherits it. No per-operation overrides in v1.
2. **Operation-identifier normalisation** — STRICT case-only (lowercase + trim whitespace). No slash collapsing, no query-string stripping, no path-parameter canonicalisation. Matches existing manual-entry hashing.
3. **File storage table choice** — Reuse `ProjectArtifact` with new `artifact_type` value `missing_input_contract_upload`. Resolution rows carry `project_artifact_id` back-reference. No new table.
4. **Content-type detection** — AUTO-DETECT by sniffing first ~2KB. OAS markers: `openapi:` / `swagger:` / `"openapi":` / `"swagger":`. WSDL 1.1: `<wsdl:definitions` / `<definitions xmlns="...wsdl..."`. WSDL 2.0: `<description xmlns="...wsdl/2.0..."`. Detection failure → file marked failed with reason "unrecognised contract format". No user-picked type dropdown.
5. **Java parsing library choice** — `swagger-parser` (`io.swagger.parser.v3:swagger-parser`) for OAS 2.0/3.0/3.1. `wsdl4j` for WSDL 1.1. Apache CXF WSDL 2.0 reader for WSDL 2.0.
6. **"Already-resolved" preview row expander** — Non-clickable "already resolved" chip + inline "view existing resolution" link opening a read-only side panel. No accordion / inline expander.
7. **File-size cap configuration location** — Existing PROJECT SETTINGS screen, under new "Uploads" section. Single "Max contract file size (MB)" field, default 10. No dedicated screen, no per-user override, no global config.
8. **Empty-file preview rendering** — Parsed file with zero operations: status = `parsed`, operation-count = 0, yellow info-row "No operations found in this file — nothing to resolve". NOT marked failed; contributes nothing to bulk-apply.
9. **Cost preview need** — NO cost / effort preview. No LLM in this path; per-file and per-operation status counts in the existing preview are sufficient.
10. **Audit chain `resolved_by` value** — Current user identifier (matches manual-entry resolutions). Add `resolution_source = 'oas_wsdl_upload'` and `project_artifact_id` back-reference for provenance. No synthesised upload-signature identity.
