**Feature name (slug suggestion):** tech-hints-llm-resolution

**Raw idea / description from user:**

LLM-assisted tech hints resolution for service entities. Currently the service row has a free-text `core_tech` field and separate `repo_url`/`repo_subfolder` fields. The discovery pipeline depends on parseCoretech heuristically splitting `core_tech` on commas to derive a language pack + framework pack — this is fragile (e.g., "Java 21 (Spring Boot 3)" fails to parse and silently forces tier C / LLM-only mode).

Goal: make language-pack + framework-pack resolution a first-class, LLM-assisted, save-time operation on the service row, stored in structured columns.

Key design decisions already agreed with user in this session:
1. Reorder the service-entry inline row so Repo URL + Subfolder come BEFORE the free-text tech_hints field, so that by the time tech_hints blurs, the repo fields are available for cross-check.
2. Single LLM call fires on tech_hints blur. If repo fields are populated, include a small repo snapshot (top-level files like pom.xml/build.gradle/package.json/requirements.txt + first N lines) in the call. If not, LLM does best-effort tech-only resolution.
3. LLM picks from the closed set of registered language packs and framework packs (no free-form invention). Returns: `{ language: {name, version} | null, frameworks: [{name, version}], languagePack: string | null, frameworkPacks: string[], confirmationSentence: string (human-friendly), repoCrossCheck: {status: 'confirmed'|'conflict'|'partial', note} | null, confidence: 'high'|'low'|'none'|'tech-only' }`.
4. Inline preview under tech_hints shows chips + the confirmationSentence so user sees the LLM interpretation and can accept or retype.
5. On conflict between stated tech and repo contents, WARN but do not block save — user may know better than LLM.
6. New columns on services: `core_tech` (raw, unchanged), `core_tech_resolved` (JSON), `core_tech_language_pack`, `core_tech_framework_packs` (array), `core_tech_resolution_confidence`, `core_tech_resolved_at`.
7. Editing either tech_hints OR repo fields marks resolution stale; re-fire on next blur OR on Save. A tech-only resolution (no repo) always re-resolves when repo is later added.
8. Endpoint lives in discovery-service (repo-reading capability already there): POST /discovery/tech-hints/resolve with {freeText, repoUrl?, repoSubfolder?}. Model-service calls it during save.
9. Discovery run tier gate reads `core_tech_resolved` directly — no more parseCoretech inference at run-time. Deterministic.
10. Discovery run remains blocked when repo is absent — natural invariant ensuring any actual run has seen both inputs at least once.

Save button is currently the old-school top-left Product → Save (one big save). LLM call on blur produces a preview; Save click re-resolves synchronously if field differs from last-resolved value.

In scope: service-scoped discovery runs (the parseCoretech path). Project-level discovery config's techHints is out of scope for now.
