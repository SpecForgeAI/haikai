# Task Breakdown: Target-conversation tech-stack constraints + versioned selection

> **Spec 6 of 6**, but **built THIRD** in the initiative (authoring/build order
> `1 → 2 → 6 → 3 → 4 → 5`). It is sequenced ahead of Specs 3/4/5 because **Spec 3
> (manifest auto-answer) and Spec 4 (vulnerability steering) both plug into the
> version-selection surface this spec creates**. There is **no hard prerequisite
> on Specs 1 or 2**: this spec only *reuses the discipline* of Spec 2's
> non-blocking, proxy/CA-aware egress for the OPTIONAL version-registry/OSV
> enrichment — it does not import Spec 1/2 entities, so it can land before them.
> The Spec 3/4 integration points here are **seams only** (a stable nudge slot/prop
> + a documented writer path/shape); none of Spec 3/4's compute is implemented here.

## Build & Verification Standards (MANDATORY — read first)

Implementation runs **UNATTENDED overnight** via `implement-tasks`. Every task
group MUST honour these standards, and the **last sub-task of every group is an
explicit isolation-verification gate** that re-states them.

- **Verify in ISOLATION — never gate on whole-repo green.** The whole-repo
  frontend `tsc`/`lint` baseline is **RED on `main`** (known, pre-existing). Do
  NOT run, or block a task on, a whole-repo typecheck/lint/test.
  - **Gateway** (Jest): run only the touched spec(s) —
    `cd gateway && npx jest <relative/path/to/file.test.ts>` (or a `-t "<name>"`
    name filter). Gateway `tsc` is reliable; a scoped
    `cd gateway && npx tsc --noEmit -p tsconfig.json` is acceptable only if it is
    already green before your change — otherwise fall back to file-scoped checks.
  - **Frontend** (Vitest): run only the touched spec(s) —
    `cd frontend && npx vitest run <relative/path/to/file.test.tsx>`. For type
    safety use **scoped `tsc` on changed files only**, e.g.
    `cd frontend && npx tsc --noEmit <changed-file.ts> <changed-file2.tsx>`
    (file-list mode; do NOT invoke the project-wide build).
- **Anchored / surgical edits only.** Implementer subagents have **Write, not
  Edit** — they rewrite whole files and can silently clobber. Make the smallest
  possible change, anchored on a unique nearby string. **After EVERY edit:**
  1. `git diff --stat` — confirm only the intended file(s) changed and the line
     delta is the expected order of magnitude (a huge delta on a file you meant
     to touch lightly = clobber; revert and retry).
  2. **Symbol-survival greps** — grep the touched file for a handful of
     load-bearing identifiers that existed before (exported names, sibling
     functions, `QUESTION_LIBRARY`, the other 50 `code:` entries, etc.) and
     confirm they still exist. Pre-existing code must survive an additive edit.
  3. **Mojibake / NUL scan** on every touched file — grep for the UTF-8
     replacement char `�`, common mojibake sequences (`Ã`, `Â`, `â€`), and
     embedded NUL bytes. Any hit = corrupted write; revert and redo.
- **No silent caps / sampling / drops.** Every hidden choice, every skipped
  (moot) question, and every grey LLM-judge adjudication MUST be logged
  (decision code + input + keep/hide outcome) via the existing `logger`. If a set
  is ever truncated, log the drop with a reason — never silently shrink a list.
- **Additive, not destructive.** `cascades` seeding behaviour is **extended,
  never removed**. New constraint metadata sits **alongside** `CascadeEntry`.
  Existing `QuestionLibraryEntry` fields, the 51 codes, and existing tests must
  all still pass unchanged.
- **Wire format.** Keep any new `{framework, version}` shape consistent with the
  existing captured-decision `answerValue = JSON.stringify({ value, sourceQuote,
  sourceFile })` envelope (`answerSummary` = the resolved chip label). No new AMS
  DTOs are required by this spec; if one is added, AMS defaults to snake_case —
  apply `@CamelCaseWire` only for a new camelCase consumer.

## Overview
Total Tasks: 8 task groups

Primary module is **`gateway`** (`src/config/architect-conversation/` +
`src/services/architectConversation/`), with a mirrored frontend control under
`frontend/src/components/targetState/architectConversation/` and the shape mirror
in `frontend/src/api/architectConversationApi.ts`.

## Task List

### Data / Config Layer (gateway)

#### Task Group 1: Encode the finalized per-question dependency matrix as metadata
**Dependencies:** None
**Primary files:**
`gateway/src/config/architect-conversation/questionLibrary.ts`,
`gateway/src/config/architect-conversation/__tests__/questionLibrary.test.ts`

This group encodes the **authoritative artifact** — the FINALIZED matrix from
spec.md (**15 hard-dependent / 9 grey / 27 independent = 51**) — as typed data on
`QuestionLibraryEntry`, alongside (never replacing) `cascades`. (FR1, FR7.)

- [x] 1.0 Extend `QuestionLibraryEntry` and populate the matrix for all 51 codes
  - [x] 1.1 Write 2-8 focused tests (extend `questionLibrary.test.ts`)
    - Test the exact tally: counts of `dependencyClass` across the library are
      **15 hard-dependent (`H`) / 9 grey (`G`) / 27 independent (`I`)** — note
      `db.engine` and `ui.framework` are class `I` (freely-chosen branchers), NOT
      hard-dependent; they are not narrowed by `service.language`.
    - Test the LOCKED independent bucket is classified `I` and is never given
      `foundationalInputs`: `cutover.*`, `api.auth`, `api.rateLimiting`,
      `secrets.management`, `tracing.framework`.
    - Test the `versioned: true` set is EXACTLY `service.language`,
      `service.framework`, `service.runtime`, `db.engine`, `db.driver`,
      `ui.framework`, `build.tool`.
    - Test a representative `H`/`G` row names a real foundational code (e.g.
      `service.framework` → includes `service.language`).
    - Keep to 2-8 tests; do NOT assert every one of the 51 rows individually.
  - [x] 1.2 Add the new metadata fields to the `QuestionLibraryEntry` interface
    - `dependencyClass: 'hard-dependent' | 'grey' | 'independent'` (define an
      exported `DependencyClass` union; do not reuse free strings).
    - `foundationalInputs: string[]` — decision codes the filter keys on; `[]`
      for independent rows. Allowed foundational codes per the matrix:
      `service.language` (primary), `service.runtime`, `build.tool`,
      `db.engine`, `api.protocol`, `ui.framework`, `interservice.asyncBus`.
    - `versioned: boolean` — renders the FR5 framework+version control.
    - Keep fields OPTIONAL-with-explicit-population or required-with-full-fill so
      the type change does not break the existing 51-entry literal; populate all
      51 entries either way.
  - [x] 1.3 Populate `dependencyClass` / `foundationalInputs` / `versioned` on all
        51 entries, transcribed verbatim from the spec.md **Per-Question
        Dependency Matrix** (Groups A-J), e.g.:
    - `service.language` → `H`, `foundationalInputs: []` (the brancher),
      `versioned: true`.
    - `service.framework` → `H`, `['service.language','service.runtime']`,
      `versioned: true`.
    - `db.driver` → `H`, `['db.engine','service.language']`, `versioned: true`.
    - `ui.buildTool` → `H`, `['ui.framework']`, `versioned: false`.
    - `service.healthcheck` → `G`, `['service.framework']`.
    - `cutover.strategy` → `I`, `[]`, `versioned: false`.
    - `db.engine` → `I`, `[]` (freely-chosen sub-foundational brancher for
      Group C; NOT narrowed by `service.language`), `versioned: true`.
    - `ui.framework` → `I`, `[]` (freely-chosen UI-tier brancher), `versioned: true`.
    - Use anchored edits per existing entry; do NOT rewrite the whole 228+ line
      literal in one Write (clobber risk — see Build & Verification Standards).
  - [x] 1.4 Verify in ISOLATION
    - `cd gateway && npx jest src/config/architect-conversation/__tests__/questionLibrary.test.ts`
      — only the tests from 1.1 plus the pre-existing library tests.
    - After each edit: `git diff --stat`; grep the file for `QUESTION_LIBRARY`,
      `CascadeEntry`, and a sample of pre-existing `code:` values (all 51 still
      present); mojibake/NUL scan.
    - Do NOT run the gateway suite or any whole-repo check.

**Acceptance Criteria:**
- The 2-8 tests in 1.1 pass; pre-existing `questionLibrary.test.ts` tests still pass.
- All 51 entries carry `dependencyClass` / `foundationalInputs` / `versioned`;
  tally is exactly 15 H / 9 G / 27 I (`db.engine` + `ui.framework` are class `I`,
  not `H`); versioned set matches the spec exactly.
- `cascades`, the 51 codes, and every existing field are untouched (additive only).

---

#### Task Group 2: Deterministic branch-lists + compatibility matrix (data) + loader validation
**Dependencies:** Task Group 1
**Primary files:**
`gateway/src/config/architect-conversation/questionLibrary.ts` (or a new sibling
data module imported by it, e.g. `branchLists.ts` / `compatibilityMatrix.ts`),
`gateway/src/config/architect-conversation/loadConfigs.ts`,
`gateway/src/config/architect-conversation/__tests__/questionLibrary.test.ts`

This group encodes the **deterministic, data-only** filter inputs (no LLM on this
path) and extends loader-time validation so a bad matrix throws at startup, not at
request time. (FR2, FR3 deterministic half, FR1 validation.)

- [x] 2.0 Add `branchLists` + deterministic compatibility matrix + load-time validation
  - [x] 2.1 Write 2-8 focused tests
    - The LOCKED worked example: with `service.language = "Java 21"`, the
      branch-list for `service.framework` yields ONLY `Spring Boot 3.4` /
      `Quarkus 3` / `Micronaut 4` and EXCLUDES `FastAPI` / `NestJS` / `Gin` /
      `ASP.NET`.
    - `validateQuestionLibrary` returns a structured error for: an unknown
      `dependencyClass`; a `foundationalInputs` code that does not resolve to a
      real library entry; an `H`/`G` entry with NO branch-list / matrix row
      covering it.
    - A valid library produces zero new errors (regression guard).
    - Keep to 2-8 tests.
  - [x] 2.2 Add the deterministic `branchLists` structure (pure data)
    - Keyed on foundational answer(s); maps each `hard-dependent` question's
      `choices` to the compatible subset. Language alone is sufficient for the
      headline filter; refiners (`service.runtime`, `build.tool`) narrow further.
    - Add `Micronaut 4` to `service.framework` `choices` (per the LOCKED
      example) via an anchored edit to that entry's `choices` array.
    - Frozen const(s); no I/O, no LLM, no orchestration in this file.
  - [x] 2.3 Add the deterministic compatibility matrix (code pre-filter) for grey
        cases that are clear-cut
    - Resolves all unambiguous `grey` rows deterministically (e.g.
      `service.healthcheck` under non-Spring → deterministic keep/hide) so the
      LLM-judge in Task Group 3 only ever sees the genuinely ambiguous residue.
    - Pure data + a pure resolver function returning keep/hide/`undecided`.
  - [x] 2.4 Extend `validateQuestionLibrary` in `loadConfigs.ts`
    - Add `ValidationError` variants: `unknown-dependency-class`,
      `unresolved-foundational-input`, `missing-branch-or-matrix-coverage`.
    - Resolve every `foundationalInputs` code against the existing `allCodes`
      set; require every `H`/`G` entry to have branch-list OR matrix coverage.
    - Route through the SAME structured-error path that already throws in
      `loadAndValidateArchitectConversationConfigs` at startup.
  - [x] 2.5 Verify in ISOLATION
    - `cd gateway && npx jest src/config/architect-conversation/__tests__/questionLibrary.test.ts`.
    - After each edit: `git diff --stat`; grep for `validateQuestionLibrary`,
      `loadAndValidateArchitectConversationConfigs`,
      `ALLOWED_SCOPE_REF_TYPES`, and existing `ValidationError` kinds (survival);
      mojibake/NUL scan.

**Acceptance Criteria:**
- The 2-8 tests in 2.1 pass; pre-existing loader tests still pass.
- Java 21 branch-list matches the LOCKED example exactly; `Micronaut 4` added.
- Loader throws structured errors for unknown class / unresolved foundational
  input / uncovered H or G entry; a valid library still loads clean.
- Branch-lists + matrix are pure data validated at load time — no LLM on this path.

---

### Filtering / Adjudication Layer (gateway)

#### Task Group 3: Grey LLM-judge (code-pre-filter-then-LLM, fail-open)
**Dependencies:** Task Group 2
**Primary files:** new
`gateway/src/services/architectConversation/greyCompatibilityJudge.ts` +
`__tests__/greyCompatibilityJudge.test.ts`, reusing the
`openTurnTechStackPrefill.ts` injectable-deps / `ArchitectLlmClient` seam.

Only the ambiguous residue from Task Group 2's matrix reaches the LLM. The judge
returns keep/hide per candidate and **fails OPEN**. (FR3 LLM half.)

- [x] 3.0 Implement the grey-area LLM-judge behind the existing single-shot seam
  - [x] 3.1 Write 2-8 focused tests
    - Happy path is **never** an LLM call: when the deterministic matrix resolves
      every candidate, the judge dependency is NOT invoked.
    - For a genuinely grey candidate, the injected `ArchitectLlmClient` is
      called and its keep/hide verdict is honoured.
    - **Fail-open:** when the judge throws / returns unavailable, the FULL
      candidate set is returned (conversation never blocked).
    - Every adjudication logs input + keep/hide output (assert via a spy/mock on
      `logger`).
    - Keep to 2-8 tests.
  - [x] 3.2 Build the judge module
    - Mirror the `OpenTurnTechStackPrefillDeps` pattern: an injectable `deps`
      object + a default; accept the `ArchitectLlmClient`; never call the LLM on
      the deterministic-resolved path.
    - Input = the question code + the deterministic-matrix residue (only
      `undecided` candidates from Task Group 2); output = keep/hide per candidate.
  - [x] 3.3 Wire the deterministic pre-filter → judge pipeline
    - Compose: branch-list (TG2) → deterministic matrix (TG2) →
      grey-judge (this group) → final keep/hide set, so the LLM sees only the
      residue. Log every grey adjudication.
  - [x] 3.4 Fail-open + logging guarantees
    - Any judge failure (throw, timeout, malformed) ⇒ offer the full set; log the
      failure reason; never propagate an error that would block the turn.
  - [x] 3.5 Verify in ISOLATION
    - `cd gateway && npx jest src/services/architectConversation/__tests__/greyCompatibilityJudge.test.ts`.
    - After each edit: `git diff --stat`; grep the new file + any touched file for
      `ArchitectLlmClient`, the deps export, and `logger`; mojibake/NUL scan.

**Acceptance Criteria:**
- The 2-8 tests in 3.1 pass.
- LLM is invoked ONLY on the ambiguous residue; deterministic path makes no call.
- Judge returns keep/hide per candidate and fails OPEN on any failure.
- Every grey adjudication (input + outcome) is logged; no silent drops.

---

#### Task Group 4: Runtime hide-incompatible + "Other (advanced)" + answer-driven skip-moot
**Dependencies:** Task Groups 2-3
**Primary files:** new
`gateway/src/services/architectConversation/choiceFilter.ts` +
`__tests__/choiceFilter.test.ts`; extend the answer-driven moot path modelled on
`relevanceEvaluator.ts` / `RelevanceContext`.

Apply the filter at runtime: hide incompatible choices, always append an escape
hatch, and skip questions that have become moot — coexisting with `cascades`
seeding. (FR4, FR7.)

- [x] 4.0 Implement runtime filtering, escape hatch, and answer-driven moot-skip
  - [x] 4.1 Write 2-8 focused tests
    - Incompatible choices are HIDDEN (removed from the offered set), not merely
      warned — e.g. Java 21 ⇒ `service.framework` offered set excludes FastAPI.
    - An `Other (advanced)` option is ALWAYS appended to a filtered question;
      selecting it accepts a free-text value outside the branch-list.
    - Skip-moot: a question moot given prior answers is auto-skipped (e.g.
      `api.contractFormat` moot when no protocol implies a contract format),
      reusing the `system-skip` / not-applicable capture shape.
    - Seeding/filtering coexistence: a `cascades`-seeded default that is a member
      of the filtered set is preserved; a seeded default NOT in the filtered set
      falls back to the recommended/first compatible choice (and that fallback is
      logged).
    - Keep to 2-8 tests.
  - [x] 4.2 Build the choice filter
    - Consume Task Group 3's keep/hide result; remove hidden choices; append a
      stable `Other (advanced)` sentinel; log every hidden choice (code + value).
  - [x] 4.3 Extend the moot-skip to be answer-driven
    - Generalise the existing tier-gated `relevanceCondition` / `RelevanceContext`
      auto-skip so a question can be skipped based on prior ANSWERS (not only
      tier flags). Keep the existing tier predicates working unchanged (additive).
  - [x] 4.4 Seed↔filter reconciliation
    - When applying a `cascades` seed, verify membership in the filtered set;
      fall back to recommended/first-compatible when the seed is filtered out;
      log the substitution. Do NOT remove or alter `cascades` seeding.
  - [x] 4.5 Verify in ISOLATION
    - `cd gateway && npx jest src/services/architectConversation/__tests__/choiceFilter.test.ts`.
    - Re-run the pre-existing `relevanceEvaluator` test(s) if the moot-skip change
      touched shared code:
      `cd gateway && npx jest src/services/architectConversation/__tests__` -t
      filtered to the relevant names — do NOT run the whole gateway suite.
    - After each edit: `git diff --stat`; grep for `RelevanceContext`,
      `relevanceCondition`, `defaultNotApplicableReason`, `cascades` (survival);
      mojibake/NUL scan.

**Acceptance Criteria:**
- The 2-8 tests in 4.1 pass; pre-existing relevance/auto-skip tests still pass.
- Incompatible choices hidden; `Other (advanced)` always present; moot questions
  skipped via the existing capture shape.
- Seeding and filtering coexist; out-of-set seeds fall back and the fallback is
  logged; `cascades` behaviour unchanged.

---

### Versioned Selection: framework/version decouple (gateway + frontend)

#### Task Group 5: Structured `{framework, version}` capture + shared shape + contract test
**Dependencies:** Task Group 1
**Primary files:** gateway capture/writer reusing
`openTurnTechStackPrefill.ts` envelope +
`targetStateCapturedDecisionsWriter.ts` / `structuredAnswerParser.ts`;
`frontend/src/api/architectConversationApi.ts`; new contract test in the style of
`frontend/src/api/__tests__/scopeRefType.contractWithGateway.test.ts`.

Decouple version from framework at the data shape: ONE resolved
`{framework, version}` captured-decision, mirrored gateway↔frontend and guarded by
a contract test. (FR5 capture half, FR8 contract.)

- [x] 5.0 Define + capture the structured `{framework, version}` value, mirrored and guarded
  - [x] 5.1 Write 2-8 focused tests (split gateway Jest + frontend Vitest)
    - Gateway: the captured row for a versioned question uses
      `answerValue = JSON.stringify({ value: { framework, version }, sourceQuote,
      sourceFile })` and `answerSummary` = the resolved chip label (e.g.
      `"Spring Boot 3.4.1"`).
    - Gateway: the `structured` answer parser accepts a `{ framework, version }`
      object and rejects a malformed payload (missing `framework` or `version`).
    - Frontend: a gateway↔frontend **contract test** asserts the shared
      `{framework, version}` shape (and any new enum/sentinel) matches across
      `architectConversationApi.ts` and the gateway source-of-truth (follow the
      JSON-source-of-truth precedent; do NOT cross-import gateway TS — use a
      shared JSON file resolved up the tree, as `scopeRefType.json` does).
    - Keep total to 2-8 tests across both runners.
  - [x] 5.2 Define the shared shape
    - Add a `{ framework: string; version: string }` type in the gateway and a
      mirrored type in `frontend/src/api/architectConversationApi.ts`. If a
      closed set / sentinel is introduced (e.g. a `version-unknown` marker), put
      its canonical member list in a shared JSON file so the contract test can
      diff it (mirroring `scopeRefType.json`).
  - [x] 5.3 Capture through the existing envelope
    - Reuse the `openTurnTechStackPrefill.ts` envelope:
      `answerValue = JSON.stringify({ value: { framework, version }, sourceQuote,
      sourceFile })`, `answerSummary` = resolved chip label, via
      `targetStateCapturedDecisionsWriter`. Do NOT invent a new persistence path
      or AMS DTO; keep snake_case-on-the-wire behaviour unchanged.
    - Extend `structuredAnswerParser.ts` to validate the `{framework, version}`
      structured shape for versioned codes.
  - [x] 5.4 Add the contract test
    - New `frontend/src/api/__tests__/<name>.contractWithGateway.test.ts` in the
      `scopeRefType.contractWithGateway.test.ts` style.
  - [x] 5.5 Verify in ISOLATION
    - Gateway: `cd gateway && npx jest <touched test files>`.
    - Frontend: `cd frontend && npx vitest run src/api/__tests__/<name>.contractWithGateway.test.ts`;
      scoped types: `cd frontend && npx tsc --noEmit src/api/architectConversationApi.ts`
      (file-scoped — NOT the project build; whole-repo is RED).
    - After each edit: `git diff --stat`; grep gateway/frontend touched files for
      the envelope keys, `architectConversationApi` exports, and existing
      `ScopeRefType` mirror (survival); mojibake/NUL scan.

**Acceptance Criteria:**
- The 2-8 tests in 5.1 pass (gateway + frontend).
- Capture uses the existing `{value, sourceQuote, sourceFile}` envelope with a
  `{framework, version}` value and a single resolved-chip `answerSummary`.
- The shared shape is mirrored gateway↔frontend and guarded by a contract test;
  no new AMS DTO; snake_case wire untouched.

---

#### Task Group 6: Version control UI + non-blocking registry/OSV enrichment + Spec 3/4 seams
**Dependencies:** Task Groups 4-5
**Primary files:** new version-control component under
`frontend/src/components/targetState/architectConversation/` (+ `.module.css` +
`__tests__/`), rendered by `ArchitectConversationTab.tsx`; enrichment client
reusing Spec 2's proxy/CA-aware, swappable, fail-open egress discipline.

The dedicated version control: recommended default pre-selected, free-text exact,
ONE resolved chip, a quiet "enrichment unavailable" affordance, a stable Spec 4
nudge slot, and a documented Spec 3 writer seam. (FR5 UI, FR6, FR8.)

- [x] 6.0 Build the dedicated version control + non-blocking enrichment + seams
  - [x] 6.1 Write 2-8 focused tests (Vitest + RTL)
    - Framework axis renders as constrained single-select chips (target ≤6,
      filtered per Task Group 4) and the version axis is a SEPARATE control with
      the recommended default PRE-SELECTED.
    - Free-text exact entry produces a valid off-list version; the resolved
      selection renders as exactly ONE chip (e.g. `Spring Boot 3.4.1`), never
      framework×version cartesian chips.
    - Enrichment is NON-BLOCKING: when the enrichment fetch fails/unavailable,
      free-text + recommended default still work and a quiet "enrichment
      unavailable" affordance shows; submission is NEVER gated; the recommended
      default is NEVER changed by enrichment.
    - A stable Spec 4 nudge slot/prop exists and renders injected nudge content
      without the control implementing any compute.
    - Keep to 2-8 tests.
  - [x] 6.2 Build the version control component
    - Framework single-select (≤6 chips, fed by the Task Group 4 filtered set) +
      a dedicated version dropdown/typeahead scoped to the chosen framework, with
      recommended default pre-selected and a free-text exact entry. Emit the
      `{framework, version}` value from Task Group 5; render one resolved chip.
  - [x] 6.3 Add the OPTIONAL registry/OSV enrichment (strictly non-blocking)
    - Reuse Spec 2's `HTTP(S)_PROXY` + custom-CA, swappable, fail-open egress
      discipline (Maven Central / npm registry / OSV) ONLY to augment the
      typeahead suggestion list. It NEVER gates submission, NEVER changes the
      recommended default, and degrades to a quiet affordance offline. Log (do
      not silently swallow) enrichment failures.
  - [x] 6.4 Expose the Spec 3 + Spec 4 integration seams (seams only)
    - **Spec 4:** a stable, documented nudge slot/prop on the version control
      where Spec 4 will render the inline non-blocking nudge + one-click "use this
      version". Do NOT implement Spec 4 compute.
    - **Spec 3:** document the writer path/shape (the Task Group 5 envelope) the
      manifest auto-answer will use, including the `version-unknown` state when a
      manifest cannot resolve a version. Do NOT implement pom.xml/package.json
      parsing.
  - [x] 6.5 Wire the control into `ArchitectConversationTab.tsx` for versioned codes
    - Render the new control for the FR5 versioned codes (`service.language`,
      `service.framework`, `service.runtime`, `db.engine`, `db.driver`,
      `ui.framework`, `build.tool`); leave all other questions rendering as today
      (additive). Use anchored edits — do NOT rewrite the tab component wholesale.
  - [x] 6.6 Verify in ISOLATION
    - `cd frontend && npx vitest run src/components/targetState/architectConversation/__tests__/<new>.test.tsx`
      plus the touched `ArchitectConversationTab` spec(s) only.
    - Scoped types on changed files only:
      `cd frontend && npx tsc --noEmit <changed component files>` (file-list mode;
      whole-repo frontend baseline is RED — never gate on it).
    - After each edit: `git diff --stat`; grep `ArchitectConversationTab.tsx` for
      pre-existing exports/handlers and the `TechStackPrefillBanner` import
      (survival — confirm the additive render didn't drop existing UI);
      mojibake/NUL scan.

**Acceptance Criteria:**
- The 2-8 tests in 6.1 pass.
- Framework = ≤6 filtered single-select chips; version = a dedicated scoped
  control with recommended default pre-selected + free-text exact; ONE resolved
  chip rendered.
- Enrichment is non-blocking, proxy/CA-aware, fail-open, never changes the
  default nor gates submission; offline affordance shown; failures logged.
- A stable Spec 4 nudge slot and a documented Spec 3 writer/`version-unknown`
  seam exist with NO Spec 3/4 compute implemented here.

---

### API like-for-like lock (gateway + frontend)

#### Task Group 7: `api.surfaceMode` like-for-like locks Group B from source (treatment class `L`)
**Dependencies:** Task Groups 1, 5 (matrix metadata from TG1; captured-decision
envelope/writer from TG5). Independent of TG2-4/TG6.
**Primary files:**
`gateway/src/config/architect-conversation/questionLibrary.ts` +
`__tests__/questionLibrary.test.ts` (matrix `lockableFromSource` metadata),
new `gateway/src/services/architectConversation/apiSurfaceLock.ts` +
`__tests__/apiSurfaceLock.test.ts` (mode resolution + lock/auto-answer +
provenance), reusing the `targetStateCapturedDecisionsWriter.ts` /
`openTurnTechStackPrefill.ts` envelope; frontend read-only render under
`frontend/src/components/targetState/architectConversation/` +
`__tests__/`, mirror in `frontend/src/api/architectConversationApi.ts`.

Add a migration mode `api.surfaceMode` (`like_for_like` | `may_change`) that
DEFAULTS to `like_for_like` whenever the architecture has a reconciled API
Behaviour Baseline / oracle. Under `like_for_like` the WHOLE of Group B is
auto-answered + LOCKED (treatment class `L`) from the source contract/baseline,
written via the captured-decision envelope with source provenance, rendered
read-only ("locked — API like-for-like"), and NOT asked. `may_change` reverts
Group B to its underlying H/I/G class. Deriving the locked values is a thin
READ of the existing source contract/oracle — wire the lock + provenance +
read-only display; do NOT rebuild reconciliation. (FR1 `L` treatment, FR9.)

- [x] 7.0 Add `api.surfaceMode`, the `L` lock from source, provenance, and read-only render
  - [x] 7.1 Write 2-8 focused tests (split gateway Jest + frontend Vitest)
    - Matrix metadata: EXACTLY the six Group B codes (`api.protocol`,
      `api.versioning`, `api.contractFormat`, `api.auth`, `api.errorContract`,
      `api.rateLimiting`) carry `lockableFromSource: true`; every other code is
      `false`/absent; each Group B row STILL records its underlying H/I/G class
      (the `L` treatment supersedes at runtime, it does not erase the base class).
    - Default resolution: when the architecture has a reconciled API Behaviour
      Baseline / oracle, `api.surfaceMode` resolves to `like_for_like` by default;
      with no baseline it is not forced.
    - Under `like_for_like`: all six Group B questions are treated `L` — NOT asked
      (excluded from the offered set) and auto-answered from the source contract;
      each locked row is written via
      `answerValue = JSON.stringify({ value, sourceQuote, sourceFile })` with
      provenance pointing at the source contract/baseline, and carries the
      locked/read-only marker.
    - Under `may_change`: the same six questions revert to their underlying
      H/I/G class and are asked normally (no `L`, no lock write).
    - Frontend: a locked Group B question renders READ-ONLY with the
      "locked — API like-for-like" affordance (not editable choices); the mirrored
      `api.surfaceMode` enum / `L` treatment shape matches gateway (extend the
      existing contract test or add a focused mirror assertion — shared JSON
      source-of-truth, do NOT cross-import gateway TS).
    - Keep total to 2-8 tests across both runners.
  - [x] 7.2 Add the matrix metadata (`lockableFromSource` + the `L` treatment type)
    - Extend `QuestionLibraryEntry` with `lockableFromSource?: boolean` and add
      `'L'`/`'locked'` to the treatment/`DependencyClass`-adjacent union as a
      RUNTIME treatment that supersedes H/I/G (do not delete the underlying
      `dependencyClass`). Set `lockableFromSource: true` on the six Group B
      entries via anchored per-entry edits; leave every other entry untouched.
    - Additive only — `cascades`, the 51 codes, `dependencyClass`,
      `foundationalInputs`, `versioned`, and existing tests stay intact.
  - [x] 7.3 Resolve `api.surfaceMode` + derive the locked answers (thin source read)
    - In `apiSurfaceLock.ts`: resolve the mode (default `like_for_like` iff a
      reconciled API Behaviour Baseline / oracle is present on the architecture;
      otherwise leave unset / caller-provided). Under `like_for_like`, READ the
      existing source contract/oracle to obtain each Group B value — a thin read,
      NO reconciliation rebuild. Emit a per-question lock decision (value +
      source provenance). Log every lock/auto-answer decision (code + source +
      locked outcome) via `logger`; never silently skip a Group B question
      without a logged lock.
  - [x] 7.4 Write locked answers + suppress the questions (capture envelope + provenance)
    - Write each locked Group B answer through the existing
      `targetStateCapturedDecisionsWriter` /
      `openTurnTechStackPrefill` envelope:
      `answerValue = JSON.stringify({ value, sourceQuote, sourceFile })` with the
      provenance pointing at the source contract/baseline, `answerSummary` = the
      resolved label. Exclude locked questions from the asked/offered set under
      `like_for_like`; restore them under `may_change`. Do NOT invent a new
      persistence path or AMS DTO; snake_case-on-the-wire behaviour unchanged.
  - [x] 7.5 Read-only render + mode mirror (frontend, additive)
    - Mirror `api.surfaceMode` (and the `L` treatment marker) into
      `frontend/src/api/architectConversationApi.ts` (shared JSON source-of-truth
      for any closed set, mirroring `scopeRefType.json`). Render a locked Group B
      question read-only with the "locked — API like-for-like" affordance and its
      source provenance, NOT as editable choices. Use anchored edits — do NOT
      rewrite the tab/control wholesale.
  - [x] 7.6 Verify in ISOLATION
    - Gateway: `cd gateway && npx jest src/config/architect-conversation/__tests__/questionLibrary.test.ts src/services/architectConversation/__tests__/apiSurfaceLock.test.ts`.
    - Frontend: `cd frontend && npx vitest run <touched contract + render spec(s)>`;
      scoped types on changed files only:
      `cd frontend && npx tsc --noEmit src/api/architectConversationApi.ts <changed component files>`
      (file-list mode — the whole-repo frontend baseline is RED; never gate on it).
    - After each edit: `git diff --stat`; symbol-survival greps (`QUESTION_LIBRARY`,
      `CascadeEntry`, the six Group B `code:` entries, the envelope keys,
      `architectConversationApi` exports); mojibake/NUL scan on every touched file.
    - Do NOT run the gateway suite or any whole-repo check.

**Acceptance Criteria:**
- The 2-8 tests in 7.1 pass (gateway + frontend); pre-existing
  `questionLibrary.test.ts` / contract tests still pass.
- EXACTLY the six Group B codes carry `lockableFromSource: true`; each retains its
  underlying H/I/G class; `L` supersedes only while `like_for_like` is active.
- `api.surfaceMode` defaults to `like_for_like` given a reconciled baseline/oracle;
  under it Group B is auto-answered + LOCKED from source (provenance in the
  envelope) and NOT asked; `may_change` reverts to H/I/G and asks normally.
- Locked questions render read-only ("locked — API like-for-like"); the lock is a
  thin source read (no reconciliation rebuild); every lock decision is logged;
  additive only; verification stayed isolated (never whole-repo green).

---

### Testing

#### Task Group 8: Test Review & Gap Analysis (this feature only)
**Dependencies:** Task Groups 1-7

- [x] 8.0 Review existing tests and fill critical gaps only
  - [x] 8.1 Review the tests written in Task Groups 1-7
    - The 2-8 tests from each of Groups 1-7 (approximately 14-56 total across
      gateway Jest + frontend Vitest).
  - [x] 8.2 Analyze coverage gaps for THIS spec only
    - Focus on the end-to-end constraint flow: foundational answer →
      branch-list → deterministic matrix → grey judge (fail-open) → hide +
      `Other (advanced)` + skip-moot → seed reconciliation → versioned capture →
      one resolved chip. Prioritise integration seams over unit edge cases. Do
      NOT assess whole-application coverage.
  - [x] 8.3 Write up to 10 additional strategic tests MAXIMUM
    - Fill only critical gaps (e.g. a full Java-21 walk that proves FastAPI is
      hidden AND the framework+version pair captures as one chip; a grey-residue
      walk that proves fail-open offers the full set; a seed-filtered-out
      fallback path). Skip exhaustive per-row, performance, and accessibility
      tests unless business-critical. Hard cap: 10 new tests.
  - [x] 8.4 Run feature-specific tests only
    - Gateway: `cd gateway && npx jest src/config/architect-conversation/__tests__ src/services/architectConversation/__tests__/greyCompatibilityJudge.test.ts src/services/architectConversation/__tests__/choiceFilter.test.ts src/services/architectConversation/__tests__/apiSurfaceLock.test.ts <any TG5/TG7/TG8 gateway specs>`.
    - Frontend: `cd frontend && npx vitest run src/api/__tests__/<contract>.test.ts src/components/targetState/architectConversation/__tests__/<new specs>`.
    - Do NOT run the entire gateway or whole-repo frontend suite. Expected total
      ≈ 24-66 tests.

**Acceptance Criteria:**
- All feature-specific tests pass (≈ 24-66 total).
- The end-to-end constraint + versioned-capture workflow for THIS spec is covered.
- No more than 10 additional tests added; scope limited to this spec's
  requirements; verification stayed isolated (never whole-repo green).

## Execution Order

Recommended implementation sequence (dependency-ordered):
1. **Task Group 1** — Encode the per-question dependency matrix as metadata (no deps).
2. **Task Group 2** — Branch-lists + deterministic compatibility matrix + loader validation (needs TG1).
3. **Task Group 3** — Grey LLM-judge, code-pre-filter-then-LLM, fail-open (needs TG2).
4. **Task Group 4** — Runtime hide-incompatible + "Other (advanced)" + answer-driven skip-moot (needs TG2-3).
5. **Task Group 5** — Structured `{framework, version}` capture + shared shape + contract test (needs TG1; can run in parallel with TG2-4).
6. **Task Group 6** — Version control UI + non-blocking enrichment + Spec 3/4 seams (needs TG4-5).
7. **Task Group 7** — API like-for-like lock: `api.surfaceMode` + `L` treatment for Group B (needs TG1, TG5; can run after TG5 in parallel with TG6).
8. **Task Group 8** — Test review & gap analysis (needs TG1-7).
