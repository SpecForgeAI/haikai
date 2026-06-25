# Raw Idea: Target-conversation tech-stack constraints + versioned selection

## IMPORTANT: Locked Requirements Pointer

**The FULL LOCKED requirements for this spec live in:**
`agent-os/planning/2026-06-24-vuln-target-state-6-spec-decisions.md`

The shaping phase MUST use the "Spec 6" section plus the shared "Existing-code anchors", "Cross-cutting decisions", and "Build-safety guidance" sections verbatim. The shaping phase MUST NOT re-ask the user — all decisions are already made. This pointer must be respected by any agent working on requirements or implementation.

---

## Spec Title

Target-conversation tech-stack constraints + versioned selection

## Raw Idea

Overhaul the target-state architect conversation so downstream choices are constrained by earlier answers and framework+version selection doesn't explode into chips. Deliverable: a per-question dependency matrix over the 51 questions classifying each as hard-dependent on the foundational answer / independent / grey. service.language is the PRIMARY brancher (Java/Kotlin vs Node/TS vs Python...); build tool + runtime refine — multiple deterministic branch-lists keyed on the foundational answer (e.g. Java 21 => only JVM frameworks offered, never FastAPI/NestJS). Grey-area questions handled by deterministic compatibility matrix for clear-cut cases + LLM-judge for the grey (code pre-filter + LLM). Hide incompatible choices + an "Other (advanced)" escape hatch; skip moot questions. DECOUPLE the version axis from framework: framework = constrained single-select chips; version = its own dedicated control (dropdown/typeahead scoped to the chosen framework, recommended default, free-text exact), captured as structured {framework, version}, shown as ONE resolved chip. Version source = free-text + recommended default + optional registry/OSV enrichment (non-blocking, same proxy caveat). This version control is the surface where Spec 4 vulnerability steering lives.
