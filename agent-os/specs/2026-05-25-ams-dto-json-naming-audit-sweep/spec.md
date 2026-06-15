# Specification: AMS DTO `@JsonNaming` Audit Sweep

## Goal

Make the existing camelCase exception island in `architecture-model-service` legible by extracting a custom meta-annotation `@CamelCaseWire` (wrapping `@JsonNaming(LowerCamelCaseStrategy.class)`), applying it to the 19 files that currently carry the raw annotation, and documenting the pattern centrally. Zero runtime wire-format change anywhere in the codebase.

## User Stories

- As a future AMS contributor adding a new DTO, I want a one-line idiom (`@CamelCaseWire`) and a central explanation of when to use it, so I can tell at a glance whether my DTO belongs to the snake_case majority or the camelCase exception island without having to grep across 19 files for precedent.
- As a reviewer of an AMS PR introducing a new endpoint, I want camelCase-on-the-wire decisions to be visually distinctive (a named annotation, not a cryptic Jackson incantation), so I can spot a missing or unnecessary override during code review.

## Specific Requirements

**Create the `@CamelCaseWire` meta-annotation**
- Path: `architecture-model-service/src/main/java/com/example/architecturemodel/jackson/CamelCaseWire.java` (implementer may pick a different package if a more idiomatic AMS-infrastructure location exists; document the chosen package in the commit message).
- Annotation declaration: `@Retention(RetentionPolicy.RUNTIME)`, `@Target(ElementType.TYPE)`, meta-annotated with `@JsonNaming(PropertyNamingStrategies.LowerCamelCaseStrategy.class)`.
- Full Javadoc on the annotation explaining: the AMS global default is `SNAKE_CASE`; this marker identifies DTOs whose consumers speak camelCase; runtime-identical to `@JsonNaming(LowerCamelCaseStrategy.class)`; current application surface is Selective Copy, target-state architecture, captured-decisions data plane.
- No other Jackson behaviour changes (no global config touched, no extra strategies introduced).

**Apply `@CamelCaseWire` to the 19 currently-overridden files**
- Authoritative list lives in `planning/requirements.md` under "Authoritative Counts and File Lists" -- 3 controllers, 1 mapper, 15 DTOs.
- For each file: replace `@JsonNaming(PropertyNamingStrategies.LowerCamelCaseStrategy.class)` with `@CamelCaseWire`.
- Remove the now-unused imports of `com.fasterxml.jackson.databind.PropertyNamingStrategies` and `com.fasterxml.jackson.databind.annotation.JsonNaming` unless something else in the file still uses them.
- Add the import for the new `CamelCaseWire` annotation.
- No other edits to these files (field shape, ordering, business logic, mapper logic untouched).

**Collapse per-class Javadoc to one sentence per file**
- Today multiple files carry multi-paragraph Javadoc explaining the global SNAKE_CASE default and why this override is needed.
- Replace with a single sentence using the template: "Marked `@CamelCaseWire` because `<consumer name / surface>` speaks camelCase."
- The detailed explanation lives only on `CamelCaseWire.java` itself; per-file repetition is removed.

**Document the pattern in repo-root `CLAUDE.md`**
- Add a new heading "AMS wire format" near other AMS-relevant sections.
- Paragraph text: "AMS speaks snake_case at the wire by default. DTOs whose consumers expect camelCase are marked `@CamelCaseWire` -- currently 19 files covering Selective Copy, target-state architecture, and the captured-decisions data plane. New camelCase consumers use `@CamelCaseWire`; new snake_case consumers need no annotation."
- No AMS-level README is added (avoids drift between two doc locations).

**Verification anchors (the spec is not done without all four)**
- `git grep "@JsonNaming(PropertyNamingStrategies.LowerCamelCaseStrategy.class)" architecture-model-service/src/main/java/` returns zero matches.
- `git grep "@CamelCaseWire" architecture-model-service/src/main/java/` returns exactly 20 matches (19 application sites + 1 declaration).
- `cd architecture-model-service && mvn test-compile` exits 0 with no `-D` flags.
- `cd architecture-model-service && mvn test -Dtest=<one or two representative tests from the camelCase island>` passes -- e.g. a Selective Copy controller test plus a target-state captured-decisions test. Confirms the meta-annotation has runtime-identical behaviour to the raw `@JsonNaming`.

**One commit boundary**
- One commit covering: the new `CamelCaseWire.java`, the 19 annotation swaps with import cleanup and Javadoc trim, and the `CLAUDE.md` edit.
- `application.yml` (main and test) untouched.
- No test fixture changes. No consumer-side changes anywhere in the repo.

## Existing Code to Leverage

**The 19 files currently carrying `@JsonNaming(PropertyNamingStrategies.LowerCamelCaseStrategy.class)`**
- Full list in `planning/requirements.md` "Authoritative Counts and File Lists" section.
- These are the application surface for `@CamelCaseWire` -- the implementer swaps the annotation in place; no other code change.
- They constitute the camelCase exception island (Selective Copy, target-state architecture, captured-decisions data plane).

**`architecture-model-service/src/main/resources/application.yml` (line 35) and `src/test/resources/application.yml` (line 28)**
- Both pin `property-naming-strategy: SNAKE_CASE`. The spec leaves them untouched -- the global default stays SNAKE_CASE, which is the wire format ~70% of consumers actually rely on.

**`planning/requirements.md` (consumer audit table)**
- Authoritative justification for not flipping the global default. Multiple snake_case-dependent consumers (gateway `WorkItemStatsResponse`, gateway `workItemSearchService.ts`, discovery-service `archModelClient.ts`, api-migration-validation-service `archModelClient.ts`, frontend `apiBehaviourClient.ts`, `findingsApi.ts`, `discoveryApi.ts`) self-document the dependency.

**`frontend/src/api/epicCapturedDecisionsApi.ts` (dual-tolerance reference shape)**
- The `coerce(snake, camel)` pattern in this file is the reference shape for the future hardening pass that would let a global flip happen safely. Out of scope for this spec; named in `CLAUDE.md` only as a pointer for the next contributor.

## Out of Scope

- Flipping the global `spring.jackson.property-naming-strategy` from `SNAKE_CASE` to `LOWER_CAMEL_CASE`. The consumer audit in `planning/requirements.md` rules this out -- the majority of AMS endpoints' callers depend on snake_case.
- Removing or modifying any `@JsonProperty` annotation. The codebase has 1,188 of them across 164+ files; they are mostly working as intended (belt-and-braces snake_case declarations matching consumer expectations), not workarounds for the global default.
- Any consumer-side change in `gateway/`, `discovery-service/`, `api-migration-validation-service/`, or `frontend/`. No client expects this annotation; no client breaks.
- Adding dual-tolerance (`coerce(snake, camel)`) to existing consumers. This is a future hardening pass that would let a future global flip happen safely; named in `CLAUDE.md` only as a pointer.
- `architecture-read-service` audit. Per Q9 of `planning/requirements.md` this was deferred; the implementer may grep to confirm it doesn't call AMS, but no audit-table update is required.
- New test coverage. The existing AMS test suite is the regression net; the verification step picks one or two representative tests from the camelCase island to prove runtime-identical behaviour.
- YAML changes. `application.yml` (main and test) stays at `SNAKE_CASE`.
- The `jira-service` module -- separate `pom.xml`, separate concern, not part of this spec.
- AMS-level README. Per Q4 the central documentation lives on `CamelCaseWire.java`'s Javadoc and in `CLAUDE.md` only; no second doc location is created.
