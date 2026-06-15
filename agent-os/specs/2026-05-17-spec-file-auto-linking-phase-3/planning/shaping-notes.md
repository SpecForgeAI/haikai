# Shaping Notes — Spec File Auto-Linking (Phase 3)

Status: Shaping complete. All clarifying questions resolved (user accepted recommended defaults across the board on 2026-05-17). Ready for `/agent-os:build-spec`.

Source of decisions: orchestrator-provided resolution bundle dated 2026-05-17. This document captures those decisions verbatim in a form the spec-writer can lift directly into the spec.

---

## 1. Scanner architecture

- **P-1 — Standalone scanner `specFileLinker`.** Runs AFTER framework adapters have produced interface candidates. Invoked as a stage of the existing pack-scanner pipeline. Uses the same `FindingEmitter`, the same run context, and the same ordering invariants.
- **P-12 — Pipeline integration.** It is a stage of the existing pipeline, NOT a separate phase / not a separate pipeline pass.
- **P-13 — Test layout.**
  - New: `specFileLinker.test.ts` colocated with the scanner.
  - Small extension to Phase 1's SOAP-emitter test for the WSDL `spec_link` promotion (that promotion is a property of the SOAP emitter, not of the linker).

## 2. REST OpenAPI Spec (OAS) matching — Workstream A

- **P-2 — Match priority order.** First match wins; once matched, lower-priority heuristics are NOT consulted for that interface.
  1. `info.title` exact match against an interface candidate's `name`.
  2. `paths` base-prefix match against the interface's known base path.
  3. springdoc `@Tag(name=...)` match against the interface's `data.openApiTag`.
- **P-15 — YAML parsing.** Add `js-yaml` to `discovery-service/package.json` if not already present (zero-dep, MIT, standard choice). Implementer to verify presence before adding.

## 3. SOAP WSDL matching — Workstream B

- **P-3 — SOAP match strategy.** Exact-only, byte-for-byte WSDL `targetNamespace` match against the namespace recorded on existing SOAP interface candidates. No fuzzy matching, no case-insensitive matching, no trailing-slash tolerance. False positives are unacceptable on namespace identifiers.

## 4. Ambiguity and orphan handling

- **P-4 — Multiple matches → `evidence_gap`.**
  - `gapType = 'oas_spec_ambiguous_match'`.
  - Leave `spec_link` null on ALL involved candidates.
  - Log the conflict at `[diag-pack]` level including all candidate IDs.
- **P-5 — Orphan specs → `evidence_gap`.**
  - `gapType = 'oas_spec_orphan'`.
  - Record the file path on the gap.
  - Do NOT create a new interface candidate from a spec file alone (would conflict with adapter-driven candidates).
- **P-14 — Sentinel additions follow Phase 1's convention.**
  - Phase 1 added dedicated builder functions for `'soap_endpoint_url_unknown'` and `'wsdl_parse_failed'`.
  - Phase 3 adds dedicated builders in the same `emissionSources.ts` location:
    - `buildOasSpecAmbiguousGap(...)`
    - `buildOasSpecOrphanGap(...)`

## 5. `spec_link` value semantics

- **P-6 — Repo-relative paths only for discovery-set values.** Matches the Phase 2 source-endpoint convention. Absolute paths remain valid only for legacy manual-upload values; existing rows are NOT touched.
- **P-8 — Never overwrite a non-null `spec_link`.** If the scanner finds a match for an interface whose `spec_link` is already populated, skip and log at `[diag-pack]` level: `spec_link_skipped pre_existing=...`. User's manual choice always wins.
- **P-16 — Cache / re-run behaviour.** Per P-8, never overwrite. Re-runs are idempotent for existing matches; new matches set new candidates' fields. Re-runs never DELETE `spec_link` values.

## 6. Wizard auto-pickup — Workstream C

- **P-7 — Single `parseOasFromFile` with internal branching on `path.isAbsolute()`.**
  - Repo-relative → fetch via Phase 2's source endpoint via a private helper.
  - Absolute → existing local-read path.
  - Single contract for the route; no new public function.
- **P-11 — AMVS (api-migration-validation-service) resolution site.** Spec-writer to `grep api-migration-validation-service/src/` for `spec_link` and `readFile` calls to confirm the exact branching site. Raw idea names `parseOasFromFile` in `api-migration-validation-service/src/services/oasParser.ts`; spec-writer should confirm during write phase.

## 7. Multi-architecture scoping

- **P-17 — Service-root scoping.** Use the discovery run's existing service-root scoping. Files outside the run's target service root are NOT scanned. Cross-service spec sharing in a monorepo emits `oas_spec_orphan` when no in-scope interface matches.

## 8. Test fixtures

- **P-9 — Reuse Phase 1's SOAP fixtures.**
  - `agent-os/specs/2026-05-17-soap-discovery-spring-classic-phase-1/planning/visuals/reference-spring-ws-countries.xsd`
  - `agent-os/specs/2026-05-17-soap-discovery-spring-classic-phase-1/planning/visuals/reference-jaxws-document-literal-wrapped.wsdl`
- **Add two new OAS fixtures** under THIS spec's `planning/visuals/`:
  - `reference-springdoc-petstore.yaml` — OpenAPI 3.0 YAML; exercises Workstream A's title + base-path + tag-name match heuristics.
  - `reference-springdoc-petstore.json` — minimal OpenAPI 3.0 JSON variant; exercises the JSON parse path.

## 9. Diagnostic logging

- **P-10 — Log prefix.** `[diag-pack] scanner=spec_file_linker ...` for all log lines from this scanner. Mirrors Phase 1's `scanner=spring_classic_soap` convention.

## 10. Out of scope (Phase 4 or out forever)

- LLM-assisted matching when deterministic heuristics fail — Phase 4 territory.
- Spec-file content validation against OpenAPI / WSDL XSD — already handled by `parse-oas`.
- Storing spec file contents in AMS as a separate entity — file lives in discovery-service cache.
- Multi-file OAS spec resolution (specs that `$ref` external YAML files) — emit `evidence_gap` instead.
- XSD-only files without a parent WSDL.
- **P-18** — AsyncAPI specs, gRPC `.proto` files, GraphQL SDL files. Future phases if they materialise.

---

## Existing code reuse pointers

User did not supply explicit paths. Spec-writer to confirm at write time:

- **Phase 1 SOAP WSDL-finding code:** `discovery-service/src/services/findings/packFindingScanners/springClassicSoap/wsdlParser.ts` (per Phase 1 spec).
- **Pack-scanner-pipeline orchestrator:** spec-writer to locate via grep at write time (likely `discovery-service/src/services/findings/packFindingScanners/index.ts` or sibling).
- **`evidence_gap` finding builder location:** `discovery-service/src/services/findings/emissionSources.ts` (Phase 1 + Phase 2 both extended this file).
- **Phase 2 source endpoint handler:** `discovery-service/src/routes/source.ts` (Phase 2 Group 1).

## Visual assets supplied

None from the user. Spec-writer and implementers work from textual descriptions plus the four fixture files:
- Two existing Phase 1 fixtures (referenced above under P-9).
- Two new OAS fixtures to be added under THIS spec's `planning/visuals/` during implementation.

---

## Open items

None. All clarifying questions (P-1 through P-18) resolved. Shaping pass complete; ready for `/agent-os:build-spec`.
