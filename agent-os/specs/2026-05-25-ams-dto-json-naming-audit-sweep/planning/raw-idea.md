# Raw Idea: AMS DTO `@JsonNaming` Audit Sweep

## Why this spec exists

The Architecture Model Service has a global Jackson configuration that translates Java camelCase field names to snake_case on the wire:

```yaml
# architecture-model-service/src/main/resources/application.yml:35
spring:
  jackson:
    property-naming-strategy: SNAKE_CASE
```

That global default is silently incorrect for any endpoint whose caller speaks camelCase JSON — which, in practice, is most of them. The frontend speaks camelCase. The gateway forwards camelCase verbatim. Discovery-service POSTs camelCase. The bug is silent: when Jackson can't map a camelCase JSON key against a snake_case-expecting field, it sets the field to null, and the controller throws something like `"sourceArchitectureId is required"` (or worse, accepts the partial payload and persists null where data was expected).

The current workaround is per-DTO: add `@JsonNaming(PropertyNamingStrategies.LowerCamelCaseStrategy.class)` to the offending DTO once a bug surfaces. **19 DTOs** in the codebase already carry that annotation. They were added one at a time as each bug was reported (the original surface was the Selective Copy preflight; subsequent surfaces were the captured-decisions data plane, the target-state architecture endpoints, and the Discovery candidate/mapping DTOs).

This is fragile. Every new DTO is a coin-flip: did the contributor remember the override? If yes, fine. If no, and the caller speaks camelCase, the next user demo finds the bug.

This spec closes the gap by **inverting the default** so the global config matches the actual wire convention used by every existing caller, and removes the per-DTO `@JsonNaming` overrides that are now redundant. The end state: AMS speaks camelCase everywhere by default; the per-DTO ritual disappears; future contributors cannot regress the behaviour by forgetting an annotation.

## What this spec is (and isn't)

**This spec is:**

- Flip `spring.jackson.property-naming-strategy` from `SNAKE_CASE` to `LOWER_CAMEL_CASE` in both `architecture-model-service/src/main/resources/application.yml` and `architecture-model-service/src/test/resources/application.yml`.
- Remove the 19 now-redundant `@JsonNaming(PropertyNamingStrategies.LowerCamelCaseStrategy.class)` annotations and their imports across `architecture-model-service/src/main/java/`.
- Replace any per-field `@JsonProperty("snake_case_name")` workarounds with plain camelCase fields where they were only present to override the global default. 5 files known so far.
- A pre-flight verification pass: confirm no consumer of an AMS endpoint actually depends on snake_case wire format. If any does, surface it as a follow-up (the spec does not silently break them).

**This spec is not:**

- A behavioural change to any AMS endpoint logic — only the wire-format naming changes. Field semantics, controller behaviour, persistence behaviour all stay the same.
- A rename of any Java field. Java fields are already camelCase; the only thing that changes is what Jackson does on serialize / deserialize.
- A change to entity-to-DTO mapping logic.
- A change to the persistence layer's column naming (Hibernate / Liquibase / Postgres columns stay snake_case; that's an orthogonal concern).
- A sweep of non-AMS DTOs (gateway TypeScript types, frontend types, discovery-service Python dataclasses) — those already speak camelCase and don't need touching.
- A new test pass. Existing tests already exercise the wire format; if any test asserts on snake_case keys directly it gets updated as part of this spec, but no new tests are written.
- The `@JsonNaming` annotation pattern itself — if shape-spec discovers any DTO that legitimately needs snake_case for a specific consumer that can't change, that DTO **keeps** its annotation. The pattern stays available; it just stops being the default.

## Decisions already made (don't re-litigate in shape-spec)

These were settled in the conversation that produced this raw idea:

1. **Direction: flip the default, don't sweep-annotate every DTO.** Annotating ~238 DTOs individually is mechanical busywork that leaves the same trap for the next contributor; flipping the default removes the trap.
2. **Pre-flight check is mandatory.** Before the flip, the spec must confirm no consumer relies on snake_case from AMS. If any do, they're documented and either updated atomically (preferred) or the spec stops and reshapes.
3. **The 19 existing `@JsonNaming` annotations get removed**, not left in place. Leaving redundant overrides obscures the real invariant ("everything is camelCase now"). The pattern is still available for future legitimate exceptions.
4. **Same for the 5 known `@JsonProperty("snake_case")` workarounds** — if they exist purely to defeat the global SNAKE_CASE setting, they get removed. If they encode a real wire-name that differs from the Java field name for a genuine reason, they stay.
5. **One commit boundary** covering both YAML changes + all 19 annotation removals + the 5 `@JsonProperty` cleanups + any test fixture updates.
6. **Existing tests are the regression net.** No new tests added. The AMS test-compile is now clean (per the test-infrastructure-cleanup spec just completed), so any wire-format-sensitive test that breaks under the flip will surface immediately.

## Specific requirements (rough — let shape-spec refine)

### Step 1: Pre-flight — verify no consumer depends on snake_case from AMS

For every AMS controller endpoint, identify the caller(s) and confirm they speak camelCase:

- **Gateway routes** (`gateway/src/routes/**`, `gateway/src/services/**`): proxy or transform AMS responses. The proxy layer is mostly verbatim pass-through, so if the frontend speaks camelCase end-to-end, the gateway also expects camelCase from AMS. Spot-check a handful of proxy routes (selective-copy, captured-decisions, target-state architecture list) and confirm they consume camelCase from AMS.
- **Discovery-service** (`discovery-service/**`): Python service that POSTs to AMS. Check the Python HTTP client(s) to see if request bodies are camelCase or snake_case.
- **Frontend** (`frontend/src/**`): never talks to AMS directly; always via the gateway. If gateway is camelCase end-to-end, frontend is fine.
- **Other AMS-internal callers** (e.g. AMS calling its own REST API in tests — unlikely but worth checking): same audit.

The pre-flight produces a one-page table in `planning/consumer-audit.md`:

```
| Caller | AMS endpoint(s) consumed | Wire format used | Notes |
| ------ | ------------------------ | ---------------- | ----- |
| gateway/src/routes/.../selective-copy.ts | POST /api/.../selective-copy/preflight | camelCase | matches frontend's wizard payload |
| discovery-service/src/.../ams_client.py | POST /api/.../discovery-runs/... | ??? | needs verification |
| ...    | ...                      | ...              | ...   |
```

If any caller is found to send / expect snake_case, the spec stops at this step and reshapes — flipping the default would break that caller silently. The fix could be (a) update the caller to camelCase first as part of this spec, or (b) carve out that specific DTO with an explicit `@JsonNaming(SnakeCaseStrategy.class)` annotation and proceed with the global flip.

My instinct (from the partial investigation that produced this raw-idea): **no consumer relies on snake_case**. The gateway is a near-verbatim camelCase proxy; discovery-service Python client uses camelCase by convention (Python dataclasses are converted explicitly); and the 19 existing `@JsonNaming` overrides were added precisely because every caller speaks camelCase and the global SNAKE_CASE default kept biting. But the verification step is mandatory because being wrong here means silent data corruption.

### Step 2: Flip the global default

Edit `architecture-model-service/src/main/resources/application.yml`:

```yaml
spring:
  jackson:
    property-naming-strategy: LOWER_CAMEL_CASE  # was SNAKE_CASE
```

And the matching line in `architecture-model-service/src/test/resources/application.yml`.

### Step 3: Remove the 19 redundant `@JsonNaming` annotations

Files known to carry the annotation (run `git grep "@JsonNaming" architecture-model-service/src/main/java/` to refresh — the count may have moved):

```
architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/targetstate/ApplyMappingMutationsRequest.java
architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/targetstate/ApplyMappingMutationsResponse.java
architecture-model-service/src/main/java/com/example/architecturemodel/controller/CapturedDecisionsApplyMappingMutationsController.java
architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/targetstate/TargetStateDecisionsSummaryDto.java
architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/targetstate/CapturedDecisionRefDto.java
architecture-model-service/src/main/java/com/example/architecturemodel/controller/ActiveTargetArchitectureController.java
architecture-model-service/src/main/java/com/example/architecturemodel/controller/TargetStateCapturedDecisionsController.java
architecture-model-service/src/main/java/com/example/architecturemodel/mapper/TargetStateCapturedDecisionMapper.java
architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/targetstate/TargetStateCapturedDecisionDto.java
architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/targetstate/CreateTargetStateCapturedDecisionRequest.java
architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/UpdateArchitectureElementMappingRequest.java
architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/SelectiveCopyPreflightRequest.java
architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/SelectiveCopyPreflightResponse.java
architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/SelectiveCopyCommitRequest.java
architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/SelectiveCopyCommitResponse.java
architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/CreateArchitectureElementMappingRequest.java
architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/ArchitectureElementMappingDto.java
architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/SuggestFromCurrentResponse.java
architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/SuggestFromCurrentRequest.java
```

For each:
- Remove the `@JsonNaming(PropertyNamingStrategies.LowerCamelCaseStrategy.class)` annotation.
- Remove the matching imports (`com.fasterxml.jackson.databind.PropertyNamingStrategies` and `com.fasterxml.jackson.databind.annotation.JsonNaming`) if no other annotation in the file uses them.
- Update the class-level Javadoc that explains why the annotation exists (multiple files have comments like "The `@JsonNaming(LowerCamelCaseStrategy.class)` annotation overrides the global …"). Replace with a one-liner explaining the new global default, OR delete the now-stale paragraph entirely.

### Step 4: Remove the 5 known `@JsonProperty("snake_case")` workarounds

Files known to use `@JsonProperty` in the DTO package (run `git grep "@JsonProperty" architecture-model-service/src/main/java/` to refresh):

```
architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/migration/MigrationDiscoveryContextDto.java
architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/migration/MigrationDiscoveryContextRequestDto.java
architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MigrationStorySpecGenerationDto.java
architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MigrationDeliveryHierarchyNodeDto.java
architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/migration/MigrationSpecContextDto.java
```

For each, inspect the actual `@JsonProperty` value:

- If the value is the **snake_case rendering of the camelCase field name** (e.g. `@JsonProperty("delivery_team_id")` on a `deliveryTeamId` field) — that's a defeat of the global, **remove the annotation**.
- If the value is a **genuinely different name** (e.g. `@JsonProperty("created-by-stage")` for a hyphenated wire convention, or `@JsonProperty("type")` for a Java reserved-word workaround) — **keep the annotation**, it's encoding a real wire-name difference.

### Step 5: Update test fixtures that assert on snake_case wire keys

The post-test-infrastructure-cleanup AMS test suite has 1911+ tests. Any test that builds a JSON request body or asserts on a response body must use camelCase keys after this change. Likely culprits:

- Controller integration tests that use `mockMvc.perform(post(...).content("{\"snake_case_key\": ...}"))` — update to camelCase.
- Tests that use `jsonPath("$.snake_case_key")` for response assertions — update to camelCase.

Implementer runs `mvn test` after the YAML flip and uses the failure list as the working set. Updates are mechanical text replacements. If any test surfaces a *behavioural* regression (not just a key-name mismatch), that's recorded as a follow-up (same rule as the test-infrastructure-cleanup spec — record, don't fix mid-spec).

### Step 6: Verify

- `cd architecture-model-service && mvn test-compile` exits 0 (no `-D` flags, per the previous spec).
- `cd architecture-model-service && mvn test` runs the full suite. Runtime failures attributable to the wire-format flip are fixed in-spec. Runtime failures unrelated to wire format (i.e. failures that already existed per the test-infrastructure-cleanup spec's "Runtime failures to address later" list) are noted and left alone.
- `git grep "@JsonNaming" architecture-model-service/src/main/java/` returns zero matches (or only the matches surfaced as legitimate exceptions in shape-spec).
- `git grep "property-naming-strategy: SNAKE_CASE" architecture-model-service/` returns zero matches in either `application.yml`.
- A smoke test against a running AMS + gateway + frontend stack confirms the Selective Copy preflight, captured-decisions data plane, and at least one read endpoint still work end-to-end. (The bug surfaces on the wire; a smoke test is cheap insurance.)

## Out of Scope

- Any change to AMS endpoint behaviour, controller logic, persistence, or schema.
- The Hibernate / Liquibase / Postgres column naming (stays snake_case at the DB layer; this is purely a Jackson-wire concern).
- Gateway TypeScript types, frontend TypeScript types, discovery-service Python dataclasses — all already camelCase, no touching needed.
- Any `@JsonProperty` annotation that encodes a *genuinely* different wire-name (Java reserved words, hyphenated conventions, etc) — those stay.
- Adding new test coverage.
- A sweep of non-DTO classes (entities, services) — irrelevant; the global config only matters at the HTTP boundary.
- The `jira-service` module (has its own `pom.xml`, separate concern).
- The runtime test failures already documented in the test-infrastructure-cleanup spec's "Runtime failures to address later" list. Those stay deferred to their own follow-up.

## Dependencies

- `2026-05-25-ams-test-infrastructure-cleanup` shipped + committed. The AMS test suite must compile cleanly with the skip flags off before this spec runs — otherwise any test failures caused by the wire-format flip can't be distinguished from pre-existing compile errors.
- `2026-05-25-four-spec-hardening-pass` shipped (the existing `@JsonNaming` pattern is referenced from one of its DTOs).
- All Specs 1-5 of the migration-workflow rework shipped (those introduced ~half the existing `@JsonNaming` annotations).
- No new functional dependencies. This is purely a configuration + annotation-removal pass.

## Open questions for shape-spec to clarify

1. **Direction confirmation.** The raw-idea recommends flipping the global default (Option D). The alternative is a per-DTO sweep (Option C) that annotates every Request + Response + Dto explicitly. The per-DTO sweep is safer (no behaviour change for any caller; just adds redundancy) but doesn't fix the trap. My instinct: **Option D**, gated on the Step 1 consumer audit returning clean. If the audit surfaces a snake_case-dependent consumer, retreat to Option C for that DTO only.

2. **Pre-flight scope.** The consumer audit covers gateway + discovery-service + frontend. Are there other consumers of AMS I should check? My instinct: **those three, plus any AMS-internal HTTP client tests**. The api-migration-validation-service and other recently-added services are also worth a grep. Confirm — or list any additional consumers.

3. **`@JsonProperty` cleanup heuristic.** For each of the 5 known `@JsonProperty` annotations, the rule is "remove if it's the snake_case rendering of the camelCase field name; keep if it encodes a genuinely different wire name". Should the implementer record each decision in a small audit file (like the test-infrastructure-cleanup spec did), or just do it inline? My instinct: **inline with a one-line commit-message note per file**. The 5-file surface is small enough that a separate audit file is overkill.

4. **Test fixture updates: scope.** If the wire-format flip surfaces N test failures, all attributable to snake_case-in-JSON-body or snake_case-in-jsonPath assertions, are those all fixed in this spec or could the count balloon enough to warrant a separate follow-up? My instinct: **fix all in this spec — they're mechanical text replacements; if the count is somehow huge (50+) we revisit, but I expect single digits because most AMS tests use POJO request bodies rather than raw JSON strings**.

5. **Behaviour during the flip — staging concern.** Is there any risk that a running AMS instance picks up the new config and starts speaking camelCase while a still-old gateway is hitting it expecting snake_case? My instinct: **no, because we deploy in this codebase the entire stack together (no rolling-upgrade story for these three services in dev)**. But worth noting so shape-spec doesn't accidentally introduce a feature-flag.

6. **Pre-existing test failures.** The test-infrastructure-cleanup spec's "Runtime failures to address later" list has ~225 failing tests, of which some may be wire-format-sensitive. Should the implementer go through that list and pick out the wire-format ones to fix as part of this spec? My instinct: **no — the list is a separate follow-up; if a runtime failure happens to be wire-format-sensitive and gets fixed as a side-effect, great, but we don't actively chase them; the spec scope is "flip the default + remove now-redundant overrides", not "fix every pre-existing test failure"**.

7. **Documentation / READMEs.** Several Javadoc blocks across the 19 annotated files explain *why* the override exists, referencing the global SNAKE_CASE setting. After the flip, those paragraphs are wrong. Are they updated to explain the new default, or deleted entirely? My instinct: **delete entirely — once the default matches the wire format, there's no need to explain the override that no longer exists**. A single sentence in the CLAUDE.md or AMS top-level README confirming "AMS speaks camelCase end-to-end" is enough for future contributors.

8. **Smoke-test scope.** The verification step asks for a manual end-to-end smoke test. Which surfaces are critical? My instinct: **(a) Selective Copy preflight (was the original bug surface); (b) captured-decisions create + apply-mappings (newly camelCase'd in Spec 2); (c) target-architecture list + draft load (Spec 1's surface); (d) one Discovery-service POST endpoint to confirm the Python client still works**. If shape-spec decides smoke-test is too heavy for a config change, **drop it and rely on the test suite**.

## Verification

After this spec:

- `git grep "property-naming-strategy: SNAKE_CASE" architecture-model-service/` returns zero matches.
- `git grep "@JsonNaming(PropertyNamingStrategies.LowerCamelCaseStrategy.class)" architecture-model-service/src/main/java/` returns zero matches (or only matches that shape-spec explicitly recorded as legitimate exceptions).
- The 5 `@JsonProperty("snake_case")` workarounds are either removed (if redundant) or kept with a short comment explaining the genuine wire-name reason.
- `cd architecture-model-service && mvn test-compile` exits 0 with no `-D` flags.
- `cd architecture-model-service && mvn test` exits 0 for every test that was passing pre-spec — i.e. no regressions attributable to the wire-format flip. Pre-existing runtime failures (from the test-infrastructure-cleanup spec's deferred list) may still be present; that's acceptable.
- Manual smoke test against the running stack confirms Selective Copy + captured-decisions + target-architecture flows still work.

## Commit boundary

One commit covering: both YAML flips, all 19 `@JsonNaming` removals + import cleanups + Javadoc edits, the 5 `@JsonProperty` cleanups (or genuine-exception decisions), and any test fixture updates required to keep `mvn test` clean for previously-passing tests.
