# Raw idea — Phase 3: auto-link discovered spec files to interface candidates

## Why this spec exists

The capture wizard's `parse-oas` flow reads `interface.spec_link` to find an OpenAPI / WSDL spec for each interface. Today that field is populated only when the user manually uploads a spec. Discovery-service already scans the repo and (in Phase 1) finds `.wsdl` files, but it does NOT promote those paths onto the parent interface candidate's `spec_link`. And it does NOT scan for standalone OAS YAML / JSON files at all — the Spring Boot adapter reads springdoc-openapi ANNOTATIONS inside Java source (`@Operation`, `@Tag`, `@ApiResponse`) but ignores `swagger.yaml` / `openapi.yaml` / `openapi.json` on disk.

Net effect: the wizard sees `spec_link === null` on most interfaces even when discovery saw the file, so the user has to upload manually. Phase 3 closes that gap with deterministic file-to-interface matching.

## Workstream A — Standalone OAS spec file discovery

- New scanner pass that walks the repo for OpenAPI / Swagger spec files.
- Conventional locations: `src/main/resources/**/*.{yaml,yml,json}`, the root of `src/main/resources/`, and the project root.
- File-signature detection: a file qualifies if its top-level keys include `openapi:` (any 3.x), `swagger: '2.0'`, OR has the `info.title` + `info.version` + `paths` shape. YAML and JSON parsed read-only; no network.
- Match each discovered spec to the most-likely interface candidate using deterministic heuristics, first match wins:
  1. `info.title` exact match against an interface candidate's `name`
  2. `paths` base-prefix match against the interface's known base path (Spring Boot adapter already captures `basePath` / `controllerType`)
  3. Tag name match (springdoc `@Tag(name=...)` already on the interface's `data`)
- Promote a unique match to `interface.spec_link = <repo-relative-path>` and emit a `[diag-pack]` log line.
- Ambiguity / orphan cases emit `evidence_gap` findings — don't guess.

## Workstream B — Promote WSDL paths to SOAP `spec_link`

- Phase 1's SOAP scanner already finds `.wsdl` files. Extend its emitter so the parent interface candidate's `spec_link` is set to the WSDL path when one is matched to that interface. The endpoint-level `data.wsdl_source` stays for per-operation context.
- Match each WSDL to the right interface candidate via WSDL `targetNamespace` → namespace recorded on existing SOAP interface candidates (Phase 1 captures `data.request_namespace` on endpoint candidates; the parent interface picks this up).
- Same evidence-gap sentinels for ambiguous / orphan matches.

## Workstream C — Wizard auto-pickup

- The wizard's `parse-oas` action already reads `interface.spec_link`. When the path is repo-relative, AMVS must fetch the file via Phase 2's source endpoint (`GET /discovery/.../runs/:runId/source/*`) instead of `fs.readFile` against AMVS's own filesystem.
- Change-site: `parseOasFromFile` in `api-migration-validation-service/src/services/oasParser.ts` (or equivalent). Branch on path shape: absolute path → existing local-read; repo-relative → source endpoint.
- Acceptance: opening the wizard against a project whose discovery run found `swagger.yaml` shows the spec selected by default in Step 1, parse-oas auto-fires using the discovered file, Step 4 lands pre-populated. Same flow for SOAP with a `.wsdl`.

## Open design points to surface during shaping

These are the calls the user needs to make before write-spec produces `spec.md`:

- P-1 Scanner placement. (a) extend Spring Boot adapter; (b) extend Spring Classic SOAP pack; (c) new standalone scanner `specFileLinker` invoked from both. Lean: (c).
- P-2 REST match priority when heuristics conflict. Title → base-path → tag-name? Lean: yes, exact priority order.
- P-3 SOAP match strategy. WSDL `targetNamespace` exact match only; no fuzzy. Lean: confirm exact-only.
- P-4 Multiple candidate specs for the same interface. Lean: `evidence_gap` `gapType='oas_spec_ambiguous_match'`, leave `spec_link` null.
- P-5 Orphan spec files. Lean: `evidence_gap` `gapType='oas_spec_orphan'`.
- P-6 `spec_link` value format. Lean: repo-relative paths only (matching Phase 2 convention).
- P-7 `parseOasFromFile` resolution change. Lean: branch inside `parseOasFromFile`, no new function.
- P-8 Pre-existing `spec_link` values. Lean: never overwrite a non-null value; log skipped.
- P-9 Test fixtures. Lean: reuse Phase 1's `reference-spring-ws-countries.xsd` and `reference-jaxws-document-literal-wrapped.wsdl`; add one fresh OAS YAML fixture.
- P-10 Diagnostic log prefix. Lean: `[diag-pack] scanner=spec_file_linker ...`.

## Out of scope (Phase 4 or out forever)

- LLM-assisted matching when deterministic heuristics fail (Phase 4).
- Spec-file content validation against OpenAPI / WSDL XSD (already handled by `parse-oas`).
- Storing spec file contents in AMS as a separate entity (file lives in discovery-service cache).
- Multi-file OAS spec resolution (specs that `$ref` external YAML files) — emit `evidence_gap` instead.
- XSD-only files without a parent WSDL — they enrich the WSDL flow when paired but have no interface owner on their own.

## Acceptance signal

- A project containing `src/main/resources/openapi.yaml` (paths matching an existing REST controller's base) produces ONE interface candidate with `spec_link` set to the file's repo-relative path. The wizard's Step 1 shows the spec auto-selected; `parse-oas` fires using that path; Step 4 pre-populates with the spec's operations.
- A project containing `src/main/resources/service.wsdl` with `targetNamespace` matching an existing SOAP interface's namespace produces the same flow for that interface.
- A repo with no spec files behaves exactly as today (no regressions on existing flows).
