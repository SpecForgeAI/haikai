# Task Breakdown: AMS Test Infrastructure Cleanup

## Overview
Total Tasks: 7 task groups. One commit boundary. **No new test coverage** (fix-or-delete only). **No production-code changes** (production bugs found mid-spec are recorded for follow-up, never fixed in this commit). Scope is closed by two binary verification anchors: (a) `architecture-model-service/pom.xml` no longer contains `<maven.test.skip>` or `<tests.skip>`, and (b) `cd architecture-model-service && mvn test-compile` exits 0 with no `-D` flags. Runtime failures do NOT block the spec — they are recorded in `triage-decisions.md`, with a bounded `@Disabled("follow-up …")` escape hatch above ~20 failures.

## Task List

---

### Group 1: Audit-file scaffolding — create `triage-decisions.md` with the agreed schema and pre-populated visible-18

#### Task Group 1: Stand up the permanent audit trail before any code changes
**Dependencies:** None
**Tests added:** 0 (per spec — cleanup pass, no new coverage)

- [x] 1.0 Create the audit file and seed it with the visible-18 entries from the baseline log
  - [x] 1.1 Create `agent-os/specs/2026-05-25-ams-test-infrastructure-cleanup/triage-decisions.md`
    - Path is fixed by the spec — the file lives in the spec folder forever as the permanent audit trail
    - Open with a short preamble pointing at `spec.md` and `planning/test-compile-baseline.log` for the original captured inventory
  - [x] 1.2 Add the per-entry table columns exactly as defined in Q7 of `planning/requirements.md`
    - Columns: `file path | fix or delete | rationale (deletes: covering-test path; fixes: nature of drift) | runtime-passed | runtime-failed (follow-up note) | not-run (rationale)`
    - One row per broken file — later-surfaced files (from iterative re-compile in Group 4) get appended as new rows, NOT a separate table
  - [x] 1.3 Add the four dedicated sections required by the spec
    - "Pre-existing `@Disabled` files deleted" — at least the two files named in spec.md will end up here
    - "Production bugs found, deferred to follow-up" — empty for now; appended to as Groups 3/4/6 fix files and surface real bugs
    - "Runtime overflow disables" — only populated if the >20-runtime-failure escape hatch fires in Group 6
    - "Runtime failures to address later" — populated by Group 6 after `mvn test` is run with the flags off
  - [x] 1.4 Pre-populate the table with the visible-18 entries from `planning/test-compile-baseline.log`
    - All 18 entries (from `planning/requirements.md` lines 27-48) seeded with `fix or delete` left blank and a placeholder rationale of `not-yet-triaged`
    - File paths recorded as relative paths under `architecture-model-service/src/test/java/com/example/architecturemodel/...`
    - Runtime columns left blank — they get filled in only after Group 6 runs
  - [x] 1.5 Verify the scaffolding is sufficient before any code changes
    - Confirm the table renders correctly in markdown
    - Confirm all 18 entries from the baseline log are present
    - Confirm the four dedicated sections exist with appropriate placeholders

**Acceptance Criteria:**
- `triage-decisions.md` exists at the spec folder path with the agreed Q7 column schema
- All 18 visible files from `planning/test-compile-baseline.log` are seeded as rows with `not-yet-triaged` status
- The four dedicated sections ("Pre-existing `@Disabled` files deleted", "Production bugs found, deferred to follow-up", "Runtime overflow disables", "Runtime failures to address later") are present
- The implementer is expected to update this file *as part of each file's task in subsequent groups*, never as a final-pass summarisation

---

### Group 2: Long-pole refactor — `ModelServiceSaveTest` to `@InjectMocks`, plus trivial constants-fix on `ModelServiceArchitectureScopedSaveTest`

#### Task Group 2: Unblock the bulk of the compile-error budget via the two `ModelService`-constructor tests
**Dependencies:** Task Group 1
**Tests added:** 0 (existing tests refactored, no new coverage)

- [x] 2.0 Refactor the two long-pole files that touch the giant `ModelService` constructor
  - [x] 2.1 Refactor `service/ModelServiceSaveTest.java` (588 lines) to `@InjectMocks` + `ReflectionTestUtils`
    - Replace direct `new ModelService(...)` against the ~17+-repo constructor with the `@InjectMocks` pattern
    - Add `@ExtendWith(MockitoExtension.class)` at the class level (if not already present)
    - Convert each previously-passed repository argument into a `@Mock private <RepoType> <repoName>;` field declaration
    - Add `@InjectMocks private ModelService modelService;` as the system-under-test
    - Use `ReflectionTestUtils.setField(modelService, "<fieldName>", <value>)` for any non-mock setup that the old constructor call previously did inline
    - Match the existing pattern in `ModelServiceArchitectureScopedSaveTest` (see `Existing Code to Leverage` in `spec.md`) — do NOT pad the direct constructor call
    - Record outcome in `triage-decisions.md`: `fix | refactored to @InjectMocks per spec long-pole rule | <runtime column to be filled in Group 6>`
  - [x] 2.2 Apply the trivial constants-fix on `service/ModelServiceArchitectureScopedSaveTest.java`
    - Add the four missing `private static final` declarations per Finding 3 in `planning/requirements.md`:
      - `private static final UUID PROJECT_ID = UUID.randomUUID();`
      - `private static final UUID ARCH_A = UUID.randomUUID();`
      - `private static final UUID ARCH_B = UUID.randomUUID();`
      - `private static final String FILENAME = "test-filename";` (or whatever string literal the existing call sites assume — verify against the 30+ "cannot find symbol" sites before picking)
    - Confirm `java.util.UUID` is imported
    - This is NOT a record-constructor-drift fix — it is missing declarations only; do not chase the file into a wider refactor
    - Record outcome in `triage-decisions.md`: `fix | added 4 missing static-final constant declarations (PROJECT_ID, ARCH_A, ARCH_B, FILENAME) | <runtime column to be filled in Group 6>`
  - [x] 2.3 Run both files in isolation to confirm they compile
    - From `architecture-model-service/`, run `mvn test-compile -Dmaven.test.skip=false -Dtests.skip=false -Dmaven.compiler.failOnError=true -Dtest=ModelServiceSaveTest`
    - Repeat for `-Dtest=ModelServiceArchitectureScopedSaveTest`
    - Both files MUST compile cleanly before moving on — they are the long-poles, so leaving them broken would distort the iterative re-compile loop in Group 4
    - Do NOT run runtime tests here — runtime sweep is Group 6's job
  - [x] 2.4 Update `triage-decisions.md` immediately
    - Flip both rows from `not-yet-triaged` to `fix`, with the rationale text as drafted in 2.1 and 2.2
    - Do NOT defer the audit-file update to a final pass — the spec is explicit that the implementer updates the file *as part of each file's task*

**Acceptance Criteria:**
- `ModelServiceSaveTest.java` no longer calls `new ModelService(...)` directly; it uses `@InjectMocks` + `ReflectionTestUtils` per the existing pattern
- `ModelServiceArchitectureScopedSaveTest.java` has the four required `private static final` constants declared and imports `java.util.UUID`
- Both files compile cleanly in isolation via `mvn test-compile -Dtest=<ClassName>`
- `triage-decisions.md` has both rows flipped to `fix` with the agreed rationale text
- The next compile pass (Group 3) starts from a base where these two long-poles are already resolved

---

### Group 3: First-pass triage of the remaining visible-18 — fix or delete every other broken file from the baseline

#### Task Group 3: Per-file triage and execution across the 16 remaining baseline entries
**Dependencies:** Task Groups 1, 2
**Tests added:** 0

- [x] 3.0 Triage and execute fix-or-delete decisions for each remaining visible-18 file
  - [x] 3.1 Delete the two pre-existing `@Disabled` files per the accepted Q3 answer
    - `git rm architecture-model-service/src/test/java/com/example/architecturemodel/migration/DataEntityPointFkColumnsMigrationTest.java`
      - Already `@Disabled` with a Javadoc pointer to its covering tests (`DataEntityPointFkSnapshotIntegrationTest` + `DataEntityPointIntegrationTest`), and currently fails compile — textbook delete
      - Record under the "Pre-existing `@Disabled` files deleted" section in `triage-decisions.md`, with the covering-test paths in the rationale
    - `git rm architecture-model-service/src/test/java/com/example/architecturemodel/integration/DataEntityPointFkSnapshotIntegrationTest.java`
      - Compiles today but is `@Disabled` and documents its own redundancy — delete per Q3
      - Record under the same section in `triage-decisions.md`
    - Verify no other test file references either deleted file (inheritance / `@Import` / static-import); the `git grep "DataEntityPointFkColumnsMigrationTest"` and `git grep "DataEntityPointFkSnapshotIntegrationTest"` sweeps MUST return zero matches across `architecture-model-service/src/test/`
  - [x] 3.2 Triage each of the 16 remaining visible-18 files using the spec rules
    - For each file, apply the fix-or-delete rules from `spec.md` "Per-broken-file triage rule":
      - **Delete if:** (a) another currently-passing AMS / gateway / frontend test covers the same scenarios; OR (b) the production feature / DTO under test was removed; OR (c) the file is a one-shot Liquibase-changeset verifier whose changeset has shipped and was already verified in production
      - **Otherwise fix:** update record constructor invocations, builder calls, DTO shape, id-type usage (`UUID` ↔ `String`) to match current production
    - For **migration tests specifically**, skim the class Javadoc and the first assertion block first per the spec's "Migration-test triage nuance":
      - Default **delete** only if the file is already `@Disabled` pointing to a covering test, OR its assertions are about a specific changeset run rather than persistent entity invariants
      - Otherwise default **fix** — migration tests that assert ongoing entity-mapping invariants (e.g. reflection-based "field X exists and maps to column Y") catch future regressions and are worth keeping
      - `migration/WorkItemExternalUrlMigrationTest.java` is the known fix candidate per Finding 2 in `planning/requirements.md` (reflection on `WorkItemEntity.externalUrl` → permanent regression invariant)
    - Files to triage (the 16 remaining after Group 2 and the two `@Disabled` deletes):
      - `controller/ModelControllerTest.java`
      - `controller/ProductSummaryControllerTest.java`
      - `controller/SequenceDiagramControllerTest.java`
      - `dto/ExpandResolveDtoTest.java`
      - `integration/BusinessLogicIntegrationTest.java`
      - `integration/InterfaceDiscoveryIntegrationTest.java`
      - `migration/WorkItemExternalUrlMigrationTest.java`
      - `model/dto/MetaModelDtoExtensionTest.java`
      - `service/ContextBundleExpansionServiceDiagramTest.java`
      - `service/DiscoveryRunServiceScopedConfigOptionalTest.java`
      - `service/ImplementContextResolutionServiceTest.java`
      - `service/ModelServiceUserJourneyGapTest.java`
      - `service/TypedContentCreateSaveFlowTest.java`
      - `service/UserJourneyLinkGapFillTest.java`
      - `service/UserJourneySyncServiceTest.java`
    - For each file: record the decision in `triage-decisions.md` *before* executing it (so the audit reflects the call, not the result)
  - [x] 3.3 Execute the per-file decisions
    - For **fix** decisions: edit the file to match current production (record constructor args, builder calls, DTO field references, id-type usage). Do NOT add new assertions or expand coverage — fix-or-delete only
    - For **delete** decisions: `git rm <path>`, then `git grep "<ClassName>"` across `architecture-model-service/src/test/` to confirm no other file references the deleted class
    - For each fix: verify the file compiles in isolation via `mvn test-compile -Dtest=<ClassName>` with the appropriate `-D` flags before moving to the next file
    - If a fix surfaces a real production bug (per spec "No production-code changes"), record it in `triage-decisions.md` under "Production bugs found, deferred to follow-up" and move on — do NOT fix the bug in this commit
  - [x] 3.4 Update `triage-decisions.md` after each file
    - As each file is executed, flip its row from `not-yet-triaged` to `fix` or `delete` with the agreed rationale
    - For deletes, include the covering-test path (or "production feature removed" / "one-shot changeset shipped") in the rationale
    - For fixes, summarise the nature of drift (e.g. "record constructor gained `auditedAt` field"; "`logicalEntityId` builder removed, replaced by `entityId`")
    - This is per-file as the file is handled — NOT a batch update at the end of Group 3

**Acceptance Criteria:**
- The two pre-existing `@Disabled` files are deleted via `git rm` and logged under "Pre-existing `@Disabled` files deleted" in `triage-decisions.md`
- All 16 remaining visible-18 files have either been fixed in place (with current-production-compatible call sites) or deleted via `git rm`
- Every fix or delete is recorded in `triage-decisions.md` *at the time of execution*, not as a post-hoc batch
- Any production bug surfaced during fixes is recorded under "Production bugs found, deferred to follow-up" — the bug itself is NOT fixed in this commit
- No `@Disabled` half-measures applied here — fix or delete only

---

### Group 4: Iterative re-compile loop — surface and resolve any later-revealed broken files

#### Task Group 4: Drive `mvn test-compile` to clean exit via repeated triage-fix-delete passes
**Dependencies:** Task Groups 1, 2, 3
**Tests added:** 0

- [x] 4.0 Iterate `mvn test-compile` until it exits 0 with no `-D` flags would be possible (flags still on at this stage)
  - [x] 4.1 Run the first post-Group-3 compile pass
    - From `architecture-model-service/`, run `mvn test-compile -Dmaven.test.skip=false -Dtests.skip=false -Dmaven.compiler.failOnError=true`
    - (The flags are still pinned in `pom.xml` at this point — they come off in Group 5; the `-D` overrides are needed to force the compile here)
    - Capture the output to a working log so the new offenders can be cross-referenced against the seeded visible-18 entries
  - [x] 4.2 Identify newly-surfaced broken files
    - The javac error count is capped at 100 by default and `maven-compiler-plugin` does not honour `-Xmaxerrs` overrides under the current config (per `spec.md` "Iterative working-set discovery")
    - Any file in the new compile output that was NOT in the original visible-18 baseline is a newly-surfaced offender
    - Do NOT modify `maven-compiler-plugin` config to bump the cap — iterate the loop instead
  - [x] 4.3 Triage each newly-surfaced file using the same rules as Group 3
    - Same fix-or-delete heuristic (covering-test path; production feature removed; one-shot changeset shipped)
    - Same migration-test nuance (skim Javadoc + first assertion block; default delete only for `@Disabled`-with-covering-test OR specific-changeset-run assertions)
    - Append a new row to the `triage-decisions.md` table for each surfaced file — same column schema as the seeded visible-18 rows
    - Record the decision *before* executing, then update the row with the executed outcome
  - [x] 4.4 Execute the per-file decisions, then re-run `mvn test-compile`
    - Same execution rules as Group 3.3 (fix in place vs `git rm`, isolated `mvn test-compile -Dtest=<ClassName>` per fix, `git grep` per delete)
    - After each batch of fixes/deletes, re-run the full `mvn test-compile` from 4.1 to surface the next round of offenders revealed by the 100-error cap
    - Repeat the surface → triage → execute → recompile cycle until no compile errors remain
  - [x] 4.5 Verify a clean compile with flags still on (sanity check before Group 5)
    - Final `mvn test-compile -Dmaven.test.skip=false -Dtests.skip=false -Dmaven.compiler.failOnError=true` MUST exit 0
    - This proves the working set is clean BEFORE the `pom.xml` flags come off — the spec is explicit that "the `pom.xml` change MUST land atomically with the fixes — no partial commit that takes the flags off before the working set is clean"
    - Any compile error here means the loop is not done — return to 4.1 and continue

**Acceptance Criteria:**
- Every file surfaced by `mvn test-compile` after Group 3 has been either fixed or deleted
- Every surfaced file has a row in `triage-decisions.md` with a `fix` or `delete` decision and rationale recorded at the time of execution
- `maven-compiler-plugin` config in `architecture-model-service/pom.xml` is unchanged (no `-Xmaxerrs` bump)
- The final `mvn test-compile -Dmaven.test.skip=false -Dtests.skip=false -Dmaven.compiler.failOnError=true` exits 0 with the skip flags still pinned in `pom.xml`
- The working set is clean and ready for the `pom.xml` skip-flag removal in Group 5

---

### Group 5: Flag removal — strip the two `<maven.test.skip>` / `<tests.skip>` properties from `pom.xml`

#### Task Group 5: Edit `architecture-model-service/pom.xml` to remove the two skip flags, preserving everything else
**Dependencies:** Task Group 4 (working set must be clean before the flags come off)
**Tests added:** 0

- [x] 5.0 Remove the two skip-flag properties from `pom.xml`
  - [x] 5.1 Open `architecture-model-service/pom.xml` and locate the `<properties>` block
    - Find the lines pinning `<maven.test.skip>true</maven.test.skip>` and `<tests.skip>true</tests.skip>`
    - These are the two binary verification anchors from `spec.md` "Binary verification anchor" — both must come out
  - [x] 5.2 Remove `<maven.test.skip>true</maven.test.skip>` from the `<properties>` block
    - Delete the single line
    - Do NOT replace it with `<maven.test.skip>false</maven.test.skip>` — the property is removed entirely so Maven's default (false) applies
  - [x] 5.3 Remove `<tests.skip>true</tests.skip>` from the `<properties>` block
    - Delete the single line
    - Same rule: removed entirely, not flipped to `false`
  - [x] 5.4 Verify the orthogonal properties stay in place
    - `<swagger-parser.version>`, `<wsdl4j.version>`, and `<cxf.version>` MUST remain — they are orthogonal to the test-skip mechanism (per `spec.md` "Existing Code to Leverage")
    - The `maven-compiler-plugin` configuration block (including the `-Xmaxerrs` cap) MUST remain — the iterative compile loop in Group 4 is the answer to the cap, not a config bump
    - Re-read the file post-edit to confirm only the two skip-flag lines were removed
  - [x] 5.5 Confirm `mvn test-compile` is clean with NO `-D` flags
    - From `architecture-model-service/`, run `mvn test-compile` (no `-D` flags)
    - It MUST exit 0
    - This is the first of the two binary verification anchors from `spec.md` — without this, the spec is not done

**Acceptance Criteria:**
- `architecture-model-service/pom.xml` no longer contains `<maven.test.skip>true</maven.test.skip>` or `<tests.skip>true</tests.skip>`
- `<swagger-parser.version>`, `<wsdl4j.version>`, `<cxf.version>` and the `maven-compiler-plugin` config block are unchanged
- `cd architecture-model-service && mvn test-compile` exits 0 with NO `-D` flags — first binary verification anchor satisfied

---

### Group 6: Runtime sweep — run `mvn test` and record per-file runtime outcomes

#### Task Group 6: Capture the runtime pass/fail picture and apply the bounded `@Disabled` escape hatch only if necessary
**Dependencies:** Task Group 5
**Tests added:** 0

- [x] 6.0 Run the full AMS test suite with the flags off and record runtime outcomes
  - [x] 6.1 Run `mvn test` from `architecture-model-service/` with NO `-D` flags
    - This is now possible because the skip flags were removed in Group 5
    - Capture the full output to a working log so per-file outcomes can be extracted
    - Runtime failures do NOT block the spec per `spec.md` "Binary verification anchor" — they are recorded and triaged, not chased
  - [x] 6.2 Record runtime outcomes per file (both fixed and untouched) in `triage-decisions.md`
    - For each file row in the table (the seeded visible-18 + any newly-surfaced rows from Group 4):
      - If the file passed at runtime, tick the `runtime-passed` column
      - If the file failed at runtime, fill the `runtime-failed (follow-up note)` column with a brief description of the failure (e.g. "NullPointerException in setUp"; "AssertionFailedError on field X")
      - If the file was deleted in Groups 3 or 4, leave runtime columns blank (the file does not exist)
      - If the file was skipped at runtime for some reason (e.g. Spring context startup failure cascading), fill `not-run (rationale)` with the reason
    - Untouched files that fail at runtime (i.e. files NOT in the original broken-file working set but which now fail because the suite finally runs) get appended as new rows to the table, with `fix or delete = (untouched)` and the runtime outcome captured
    - This is the audit trail the reviewer will use to size the follow-up
  - [x] 6.3 Populate the "Runtime failures to address later" section
    - For every file with a `runtime-failed` entry, add a one-line summary to the "Runtime failures to address later" dedicated section
    - This section feeds the follow-up triage spec; it is not actioned within this commit
  - [x] 6.4 Apply the bounded `@Disabled` escape hatch only if runtime failures exceed ~20
    - Count the total runtime-failed entries from 6.2
    - If the count is ≤ ~20, do NOT add any `@Disabled` annotations — the failures stay as recorded follow-ups and the spec lands as-is
    - If the count is > ~20, the implementer may `@Disabled("follow-up #<ticket-or-note-ref>")` the worst offenders before landing the commit so day-to-day `mvn install` stays useful
    - Each `@Disabled` added under this escape hatch gets its own one-line entry under the dedicated "Runtime overflow disables" section in `triage-decisions.md`, with a follow-up ticket / raw-idea reference AND a stated deletion date
    - This is the ONLY permitted use of `@Disabled` in this spec — Groups 1-5 never apply it
  - [x] 6.5 Confirm the audit file is internally consistent
    - Every row in the main table has either a `fix` / `delete` / `(untouched)` decision recorded
    - Every fix has a runtime column filled (passed / failed / not-run with rationale)
    - Every delete has empty runtime columns and a covering-test path in rationale
    - The four dedicated sections accurately reflect what happened in Groups 3, 4, and 6
    - "Production bugs found, deferred to follow-up" is up-to-date with any bugs surfaced during fixes

**Acceptance Criteria:**
- `mvn test` ran from `architecture-model-service/` with NO `-D` flags
- Every fixed file has a runtime outcome (`runtime-passed` / `runtime-failed` / `not-run with rationale`) recorded in `triage-decisions.md`
- Untouched files that newly fail at runtime are appended as `(untouched)` rows with their runtime outcomes
- "Runtime failures to address later" section lists every runtime failure for follow-up triage
- The `@Disabled` escape hatch was applied only if the runtime failure count exceeded ~20, and each application is recorded under "Runtime overflow disables" with a ticket reference and deletion date
- No other use of `@Disabled` anywhere in the spec

---

### Group 7: Final verification — confirm both binary anchors and full audit coverage before the single commit

#### Task Group 7: End-to-end DoD walkthrough before the single commit
**Dependencies:** Task Groups 1-6
**Tests added:** 0

- [x] 7.0 Verify both binary verification anchors and the full audit trail before committing
  - [x] 7.1 Verify the first binary anchor — `mvn test-compile` with no `-D` flags
    - From `architecture-model-service/`, run `mvn test-compile` (no `-D` flags whatsoever)
    - Confirm exit code 0
    - This is the same check Group 5 did, repeated as the pre-commit gate
  - [x] 7.2 Verify the second binary anchor — `pom.xml` no longer contains the skip flags
    - `git grep "<maven.test.skip>true</maven.test.skip>" architecture-model-service/pom.xml` MUST return zero matches
    - `git grep "<tests.skip>true</tests.skip>" architecture-model-service/pom.xml` MUST return zero matches
    - Confirm `<swagger-parser.version>`, `<wsdl4j.version>`, `<cxf.version>`, and the `maven-compiler-plugin` block are still present (re-read the file to confirm)
  - [x] 7.3 Verify `mvn install` runs without `-D` flags
    - From `architecture-model-service/`, run `mvn install` (no `-D` flags)
    - The full test suite must execute by default — `mvn install` may exit non-zero if runtime failures exist (acceptable per spec — runtime failures don't block the spec; they are recorded follow-ups)
    - The verification is that `mvn install` ATTEMPTS the test phase by default, not that all tests pass
  - [x] 7.4 Verify `triage-decisions.md` accounts for every file in the original baseline plus anything newly surfaced
    - Every entry in `planning/test-compile-baseline.log`'s visible-18 has a row in `triage-decisions.md` with a non-`not-yet-triaged` decision
    - Every file surfaced during the iterative compile loop in Group 4 has a row appended
    - Every fix has a runtime column filled
    - Every delete has a covering-test path or equivalent rationale
    - The four dedicated sections are present and accurate
  - [x] 7.5 Sanity-check the commit scope before staging
    - The spec is explicit that this is ONE commit boundary covering: every per-file fix and delete across `architecture-model-service/src/test/java/`, the deletion of the two pre-existing `@Disabled` files, the `pom.xml` skip-flag removal, the new `triage-decisions.md` audit file, and any `@Disabled` escape-hatch tagging from Group 6
    - Confirm no files outside `architecture-model-service/src/test/java/**`, `architecture-model-service/pom.xml`, and the spec folder were edited (per spec "No production-code changes")
    - Confirm no Liquibase changesets were added
    - Confirm no production source code under `architecture-model-service/src/main/` was touched
    - Confirm `architecture-model-service/__pycache__/` was not touched (it's a separate unrelated cleanup per spec out-of-scope list)
  - [x] 7.6 Walk the spec's verification anchors and out-of-scope list one final time
    - Tick both binary verification anchors from `spec.md`
    - Confirm everything in the spec's "Out of Scope" list was honoured (no gateway / frontend test work; no `@JsonNaming` audit; no `jira-service/pom.xml` touched; no fixture changes; no production refactors; no new coverage; no CI yaml work; no `-Xmaxerrs` bump; no `__pycache__/` cleanup)
    - The commit is ready to land

**Acceptance Criteria:**
- `cd architecture-model-service && mvn test-compile` exits 0 with NO `-D` flags
- `architecture-model-service/pom.xml` no longer contains `<maven.test.skip>true</maven.test.skip>` or `<tests.skip>true</tests.skip>`, and the orthogonal properties / `maven-compiler-plugin` block are unchanged
- `mvn install` runs the full test suite by default (may exit non-zero if runtime failures exist; that's recorded, not blocking)
- `triage-decisions.md` accounts for every file in `planning/test-compile-baseline.log`'s visible-18 plus every file surfaced during Group 4, with runtime outcomes recorded for fixes
- No files outside the spec-permitted surface were edited (no production code, no Liquibase changesets, no fixtures, no other modules)
- Exactly one commit is created covering all of the above

---

## Execution Order

Recommended implementation sequence:

1. **Group 1** — Audit-file scaffolding. Stand up `triage-decisions.md` with the agreed schema and pre-populated visible-18 rows BEFORE any code changes, so every later decision lands in the audit trail at the moment it is made.
2. **Group 2** — Long-pole refactor of `ModelServiceSaveTest` + constants fix on `ModelServiceArchitectureScopedSaveTest`. These two files dominate the compile-error budget; resolving them first means the iterative re-compile loop in Group 4 sees a cleaner picture.
3. **Group 3** — First-pass triage of the 16 remaining visible-18 files (including the two pre-existing `@Disabled` deletes). Per-file decisions recorded in `triage-decisions.md` at the time of execution.
4. **Group 4** — Iterative re-compile loop. Surface and resolve any later-revealed broken files (the javac 100-error cap means more may appear). Repeat until `mvn test-compile` exits 0 with the flags still on.
5. **Group 5** — Flag removal from `pom.xml`. Only after the working set is clean — the spec is explicit that the `pom.xml` change MUST land atomically with the fixes, never as a partial commit.
6. **Group 6** — Runtime sweep with `mvn test` (no `-D` flags). Record per-file runtime outcomes; apply the bounded `@Disabled` escape hatch ONLY if runtime failures exceed ~20.
7. **Group 7** — Final verification. Both binary anchors verified, audit file complete, commit scope sanity-checked, then the single commit is created.

Groups 1-7 are strictly sequential — each depends on the preceding group's output. The single commit is created AFTER Group 7 passes.
