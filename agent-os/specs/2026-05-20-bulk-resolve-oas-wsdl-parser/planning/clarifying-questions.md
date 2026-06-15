# Clarifying Questions: Bulk-Resolve OAS/WSDL Parser

These are the genuinely open product questions for this spec. The 10 working assumptions captured in `requirements.md` are treated as decided and are NOT re-opened here.

For each question, a recommended default is included; please confirm or override.

---

1. **Service-name override granularity** — When the user overrides the auto-suggested service name, at what granularity does the override apply? My recommended default: PER-FILE override only — one editable "Service name" field per uploaded file (pre-filled from `info.title` for OAS or `<service name>` for WSDL), and every operation parsed from that file inherits it. Per-operation overrides are out of v1; if the user needs different service names for different operations, they should split the file or fall back to manual entry. Confirm per-file only, or do you want per-operation overrides too?

2. **Operation-identifier normalisation** — How aggressively do we normalise the operation identifier before it flows into `MissingInputKeyHasher`? My recommended default: STRICT case-only normalisation — lowercase + trim whitespace, nothing else. We do NOT collapse slashes, strip query strings, or rewrite path parameters (`{id}` vs `:id`). This matches how the existing manual-entry path hashes today, so OAS-parsed and hand-typed keys stay comparable. Confirm strict case-only, or should we also normalise slashes / strip query-strings / canonicalise path-parameter syntax?

3. **File storage table choice** — Where do the uploaded contract files persist? My recommended default: REUSE the existing `ProjectArtifact` table with a new `artifact_type` value (e.g. `missing_input_contract_upload`). Resolution rows carry a back-reference (`project_artifact_id`) to the artefact. No new table, no schema migration beyond the enum/string value. Confirm reuse with new type, or do you want a dedicated `missing_input_contract_artifact` table for cleaner separation?

4. **Content-type detection** — How does AMS know whether an uploaded file is OAS vs WSDL? My recommended default: AUTO-DETECT — sniff the first ~2KB for telltale markers (`openapi:` / `swagger:` / `"openapi":` / `"swagger":` for OAS; `<wsdl:definitions` / `<definitions xmlns="...wsdl..."` for WSDL 1.1; `<description xmlns="...wsdl/2.0..."` for WSDL 2.0). User does NOT pick a type. If detection fails, the file is marked failed in preview with reason "unrecognised contract format". Confirm auto-detect, or do you want a user-flagged dropdown per file?

5. **Java parsing library choice** — Which library does AMS use for parsing? My recommended default: `swagger-parser` (io.swagger.parser.v3:swagger-parser) for OAS 2.0/3.0/3.1 — it's the de-facto standard, handles all three versions, and already in the Java ecosystem. For WSDL: `wsdl4j` for 1.1, and the Apache CXF WSDL 2.0 reader for 2.0 (no single library covers both). Confirm this trio, or push for an alternative (e.g. apicurio-data-models for OAS)?

6. **"Already-resolved" preview row expander** — In the preview, when a parsed operation matches a missing-input key that's ALREADY resolved, is the row interactive? My recommended default: SHOW the row with a non-clickable "already resolved" chip and a small inline link "view existing resolution" that opens the existing resolution in a side panel (read-only). No expander/accordion. Keeps the preview scannable while still giving an escape hatch to inspect. Confirm chip + side-panel link, or prefer plain non-clickable row / full inline expander?

7. **File-size cap configuration location** — Where does the per-project file-size cap live in the UI? My recommended default: on the existing PROJECT SETTINGS / config screen, under an "Uploads" section, as a single "Max contract file size (MB)" field defaulting to 10. No dedicated screen, no per-user override. Confirm project-settings, or do you want a dedicated "Upload limits" screen / global system-wide config instead?

8. **Empty-file preview rendering** — How does the preview render a file that parsed successfully but contained ZERO operations (e.g. an OAS file with empty `paths: {}`)? My recommended default: file-status = `parsed`, operation-count = 0, with a yellow info-row reading "No operations found in this file — nothing to resolve". The file is NOT marked failed (parsing succeeded), but it contributes nothing to the bulk-apply. Confirm yellow-info-row, or treat empty as failed / hide it silently?

9. **Cost preview need** — Do we show any cost/effort preview before commit? My recommended default: NO preview — there is no LLM in this path (parse is pure Java, commit is a DB transaction). The existing per-file and per-operation status counts in the preview are sufficient. Confirm no cost preview, or do you want a "X operations across Y files will be resolved" summary banner above the commit button?

10. **Audit chain `resolved_by` value** — When the bulk-apply commits, what goes into the resolution row's `resolved_by` audit field? My recommended default: the CURRENT USER identifier (same value used by manual-entry resolutions today), with a separate `resolution_source` field set to `oas_wsdl_upload` and the `project_artifact_id` back-reference carrying the file provenance. We do NOT synthesise an upload-signature identity. Confirm user-id + source-tag + artefact-ref, or do you want an upload-signature (e.g. file hash) as the `resolved_by` value for clearer machine-applied provenance?

---

Please answer each by number. "Default" is shorthand for accepting my recommendation as written.
