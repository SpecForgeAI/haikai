# Task Breakdown: Target Dependency-Manifest Upload + Auto-Answer

> **Spec 3 of 6** in the "CVE Reduction Across Current→Target Migration + Target-State Conversation Overhaul" initiative.
> Authoring/build order is **1 → 2 → 6 → 3 → 4 → 5**; this is the **FOURTH** spec built.

## PREREQUISITE — Spec 6 must be implemented first

This spec **consumes Spec 6's constrained/versioned conversation model**. Before starting:
- Spec 6's structured **`{framework, version}`** captured-answer model must exist (one resolved chip downstream, version axis decoupled from framework).
- Spec 6's **per-question dependency matrix** over the 51 `questionLibrary.ts` questions must exist — it is the authoritative source that defines the **dependency-answerable code subset** this spec auto-answers. Do NOT re-derive that classification here; consume it.
- If the Spec 6 matrix/structured-selection artifacts are absent at implementation time, **stop and surface the missing prerequisite** rather than inventing a parallel classification or a `{framework}`-only answer shape.

---

## BUILD & VERIFICATION STANDARDS (read first — implementation runs UNATTENDED overnight)

These standards are MANDATORY and apply to EVERY task group. The final sub-task of each group re-states the isolation verification concretely.

### Verify in ISOLATION — never gate on whole-repo green
- The **whole-repo frontend tsc/lint baseline is RED** (pre-existing, on `main`). NEVER run a whole-repo build/lint/typecheck as a gate, and never treat whole-repo red as this feature's failure.
- **Gateway** (Jest): run ONLY the touched test file(s):
  `cd gateway; npx jest <relativeTestPath> --runTestsByPath`
- **Discovery-service** (Jest): run ONLY the touched test file(s):
  `cd discovery-service; npx jest <relativeTestPath> --runTestsByPath`
- **Frontend** (Vitest): run ONLY the touched test file(s):
  `cd frontend; npx vitest run <relativeTestPath>`
- **Frontend scoped type-check** (changed files only — do NOT run the whole `tsc && vite build`):
  `cd frontend; npx tsc --noEmit -p tsconfig.json` is whole-repo and RED — instead type-check the touched files in isolation, e.g. `cd frontend; npx tsc --noEmit --skipLibCheck --jsx react-jsx --moduleResolution bundler --module esnext --target es2020 <changedFile.tsx>`, and judge ONLY errors originating in the touched files. Pre-existing errors elsewhere are not a gate.

### Anchored / surgical edits (implementer subagents have Write, NOT Edit)
- Implementer subagents write WHOLE files and can clobber adjacent code. For any change to an EXISTING file, make **anchored/surgical edits** against a unique nearby string; never blind-overwrite a file you have not just read in full.
- After EVERY change to a touched file, run:
  - `git diff --stat` — confirm only the intended files/line-counts changed.
  - **Symbol-survival greps** — grep the touched file for the key symbols that must still exist (existing exports, the new function name, the new task constant) so an accidental truncation is caught immediately.
  - **Mojibake / NUL scan** — scan each touched file for replacement chars / smart-quote corruption / embedded NULs (e.g. `grep -nP "[\x00\x{FFFD}\x{2018}\x{2019}\x{201C}\x{201D}]" <file>`); a hit means re-encode before proceeding.

### No silent caps / sampling — log anything dropped
- When parsing manifests, **reject nothing silently**. Any file that is dropped, unparseable, oversized, or skipped MUST be logged with its path + reason (use the existing `logger`). No silent caps, no sampling, no truncation-without-a-log.

### Contract-preservation guardrails (do NOT modify locked code)
- Do NOT modify `MavenDependencyResolver`, `NpmDependencyResolver`, or `mavenPomMetadataParser` — they store versions **VERBATIM** (incl. unresolved `${propname}`) and do NO `${...}`/BOM resolution. **Layer resolution ON TOP**; consume their output as-is.
- Do NOT introduce a new captured-decision endpoint. Reuse `targetStateCapturedDecisionsWriter.postCapturedDecision` verbatim.
- AMS DTOs default to **snake_case** wire; apply `@CamelCaseWire` ONLY if a NEW camelCase-consumed DTO is added (none expected — `target_state_captured_decisions` is the existing target).

---

## Overview
Total Tasks: 6 task groups.

Verified reuse anchors (all confirmed on disk):
- `gateway/src/services/architectConversation/openTurnTechStackPrefill.ts` (+ `__tests__/openTurnTechStackPrefill.test.ts`) — deterministic-sibling model + write contract.
- `gateway/src/services/architectConversation/targetStateCapturedDecisionsWriter.ts` — `postCapturedDecision` / `CreateCapturedDecisionRequestBody` POST seam.
- `gateway/src/services/targetStateCapturedDecisionsClient.ts` — read-side resolver (`fetchLatestCapturedDecisions`) for precedence checks.
- `gateway/src/config/architect-conversation/questionLibrary.ts` — 51-question / groups A–J source.
- `gateway/src/routes/architectConversation.ts` — route layer that already wires the prefill; the manifest route mounts alongside it.
- `discovery-service/src/services/dependencyResolvers/maven/MavenDependencyResolver.ts` + `mavenPomMetadataParser.ts` (exports `parsePomMetadataFromString`, `resolvePropertyRef`, `PomMetadata`) (+ `__tests__`).
- `discovery-service/src/services/dependencyResolvers/npm/NpmDependencyResolver.ts`.
- `discovery-service/src/services/dependencyResolvers/types.ts` — `DeclaredDependency` locked shape (`name`, `version`, `versionRange`, `scope`, `manifestPath`, `manifestLine`).
- Frontend target-state authoring surface: `frontend/src/components/targetState/architectConversation/ArchitectConversationTab.tsx` (+ `TechStackPrefillBanner.tsx` as the provenance-banner precedent).

> **Note on resolver invocation:** the resolvers' `resolve(repoRoot, manifestPath)` reads from disk. Uploaded manifests arrive as in-memory buffers. The version-resolution layer (Group 2) consumes the resolver `DeclaredDependency[]` output + the metadata parser's pure `parsePomMetadataFromString(...)` string seam; the upload route (Group 1) is responsible for materializing/feeding manifest content to the resolvers via their existing on-disk contract (e.g. a per-upload temp workspace) WITHOUT modifying the resolvers.

## Task List

### Backend — Manifest Upload + Parsing (Gateway)

#### Task Group 1: Manifest upload route, tagging, and resolver-backed parsing
**Stack:** gateway (Node/TS, Jest)
**Dependencies:** Spec 6 (prerequisite). None within this spec.

- [x] 1.0 Accept + parse uploaded target manifests via the discovery resolvers (no resolver changes)
  - [x] 1.1 Write 2-8 focused tests for the upload + parse seam
    - Limit to 2-8 highly focused tests maximum.
    - Cover ONLY: (a) a `pom.xml` upload tagged to a module produces `DeclaredDependency[]` via the resolver; (b) a `package.json` upload across `dependencies`/`devDependencies` produces rows; (c) a dropped/unparseable file is LOGGED (no silent drop) and surfaced in the response; (d) multiple manifests each retain their per-module/service tag.
    - Skip exhaustive ecosystem/edge coverage (lockfile pinning + property/BOM resolution are Group 2; auto-answer is Group 3).
  - [x] 1.2 Add the manifest-upload route (reuse the existing multipart pattern)
    - Accept `pom.xml` and `package.json` ONLY; optionally an accompanying `package-lock.json` paired with a `package.json`. Reuse the multipart-upload idiom already used by `gateway/src/routes/discovery.ts` / `apiMigrationValidation.ts` / `missingInputResolutions.ts`.
    - Require a **target module/service tag per manifest** (the per-module/service mapping Spec 5 reuses for per-module placement); reject an untagged manifest with a clear error (do NOT silently accept).
    - Mount alongside the existing conversation routes in `gateway/src/routes/architectConversation.ts` (or a focused sibling route file imported there). Introduce NO new captured-decision endpoint.
    - Allow MULTIPLE manifests per target architecture. Reject NOTHING silently — every dropped/unparsed/oversized file is logged via `logger` with path + reason and reported back to the caller.
  - [x] 1.3 Parse each manifest through the discovery resolvers (consume verbatim)
    - Maven: invoke `MavenDependencyResolver` to produce `DeclaredDependency` rows (`name = groupId:artifactId`, verbatim `version`/`versionRange`/`scope`, `manifestPath`/`manifestLine`). Feed uploaded content to the resolver via its existing on-disk `resolve(repoRoot, manifestPath)` contract (per-upload temp workspace) — do NOT fork or modify the resolver.
    - npm: invoke `NpmDependencyResolver` across `dependencies`/`devDependencies`/`peerDependencies`/`optionalDependencies`; keep versions verbatim.
    - Preserve each row's `manifestPath` so it can later become `sourceFile`, and tag every row with its module/service.
  - [x] 1.4 Define the in-gateway "parsed manifest" model passed to Group 2
    - A typed structure carrying: ecosystem, tagged module/service, the resolver `DeclaredDependency[]`, the raw pom string (for Maven, to feed `parsePomMetadataFromString` in Group 2), and the optional `package-lock.json` content (for npm pinning in Group 2). No version resolution here — that is Group 2.
  - [x] 1.5 Ensure Task Group 1 tests pass IN ISOLATION
    - Run ONLY the 2-8 tests from 1.1: `cd gateway; npx jest <newUploadTest> --runTestsByPath`.
    - Do NOT run the whole gateway suite as a gate.
    - After edits: `git diff --stat`; grep the touched route file for the new route handler symbol + reused `MavenDependencyResolver`/`NpmDependencyResolver` imports (symbol-survival); mojibake/NUL scan touched files.

**Acceptance Criteria:**
- The 2-8 tests from 1.1 pass in isolation.
- Only `pom.xml` / `package.json` (+ optional `package-lock.json`) accepted; multiple, each with a required module/service tag.
- Manifests parsed through the UNMODIFIED discovery resolvers, versions verbatim.
- Every dropped/unparsed/oversized file is logged with path + reason (no silent caps).
- A typed parsed-manifest model (incl. raw pom string + optional lockfile content) is produced for Group 2.

---

### Backend — Version Resolution Layer (Gateway)

#### Task Group 2: Layered version resolution + "version-unknown" handling
**Stack:** gateway (Node/TS, Jest)
**Dependencies:** Task Group 1.

- [x] 2.0 Resolve target versions ON TOP of the verbatim resolver output (no resolver/parser changes)
  - [x] 2.1 Write 2-8 focused tests for version resolution
    - Limit to 2-8 highly focused tests maximum.
    - Cover ONLY: (a) a `${propname}` version resolves via `resolvePropertyRef` against parsed `<properties>`; (b) a versionless `<dependency>` recovers its managed version from `<dependencyManagement>` (and/or parent/Spring-parent version); (c) an unmanaged `${...}` / no-managed-match → **"version-unknown"** (no guessing); (d) an npm dep pins to its EXACT lockfile version when `package-lock.json` present, and an open range / `latest` / dist-tag WITHOUT a lockfile → **"version-unknown"**.
    - Skip exhaustive Maven/npm permutation coverage.
  - [x] 2.2 Maven resolution layered on `mavenPomMetadataParser`
    - Run `parsePomMetadataFromString(pomPath, rawPom)` alongside the resolver output to obtain `parent`, `dependencyManagement`, `properties`, `plugins`.
    - Resolve `${...}` placeholders in declared versions via the EXPORTED `resolvePropertyRef(value, properties)` helper (do not reimplement placeholder logic).
    - Recover BOM/parent-managed versions: when a `DeclaredDependency` has no resolvable `version`, match it (by `groupId:artifactId`) against `dependencyManagement`, and consider the parent/Spring-parent version surfaced by `parent`, to recover the managed version where feasible.
    - Anything still unresolved (unmanaged `${...}`, no matching managed entry) → mark **"version-unknown"**. NO guessing. Log each unresolved coordinate (no silent drop).
  - [x] 2.3 npm resolution with optional lockfile pin
    - If `package-lock.json` is present, pin each dependency to its EXACT installed version from the lockfile.
    - Without a lockfile, keep the verbatim range; open ranges / `latest` / dist-tags with no lockfile → **"version-unknown"**.
    - Log any dependency that degrades to `version-unknown`.
  - [x] 2.4 Define the resolved-version model + first-class "version-unknown"
    - Emit a typed resolved-dependency structure: coordinate/name, resolved version OR an explicit `version-unknown` marker, the source `manifestPath`, and a short evidence string (e.g. `org.springframework.boot:spring-boot-starter-web 3.4.1`) for later `sourceQuote`.
    - `version-unknown` is a first-class value that flows downstream unchanged (so Spec 4 can render "remaining — fix version unknown" and Group 3 can write an editable unknown answer) — never coerce it to a fabricated version.
  - [x] 2.5 Ensure Task Group 2 tests pass IN ISOLATION
    - Run ONLY the 2-8 tests from 2.1: `cd gateway; npx jest <versionResolutionTest> --runTestsByPath`.
    - Do NOT run the whole gateway suite as a gate.
    - After edits: `git diff --stat`; grep the new module for `resolvePropertyRef` usage + the `version-unknown` marker symbol (symbol-survival); confirm `mavenPomMetadataParser.ts` is UNCHANGED (`git diff --stat` shows it untouched); mojibake/NUL scan touched files.

**Acceptance Criteria:**
- The 2-8 tests from 2.1 pass in isolation.
- Maven `${...}` + BOM/parent-managed versions resolved where feasible via the parser's exported seams; resolver + parser files UNMODIFIED.
- npm exact-pins from `package-lock.json` when present; verbatim range otherwise.
- All genuinely-unresolved versions marked first-class **"version-unknown"** (no guessing) and logged.
- A typed resolved-version model (with evidence strings) is produced for Group 3.

---

### Backend — Deterministic Auto-Answer Writer (Gateway)

#### Task Group 3: Manifest auto-answerer (deterministic sibling of the prefill)
**Stack:** gateway (Node/TS, Jest)
**Dependencies:** Task Groups 1-2; Spec 6's dependency matrix + `{framework, version}` model.

- [x] 3.0 Auto-answer the dependency-answerable subset via the captured-decision envelope
  - [x] 3.1 Write 2-8 focused tests for the auto-answerer
    - Limit to 2-8 highly focused tests maximum.
    - Cover ONLY: (a) a resolved framework/library/build-tool/driver coordinate writes a captured-decision row with `answerValue = JSON.stringify({ value, sourceQuote, sourceFile })`, `scopeKind:'architecture'`, `standardsLookupRef:null`, and `createdByTask` = the NEW distinct constant; (b) `sourceFile` = the tagged manifest path and `sourceQuote` = the resolved coordinate/version evidence; (c) a `version-unknown` resolved entry still writes an editable answer (not skipped, not fabricated); (d) on first POST failure remaining writes abort and partial is surfaced (mirror the prefill robustness shape); (e) a non-dependency code (cutover/auth/etc.) is NOT attempted.
    - Skip exhaustive per-code coverage; assert the contract + selection boundary.
  - [x] 3.2 Select the dependency-answerable code subset
    - Select from `questionLibrary.ts` the framework, libraries, build-tool, drivers, and their version codes — the codes a manifest can DETERMINISTICALLY resolve — **as defined by Spec 6's per-question dependency matrix**. Consume that matrix; do not re-derive the classification.
    - Do NOT attempt non-dependency questions (cutover, auth policy, rate limiting, secrets, etc.).
  - [x] 3.3 Map resolved dependencies → captured-decision rows (reuse the envelope verbatim)
    - Build each row with `CreateCapturedDecisionRequestBody` from `targetStateCapturedDecisionsWriter`: `decisionCode`, `scopeKind:'architecture'`, `scopeRefType:null`, `scopeRefId:null`, `answerValue = JSON.stringify({ value, sourceQuote, sourceFile })`, `answerSummary` = the resolved value, `standardsLookupRef:null`, `conversationTurnRef:null`, and `createdByTask` = a NEW constant (e.g. `TARGET_MANIFEST_AUTO_ANSWER_TASK_NAME = 'target-manifest-auto-answer'`).
    - Capture the answer consistent with Spec 6's structured `{framework, version}` selection so ONE resolved chip shows downstream (e.g. `Spring Boot 3.4.1`); a `version-unknown` entry captures the framework/library with an explicit unknown version, editable downstream.
    - `sourceFile` = the tagged manifest path; `sourceQuote` = the resolved coordinate/version evidence string from Group 2.
  - [x] 3.4 Write rows via the existing POST seam (no new endpoint) with prefill-shaped robustness
    - POST each row via `postCapturedDecision(projectId, targetArchitectureId, body)`.
    - Mirror the prefill's robustness shape: on first POST failure, ABORT remaining writes, capture the failed/remaining codes, and surface a partial-success outcome (do not throw through the flow). Use an injectable-deps test seam exactly like `OpenTurnTechStackPrefillDeps`.
    - Use the NEW `createdByTask` so manifest rows are discriminable from tech-stack-prefill (`'tech-stack-md-prefill'`) and user-walked (`'architect-persona-conversation'`) rows.
  - [x] 3.5 Ensure Task Group 3 tests pass IN ISOLATION
    - Run ONLY the 2-8 tests from 3.1: `cd gateway; npx jest <autoAnswererTest> --runTestsByPath`.
    - Do NOT run the whole gateway suite as a gate.
    - After edits: `git diff --stat`; grep the new module for the new task-name constant + `postCapturedDecision` import + the `{ value, sourceQuote, sourceFile }` envelope shape (symbol-survival); confirm `TECH_STACK_PREFILL_TASK_NAME` is NOT reused; mojibake/NUL scan touched files.

**Acceptance Criteria:**
- The 2-8 tests from 3.1 pass in isolation.
- Only the dependency-answerable subset (per Spec 6's matrix) is auto-answered; non-dependency codes untouched.
- Rows written via the EXISTING writer with the proven envelope + a NEW distinct `createdByTask`; no new endpoint.
- `version-unknown` produces a first-class editable answer; nothing fabricated.
- First-POST-failure aborts remaining writes and surfaces partial (prefill-shaped robustness).

---

### Backend — Precedence + Re-upload Iterate Loop (Gateway)

#### Task Group 4: Manual-wins precedence + supersede / preserve / recompute
**Stack:** gateway (Node/TS, Jest)
**Dependencies:** Task Group 3.

- [x] 4.0 Enforce precedence and the re-upload iterate loop over append-only supersession
  - [x] 4.1 Write 2-8 focused tests for precedence + re-upload
    - Limit to 2-8 highly focused tests maximum.
    - Cover ONLY: (a) a manual answer (e.g. `createdByTask = 'architect-persona-conversation'`) for a code is PRESERVED — a manifest upload does NOT overwrite it; (b) re-upload SUPERSEDES the PRIOR manifest-derived row for the same code/module via the append-only convention; (c) after supersession the resolved target-version set RECOMPUTES from latest manifests + surviving manual edits; (d) a `version-unknown` manual override is honored.
    - Skip exhaustive multi-manifest permutations.
  - [x] 4.2 Implement manual-wins precedence
    - Before writing a manifest-derived row, consult the latest captured decisions (reuse `fetchLatestCapturedDecisions` from `targetStateCapturedDecisionsClient`). If the current winning row for a code was MANUALLY set, the manifest must NOT overwrite it (skip the write for that code and log the skip — no silent drop).
    - Manifest-derived rows DO win over older manifest-derived rows for the same code/module (that is the re-upload supersede path).
  - [x] 4.3 Implement re-upload supersede + preserve via the append-only convention
    - Re-upload SUPERSEDES prior manifest-derived rows for the affected module/service using the EXISTING append-only supersession in `target_state_captured_decisions` (AMS sets `supersededById` on the prior row inside its transaction — POST a new row; do not PATCH/DELETE).
    - Manual edits are PRESERVED (guaranteed by 4.2's precedence check).
  - [x] 4.4 Recompute the resolved target-version delta
    - After a (re-)upload, RECOMPUTE the resolved target-version set so it reflects the latest manifests + surviving manual edits. Expose this recomputed set as the STRUCTURED target-version source (Group 6 hand-off), with `version-unknown` entries passing through unchanged.
  - [x] 4.5 Ensure Task Group 4 tests pass IN ISOLATION
    - Run ONLY the 2-8 tests from 4.1: `cd gateway; npx jest <precedenceReuploadTest> --runTestsByPath`.
    - Do NOT run the whole gateway suite as a gate.
    - After edits: `git diff --stat`; grep for the precedence-check + `fetchLatestCapturedDecisions` usage (symbol-survival); confirm no PATCH/DELETE path was introduced (POST-only supersession); mojibake/NUL scan touched files.

**Acceptance Criteria:**
- The 2-8 tests from 4.1 pass in isolation.
- Manual answers ALWAYS win; a manifest never overwrites a manually-set row (skips are logged).
- Re-upload supersedes prior manifest-derived rows via the existing append-only convention (POST-only; no new endpoint, no PATCH/DELETE).
- The resolved target-version set recomputes after each (re-)upload; `version-unknown` passes through.

---

### Frontend — Upload UX + Provenance + Editability

#### Task Group 5: Manifest-upload UI, provenance display, inline edit, version-unknown affordance
**Stack:** frontend (React/TS, Vitest + scoped tsc)
**Dependencies:** Task Groups 1-4 (route + write behaviors).

- [x] 5.0 Build the manifest-upload surface in target-state authoring
  - [x] 5.1 Write 2-8 focused tests for the upload UI
    - Limit to 2-8 highly focused tests maximum (Vitest).
    - Cover ONLY: (a) selecting a `pom.xml`/`package.json` (+ optional `package-lock.json`) requires a target module/service tag before submit; (b) the uploaded-manifests list renders each manifest with its tag + parse status; (c) an auto-answered decision renders its SOURCE PROVENANCE (manifest file + coordinate) and is editable inline; (d) a `version-unknown` answer renders a clear affordance and accepts a manually-supplied exact version.
    - Skip exhaustive interaction/animation coverage.
  - [x] 5.2 Add the manifest-upload control
    - Lives in the existing target-state authoring surface (alongside `ArchitectConversationTab.tsx`). Accept `pom.xml`/`package.json` (+ optional `package-lock.json`); REQUIRE a target module/service tag per manifest before submit; surface server-reported dropped/unparsed files (do not hide them).
  - [x] 5.3 List uploaded manifests with tag + parse status
    - Show each uploaded manifest with its module/service tag and parse/resolution status (parsed, partially resolved, dropped-with-reason).
  - [x] 5.4 Surface auto-answered decisions with provenance + inline edit
    - Render each manifest-derived answer with its source provenance (which manifest file + coordinate, vs. manually entered) — model the provenance banner on `TechStackPrefillBanner.tsx`. Every value is EDITABLE inline; a manual edit must win (it is written as a manual answer, which Group 4 precedence preserves).
    - Render `version-unknown` as a first-class, editable affordance (the user can supply the exact version manually).
  - [x] 5.5 Wire the UI to the Group 1-4 endpoints
    - Upload to the Group 1 route; reflect Group 3 auto-answers + Group 4 precedence/recompute outcomes (including partial-success from a first-POST failure).
  - [x] 5.6 Ensure Task Group 5 tests pass IN ISOLATION
    - Run ONLY the 2-8 tests from 5.1: `cd frontend; npx vitest run <uploadUiTest>`.
    - Scoped type-check the touched `.tsx`/`.ts` files ONLY (per Build & Verification Standards) — judge ONLY errors originating in the touched files; the whole-repo frontend baseline is RED and is NOT a gate.
    - After edits: `git diff --stat`; grep touched components for the new component/handler symbols + the provenance/version-unknown render paths (symbol-survival); mojibake/NUL scan touched files.

**Acceptance Criteria:**
- The 2-8 tests from 5.1 pass in isolation (Vitest) and touched files type-check cleanly in isolation.
- Upload requires a per-manifest module/service tag; uploaded manifests list shows tag + parse status; dropped files are visible (not hidden).
- Auto-answers render with source provenance and are editable inline (manual edit wins).
- `version-unknown` is a clear, editable affordance.

---

### Hand-offs + Test Review

#### Task Group 6: Spec 4 / Spec 5 hand-offs + test gap analysis
**Stack:** gateway (Node/TS, Jest) + cross-cutting
**Dependencies:** Task Groups 1-5.

- [x] 6.0 Expose the structured hand-offs and fill critical test gaps only
  - [x] 6.1 Expose the resolved target versions as Spec 4's structured target-version source
    - Surface the recomputed resolved-version set (from Group 4) as the STRUCTURED target-version source Spec 4 consumes for reduction/steering, ALONGSIDE manual `{framework, version}` answers; `version-unknown` entries pass through so Spec 4 can show "remaining — fix version unknown". This spec does NOT compute the CVE delta and makes NO steering UI.
  - [x] 6.2 Expose the confirmed per-module/service-tagged manifest as Spec 5's source
    - Make the confirmed manifest (per-module/service tagged) the source Spec 5 consumes for the write-this-exact-file codebase artifact. This spec does NOT write the codebase artifact and makes NO IVS change (zero `implement-verify-service` edits).
  - [x] 6.3 Review tests from Task Groups 1-5
    - Review the 2-8 tests from each of 1.1, 2.1, 3.1, 4.1 (gateway) and 5.1 (frontend) — roughly 10-40 existing tests.
  - [x] 6.4 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows lacking coverage: upload → parse → resolve → auto-answer → re-upload supersede-but-preserve-manual → recompute. Focus ONLY on this spec's requirements; do NOT assess whole-application coverage.
  - [x] 6.5 Write up to 10 additional strategic tests maximum
    - Add at most 10 new tests to fill identified CRITICAL gaps (favor the end-to-end iterate-loop workflow + the hand-off shapes in 6.1/6.2). Do NOT write comprehensive coverage; skip edge/perf/a11y unless business-critical. Log-on-drop assertions count as in-scope.
  - [x] 6.6 Run feature-specific tests ONLY, in isolation
    - Gateway: `cd gateway; npx jest <each feature test path> --runTestsByPath`. Frontend: `cd frontend; npx vitest run <each feature test path>`.
    - Expected total ~20-50 tests. Do NOT run any whole-repo suite, lint, or whole-repo `tsc` as a gate (frontend baseline is RED).
    - After edits: `git diff --stat`; symbol-survival greps on touched files; mojibake/NUL scan; confirm `implement-verify-service` and the discovery resolvers/parser remain UNCHANGED (`git diff --stat`).

**Acceptance Criteria:**
- Resolved target versions exposed as Spec 4's structured source (with `version-unknown` passthrough); confirmed tagged manifest exposed as Spec 5's source.
- NO CVE-delta computation, NO steering UI, NO codebase-artifact write, NO IVS change in this spec.
- All feature-specific tests pass in isolation (~20-50 total); no more than 10 added in 6.5.
- Testing focused exclusively on this spec's requirements; never gated on whole-repo green.

---

## Execution Order

Recommended implementation sequence (dependency-ordered):
1. Task Group 1 — Manifest upload route, tagging, resolver-backed parsing (gateway).
2. Task Group 2 — Layered version resolution + "version-unknown" (gateway).
3. Task Group 3 — Deterministic auto-answer writer (gateway).
4. Task Group 4 — Manual-wins precedence + re-upload supersede/preserve/recompute (gateway).
5. Task Group 5 — Upload UX + provenance + editability + version-unknown affordance (frontend).
6. Task Group 6 — Spec 4 / Spec 5 hand-offs + test gap analysis.

> Reminder: Spec 6 is a hard PREREQUISITE (its `{framework, version}` model + per-question dependency matrix). Every group ends with an ISOLATION verification; the whole-repo frontend baseline is RED and must NEVER be a gate. Do NOT modify the discovery resolvers, `mavenPomMetadataParser`, the captured-decision endpoint, or `implement-verify-service`.
