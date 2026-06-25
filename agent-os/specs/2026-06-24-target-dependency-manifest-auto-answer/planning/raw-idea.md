# Raw Idea: Target Dependency-Manifest Upload + Auto-Answer

## IMPORTANT: Locked Requirements Pointer

**The FULL LOCKED requirements for this spec live in:**

`agent-os/planning/2026-06-24-vuln-target-state-6-spec-decisions.md`

Specifically the **"Spec 3" section** plus the shared sections:
- "Existing-code anchors"
- "Cross-cutting decisions"
- "Build-safety guidance"

The shaping phase MUST use those sections verbatim and MUST NOT re-ask the user. All decisions are already made. This pointer must be consulted before any requirements or shaping work begins.

---

## Spec Title

Target dependency-manifest upload + auto-answer

## Raw Idea

Let the user upload a TARGET dependency manifest (pom.xml + package.json only — no Gradle in v1) during target-state authoring; it auto-answers the dependency-related subset of the architect-conversation decisions. Reuse the discovery Maven/npm resolvers + mavenPomMetadataParser, and the proven tech-stack-prefill {value,sourceQuote,sourceFile} envelope to write captured-decision rows. Version resolution: resolve Maven parent/BOM-managed versions where feasible + accept an optional package-lock.json for exact npm versions; mark anything unresolved as "version-unknown" so steering degrades gracefully. Allow MULTIPLE manifests, each tagged to its target module/service. Manual answers always win; everything editable with source provenance. Re-upload supersedes manifest-derived answers, preserves manual edits, and recomputes the delta (the iterate loop). The manifest's resolved versions become the structured target-version source for the reduction (Spec 4). Depends on Spec 6's constrained/versioned conversation model.

## Dependencies

- Spec 6: constrained/versioned conversation model (this spec depends on it)
- Spec 4: reduction — this spec's resolved versions become the structured target-version source

## Key Design Points

- Supported manifest types (v1): pom.xml and package.json only; no Gradle in v1
- Optional: package-lock.json for exact npm versions
- Multiple manifests allowed, each tagged to its target module/service
- Reuse existing discovery Maven/npm resolvers and mavenPomMetadataParser
- Reuse proven tech-stack-prefill `{value, sourceQuote, sourceFile}` envelope for captured-decision rows
- Maven parent/BOM-managed version resolution where feasible
- Unresolved versions marked as "version-unknown" for graceful degradation
- Manual answers always win over manifest-derived answers
- Everything editable with source provenance
- Re-upload supersedes manifest-derived answers, preserves manual edits, recomputes delta (iterate loop)
