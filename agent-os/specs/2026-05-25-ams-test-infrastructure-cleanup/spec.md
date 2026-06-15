# Specification: AMS Test Infrastructure Cleanup

## Goal

Restore default-on test compilation and execution in `architecture-model-service` by triaging every broken test file (fix or delete — no `@Disabled` half-measures), then removing the two skip flags from `architecture-model-service/pom.xml` so `mvn test-compile` exits 0 with no `-D` flags and `mvn install` runs the full suite by default. This is a pure code-cleanup pass with one commit boundary and no production-code changes.

## User Stories

- As an implementer running `mvn install` against `architecture-model-service` from a clean checkout, I want the build to compile every test file and execute every test by default, so I never again need `-Dmaven.compiler.failOnError=false -Dmaven.test.skip=false -Dtests.skip=false` rituals to do routine work.
- As a reviewer of this commit, I want every delete decision recorded in a `triage-decisions.md` audit file inside the spec folder, so I can sanity-check the "covered by newer test X" / "one-shot Liquibase changeset" calls without re-deriving them from scratch.
- As a future implementer touching AMS tests, I want compile errors to surface immediately at `mvn test-compile` time, so silent record-constructor / builder-method / id-type drift can no longer accumulate undetected behind a skip flag.

## Specific Requirements

### Binary verification anchor (the spec is not done without both)

- `architecture-model-service/pom.xml` no longer contains `<maven.test.skip>true</maven.test.skip>` or `<tests.skip>true</tests.skip>`.
- `cd architecture-model-service && mvn test-compile` exits 0 with no `-D` flags.
- The two unrelated properties `swagger-parser.version`, `wsdl4j.version`, `cxf.version` stay in place — only the two skip flags come out.
- If either anchor fails, the spec is not done; runtime failures are NOT a blocker.

### Per-broken-file triage rule (fix or delete, no third option)

- For each broken test file: decide **fix** (update record constructor invocations, builder calls, DTO shape, id-type usage to match current production) or **delete** (`git rm`).
- No `@Disabled` half-measures except the bounded escape hatch in the runtime-failures requirement below — `@Disabled` re-creates the original silent-drift problem.
- Delete criteria: (a) another currently-passing AMS / gateway / frontend test covers the same scenarios, OR (b) the production feature/DTO under test was removed, OR (c) the file is a one-shot Liquibase-changeset verifier whose changeset has shipped and was already verified in production.
- Otherwise fix. Verify no other test file references a deleted file (inheritance / `@Import`).
- Implementer deletes inline in the same commit; each delete is logged in `triage-decisions.md` for reviewer audit.

### Migration-test triage nuance (skim Javadoc first)

- Default **delete** for a migration test only if the file is already `@Disabled` pointing to a covering test, OR its assertions are about a specific changeset run rather than persistent entity invariants.
- Otherwise default **fix** — migration tests that assert ongoing entity-mapping invariants (e.g. reflection-based "field X exists and maps to column Y") catch future regressions and are worth keeping.
- Implementer must skim the class Javadoc and the first assertion block before applying the default.

### Pre-existing `@Disabled` files: delete both

- Delete `architecture-model-service/src/test/java/com/example/architecturemodel/migration/DataEntityPointFkColumnsMigrationTest.java` — already `@Disabled` with a Javadoc pointer to its covering tests, and currently fails compile. Textbook delete; record in `triage-decisions.md`.
- Delete `architecture-model-service/src/test/java/com/example/architecturemodel/integration/DataEntityPointFkSnapshotIntegrationTest.java` — compiles today but is `@Disabled` and documents its own redundancy. Record in `triage-decisions.md`.
- No other pre-existing `@Disabled` survivors are in scope unless they appear in the broken-file working set.

### Iterative working-set discovery (compile → triage → fix/delete → compile)

- Start from the 18-file inventory in `planning/test-compile-baseline.log` (captured 2026-05-25).
- The javac error count is capped at 100 by default and the current `maven-compiler-plugin` config does not honour `-Xmaxerrs` overrides; the real broken-file count may be higher. Plan for one or two additional `mvn test-compile` passes as fixed/deleted files reveal further offenders.
- Do NOT change `maven-compiler-plugin` config to bump the `-Xmaxerrs` cap — iterate the loop instead.
- The spec is not scoped to a fixed file count; it is scoped to "until `mvn test-compile` is clean".

### Long-pole fixes: refactor to `@InjectMocks` + `ReflectionTestUtils`

- `service/ModelServiceSaveTest.java` (588 lines, direct `new ModelService(...)` against a ~17+-repo constructor) and `service/ModelServiceArchitectureScopedSaveTest.java` both touch the giant `ModelService` constructor.
- Refactor both to `@InjectMocks` + `ReflectionTestUtils` (matches the existing pattern in the codebase). Do not pad the direct constructor call — that recreates the same fragility against the next infrastructure-domain spec that adds more repository arguments.
- `ModelServiceArchitectureScopedSaveTest.java`'s 30+ "cannot find symbol" errors are missing-constant declarations (`PROJECT_ID`, `ARCH_A`, `ARCH_B`, `FILENAME`), not record-constructor drift. Add the constants as `private static final` declarations alongside the refactor.

### Per-fixed-file runtime green-ness check (record, don't block)

- For each fixed file, attempt `mvn test -Dtest=<ClassName>` and record outcome in `triage-decisions.md` under one of three columns: `runtime-passed`, `runtime-failed (follow-up note)`, `not-run` (rationale required for not-run).
- Runtime failure does NOT block the spec. Same rule applies to runtime failures uncovered when the flags come off and the full suite runs.

### Bounded `@Disabled` escape hatch for runtime-failure overflow

- Acceptable threshold: up to ~20 runtime test failures recorded as follow-ups after the flags come off.
- Above that threshold, the implementer may `@Disabled("follow-up #<ticket-or-note-ref>")` the worst offenders before landing the commit so day-to-day `mvn install` stays useful.
- Each `@Disabled` added under this escape hatch gets a one-line entry in `triage-decisions.md` under a dedicated "Runtime overflow disables" section, with a follow-up ticket / raw-idea reference and a stated deletion date.
- This is the ONLY permitted use of `@Disabled` in this spec.

### `triage-decisions.md` audit file (lives in spec folder forever)

- Path: `agent-os/specs/2026-05-25-ams-test-infrastructure-cleanup/triage-decisions.md`.
- Per-entry columns (one row per broken-file-inventory entry plus any later-surfaced files): `file path | fix or delete | rationale (deletes: covering-test path; fixes: nature of drift) | runtime-passed | runtime-failed (follow-up note) | not-run (rationale)`.
- Dedicated sections also required: "Pre-existing `@Disabled` files deleted", "Production bugs found, deferred to follow-up", "Runtime overflow disables" (only if the escape hatch is used), "Runtime failures to address later" (recorded after the flags come off).
- File stays in the spec folder forever as the permanent audit trail; not deleted after follow-up specs land.

### No production-code changes

- This spec ONLY edits files under `architecture-model-service/src/test/java/**`, `architecture-model-service/pom.xml`, and the spec folder.
- If fixing a test reveals a real production bug (e.g. a record-constructor change that silently dropped a field, a DTO mapping inconsistency), record the bug in `triage-decisions.md` under "Production bugs found, deferred to follow-up". Do NOT fix it in this commit.
- The implementer may, while context is fresh, write a fresh `raw-idea.md` for the discovered bug in a new appropriately-dated spec folder — that is a separate workstream, not part of this commit.

### One commit boundary

- One commit covering: every per-file fix and delete across `architecture-model-service/src/test/java/`, the deletion of the two pre-existing `@Disabled` files, the `pom.xml` skip-flag removal, the new `triage-decisions.md` audit file, and any `@Disabled` escape-hatch tagging if the runtime-overflow threshold is crossed.
- The `pom.xml` change MUST land atomically with the fixes — no partial commit that takes the flags off before the working set is clean.

## Existing Code to Leverage

### `architecture-model-service/pom.xml` (lines pinning `<maven.test.skip>` and `<tests.skip>`)

- The two properties to remove at the end of the pass. Leave `swagger-parser.version`, `wsdl4j.version`, `cxf.version`, and the `maven-compiler-plugin` config untouched.
- The `maven-compiler-plugin` `-Xmaxerrs` config is deliberately not changed — the iterative compile loop is the answer to the 100-error javac cap.

### `service/ModelServiceArchitectureScopedSaveTest.java` (the existing `@InjectMocks` + `ReflectionTestUtils` pattern)

- This file already uses (or is being refactored to use) the `@InjectMocks` + `ReflectionTestUtils` pattern that immunises against `ModelService` constructor drift. Replicate the same pattern in `ModelServiceSaveTest.java` rather than padding a direct `new ModelService(...)` call with ~17+ repository arguments.

### `planning/test-compile-baseline.log` (the captured 2026-05-25 inventory)

- The starting point for the iterative compile-triage loop. The 18 visible files (with 100 reported errors) are the first pass; further files surface as fixes land. The log is reference-only — the canonical working set is whatever `mvn test-compile` reports against current HEAD.

### `planning/requirements.md` (research findings, Q1–Q10 accepted answers)

- The authoritative source for the triage rule nuances, the `@InjectMocks` refactor direction, the threshold-20 runtime-failure escape hatch, the `triage-decisions.md` schema, and the pre-existing-`@Disabled` deletion decision. The spec encodes the conclusions; the requirements file holds the reasoning.

### `architecture-model-service/src/test/resources/application.yml` (H2 fixtures, untouched)

- H2 in PostgreSQL mode with `liquibase.enabled: false` and `hibernate.ddl-auto: create-drop`. No Liquibase coupling at runtime; the schema is built from JPA entities. The fixture stays as-is — runtime failures are recorded, not chased into fixture changes.

## Out of Scope

- Gateway and frontend pre-existing test failures listed in `CLAUDE.md` (`bootstrap-summary-fetching.test.ts`, `conversation-memory-edge-cases.test.ts`, `dashboardSummary*.test.ts`, `hub-bootstrap-4-task-definition.test.ts`, `chatV2-panel-*.test.ts`) — different modules, separate cleanup.
- The `@JsonNaming(LowerCamelCaseStrategy.class)` audit sweep across remaining AMS DTOs — explicitly deferred to a separate cleanup spec.
- `jira-service/pom.xml`, which also pins `<maven.test.skip>true</maven.test.skip>` and `<tests.skip>true</tests.skip>` — explicitly deferred to a future `jira-service-test-infrastructure-cleanup` spec; not touched here.
- `architecture-model-service/__pycache__/` — unrelated repo artefact, separate cleanup.
- Test execution speed optimisation — slower `mvn install` is accepted as the cost of having tests actually run; pathologically-slow individual tests are a future optimisation pass.
- Production-code refactors — this spec only edits test files and `pom.xml`; production bugs uncovered during fixes are recorded for follow-up, never fixed in this commit.
- New AMS test coverage — this spec does not expand the test surface beyond what already exists; fix-or-delete only.
- CI pipeline config changes — research confirmed no CI yaml exists in this repo (no `.github/`, `.circleci/`, `*ci*.yml`); the question is moot.
- Changes to the Spring profile setup, H2 schema, Liquibase wiring, or any test fixture — unless a specific broken file's fix genuinely requires it.
- Bumping the `maven-compiler-plugin` `-Xmaxerrs` cap — the iterative compile loop is the answer.
