# Spec Requirements: V3 Tier UX

## Initial Description

Expose the V3 pipeline's tier model (A/B/C) to API consumers and the review UI. Gate Tier C (LLM-only) runs behind an explicit opt-in. Propagate tier-based confidence scores through candidates so reviewers can filter by trust level.

**Context:**
- Spec 1 added internal `computeTier()` logic.
- Spec 2 wired the tiered prompt variants.
- Spec 4 ensured all packs work in A/B/C modes.
- This spec surfaces the tier through the API so callers know what they're getting before paying for an LLM run, and reviewers can filter candidate lists accordingly.

**Original raw idea scope:**
1. `POST /discovery/runs` response enrichment with `mode`, `tier`, `warnings`.
2. Tier C gate (409 + `confirmLlmSolo: true` opt-in).
3. Extend `GET /discovery/packs/applicable` to include `tier` + `warnings`.
4. Confidence propagation on candidates (adapter / gap-fill / ir-guided / solo tiers).
5. Architecture-model-service: persist `mode`, `tier`, `warnings` as columns on `discovery_runs`.
6. Review UI: run-level banner for Tier B/C, confidence filter (default 0.7), tag badges.
7. Documentation updates (`DISCOVERY_SERVICE_EXPLAINER.md`, API docs).

**Out of scope from raw idea:**
- Upgrading Tier C stacks to Tier B by building new language packs.
- Automated tier-based triggers (policy layer).

**Done when:**
- Tier C run against unsupported stack requires explicit `confirmLlmSolo: true`.
- `POST /discovery/runs` response shows tier + mode + warnings for all three tiers.
- Review UI filters candidates by confidence and shows tier banners.
- Database migration applied and verified.
- Documentation updated.

## Requirements Discussion

### First Round Questions

**Q1:** Where should the Tier C gate be enforced? Inside discovery-service's `POST /discovery/runs` route (port 8091), inside architecture-model-service's persistence layer, or in both?
**Answer:** Gate in discovery-service (`POST /discovery/runs` at port 8091). Return 409 BEFORE calling `archModelClient.createDiscoveryRun` when tier would be C and `confirmLlmSolo !== true`. archModelClient is not re-validating — single source of truth at the discovery-service route. This avoids orphaned PENDING run records and keeps the gate close to where tier is computed.

**Q2:** When should tier be computed relative to run creation — before calling archModelClient (so the gate runs first and no row is created on rejection), or after (and rollback on 409)?
**Answer:** Move techHint synthesis to BEFORE run creation. Flow:
1. discovery-service's `POST /discovery/runs` route receives request.
2. If `serviceId` present: fetch service entity via `archModelClient.getService(projectId, serviceId)`, call `parseCoretech(service.core_tech)` to build techHints.
3. If no `serviceId`: fetch project config via `archModelClient.getDiscoveryConfig(projectId)`, use its techHints.
4. `computeTier(techHints)` → `'A' | 'B' | 'C'`.
5. Build warnings array.
6. If tier === 'C' AND !body.confirmLlmSolo → return 409 with `{ error: { code: 'LLM_SOLO_CONFIRMATION_REQUIRED', tier: 'C', mode: 'llm-solo', warnings } }`.
7. Otherwise create run with tier + mode + warnings + confirmed_llm_solo on the entity.
8. `runDiscoveryV3` reuses the already-computed tier (pass through, don't re-compute).

Minor coupling at the route but accurate gating.

**Q3:** Should `confirmLlmSolo` be persisted on the run (so audit logs show "this was an explicit opt-in")?
**Answer:** Persist. Add `confirmed_llm_solo BOOLEAN NOT NULL DEFAULT FALSE` column on `discovery_run`. Liquibase migration number after Spec 1's `083-discovery-run-mode.sql` — likely `084-discovery-run-confirmed-llm-solo.sql`.

**Q4:** Should `warnings` be persisted (as a JSON text column on `discovery_run`), or recomputed on every GET?
**Answer:** Persist. Add `warnings TEXT` column on `discovery_run` storing JSON-encoded `string[]`. (PostgreSQL JSONB would be cleaner but keep TEXT for Liquibase portability — match the project's existing pattern where small arrays live as TEXT JSON.) Migration `085-discovery-run-warnings.sql`. Nullable; empty array `[]` for tier A with no warnings; populated array for tier B/C.

**Q5:** Approve warning copy?
- Tier B: "Discovery will run in language-only mode. No framework-specific adapter matches your service's tech stack. Candidate quality depends on LLM gap-fill."
- Tier C: "Discovery will run in LLM-only mode. No language or framework pack matches. Pass confirmLlmSolo: true to proceed."
- Tier A: no warnings (empty array).

**Answer:** Approved as stated.

**Q6:** Confidence: fixed midpoint per tag, or stochastic (jitter within range)? Where does the confidence value originate (adapter-emitted, LLM-extracted, or service-injected)?
**Answer:** Fixed midpoint per tag, centralized in a single `src/services/confidence.ts` export:
- `'<framework>-adapter'` (any): 0.9
- `'llm-gap-fill'`: 0.75
- `'llm-ir-guided'`: 0.6
- `'llm-solo'`: 0.4
- LLM-emitted explicit `confidence` value (LLM sometimes returns its own confidence in responses): clamp to tag range. Use LLM value if within range, else clamp to midpoint.
- Adapters that already emit an explicit confidence retain it (don't overwrite existing adapter confidence values; only fill in when missing). Most adapters currently emit 0.85–0.95 or similar — leave those alone.
- "Configurable" scope: the midpoints are env-overridable via `CONFIDENCE_<TAG>` env vars (e.g., `CONFIDENCE_LLM_SOLO=0.35`) but default to the above. Document in the explainer.

**Q7:** Retroactive assignment — do existing candidates get confidence backfilled, or only new candidates get the field populated?
**Answer:** New candidates only. Existing rows with NULL confidence are shown by default (UI treats NULL as "unmarked" — neither filtered in nor out at the default threshold; they appear above any threshold gate so reviewers see them). No backfill migration.

**Q8:** UI confidence filter default of 0.7 — is this a hard floor (can't go below) or a slider default?
**Answer:** Default `confidence >= 0.7`. Slider/input lets user drop lower to reveal Tier B (0.6) + Tier C (0.4). Unmarked (NULL) candidates always visible. Slider range 0.0 to 1.0, step 0.05.

**Q9:** Badge colors — introduce new CSS variables, or map to existing warning/success tokens in the frontend design system?
**Answer:** Check `frontend/src/components/DashboardView/DiscoveryRunDetailView.module.css` and `frontend/src/config/gridConfigs.ts` for existing color tokens. Map:
- adapter (green) — existing "success" / "approved" token
- gap-fill (yellow) — existing "warning" token
- ir-guided (orange) — existing "caution" / "attention" token (or introduce one if missing)
- solo (red) — existing "error" / "danger" token

If any of these 4 tokens are missing, introduce a single new CSS variable for the missing one — do NOT introduce all 4 new colors. Maintain visual consistency with the rest of the frontend.

**Q10:** Dedup collision — when a candidate is emitted by both an adapter and LLM gap-fill, who wins on confidence?
**Answer:** Adapter wins. Candidate keeps `_addedBy: '<framework>-adapter'`, confidence = 0.9, badge = green. Current dedup logic unchanged.

**Q11:** Which other endpoints need tier/mode/warnings fields? (GET run detail, GET run list, GET packs applicable, frontend runs list, etc.)
**Answer:**
- `GET /discovery/runs/{runId}` (architecture-model-service port 8080) — return `mode`, `tier`, `warnings`, `confirmedLlmSolo` on DiscoveryRunDto (additive).
- `GET /discovery/runs` (list) — include `mode` + `tier` in each entry (warnings omitted from list for brevity; available on detail).
- `GET /discovery/packs/applicable` (discovery-service) — return `tier` + `warnings` per Q13.
- Frontend runs-list: add a small `tier` column/badge so reviewers can quickly see which runs are Tier B/C before opening the detail.

**Q12:** Does the gate apply equally for project-scoped and service-scoped runs? (Confirming same logic flows through both paths.)
**Answer:** Confirmed. Both paths run `computeTier(techHints)` the same way; Tier C gate applies in both. Service-scoped typically has 1–3 techHints from parseCoretech; project-scoped has the project's framing config techHints. Predicate evaluation + tier logic identical regardless of where the hints come from.

**Q13:** Approve extending `GET /discovery/packs/applicable` with `tier` + `warnings` as additive, backward-compatible fields?
**Answer:** Approved. Add `tier: 'A'|'B'|'C'` and `warnings: string[]` fields to response.

**Q14:** Primary gate validation lives in discovery-service route; archModelClient persists whatever it receives. If someone bypasses discovery-service and hits archModelClient directly, no gate enforcement. Acceptable?
**Answer:** Confirmed. discovery-service's route owns tier computation + gate enforcement. archModelClient persists whatever discovery-service sends. Bypass of the gate via direct archModelClient access is acceptable for a backend-internal endpoint.

**Q15:** Any additions to out-of-scope beyond the raw idea's list?
**Answer:** No additions. Existing out-of-scope stands (pack-building for unsupported stacks, policy enforcement like "never run Tier C in production", override-warnings audit log, email/slack notifications, tier-change-on-rerun).

### Existing Code to Reference

**Similar Features / Paths Identified:**
- Service fetch from discovery-service → archModelClient: `discovery-service/src/services/archModelClient.ts::getService` (confirm exists)
- Project discovery config fetch: `discovery-service/src/services/archModelClient.ts::getDiscoveryConfig`
- parseCoretech: `discovery-service/src/utils/coreTechParser.ts`
- computeTier: `discovery-service/src/services/extensionPackRegistry.ts::computeTier`
- DiscoveryRunEntity / DTO / service (Java):
  - `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/DiscoveryRunEntity.java`
  - `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/DiscoveryRunDto.java`
  - `architecture-model-service/src/main/java/com/example/architecturemodel/service/DiscoveryRunService.java`
- Existing Liquibase migration pattern: `architecture-model-service/src/main/resources/db/changelog/sql/083-discovery-run-mode.sql` and `db.changelog-master.yaml`
- Frontend candidate table: `frontend/src/components/DashboardView/DiscoveryCandidateTable.tsx`
- Run detail view: `frontend/src/components/DashboardView/DiscoveryRunDetailView.module.css`
- Existing 409 "conflict" pattern in runs route: `discovery-service/src/routes/runs.ts`
- Grid/color config tokens to check for badge colors: `frontend/src/config/gridConfigs.ts`

### Follow-up Questions

No follow-up questions were needed. All 15 first-round questions were answered with sufficient detail to proceed to specification.

## Visual Assets

### Files Provided:
No visual assets provided. The `planning/visuals/` folder was checked and is empty.

### Visual Insights:
N/A.

## Requirements Summary

### Functional Requirements

**Tier gate (discovery-service):**
- `POST /discovery/runs` at port 8091 must compute tier BEFORE creating a run.
- Flow: fetch techHints (from service's core_tech via parseCoretech, or from project discovery config) → `computeTier(techHints)` → build warnings → check gate → create run.
- If tier === 'C' AND `body.confirmLlmSolo !== true`: return 409 with `{ error: { code: 'LLM_SOLO_CONFIRMATION_REQUIRED', tier: 'C', mode: 'llm-solo', warnings } }`. NO run is persisted.
- If tier === 'C' AND `body.confirmLlmSolo === true`: create run with `confirmed_llm_solo = true`.
- If tier === 'A' or 'B': create run transparently (no gate).
- Tier is passed through to `runDiscoveryV3` — not recomputed.
- Gate applies equally to project-scoped and service-scoped runs.

**Persistence (architecture-model-service):**
- Liquibase migration `084-discovery-run-confirmed-llm-solo.sql`: add `confirmed_llm_solo BOOLEAN NOT NULL DEFAULT FALSE`.
- Liquibase migration `085-discovery-run-warnings.sql`: add `warnings TEXT` (nullable; stores JSON-encoded `string[]`).
- Prior Spec 1 migration `083-discovery-run-mode.sql` already provides `mode` / `tier` columns (confirm during spec writing).
- `DiscoveryRunEntity`, `DiscoveryRunDto`, and `DiscoveryRunService` updated to read/write new fields.

**Warning copy:**
- Tier A: `[]`
- Tier B: `["Discovery will run in language-only mode. No framework-specific adapter matches your service's tech stack. Candidate quality depends on LLM gap-fill."]`
- Tier C: `["Discovery will run in LLM-only mode. No language or framework pack matches. Pass confirmLlmSolo: true to proceed."]`

**Confidence propagation:**
- Create `discovery-service/src/services/confidence.ts` as single source of truth.
- Fixed midpoint defaults:
  - `<framework>-adapter` (any): 0.9
  - `llm-gap-fill`: 0.75
  - `llm-ir-guided`: 0.6
  - `llm-solo`: 0.4
- Env-overridable via `CONFIDENCE_<TAG>` env vars (documented in explainer).
- Adapter-emitted confidence values preserved (no overwrite when already set).
- LLM-emitted explicit `confidence` clamped to tag range; fall back to midpoint if out of range.
- Applied at candidate emission only — no retroactive backfill for existing rows.

**Dedup collision:**
- Adapter-tagged wins. Candidate retains `_addedBy: '<framework>-adapter'`, confidence = 0.9, green badge. Current dedup logic unchanged.

**Additional endpoints (additive):**
- `GET /discovery/runs/{runId}` (archmodel, port 8080): return `mode`, `tier`, `warnings`, `confirmedLlmSolo`.
- `GET /discovery/runs` (list): return `mode` + `tier` per entry (warnings excluded from list; available on detail).
- `GET /discovery/packs/applicable` (discovery-service): add `tier: 'A'|'B'|'C'` and `warnings: string[]`.

**Frontend UI:**
- Candidate list: confidence filter, slider default `>= 0.7`, range 0.0–1.0, step 0.05. Unmarked (NULL confidence) candidates always visible regardless of threshold.
- Tag badges per candidate:
  - adapter → green
  - gap-fill → yellow
  - ir-guided → orange
  - solo → red
- Reuse existing CSS color tokens (success/warning/caution/danger) from `DiscoveryRunDetailView.module.css` / `gridConfigs.ts`. Introduce at most one new CSS variable if a single token is missing — do not introduce all 4 new colors.
- Run-level banner (Tier B / Tier C) surfacing `warnings[]` on the run detail view.
- Runs-list: small `tier` column/badge so reviewers can identify Tier B/C runs before opening detail.

**Documentation:**
- `DISCOVERY_SERVICE_EXPLAINER.md`: expand tier section with examples of Tier A / B / C modes, warning copy, gate behavior, confidence-midpoint table, env-var overrides.
- API documentation for new `mode`, `tier`, `warnings`, `confirmedLlmSolo` fields on `POST/GET /discovery/runs` and new fields on `GET /discovery/packs/applicable`.

### Reusability Opportunities
- `computeTier` already exists in `discovery-service/src/services/extensionPackRegistry.ts` — reuse, do not reimplement.
- `parseCoretech` already exists in `discovery-service/src/utils/coreTechParser.ts` — reuse for service-scoped runs.
- `archModelClient.getService` / `archModelClient.getDiscoveryConfig` — reuse for tech-hint synthesis.
- Existing 409 error pattern in `discovery-service/src/routes/runs.ts` — model new `LLM_SOLO_CONFIRMATION_REQUIRED` 409 response after it.
- Existing Liquibase migration pattern from `083-discovery-run-mode.sql` — follow for `084` and `085`.
- Existing CSS tokens (success/warning/caution/danger) in frontend — reuse rather than introducing new colors.
- Existing `DiscoveryRunDto` / `DiscoveryRunEntity` — additive field additions only.

### Scope Boundaries

**In Scope:**
- Tier gate in discovery-service's `POST /discovery/runs` (pre-creation, 409 on Tier C without `confirmLlmSolo`).
- Persist `confirmed_llm_solo` (boolean) and `warnings` (JSON text) columns on `discovery_run` via Liquibase migrations 084 and 085.
- Centralized `confidence.ts` module with fixed midpoints and env-var overrides.
- Confidence propagation for new candidates across tier tags.
- Frontend: confidence slider filter (default 0.7), tag badges, run-level tier warnings banner, tier column on runs list.
- Additive tier/mode/warnings fields on `GET /discovery/runs/{runId}`, `GET /discovery/runs`, `GET /discovery/packs/applicable`.
- Documentation in `DISCOVERY_SERVICE_EXPLAINER.md` and API docs.

**Out of Scope:**
- Upgrading Tier C stacks to Tier B by building new language packs (future work).
- Policy enforcement layer (e.g., "never run Tier C in production").
- Override/warnings audit log beyond the `confirmed_llm_solo` flag.
- Email/slack notifications on Tier B/C runs.
- Tier-change-on-rerun semantics.
- Retroactive backfill of confidence for existing candidate rows.
- Re-validation of the gate in archModelClient (bypass acceptable for backend-internal endpoint).

### Technical Considerations

**Integration points:**
- discovery-service ↔ archModelClient (service entity fetch, project discovery config fetch, run persistence).
- discovery-service ↔ frontend (confidence + badges + warnings surfaced through `GET /discovery/runs/{runId}` and `GET /discovery/packs/applicable`).
- architecture-model-service Liquibase pipeline (additive nullable columns, reversible migrations).

**Existing system constraints:**
- Backward-compatible API: all new fields additive; existing clients ignoring them must still work.
- Liquibase migration must be reversible (nullable new columns, sensible defaults).
- Existing Tier A runs (spring-boot, django, etc.) must NOT regress or require opt-in.
- Confidence mapping must not overwrite adapter-emitted confidence values already in the range 0.85–0.95.
- Dedup logic unchanged — adapter-tagged candidate wins on collision.
- TEXT (not JSONB) for warnings to match existing Liquibase portability pattern.

**Technology preferences:**
- Single source of truth for tier gate: discovery-service's `POST /discovery/runs` route.
- Single source of truth for confidence defaults: `discovery-service/src/services/confidence.ts`.
- Reuse existing CSS tokens and color variables for badges; minimize new CSS variables.
- Liquibase migration numbering continues sequentially after `083-discovery-run-mode.sql`.

**Similar code patterns to follow:**
- 409 error-response structure in `discovery-service/src/routes/runs.ts`.
- `jest.requireActual` spread pattern when mocking `archModelClient` in gateway/discovery-service tests.
- DTO additive-field pattern used in prior DiscoveryRunDto revisions.
- Liquibase SQL migration style from `083-discovery-run-mode.sql`.
