# Spec Requirements: Target Dependency-Manifest Upload + Auto-Answer

## Initial Description

Let the user upload a TARGET dependency manifest (pom.xml + package.json only — no Gradle in v1) during target-state authoring; it auto-answers the dependency-related subset of the architect-conversation decisions. Reuse the discovery Maven/npm resolvers + `mavenPomMetadataParser`, and the proven tech-stack-prefill `{value, sourceQuote, sourceFile}` envelope to write captured-decision rows. Version resolution: resolve Maven parent/BOM-managed versions where feasible + accept an optional `package-lock.json` for exact npm versions; mark anything unresolved as "version-unknown" so steering degrades gracefully. Allow MULTIPLE manifests, each tagged to its target module/service. Manual answers always win; everything editable with source provenance. Re-upload supersedes manifest-derived answers, preserves manual edits, and recomputes the delta (the iterate loop). The manifest's resolved versions become the structured target-version source for the reduction (Spec 4). Depends on Spec 6's constrained/versioned conversation model.

> This is **Spec 3** of the 6-spec "CVE Reduction Across Current→Target Migration + Target-State Conversation Overhaul" initiative. Requirements are LOCKED in `agent-os/planning/2026-06-24-vuln-target-state-6-spec-decisions.md` (Spec 3 section + shared Existing-code anchors / Cross-cutting decisions / Build-safety guidance). No discovery was performed; this document transcribes the locked decisions and grounds them in the verified reuse anchors.

## Requirements Discussion

Requirements were pre-decided in the locked decisions document. No clarifying questions were posed to the user. The questions below restate the LOCKED decisions as Q/A for traceability.

### First Round Questions

**Q1:** Which manifest formats are in scope for v1?
**Answer:** `pom.xml` and `package.json` only. **No Gradle parser in v1** (out of scope). Optionally an accompanying `package-lock.json` may be supplied to pin exact npm versions.

**Q2:** How are dependencies parsed?
**Answer:** Reuse the existing discovery resolvers — do not reinvent. Maven: `MavenDependencyResolver` + `mavenPomMetadataParser`. npm: `NpmDependencyResolver`. These already produce the `DeclaredDependency` shape (`name = group:artifact` for Maven / full pkg name for npm; verbatim `version` / `versionRange` / `scope`; `manifestPath` / `manifestLine`).

**Q3:** What subset of the 51 architect-conversation decisions does the manifest auto-answer?
**Answer:** The **dependency-answerable subset** of the `questionLibrary.ts` decision codes (framework, libraries, build tool, drivers, and their versions — the codes a dependency manifest can deterministically resolve). It does NOT attempt non-dependency questions (cutover, auth policy, rate limiting, secrets, etc.).

**Q4:** How are auto-answers written into the conversation?
**Answer:** As captured-decision rows, using the **proven tech-stack-prefill envelope**: `answer_value = JSON.stringify({ value, sourceQuote, sourceFile })`, written via the existing captured-decision POST path. The manifest auto-answerer is the **deterministic sibling** of `openTurnTechStackPrefill.ts` (which is LLM-based); this one is rule-based off the parsed manifest.

**Q5:** How are versions resolved?
**Answer:** Resolve Maven **parent/BOM-managed** versions where feasible (using `mavenPomMetadataParser`'s `<parent>` / `<dependencyManagement>` / `<properties>` + `resolvePropertyRef` for `${...}` placeholders). Accept the optional `package-lock.json` for **exact** npm versions. Anything still unresolved (unmanaged `${...}`, open ranges with no lockfile, `latest`/tag specifiers) is marked **"version-unknown"** — **no guessing** — so downstream steering degrades gracefully.

**Q6:** Can the user upload more than one manifest?
**Answer:** Yes. **Multiple manifests** are allowed; **each is tagged to its target module/service** (the per-module/service mapping that Spec 5 also consumes for per-module placement).

**Q7:** What is the precedence between manifest-derived answers and manual answers?
**Answer:** **Manual answer always wins.** Everything is **editable**, and every value is shown with its **source provenance** (manifest file + quote, vs. manually entered).

**Q8:** What happens on re-upload (the iterate loop)?
**Answer:** Re-upload **supersedes the manifest-derived answers, preserves manual edits, and recomputes the delta**. (Append-only supersession is the existing `target_state_captured_decisions` convention; manual rows are not overwritten by a new manifest.)

**Q9:** How does this feed Spec 4?
**Answer:** The manifest's **resolved versions become the structured target-version source** for Spec 4's reduction/steering (alongside manual `{framework, version}` answers). "version-unknown" entries flow through so Spec 4 can show "remaining — fix version unknown" rather than fabricating a version.

**Q10 (exclusions):** What is explicitly out of scope?
**Answer:** Gradle parsing; guessing/fabricating unresolved versions; changing the discovery resolvers' locked output contract; any IVS change (that is Spec 5); writing the codebase artifact (Spec 5); computing the CVE delta itself (Spec 4); the conversation constraint/branching layer (Spec 6).

### Existing Code to Reference

**Similar Features Identified (verified to exist on disk):**

- **Deterministic-sibling seam (primary model):** `gateway/src/services/architectConversation/openTurnTechStackPrefill.ts` — the proven pattern for extracting decision codes from a source and writing captured-decision rows. Confirmed it writes `answerValue: JSON.stringify({ value, sourceQuote, sourceFile })`, `scopeKind: 'architecture'`, `standardsLookupRef: null`, and a distinguishing `createdByTask` (it uses `'tech-stack-md-prefill'`; the manifest auto-answerer should use its own distinct task name, e.g. `'target-manifest-auto-answer'`, so manifest rows are discriminable from tech-stack-prefill and user-walked rows). Test: `gateway/src/services/architectConversation/__tests__/openTurnTechStackPrefill.test.ts`.
- **Captured-decision writer:** `targetStateCapturedDecisionsWriter` (imported by the prefill module as `postCapturedDecision` / `CreateCapturedDecisionRequestBody`) — the existing POST seam for captured-decision rows; reuse rather than introduce a new endpoint.
- **Maven resolver:** `discovery-service/src/services/dependencyResolvers/maven/MavenDependencyResolver.ts` — emits `DeclaredDependency` (`name = groupId:artifactId`, verbatim `version` **including unresolved `${propname}`**, `versionRange` for `[a,b)`, `scope`). NOTE: the resolver itself does **no** property resolution; that is what the metadata parser adds.
- **Maven metadata parser:** `discovery-service/src/services/dependencyResolvers/maven/mavenPomMetadataParser.ts` — exposes `<parent>`, `<dependencyManagement>`, `<properties>`, `<build><plugins>`, plus the exported `resolvePropertyRef(value, properties)` helper. This is the seam that makes "resolve parent/BOM-managed versions where feasible" possible. Test: `.../__tests__/mavenPomMetadataParser.test.ts`.
- **npm resolver:** `discovery-service/src/services/dependencyResolvers/npm/NpmDependencyResolver.ts` — emits `DeclaredDependency` across `dependencies`/`devDependencies`/`peerDependencies`/`optionalDependencies`; versions verbatim (`^1.2.3`, `latest`, etc.). `package-lock.json` reading is the additive pin step layered on top.
- **Question library:** `gateway/src/config/architect-conversation/questionLibrary.ts` — the 51-question / groups A–J source from which the dependency-answerable code subset is selected.
- **Persistence target:** `target_state_captured_decisions` (`answer_value TEXT`, append-only supersession, `{value,sourceQuote,sourceFile}` envelope) in AMS.

### Follow-up Questions

None. Requirements are fully specified by the locked decisions document; no follow-ups were required.

## Visual Assets

### Files Provided:

No visual assets provided. (Mandatory check ran against `agent-os/specs/2026-06-24-target-dependency-manifest-auto-answer/planning/visuals/` — folder absent / no image files.)

### Visual Insights:

None.

## Requirements Summary

### Functional Requirements

- During target-state authoring, the user can **upload one or more target dependency manifests** (`pom.xml` and/or `package.json`), optionally accompanied by `package-lock.json` for exact npm versions.
- **Each manifest is tagged to a target module/service** (per-module/service mapping, shared with Spec 5).
- The manifests are **parsed via the existing discovery resolvers** (`MavenDependencyResolver` + `mavenPomMetadataParser`, `NpmDependencyResolver`) — no new parser.
- **Version resolution:** resolve Maven parent/BOM-managed + `${...}` property versions where feasible; pin exact npm versions from `package-lock.json` when present; mark everything else **"version-unknown"** (no guessing).
- The **dependency-answerable subset** of the architect-conversation decision codes is **auto-answered deterministically** from the parsed manifests, written as captured-decision rows using the `{value, sourceQuote, sourceFile}` envelope and a distinct `createdByTask`.
- Every auto-answered value is **editable** and shown with **source provenance** (which manifest file / coordinate it came from).
- **Manual answers always win** over manifest-derived answers.
- **Re-upload** supersedes manifest-derived answers, **preserves manual edits**, and **recomputes the delta** (iterate loop).
- The resolved target versions are exposed as the **structured target-version source** consumed by Spec 4 (reduction/steering); the confirmed manifest is consumed by Spec 5 (codebase artifact).

### Reusability Opportunities

- Model the auto-answerer directly on `openTurnTechStackPrefill.ts` (its deterministic sibling) — same captured-decision write contract, distinct task name.
- Reuse `targetStateCapturedDecisionsWriter` POST seam; introduce **no new captured-decision endpoint**.
- Reuse the discovery resolvers and `mavenPomMetadataParser` (incl. `resolvePropertyRef`) verbatim; do not fork or alter their locked output contracts.
- Reuse the existing append-only supersession convention in `target_state_captured_decisions`.

### Scope Boundaries

**In Scope:**
- `pom.xml` + `package.json` manifest upload (multiple, per-module/service tagged).
- Optional `package-lock.json` for exact npm pins.
- Maven parent/BOM/property version resolution where feasible.
- Deterministic auto-answer of the dependency-answerable decision subset via the prefill envelope.
- "version-unknown" marking for unresolved versions.
- Editability + source provenance; manual-wins precedence; re-upload supersede/preserve/recompute.
- Exposing resolved versions as the structured target-version source for Spec 4 and the confirmed manifest for Spec 5.

**Out of Scope:**
- Gradle manifest parsing (no Gradle in v1).
- Guessing/inferring unresolved versions.
- Changing the discovery resolvers' or metadata parser's locked output contracts.
- Computing the CVE elimination/remaining/newly-introduced delta (Spec 4).
- Steering UI / "use this version" control (Spec 4 / Spec 6).
- Writing the dependency declarations into the target codebase / any IVS change (Spec 5).
- The conversation constraint/branching + versioned-selection layer (Spec 6).

### Technical Considerations

- **Dependency on Spec 6:** consumes Spec 6's constrained/versioned conversation model — answers are captured as structured `{framework, version}` and the dependency-answerable code subset is defined against Spec 6's per-question dependency matrix. Authoring/build order is 1 → 2 → 6 → 3 → 4 → 5, so Spec 6 lands first.
- **Resolver split nuance:** `MavenDependencyResolver` stores versions verbatim (including unresolved `${propname}`) and does NO property resolution; the parent/BOM/property resolution required here is provided by `mavenPomMetadataParser` + `resolvePropertyRef`. Implementation must layer resolution on top, not modify the resolver.
- **Captured-decision write contract:** `scopeKind: 'architecture'`, `standardsLookupRef: null`, `answerValue = JSON.stringify({ value, sourceQuote, sourceFile })`, distinct `createdByTask` (e.g. `'target-manifest-auto-answer'`); reuse `targetStateCapturedDecisionsWriter`.
- **Persistence:** captured decisions live in `target_state_captured_decisions` (AMS). AMS DTOs default to snake_case wire; apply `@CamelCaseWire` only on camelCase consumers (none expected unless a new DTO is added).
- **Cross-cutting:** any external version-registry enrichment stays non-blocking and proxy/CA-aware (that enrichment itself belongs to Spec 6 / Spec 4; this spec must not gate on it). Per cross-cutting rules, **no silent caps/sampling — log anything dropped** when parsing manifests.

### Build-safety guidance (bake into `tasks.md` for unattended overnight `implement-tasks`)

- Whole-repo frontend tsc/lint baseline is **RED** → verify each feature in **ISOLATION** (targeted vitest/jest + scoped tsc on changed files); never gate on whole-repo green.
- Implementer subagents have **Write (not Edit)** → use **anchored/surgical Bash edits**; after each, run `git diff --stat`, symbol-survival greps, and a mojibake/NUL scan on touched files.
- AMS DTOs default to snake_case wire; `@CamelCaseWire` only for camelCase consumers.
- No silent caps/sampling — log anything dropped.
