# Specification: Target Dependency-Manifest Upload + Auto-Answer

## Goal
During target-state authoring, let the user upload one or more TARGET dependency manifests (`pom.xml` + `package.json` only — no Gradle in v1) and deterministically auto-answer the dependency-answerable subset of the architect-conversation decisions, resolving target versions where feasible and degrading to "version-unknown" rather than guessing. This is Spec 3 of the 6-spec initiative: it depends on Spec 6's constrained/versioned conversation model, feeds Spec 4 (structured target-version source for CVE reduction) and Spec 5 (confirmed manifest for the codebase artifact).

## User Stories
- As a migration architect, I want to upload the target `pom.xml`/`package.json` for a module so that the framework/library/build-tool/driver decisions (and their versions) are answered for me instead of hand-walking each question.
- As a migration architect, I want every auto-answered value shown with its source manifest + coordinate and fully editable so that I can trust, correct, or override what the manifest inferred — and have my manual edits always win.
- As a migration architect, I want to re-upload a revised manifest and have it supersede the prior manifest-derived answers while preserving my manual edits so that I can iterate the target toward a clean CVE delta.

## Specific Requirements

**Manifest upload scope (v1)**
- Accept `pom.xml` and `package.json` only; an optional `package-lock.json` may accompany a `package.json` to pin exact npm versions.
- **No Gradle parser in v1** — out of scope.
- Allow MULTIPLE manifests per target architecture; reject nothing silently — log any file dropped/unparsed (no silent caps/sampling).
- Each manifest is tagged to a target module/service (the per-module/service mapping that Spec 5 reuses for per-module placement).

**Parsing via the discovery resolvers (reuse, do not reinvent)**
- Maven: parse with `MavenDependencyResolver` to produce `DeclaredDependency` rows (`name = groupId:artifactId`, verbatim `version`/`versionRange`/`scope`, `manifestPath`/`manifestLine`).
- npm: parse with `NpmDependencyResolver` across `dependencies`/`devDependencies`/`peerDependencies`/`optionalDependencies`; versions verbatim (`^1.2.3`, `latest`, etc.).
- **CRITICAL — resolver contract is locked:** the resolvers store versions VERBATIM (including unresolved `${propname}`) and do NO `${...}`/BOM resolution. Do NOT modify the resolvers; layer version resolution on top.

**Maven version resolution (layered on the metadata parser)**
- Run `mavenPomMetadataParser` alongside the resolver to obtain `<parent>`, `<dependencyManagement>`, `<properties>`, `<build><plugins>`.
- Resolve `${...}` placeholders in declared versions via the exported `resolvePropertyRef(value, properties)` helper.
- Resolve BOM/parent-managed versions: when a `<dependency>` has no version, match it against `dependencyManagement` (and the Spring/parent version surfaced by `parent`) to recover the managed version where feasible.
- Anything still unresolved (unmanaged `${...}`, no matching managed entry) → mark **"version-unknown"** (no guessing).

**npm version resolution (optional lockfile pin)**
- If a `package-lock.json` is supplied, pin each dependency to its EXACT installed version from the lockfile.
- Without a lockfile, keep the verbatim range; open ranges / `latest` / dist-tags with no lockfile → **"version-unknown"**.
- `version-unknown` flows through downstream so Spec 4 can show "remaining — fix version unknown" rather than fabricating a version.

**Deterministic auto-answer of the dependency-answerable subset**
- Select the dependency-answerable code subset from `questionLibrary.ts` (framework, libraries, build tool, drivers, and their versions — the codes a manifest can deterministically resolve), defined against Spec 6's per-question dependency matrix.
- Do NOT attempt non-dependency questions (cutover, auth policy, rate limiting, secrets, etc.).
- This module is the **deterministic, rule-based sibling** of the LLM-based `openTurnTechStackPrefill.ts` — same write contract, different derivation.

**Captured-decision write contract (reuse the prefill envelope + writer)**
- Write each auto-answer as a captured-decision row via the existing `targetStateCapturedDecisionsWriter` POST seam — introduce NO new endpoint.
- Use the proven envelope: `answerValue = JSON.stringify({ value, sourceQuote, sourceFile })`, with `scopeKind: 'architecture'` and `standardsLookupRef: null`.
- Use a DISTINCT `createdByTask` (e.g. `'target-manifest-auto-answer'`) so manifest rows are discriminable from tech-stack-prefill (`'tech-stack-md-prefill'`) and user-walked (`'architect-persona-conversation'`) rows.
- `sourceFile` = the tagged manifest path; `sourceQuote` = the resolved coordinate/version evidence (e.g. `org.springframework.boot:spring-boot-starter-web 3.4.1`).
- Capture answers consistent with Spec 6's structured `{framework, version}` selection model so one resolved chip shows downstream.

**Precedence, editability, and provenance**
- **Manual answer ALWAYS wins** over a manifest-derived answer for the same decision code.
- Every value is editable and rendered with its source provenance (which manifest file + coordinate, vs. manually entered) so the user can see exactly where each answer came from.
- `version-unknown` answers are first-class and editable (the user can supply the exact version manually).

**Re-upload supersede / preserve / recompute (the iterate loop)**
- Re-upload SUPERSEDES the prior manifest-derived rows for the affected module/service via the existing append-only supersession convention in `target_state_captured_decisions`.
- Manual edits are PRESERVED — a new manifest must not overwrite a manually-set row.
- After supersession, RECOMPUTE the delta so the resolved target-version set reflects the latest manifests + surviving manual edits.

**Hand-offs to Spec 4 and Spec 5**
- Expose the resolved target versions as the STRUCTURED target-version source consumed by Spec 4 (reduction/steering), alongside manual `{framework, version}` answers; `version-unknown` entries pass through.
- The confirmed manifest (per-module/service tagged) is the source consumed by Spec 5 (write-this-exact-file codebase artifact); this spec does NOT write the codebase artifact and makes NO IVS change.

## Visual Design
No visual assets were provided (the `planning/visuals/` folder is absent). The upload UX lives in the existing target-state authoring surface: a manifest-upload control that (1) accepts `pom.xml`/`package.json` (+ optional `package-lock.json`), (2) requires a target module/service tag per manifest, (3) lists uploaded manifests with their tag and parse status, and (4) surfaces auto-answered decisions with source provenance and inline edit, including a clear "version-unknown" affordance.

## Existing Code to Leverage

**`gateway/src/services/architectConversation/openTurnTechStackPrefill.ts` (+ `__tests__/openTurnTechStackPrefill.test.ts`)**
- The proven pattern for deriving decision codes from a source and writing captured-decision rows; model the manifest auto-answerer directly on it as its deterministic sibling.
- Reuse its exact write contract: `answerValue = JSON.stringify({ value, sourceQuote, sourceFile })`, `scopeKind: 'architecture'`, `scopeRefType/scopeRefId/conversationTurnRef: null`, `standardsLookupRef: null`.
- Replicate its `createdByTask` discriminator approach, but with a NEW task constant (e.g. `'target-manifest-auto-answer'`) — do not reuse `TECH_STACK_PREFILL_TASK_NAME`.
- Mirror its injectable-deps test seam and its "abort remaining writes on first POST failure, surface partial" robustness shape.

**`targetStateCapturedDecisionsWriter` (`postCapturedDecision` / `CreateCapturedDecisionRequestBody`)**
- The existing captured-decision POST seam imported by the prefill module; reuse verbatim, introduce no new endpoint.
- Append-only supersession into `target_state_captured_decisions` is the mechanism for the re-upload supersede-but-preserve-manual behaviour.

**`discovery-service/.../maven/MavenDependencyResolver.ts` + `maven/mavenPomMetadataParser.ts` (+ its `__tests__`)**
- `MavenDependencyResolver` emits `DeclaredDependency` with VERBATIM versions and does no `${...}`/BOM resolution — consume as-is, do not fork or modify.
- `mavenPomMetadataParser` exposes `PomMetadata` (`properties`, `parent`, `dependencyManagement`, `plugins`) and the exported `resolvePropertyRef(value, properties)` — this is the seam that makes parent/BOM/property resolution possible. The parser explicitly keeps `dependencyManagement` separate (not merged into resolved deps), which is what enables managed-version recovery here.

**`discovery-service/.../npm/NpmDependencyResolver.ts`**
- Emits `DeclaredDependency` across all four dependency groups with verbatim ranges. Reuse as-is; the optional `package-lock.json` exact-pin step is layered additively on top of its output.

**`gateway/src/config/architect-conversation/questionLibrary.ts`**
- The 51-question / groups A–J source from which the dependency-answerable code subset is selected; the subset is defined against Spec 6's per-question dependency matrix.

## Out of Scope
- Gradle manifest parsing (no Gradle in v1).
- Guessing, inferring, or fabricating any unresolved version (must mark "version-unknown" instead).
- Changing the discovery resolvers' or `mavenPomMetadataParser`'s locked output contracts (consume only).
- Computing the CVE eliminated/remaining/newly-introduced delta (Spec 4).
- Steering UI, "use this version" control, or hard-gating criticals (Spec 4 / Spec 6).
- External version-registry / OSV enrichment of versions (Spec 6 / Spec 4); this spec must not gate on it.
- Writing dependency declarations into the target codebase or any IVS change / "seed files" mechanism (Spec 5).
- The conversation constraint/branching + versioned-selection layer itself (Spec 6).
- Introducing a new captured-decision endpoint (reuse the existing writer).
- Auto-answering non-dependency decisions (cutover, auth policy, rate limiting, secrets, etc.).
