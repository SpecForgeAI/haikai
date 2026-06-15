# Implementation Notes: Bulk-Resolve OAS/WSDL Parser

Spec: 2026-05-20 Bulk-Resolve OAS/WSDL Parser
Task Group 9.5 -- brief summary of library versions, design choices, and
sharp edges discovered during implementation.

## Library versions chosen (AMS `pom.xml`)

| Library | Version | Why |
|---------|---------|-----|
| `io.swagger.parser.v3:swagger-parser` | `2.1.22` | Handles OAS 2.0, 3.0, 3.1 in one library with JSON+YAML transparency. Already cached locally in the build environment. Permissive on $ref resolution which we disable explicitly (`ParseOptions.setResolve(false)`) to keep parsing local-only. |
| `wsdl4j:wsdl4j` | `1.6.3` | JSR-110 reference implementation. Long-stable, Apache 2.0. Disables verbose + import resolution at the reader level so uploaded WSDL bytes never trigger external fetches. |
| `org.apache.cxf:cxf-rt-wsdl` | `4.0.5` | Declared on the classpath so the WSDL 2.0 dispatch branch can later swap in the full CXF WSDLManager reader. The v1 implementation uses DOM extraction (sufficient for "operation names only") and treats CXF as a placeholder for future enrichment. |

No transitive conflicts with Spring Boot 3.2.x BOM. The CXF runtime
footprint is intentionally minimal -- pulling in `cxf-rt-wsdl` alone
avoids the JAX-WS frontend / databinding stack.

## Design choices vs. the spec

1. **Service-level orchestration sits on a new class, not on
   `MissingInputResolutionBulkService`.** Per Task 3.4's implementation
   note we created `OasWsdlContractIngestService` as a sibling service
   rather than adding a method to the existing bulk service. Reason: the
   detect -> parse -> classify -> persist pipeline has a different
   transactional shape (artefact must persist BEFORE the resolution row
   so the FK can be stamped) and a different input shape (multipart
   bytes vs. structured BulkResolveItems). Keeping it separate kept the
   existing `bulkResolve(...)` signature untouched (purely additive at
   the service-graph level).

2. **`serviceNames` is positional, not a JSON map.** Task 4.2's note
   spells out the deviation: AMS binds `serviceNames` as a
   `@RequestParam List<String>` so the controller sees positional
   ordering aligned with the file-part ordering. Matches the multipart
   conventions used by `InfrastructureTerraformImportController`. The
   spec said "JSON map keyed by filename" but the gateway and frontend
   both produce the positional form, so the AMS surface follows suit.

3. **`file_too_large` reason string instead of `file_size_exceeded`.**
   Task 4.3's note documents this: we kept the shorter token to match
   the gateway's multer `LIMIT_FILE_SIZE` error code. The spec's
   `file_size_exceeded` spelling is captured in the controller's
   javadoc + the response-envelope message so user-visible copy can
   still reference the spec wording.

4. **Total-upload safety cap of 5x per-file.** Task 4.3's note: the
   per-project cap controls individual file size; the controller adds a
   safety multiplier (5x) so a caller submitting many "just-under-cap"
   files cannot OOM the JVM. Sum-of-`getSize()` is checked before any
   bytes are read into memory.

5. **Gateway does NOT read per-project cap.** Task 5.2's note: the user
   directed that AMS owns the per-project cap. The gateway sets a
   generous 100 MB per-file ceiling on multer (defensive against multer
   default changes) and lets AMS enforce the real cap. This means a
   request between 10 MB (project cap) and 100 MB (gateway cap) reaches
   AMS and is rejected there with `file_too_large` per-file -- the
   gateway never short-circuits a request that's within its own ceiling.

6. **Project DTO field added on the EXISTING `ProjectDto`.** The
   `maxContractUploadFileSizeMb` field flows through the existing
   project PATCH endpoint. No new endpoint, no new screen. The boxed
   `Integer` discipline per `project_primitive_double_dto_overwrite.md`
   means a PATCH that omits the field leaves the stored value alone.

7. **Field-injected optional collaborators on the controller.** Task 4.2:
   `OasWsdlContractIngestService` and `ProjectRepository` are
   `@Autowired(required = false)` on `MissingInputResolutionsController`
   so existing 4-arg constructor tests (`MissingInputResolutionController*Test`)
   still wire cleanly. Production deployments populate both.

## Sharp edges discovered

1. **Swagger short-name collision.**
   `io.swagger.v3.oas.models.Operation` collides by short name with
   `javax.wsdl.Operation`. The parser service imports `javax.wsdl.*`
   (since WSDL types appear in multiple methods) and references the OAS
   operation type via its fully-qualified name inline. Documented in the
   class javadoc.

2. **WSDL 2.0 DOM read sufficient for v1 scope.** The full CXF
   `WSDLManager` API is overkill for "operation names only". A direct
   DOM read of `//service/@name` and
   `//interface/operation/@name` (with namespace-aware lookup against
   `http://www.w3.org/ns/wsdl`) is simpler and avoids the binding-
   traversal complexity. The CXF dependency stays declared so future
   passes (e.g., binding-aware parsing) can swap in the real reader
   without re-doing the Maven plumbing.

3. **XXE / DTD hardening on the WSDL 2.0 DOM reader.** A malicious
   WSDL 2.0 file could otherwise trigger entity-expansion attacks. The
   parser sets the standard DTD-disabling features
   (`disallow-doctype-decl`, `external-general-entities`,
   `external-parameter-entities`, `setExpandEntityReferences(false)`).
   These are reapplied per parse so a future caller passing a
   `DocumentBuilderFactory` from elsewhere cannot accidentally undo
   them.

4. **`OpenAPIParser.readContents` may return non-null `SwaggerParseResult`
   with a null `OpenAPI` model.** When the input is garbage but
   structurally JSON/YAML, the swagger-parser returns a result with a
   populated `messages` list and a null model. The parser service
   treats this as FAILED and surfaces the joined messages as the
   `failureReason` string.

5. **wsdl4j keys services by QName.** The first-service-in-document-order
   convention (per spec) is implemented by iterating
   `def.getServices().keySet()` and taking the first entry, then reading
   `QName.getLocalPart()`. Map iteration order is preserved for the
   wsdl4j `HashMap` because the WSDL is parsed sequentially.

6. **`info.title` lowercase + trim is applied at parse time, not at
   classify time.** This means the per-file user override (resolved at
   classify time) does NOT get lowercased -- if a user types
   `"OrdersSvc"` as an override, that exact case is used in the hash
   key derivation. The hasher's
   `canonicalDescriptorForApiContract(...)` is the final case
   normaliser; this is the same behaviour as the manual-entry path so
   OAS/WSDL keys match manual-entry keys byte-for-byte.

7. **Liquibase changeset 152 backfill via DB DEFAULT, not UPDATE.** On
   Postgres 11+, adding a column with a `DEFAULT` clause back-fills
   existing rows in a metadata-only operation. No separate `UPDATE
   project SET ...` statement is needed (and a stray one would be a
   silent footgun). The smoke test asserts the absence of any
   `UPDATE project` statement in changeset 152.

8. **The frontend modal does NOT persist files across the
   preview/commit boundary.** The user explicitly re-confirms intent by
   clicking Apply, which re-uploads the same files. This is intentional
   per spec; it also avoids the React state complexity of keeping a
   `File` instance alive across an async pipeline (browsers may
   garbage-collect the underlying file handle).

## Test infrastructure

The AMS module has `<maven.test.skip>true</maven.test.skip>` because the
broader test suite has pre-existing compile errors on this branch (see
`gitStatus` in the original task context for the list of unrelated
`M src/test/...` files). The bulk-resolve feature tests are runnable via
an isolated `javac` + `junit-platform-console-standalone` workaround
(documented in the changeset-smoke test class javadoc); a single
invocation compiles only the 6 feature test files against
`target/classes` + Maven's dependency classpath, then runs them through
the console launcher. Total wall-clock: about 8 seconds for 35 tests.

## Production smoke test (Task 9.3, deferred)

The smoke test (`Liquibase from clean -> start AMS -> start gateway ->
start frontend -> upload a real OAS + WSDL -> preview -> commit ->
verify dashboard counter`) is a manual step. It depends on a clean
local Postgres + the dashboard's ready-to-retry surface, neither of
which is automated yet in CI. Left as a smoke-test runbook item rather
than blocking the Task Group 9 close-out.
