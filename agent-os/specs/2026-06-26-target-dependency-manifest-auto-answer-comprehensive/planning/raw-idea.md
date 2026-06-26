Feature: Make the target dependency-manifest (pom.xml / package.json) upload auto-answer COMPREHENSIVE, and add Tier-2 "free facts". Spec 2 of a 3-spec initiative; DEPENDS ON Spec 1 (2026-06-26-target-conversation-versioned-answer-bare-stem-ux), which makes the answer format bare-stem `{framework, version}` and fixes the cascade engine + resolved-label rendering. STOP at the shaped spec (shape→build pause).

== THE TWO PROBLEMS ==
Problem 1 (too basic): today's auto-answer is a ~15-rule hardcoded coordinate dictionary (`gateway/src/services/targetManifest/manifestCodeMapping.ts`) covering only 4 codes (service.framework, db.driver, ui.framework, build.tool). It NEVER reads pom `<properties>` (so `<java.version>21</java.version>` is missed → service.language unanswered) and can't scale to the long tail (Spring AI / Spring Cloud / MCP ignored).
Problem 2 (Tier-2 "free facts"): for the lower-level things a manifest declares that fall OUTSIDE the 51 questions (e.g. `io.modelcontextprotocol.sdk` → "MCP SDK", `spring-ai-openai` → "Spring AI / LLM client"), show a sensible LLM-named, CONFIRMED-BY-DEFAULT informational list — NOT new questions.

== THE EXISTING PIPELINE (gateway/src/services/targetManifest/) ==
parseUploadedManifest (parsedManifestModel.ts) → resolveManifestVersions (manifestVersionResolution.ts — it ALREADY parses `<properties>`/`<plugins>` via mavenPomMetadata.ts but DISCARDS them on ResolvedManifest; that discard is the structural root cause of the missed java.version) → deriveManifestAnswerCandidates (manifestAutoAnswerer.ts) → filterCandidatesByPrecedence (manifestPrecedence.ts, manual-wins) → runManifestAutoAnswer (writes captured-decision rows via the SAME `{value, sourceQuote, sourceFile}` envelope, createdByTask='target-manifest-auto-answer') → recomputeResolvedTargetVersions. Upload route: `gateway/src/routes/targetManifestUpload.ts` (POST .../target-manifests). Frontend: `frontend/src/components/targetState/architectConversation/ManifestUploadPanel.tsx`. Gateway tests are JEST.

== THE BUILD (agreed: deterministic-first + LLM-augment) ==
A. Carry pom metadata (properties + plugins) through onto ResolvedManifest (today discarded) so derivation can see `<java.version>` etc.
B. EXPAND the witness registry to a union answer shape: coordinate → `{kind:'framework-version', framework: BARE STEM}` (the 7 versioned codes; version from the resolved dep) OR `{kind:'single-choice', value: EXACT questionLibrary choice}` (the non-versioned codes). Cover the manifest-witnessable codes with STRONG single-coordinate witnesses only (logging/metrics/tracing/validation/migrations/connectionPool/testing.*/ui.buildTool-stateManagement-designSystem-testing/asyncBus/discovery/mapping). Principle (agreed): cover the CLOSED choice set per code (not "top-N popular libraries"); leave ambiguous/combo codes to the LLM. Emit BARE STEMS (aligned with Spec 1).
C. Property extractor: `<java.version>` / maven.compiler.release / kotlin.version → service.language. Plugin extractor: flyway/liquibase maven-plugin → db.migrations.
D. Inference, flagged "inferred → confirm": db.driver → db.engine (family only, so version-unknown — a driver doesn't reveal the server version); service.language → service.runtime (reuse the Spec-1 cascade seed).
E. ONE cheap LLM gap-fill call — mirror `gateway/src/services/architectConversation/prefillFromTechStack.ts` (inject `ArchitectLlmClient.callSingleShot`, fail-open, JSON-defensive parse, CACHE by manifest content hash). It does BOTH: (a) proposes answers to the 51 for deps the deterministic registry missed — DETERMINISTIC ALWAYS WINS, the LLM never overrides a deterministic hit; and (b) names Tier-2 "free facts" for deps outside the 51. REFINED DECISION: the LLM is NOT confined out of the 51 (confining it forces a double-confirm + conflict risk). Net rule: each of the 51 ends with EXACTLY ONE pre-filled answer (deterministic / inferred / LLM / manifest), the user confirms it ONCE, edits are manual-wins supersede, and every pre-filled answer shows PROVENANCE ("from org.postgresql:postgresql" / "inferred from driver" / "LLM-suggested").
F. SURFACE Tier-2 facts + the source-dependency provenance + the "inferred" badge in the upload response slice + ManifestUploadPanel (Tier-2 = informational, editable/removable, never forced questions).
Guard-rails: deterministic facts never overridden by the LLM; one LLM call per upload, cached; never auto-answer the not-manifest codes (cutover.*, api.auth, secrets.management, service.processModel, logging.format, container.*, ci.pipeline, deployment.*, etc.).

== DEPENDS ON Spec 1 ==
The manifest emits BARE STEMS + a resolved version, which now lines up with Spec 1's bare-stem chips. The doubled build.tool envelope is fixed in Spec 1; here the manifest emits {framework:'Maven', version:'3.9'}. Manifest answers flow through the captured-decision envelope and (post-Spec-1) display as resolved labels.

== OUT OF SCOPE ==
- The version-decoupling UX + cascade engine fix (Spec 1).
- The decisions-file import (Spec 3). NOTE: the manifest upload box's MUTUAL EXCLUSIVITY with the Spec 3 "Manually Answer Target State" box (upload one → the other disables w/ hover tooltip) is implemented in Spec 3.

== CONSTRAINTS ==
- Gateway tests use Jest; frontend uses Vitest; frontend whole-repo baseline is pre-existingly RED → verify in ISOLATION.
- Keep the existing capture envelope + POST path; no new AMS DTO for the captured answers. (Tier-2 facts may need their own lightweight persistence/return shape — decide in shaping.)
- The EXISTING manifest tests encode the OLD too-basic behaviour (e.g. a Spring+Postgres pom yields exactly build.tool/db.driver/service.framework) and WILL be deliberately updated to the richer output.

== OPEN QUESTIONS FOR SHAPING ==
1. LLM call shape: exact prompt/response contract (propose-51-answers + name-Tier-2 in one JSON call), the manifest-hash cache key + store, and fail-open behaviour when the LLM is unconfigured/down.
2. Deterministic registry breadth confirmation (closed-choice coverage per code; which codes are explicitly left to the LLM).
3. How "inferred → confirm" is represented end-to-end (a field on the candidate + a badge in the UI) and whether inferred/LLM answers are written as captured-decisions immediately (with provenance) or held as proposals.
4. Tier-2 facts: the naming format, where they surface, and whether/how they persist (they are NOT captured-decisions / answers to the 51) — and whether they feed the prompt-ready output / seed-build-files.
5. Provenance display in ManifestUploadPanel (source-dependency badge per answer).
6. Precedence ordering: deterministic > LLM, manual > all (re-upload supersede already exists) — confirm where inferred/LLM sit.

Do NOT proceed to write-spec/build — stop at the shaped spec for review.
