# Clarifying Answers: Bulk-Resolve OAS/WSDL Parser

The user confirmed ALL 10 recommended defaults from `clarifying-questions.md` verbatim, with no changes. Each answer below is the recommended default as written, locked in as a product decision.

---

## 1. Service-name override granularity

**Decision:** PER-FILE override only.

One editable "Service name" field per uploaded file (pre-filled from `info.title` for OAS or `<service name>` for WSDL), and every operation parsed from that file inherits it. Per-operation overrides are out of v1. If the user needs different service names for different operations, they should split the file or fall back to manual entry.

---

## 2. Operation-identifier normalisation

**Decision:** STRICT case-only normalisation.

Lowercase + trim whitespace, nothing else. Do NOT collapse slashes, strip query strings, or rewrite path parameters (`{id}` vs `:id`). This matches how the existing manual-entry path hashes today, so OAS-parsed and hand-typed keys stay comparable.

---

## 3. File storage table choice

**Decision:** REUSE the existing `ProjectArtifact` table with a new `artifact_type` value (e.g. `missing_input_contract_upload`).

Resolution rows carry a back-reference (`project_artifact_id`) to the artefact. No new table, no schema migration beyond the enum/string value.

---

## 4. Content-type detection

**Decision:** AUTO-DETECT — no user-flagged dropdown.

Sniff the first ~2KB for telltale markers:
- OAS: `openapi:` / `swagger:` / `"openapi":` / `"swagger":`
- WSDL 1.1: `<wsdl:definitions` / `<definitions xmlns="...wsdl..."`
- WSDL 2.0: `<description xmlns="...wsdl/2.0..."`

If detection fails, the file is marked failed in preview with reason "unrecognised contract format".

---

## 5. Java parsing library choice

**Decision:** The recommended trio.

- OAS 2.0 / 3.0 / 3.1: `swagger-parser` (`io.swagger.parser.v3:swagger-parser`)
- WSDL 1.1: `wsdl4j`
- WSDL 2.0: Apache CXF WSDL 2.0 reader

No single library covers both WSDL versions; this trio is locked in.

---

## 6. "Already-resolved" preview row expander

**Decision:** Non-clickable "already resolved" chip + small inline "view existing resolution" link that opens the existing resolution in a read-only side panel.

No expander/accordion. Keeps the preview scannable while still giving an escape hatch to inspect.

---

## 7. File-size cap configuration location

**Decision:** Existing PROJECT SETTINGS / config screen, under an "Uploads" section.

Single "Max contract file size (MB)" field defaulting to 10. No dedicated screen, no per-user override, no global system-wide config.

---

## 8. Empty-file preview rendering

**Decision:** file-status = `parsed`, operation-count = 0, with a yellow info-row reading "No operations found in this file — nothing to resolve".

The file is NOT marked failed (parsing succeeded), but contributes nothing to the bulk-apply.

---

## 9. Cost preview need

**Decision:** NO cost preview.

There is no LLM in this path (parse is pure Java, commit is a DB transaction). The existing per-file and per-operation status counts in the preview are sufficient.

---

## 10. Audit chain `resolved_by` value

**Decision:** Current user identifier (same value used by manual-entry resolutions today).

Plus:
- separate `resolution_source` field set to `oas_wsdl_upload`
- `project_artifact_id` back-reference for file provenance

No synthesised upload-signature identity.

---

## Status

All 10 product decisions confirmed verbatim by the user on 2026-05-20. Spec-writer can treat these as final.
