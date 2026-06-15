# Raw Idea: AMS Test Infrastructure Cleanup

## Why this spec exists

Every implementer delegation over the last five specs has had to work around the same problem: the Architecture Model Service test suite no longer compiles cleanly. To make `mvn` even start a build, two flags are pinned in `pom.xml`:

```xml
<maven.test.skip>true</maven.test.skip>
<tests.skip>true</tests.skip>
```

With those flags on, `mvn install` skips compilation and execution of `src/test/java/**` entirely. To actually compile tests, every subagent has needed `-Dmaven.test.skip=false -Dtests.skip=false -Dmaven.compiler.failOnError=false`, often combined with `-Dtest=...` filters to isolate the new tests for the spec being implemented. That ritual has become routine and silently expensive — it suppresses real compile errors, hides cascading record-constructor drift, and leaves new contributors confused about what "passing" actually means.

The reason the flags are there is real: roughly thirty AMS test files no longer compile against current production code. Record constructors have gained or lost components, builder methods have been renamed (`logicalEntityId` removed, etc), entity ids drifted between `String` and `UUID`, DTO shapes changed. Each individual drift was understandable at the time the production code shifted; nobody updated the stale tests because the flags meant nothing was breaking.

This spec closes that gap: triage every broken test file, fix the ones still worth keeping, delete the ones overtaken by newer coverage, then **remove the two skip flags from `pom.xml`** so that `mvn install` once again compiles and executes the full test suite by default. After this spec, no implementer delegation should ever need `-Dmaven.compiler.failOnError=false` again.

## What this spec is (and isn't)

**This spec is:**

- A triage-and-repair pass over every AMS test file that currently fails `mvn test-compile`.
- For each broken file: decide **fix** (update record constructor args, builder calls, DTO shapes to match current production) or **delete** (file's behaviour is covered by newer tests, or the production feature it covered is gone).
- Removing `<maven.test.skip>true</maven.test.skip>` and `<tests.skip>true</tests.skip>` from `architecture-model-service/pom.xml` once the compile is clean.
- Making `mvn install` from a clean checkout green by default — no extra `-D` flags.

**This spec is not:**

- A pass over **runtime** test failures (the ones in CLAUDE.md's "Pre-existing Test Failures" list — `bootstrap-summary-fetching.test.ts`, `dashboardSummary*.test.ts`, etc are gateway/frontend, not AMS, and stay out of scope; if AMS has its own runtime failures after this spec, those are a separate cleanup).
- A green-light to refactor production code so a test passes — when production behaviour has legitimately changed and the test is wrong, the test changes, not the code.
- An opportunity to expand AMS coverage with new tests beyond what already exists.
- A `@JsonNaming` audit sweep across remaining AMS DTOs (already explicitly deferred from the hardening pass).
- A change to the Spring profile setup, the H2 schema, the Liquibase wiring, or any of the test fixtures unless a specific broken file requires it.

## Decisions already made (don't re-litigate in shape-spec)

These were settled in the conversation that produced this raw idea:

1. **Two outcomes per broken file, no third option.** Either fix it to compile + pass against current production, or delete it. No "leave broken with `@Disabled`" half-measures — that just re-creates the original problem in a different shape.
2. **The `pom.xml` flag removal is mandatory and is the verification anchor.** If the flags can't come out at the end of the spec, the spec is not done.
3. **No production-code changes** unless a test exposes a genuine bug (in which case the bug fix belongs in a separate commit/PR and this spec calls it out for follow-up rather than absorbing it).
4. **One commit boundary for the whole pass.** It's large in file count but trivially-reviewable per-file, and the `pom.xml` change has to land atomically with the fixes.
5. **Triage criterion for delete:** if the file's named scenarios are already covered by another currently-passing AMS test, or if the production feature the file tested has been removed or replaced, the file is deleted. Otherwise it gets fixed.
6. **Runtime failures are out of scope.** This is a compile-clean + flag-removal spec, not a make-every-AMS-test-pass spec. If a fixed file compiles but fails at runtime, the spec records the failure in a follow-up list and moves on.

## Specific requirements (rough — let shape-spec refine)

### Step 1: Establish the current broken-file inventory

Run `mvn test-compile -Dmaven.test.skip=false -Dtests.skip=false -Dmaven.compiler.failOnError=true` against `architecture-model-service/` and capture the full list of files with compile errors. This is the working set for the spec. Known offenders (from prior spec verifier reports):

- `service/ContextBundleExpansionServiceDiagramTest.java` — cannot find symbol
- `service/TypedContentCreateSaveFlowTest.java` — annotation interface not applicable + cannot find symbol (9+ errors)
- `service/ModelServiceUserJourneyGapTest.java` — cannot find symbol
- `service/UserJourneyLinkGapFillTest.java` — 2 errors
- `service/ModelServiceArchitectureScopedSaveTest.java` — 30+ cannot find symbol errors (most broken file)
- `service/UserJourneySyncServiceTest.java` — signature drift in `UserJourneySyncService.checkSyncStatus`
- `integration/BusinessLogicIntegrationTest.java` — incompatible types `BusinessLogicDto` vs `UIActionDto`
- `integration/InterfaceDiscoveryIntegrationTest.java` — builder method `logicalEntityId` removed
- `migration/DataEntityPointFkColumnsMigrationTest.java` — 3 errors
- `migration/WorkItemExternalUrlMigrationTest.java` — String/UUID drift
- `controller/SequenceDiagramControllerTest.java` — `SequenceMessageDto` record constructor mismatch
- `controller/ProductSummaryControllerTest.java` — UUID/String type mismatch
- `controller/ModelControllerTest.java` — constructor arity drift
- `service/MetaModelDtoExtensionTest.java` — record constructor drift for `EnvironmentDto`, `DeploymentUnitComputeResourceDto`, `LoadBalancerResourceRouteDto`, `ResourceSubnetHostingDto`
- `service/ExpandResolveDtoTest.java` — record constructor drift (`EntityBundleSelection`, `ExpandResolveResponseDto`)
- `service/DiscoveryRunServiceScopedConfigOptionalTest.java` — String/UUID drift

The shape-spec phase should regenerate this list against the current main HEAD; the list above is from accumulated verifier reports and may be slightly stale.

### Step 2: Per-file triage (fix vs delete)

For each broken file, the implementer decides fix-or-delete using these heuristics:

- **Delete if:** another currently-passing test (in AMS, gateway, or frontend) covers the same scenarios; OR the production feature/DTO under test was removed; OR the file is a one-off migration test for a Liquibase changeset that has already shipped and been verified in production.
- **Fix if:** the file covers a behaviour that isn't otherwise tested AND the broken signatures are mechanical drift (record constructor changed, builder method renamed, field added/removed). Fix the call sites to match current production code.

The triage decision should be recorded in the commit message or a small markdown audit file inside the spec folder (`triage-decisions.md`) so reviewers can sanity-check the delete calls without re-deriving them.

### Step 3: Fix or delete

- **Fix files:** update record constructor invocations, builder calls, DTO field references, and id type usages (`UUID` ↔ `String`) so the file compiles. Run the file in isolation (`-Dtest=SomeTest`) and verify it passes at runtime if reasonably possible; if it compiles but fails at runtime, record the failure in `triage-decisions.md` under "Compiles but fails at runtime" rather than letting it block the spec.
- **Delete files:** `git rm` the file. Verify no other test file references it (e.g. via inheritance or `@Import`).

### Step 4: Remove the skip flags

Once `mvn test-compile` is clean across the whole module, edit `architecture-model-service/pom.xml`:

- Remove the `<maven.test.skip>true</maven.test.skip>` property.
- Remove the `<tests.skip>true</tests.skip>` property.
- Leave the `swagger-parser.version`, `wsdl4j.version`, and `cxf.version` properties in place — they're orthogonal.

### Step 5: Verify clean build

From a clean checkout, `cd architecture-model-service && mvn install` should:

- Compile production code (already does today).
- Compile every test file (new — this is what this spec delivers).
- Execute every test file (new — this is what this spec delivers, even if some individual tests fail at runtime).
- Exit non-zero if any compile error OR any test runtime failure occurs.

Per the "decisions already made", runtime failures discovered after the flags are removed do NOT block the spec — they get recorded in `triage-decisions.md` under "Runtime failures to address later" and are handed off to a follow-up.

If the number of runtime failures is large enough that running `mvn install` is no longer useful for day-to-day development, the spec needs to think harder about that case in the shape-spec — possibly tagging the worst offenders with `@Disabled("explicit issue tracker ref")` as a temporary measure with a deletion date. That decision is deferred to shape-spec; the raw-idea position is "remove the flags and live with runtime failures unless that number is huge."

## Out of Scope

- The gateway and frontend pre-existing test failures listed in CLAUDE.md (`bootstrap-summary-fetching.test.ts`, `conversation-memory-edge-cases.test.ts`, `dashboardSummary*.test.ts`, `hub-bootstrap-4-task-definition.test.ts`, `chatV2-panel-*.test.ts`).
- The `@JsonNaming` audit sweep on remaining AMS DTOs (deferred from the hardening pass).
- Any production-code refactor (unless a test discloses a real bug, in which case it's called out as a follow-up).
- Adding new test coverage beyond what already exists.
- CI pipeline configuration changes — this spec only changes `pom.xml` flags; if there's a CI yaml that also passes `-Dmaven.test.skip=true` it'll need a separate touch, but that's a follow-up if it exists.
- The pre-existing `architecture-model-service/__pycache__/` artefact in `git status` — unrelated, stays a separate cleanup.

## Dependencies

- All five migration-workflow specs (Specs 1–5) committed.
- The four-spec hardening pass committed.
- The tech-stack-prefill spec committed.
- No new functional dependencies — this is a pure cleanup that only touches files already on disk.

## Open questions for shape-spec to clarify

1. **Triage authority.** Should the implementer subagent be allowed to delete a test file unilaterally during this spec, or does each delete need to be flagged in `triage-decisions.md` for human review first, then a second pass actually deletes? My instinct: **let the implementer delete inline, with the decision recorded in `triage-decisions.md`** — the reviewer can audit the deletes in the same PR. Confirm?

2. **Runtime failures budget.** If removing the flags reveals (say) 50+ runtime test failures, is that acceptable for this spec, or should the spec also include a triage pass on runtime failures? My instinct: **acceptable up to ~20 runtime failures recorded as follow-ups; beyond that, the spec adds a single `@Disabled` pass with explicit follow-up tickets per failure.** Confirm — or pick a different threshold.

3. **`triage-decisions.md` lifetime.** Does this file stay in the spec folder forever as a record, or get deleted once the follow-up runtime-failure spec lands? My instinct: **stays in the spec folder forever** — it's the audit trail for the deletes.

4. **Test execution speed.** Some AMS tests are slow (Spring context boots, H2 schema reloads). Once the flags come off, `mvn install` could become noticeably slower for local dev. Is that acceptable? My instinct: **yes, accepted as the cost of having running tests** — if individual tests are pathologically slow that's a separate optimisation pass. Confirm.

5. **CI integration.** If there's a CI pipeline that also pins `-Dmaven.test.skip=true`, should this spec hunt it down and remove it too? My instinct: **yes, it's part of "make `mvn install` green by default"** — but only if it exists in this repo. External CI configs in other repos are out of scope.

6. **Should fixed tests also be run for runtime green-ness as part of the spec?** I.e. for each fix, do we just confirm it compiles, or do we also confirm it passes? My instinct: **confirm runtime green per fixed file when feasible, but don't let runtime failures in fixed files block the spec** — record them as follow-ups in `triage-decisions.md`. (Effectively the same rule as for tests we didn't touch.)

7. **Production bug discovery.** If fixing a test reveals a real production bug (e.g. a record constructor change that silently dropped a field), does this spec fix the bug too, or just record it? My instinct: **record it; bug fixes belong in their own PR with their own description** — but the implementer can write a follow-up `raw-idea.md` for the discovered bug while context is fresh.

8. **Triage criterion edge case — Liquibase migration tests.** Migration tests are often one-shot — they verify a specific data shape after a specific changeset runs. Once the changeset is in production, the test has little ongoing value. Should those default to **delete**? My instinct: **yes, default to delete for migration-tests-of-shipped-changesets unless the file documents an ongoing invariant** (i.e. the test would catch a regression on future changesets touching the same tables).

## Verification

After this spec:

- `architecture-model-service/pom.xml` no longer contains `<maven.test.skip>` or `<tests.skip>` properties.
- `cd architecture-model-service && mvn test-compile` exits 0 with no `-D` flags.
- `cd architecture-model-service && mvn install` runs the full test suite by default (it may or may not exit 0 depending on runtime failures; the spec records those rather than masking them).
- The `triage-decisions.md` audit file lists every broken file from the original inventory with a fix-or-delete decision and (for fixed files) a runtime-pass-or-record-as-followup outcome.
- No subsequent implementer delegation needs `-Dmaven.compiler.failOnError=false` for unrelated reasons.

## Commit boundary

One commit covering: per-file fixes and deletes across `architecture-model-service/src/test/java/`, the `pom.xml` flag removal, and the new `triage-decisions.md` audit file in the spec folder.
