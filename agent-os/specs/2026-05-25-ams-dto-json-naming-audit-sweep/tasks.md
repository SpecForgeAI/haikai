# Task Breakdown: AMS DTO `@JsonNaming` Audit Sweep

## Overview
Total Tasks: 4 task groups. One commit boundary. **No new test coverage** — existing AMS tests are the regression net per `spec.md`. **No production behaviour change** — the new `@CamelCaseWire` meta-annotation is runtime-identical to the raw `@JsonNaming(LowerCamelCaseStrategy.class)` it replaces. Scope is closed by four verification anchors enumerated in `spec.md`: two git greps, one `mvn test-compile`, one representative `mvn test`.

The 19 application sites are an enumerated list (see `planning/requirements.md` "Authoritative Counts and File Lists"). There is no triage in this spec — every one of those 19 files gets the same mechanical edit. No `triage-decisions.md` artefact is produced.

## Task List

---

### Group 1: Create the `@CamelCaseWire` meta-annotation

#### Task Group 1: Stand up the new annotation with full Javadoc before any application sites are touched
**Dependencies:** None
**Tests added:** 0 (per spec — no new coverage; existing tests are the regression net)

- [x] 1.0 Create `CamelCaseWire.java` with the agreed meta-annotation declaration and central Javadoc
  - [x] 1.1 Choose the package and create the file
    - Default path: `architecture-model-service/src/main/java/com/example/architecturemodel/jackson/CamelCaseWire.java`
    - Alternative acceptable path: `architecture-model-service/src/main/java/com/example/architecturemodel/model/annotation/CamelCaseWire.java`
    - Implementer picks whichever sits better alongside existing AMS-infrastructure conventions; document the choice in the commit message per `spec.md` "Create the `@CamelCaseWire` meta-annotation"
    - Confirm the parent directory exists before writing the file
  - [x] 1.2 Declare the annotation with the required JSR-175 metadata
    - `@Retention(RetentionPolicy.RUNTIME)`
    - `@Target(ElementType.TYPE)`
    - Meta-annotated with `@JsonNaming(PropertyNamingStrategies.LowerCamelCaseStrategy.class)` — this is what makes `@CamelCaseWire` runtime-identical to the raw Jackson annotation
    - Imports: `com.fasterxml.jackson.databind.PropertyNamingStrategies`, `com.fasterxml.jackson.databind.annotation.JsonNaming`, `java.lang.annotation.ElementType`, `java.lang.annotation.Retention`, `java.lang.annotation.RetentionPolicy`, `java.lang.annotation.Target`
    - No other Jackson behaviour change (no global config touched, no extra strategies introduced) — confirm the body is purely the meta-annotation chain
  - [x] 1.3 Write the central Javadoc covering all the knowledge that used to be scattered across 19 per-class blocks
    - State that the AMS global default is `SNAKE_CASE` (configured via `spring.jackson.property-naming-strategy` in `architecture-model-service/src/main/resources/application.yml`)
    - State that this marker identifies DTOs whose consumers speak camelCase
    - State that the annotation is runtime-identical to `@JsonNaming(PropertyNamingStrategies.LowerCamelCaseStrategy.class)`
    - State the current application surface: Selective Copy, target-state architecture, captured-decisions data plane (per the 19-file enumeration in `planning/requirements.md`)
    - Reference `frontend/src/api/epicCapturedDecisionsApi.ts` as the dual-tolerance pattern that any future hardening pass would use — this is the named pointer per Q8 of `planning/requirements.md`; do not implement that pattern here
    - The Javadoc is the only place the SNAKE_CASE-default explanation lives after this spec — per-class Javadoc on the 19 application sites is collapsed in Group 2
  - [x] 1.4 Verify the new file compiles in isolation before touching any application sites
    - From `architecture-model-service/`, run `mvn test-compile` — exit 0 required
    - Confirm the file is discoverable from one of the 19 application sites' packages by spot-checking the import path

**Acceptance Criteria:**
- `CamelCaseWire.java` exists at the chosen package path with `@Retention(RUNTIME)`, `@Target(TYPE)`, and the meta-annotation `@JsonNaming(PropertyNamingStrategies.LowerCamelCaseStrategy.class)`
- The central Javadoc carries every knowledge fragment that used to be repeated across the 19 application sites — global SNAKE_CASE default, camelCase-exception purpose, runtime-identical guarantee, current application surface, and the `epicCapturedDecisionsApi.ts` dual-tolerance pointer
- `mvn test-compile` exits 0 with the new file in place
- The chosen package is documented in the eventual commit message

---

### Group 2: Apply `@CamelCaseWire` to the 19 enumerated application sites

#### Task Group 2: Mechanical swap of `@JsonNaming(...)` for `@CamelCaseWire` across the camelCase exception island
**Dependencies:** Task Group 1
**Tests added:** 0

- [x] 2.0 Replace the raw `@JsonNaming` annotation with `@CamelCaseWire` on each of the 19 files, with import cleanup and Javadoc collapse

  For each file in the sub-tasks below, the exact mechanical edit is:
  - Replace `@JsonNaming(PropertyNamingStrategies.LowerCamelCaseStrategy.class)` with `@CamelCaseWire`
  - Remove the imports `com.fasterxml.jackson.databind.PropertyNamingStrategies` and `com.fasterxml.jackson.databind.annotation.JsonNaming` — ONLY if no other code in the file still uses them
  - Add the import for the new `CamelCaseWire` annotation (using whichever package was chosen in Group 1)
  - Collapse the existing multi-paragraph per-class Javadoc explaining the global SNAKE_CASE default and the override rationale into the one-sentence template from Q5 of `planning/requirements.md`: "Marked `@CamelCaseWire` because `<consumer name / surface>` speaks camelCase."
  - No other edits — field shape, ordering, business logic, mapper logic all stay untouched per `spec.md`

  **Controllers (3 files):**
  - [x] 2.1 `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ActiveTargetArchitectureController.java`
    - Consumer surface for the Javadoc one-liner: target-state architecture (frontend speaks camelCase)
  - [x] 2.2 `architecture-model-service/src/main/java/com/example/architecturemodel/controller/CapturedDecisionsApplyMappingMutationsController.java`
    - Consumer surface: captured-decisions apply-mapping-mutations data plane (frontend speaks camelCase)
  - [x] 2.3 `architecture-model-service/src/main/java/com/example/architecturemodel/controller/TargetStateCapturedDecisionsController.java`
    - Consumer surface: target-state captured decisions (frontend speaks camelCase)

  **Mapper (1 file):**
  - [x] 2.4 `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/TargetStateCapturedDecisionMapper.java`
    - Consumer surface: target-state captured-decisions mapper (paired with the controller in 2.3)

  **DTOs in `model/dto/` (8 files):**
  - [x] 2.5 `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/ArchitectureElementMappingDto.java`
    - Consumer surface: Selective Copy (frontend speaks camelCase)
  - [x] 2.6 `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/CreateArchitectureElementMappingRequest.java`
    - Consumer surface: Selective Copy
  - [x] 2.7 `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/SelectiveCopyCommitRequest.java`
    - Consumer surface: Selective Copy commit
  - [x] 2.8 `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/SelectiveCopyCommitResponse.java`
    - Consumer surface: Selective Copy commit
  - [x] 2.9 `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/SelectiveCopyPreflightRequest.java`
    - Consumer surface: Selective Copy preflight (original bug-surface that spawned the exception-island pattern)
  - [x] 2.10 `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/SelectiveCopyPreflightResponse.java`
    - Consumer surface: Selective Copy preflight
  - [x] 2.11 `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/SuggestFromCurrentRequest.java`
    - Consumer surface: Selective Copy suggest-from-current
  - [x] 2.12 `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/SuggestFromCurrentResponse.java`
    - Consumer surface: Selective Copy suggest-from-current
  - [x] 2.13 `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/UpdateArchitectureElementMappingRequest.java`
    - Consumer surface: Selective Copy

  **DTOs in `model/dto/targetstate/` (6 files):**
  - [x] 2.14 `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/targetstate/ApplyMappingMutationsRequest.java`
    - Consumer surface: target-state apply-mapping-mutations
  - [x] 2.15 `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/targetstate/ApplyMappingMutationsResponse.java`
    - Consumer surface: target-state apply-mapping-mutations
  - [x] 2.16 `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/targetstate/CapturedDecisionRefDto.java`
    - Consumer surface: target-state captured decisions
  - [x] 2.17 `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/targetstate/CreateTargetStateCapturedDecisionRequest.java`
    - Consumer surface: target-state captured decisions
  - [x] 2.18 `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/targetstate/TargetStateCapturedDecisionDto.java`
    - Consumer surface: target-state captured decisions
  - [x] 2.19 `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/targetstate/TargetStateDecisionsSummaryDto.java`
    - Consumer surface: target-state decisions summary

  - [x] 2.20 Confirm the full module still compiles after all 19 swaps
    - From `architecture-model-service/`, run `mvn test-compile` — exit 0 required
    - This catches missed import cleanups (e.g. a `@JsonNaming` import left dangling on a file with no other Jackson-annotation use) or accidental field-shape regressions

**Acceptance Criteria:**
- Each of the 19 files listed in `planning/requirements.md` "Authoritative Counts and File Lists" has had `@JsonNaming(PropertyNamingStrategies.LowerCamelCaseStrategy.class)` replaced with `@CamelCaseWire`
- The two raw Jackson imports (`PropertyNamingStrategies`, `JsonNaming`) are removed from any file that no longer uses them, and the new `CamelCaseWire` import is added in their place
- Each file's previously multi-paragraph Javadoc describing the global SNAKE_CASE default is collapsed to the one-sentence "Marked `@CamelCaseWire` because `<consumer surface>` speaks camelCase" form
- No other edits to any of the 19 files (no field shape changes, no ordering changes, no business-logic edits, no mapper-logic edits)
- `mvn test-compile` exits 0 after all 19 files are edited

---

### Group 3: Document the pattern in repo-root `CLAUDE.md`

#### Task Group 3: Add the central "AMS wire format" reference paragraph
**Dependencies:** Task Groups 1, 2 (the annotation must exist and have been applied before the doc paragraph claims "19 files")
**Tests added:** 0

- [x] 3.0 Append the "AMS wire format" section to repo-root `CLAUDE.md`
  - [x] 3.1 Open `CLAUDE.md` at the repo root and find a sensible insertion point
    - Add a new heading near other AMS-relevant sections (do not append at the very end if better contextual placement is available)
    - Heading text: `AMS wire format`
  - [x] 3.2 Write the paragraph text per `spec.md`
    - Required content: "AMS speaks snake_case at the wire by default. DTOs whose consumers expect camelCase are marked `@CamelCaseWire` -- currently 19 files covering Selective Copy, target-state architecture, and the captured-decisions data plane. New camelCase consumers use `@CamelCaseWire`; new snake_case consumers need no annotation."
    - Optionally include a one-line forward pointer to `frontend/src/api/epicCapturedDecisionsApi.ts` as the dual-tolerance reference for any future hardening pass (per Q8 of `planning/requirements.md`)
  - [x] 3.3 Confirm no AMS-level README is being created
    - Per Q4 of `planning/requirements.md`, the central documentation lives in two places only: the `CamelCaseWire.java` Javadoc (Group 1) and this `CLAUDE.md` paragraph (Group 3)
    - Do NOT create `architecture-model-service/README.md` or any equivalent module-level doc — that would create a drift risk

**Acceptance Criteria:**
- Repo-root `CLAUDE.md` contains a new heading `AMS wire format`
- The paragraph under that heading matches the required text from `spec.md`, including the "19 files" count and the named application surfaces (Selective Copy, target-state architecture, captured-decisions data plane)
- No second doc location (e.g. an AMS-level README) was created

---

### Group 4: Verification — confirm all four anchors from `spec.md`

#### Task Group 4: End-to-end DoD walkthrough before the single commit
**Dependencies:** Task Groups 1, 2, 3
**Tests added:** 0

- [x] 4.0 Run all four verification anchors enumerated in `spec.md` and confirm each passes
  - [x] 4.1 Anchor 1 — confirm zero raw `@JsonNaming(...)` left behind
    - Run: `git grep "@JsonNaming(PropertyNamingStrategies.LowerCamelCaseStrategy.class)" architecture-model-service/src/main/java/`
    - Expected: zero matches
    - If any matches remain, return to Group 2 and fix the missed files before continuing
  - [x] 4.2 Anchor 2 — confirm exactly 20 `@CamelCaseWire` references
    - Run: `git grep "@CamelCaseWire" architecture-model-service/src/main/java/`
    - Expected: exactly 20 matches (19 application sites + 1 declaration in `CamelCaseWire.java`)
    - A count below 20 means a file was missed in Group 2; a count above 20 means an accidental extra application
  - [x] 4.3 Anchor 3 — confirm `mvn test-compile` exits 0 with no `-D` flags
    - From `architecture-model-service/`, run `mvn test-compile` (NO `-D` flags whatsoever)
    - Expected: exit code 0
    - Catches any import cleanup miss or stale reference
  - [x] 4.4 Anchor 4 — confirm runtime-identical behaviour via a representative camelCase-island test
    - From `architecture-model-service/`, run `mvn test` against one or two representative tests from the camelCase island
    - Suggested choices: a Selective Copy controller test (covers DTOs 2.5-2.13) plus a target-state captured-decisions test (covers DTOs 2.14-2.19)
    - Expected: exit code 0
    - Proves the meta-annotation is runtime-identical to the raw `@JsonNaming(LowerCamelCaseStrategy.class)` it replaced
  - [x] 4.5 Sanity-check the commit scope before staging
    - Confirm the changeset covers exactly: the new `CamelCaseWire.java`, the 19 annotation swaps with import cleanup and Javadoc trim, and the `CLAUDE.md` edit
    - Confirm `application.yml` (both `src/main/resources/application.yml` and `src/test/resources/application.yml`) is untouched — the global default stays SNAKE_CASE
    - Confirm no test fixture changes (no `.content("{...}")` edits, no `jsonPath(...)` edits)
    - Confirm no consumer-side files in `gateway/`, `discovery-service/`, `api-migration-validation-service/`, or `frontend/` were touched
    - Confirm `architecture-read-service` was not touched (deferred per Q9 of `planning/requirements.md`)
    - Confirm `jira-service` was not touched (separate `pom.xml`, separate concern)
    - Confirm no `@JsonProperty` annotations were modified anywhere
    - The commit is ready to land as a single commit per `spec.md` "One commit boundary"

**Acceptance Criteria:**
- `git grep "@JsonNaming(PropertyNamingStrategies.LowerCamelCaseStrategy.class)" architecture-model-service/src/main/java/` returns zero matches
- `git grep "@CamelCaseWire" architecture-model-service/src/main/java/` returns exactly 20 matches
- `cd architecture-model-service && mvn test-compile` exits 0 with no `-D` flags
- A representative `mvn test` invocation from the camelCase island passes, confirming runtime-identical behaviour
- Commit scope is bounded to the new annotation file, the 19 swaps, and the `CLAUDE.md` edit — no YAML, no tests, no consumer code, no `@JsonProperty` changes, no other modules

---

## Execution Order

Recommended implementation sequence:

1. **Group 1** — Create `CamelCaseWire.java` with full central Javadoc. The annotation must exist before any application site can reference it.
2. **Group 2** — Apply `@CamelCaseWire` to the 19 enumerated files in any order (they are independent). Run `mvn test-compile` once at the end of the group to confirm the full module is clean.
3. **Group 3** — Add the "AMS wire format" paragraph to repo-root `CLAUDE.md`. Done after Group 2 so the "19 files" claim in the paragraph matches reality.
4. **Group 4** — Verify all four anchors from `spec.md` and confirm commit scope is bounded. Single commit is created after Group 4 passes.

Groups 1-4 are strictly sequential — each depends on the preceding group's output. The single commit is created AFTER Group 4 passes.
