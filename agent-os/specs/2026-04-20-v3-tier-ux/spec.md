# Specification: V3 Tier UX

## Goal
Surface the V3 discovery pipeline's tier model (A/B/C) through the discovery-service API and review UI, gate Tier C (LLM-only) runs behind an explicit `confirmLlmSolo` opt-in, and propagate fixed-midpoint per-tier confidence scores onto new candidates so reviewers can filter by trust level.

## User Stories
- As an API consumer, I want `POST /discovery/runs` to return `mode`, `tier`, and `warnings` (and reject Tier C without `confirmLlmSolo: true` via 409) so I know what I am about to pay for before triggering an LLM run.
- As a reviewer, I want a run-level warnings banner, a confidence slider filter (default >= 0.7), and a per-candidate tier badge so I can triage Tier B/C output by trust level.
- As an operator, I want tier, warnings, and the explicit `confirmed_llm_solo` opt-in persisted on `discovery_run` so audit traces show which runs were explicitly opted into LLM-solo mode.

## Specific Requirements

**Tier + warnings synthesized before run creation (discovery-service `POST /discovery/runs`)**
- Fetch techHints: if `serviceId` present, `archModelClient.getService(projectId, serviceId)` + `parseCoretech(service.core_tech)`; else `archModelClient.getDiscoveryConfig(projectId)`.
- Call existing `computeTier(techHints)` from `extensionPackRegistry.ts` to derive `'A'|'B'|'C'`.
- Map tier to mode: A=`pack-supervised`, B=`language-only`, C=`llm-solo`.
- Build `warnings: string[]` per the copy table below.
- Gate: if tier === 'C' AND `body.confirmLlmSolo !== true`, return 409 with `{ error: { code: 'LLM_SOLO_CONFIRMATION_REQUIRED', tier, mode, warnings } }` BEFORE any call to `archModelClient.createDiscoveryRun` (no orphaned PENDING rows).
- Otherwise, pass `tier`, `mode`, `warnings`, and `confirmedLlmSolo` (true only when tier C proceeded via opt-in) to `archModelClient.createDiscoveryRun`.
- Gate applies equally for project-scoped and service-scoped runs.

**Response enrichment on `POST /discovery/runs`**
- Request gains optional `confirmLlmSolo: boolean` (default false).
- Response adds `mode: 'pack-supervised'|'language-only'|'llm-solo'`, `tier: 'A'|'B'|'C'`, `warnings: string[]`.
- All fields additive; existing clients ignoring them continue to work.

**`runDiscoveryV3` accepts tier as input**
- Refactor `discovery-service/src/services/discoveryV3Pipeline.ts` so the tier computed at the route is passed in rather than re-derived internally.
- No behavioural change for Tier A/B; eliminates double computation and ensures the persisted tier matches the tier the pipeline actually ran under.

**Centralized confidence module (`discovery-service/src/services/confidence.ts`)**
- Single source of truth for per-tag midpoint confidence values: `adapter=0.9`, `llm-gap-fill=0.75`, `llm-ir-guided=0.6`, `llm-solo=0.4`.
- Env-overridable: `CONFIDENCE_ADAPTER`, `CONFIDENCE_LLM_GAP_FILL`, `CONFIDENCE_LLM_IR_GUIDED`, `CONFIDENCE_LLM_SOLO`.
- Adapters that already emit an explicit `confidence` retain it (no overwrite).
- LLM-emitted explicit `confidence`: clamp into tag range; fall back to midpoint if out of range.
- Applied at candidate emission only (new candidates). No backfill migration for existing rows.
- On dedup collision between adapter + LLM gap-fill, adapter wins (confidence 0.9, `_addedBy: '<framework>-adapter'`); current dedup logic unchanged.

**Architecture-model-service schema changes**
- Liquibase `084-discovery-run-confirmed-llm-solo.sql`: `ALTER TABLE discovery_run ADD COLUMN confirmed_llm_solo BOOLEAN NOT NULL DEFAULT FALSE`.
- Liquibase `085-discovery-run-warnings.sql`: `ALTER TABLE discovery_run ADD COLUMN warnings TEXT` (nullable, stores JSON-encoded `string[]`).
- Register both in `db.changelog-master.yaml` following the pattern used for `083-discovery-run-mode.sql`.
- Existing rows keep NULL `warnings`, default FALSE `confirmed_llm_solo`, and whatever `mode` value they currently hold — no backfill.

**DiscoveryRunEntity / DiscoveryRunDto / DiscoveryRunService updates**
- Entity gains `confirmedLlmSolo: boolean` and `warnings: String` (raw JSON text).
- DTO gains `confirmedLlmSolo: boolean`, `warnings: List<String>` (serialized/deserialized from the entity's JSON text), and derived `tier: 'A'|'B'|'C'` (single-char value derived from the existing `mode` column introduced by `083`).
- `DiscoveryRunService.createRun` accepts new inputs and persists them; `updateRun` accepts both fields for the proceed-after-gate flow.
- Additive only — no breaking changes to existing fields.

**Other endpoints additive field surfacing**
- `GET /discovery/runs/{runId}` (archmodel): include `mode`, `tier`, `warnings`, `confirmedLlmSolo`.
- `GET /discovery/runs` (archmodel list): include `mode`, `tier` per entry (warnings omitted from list for brevity, available on detail).
- `GET /discovery/packs/applicable` (discovery-service): include `tier: 'A'|'B'|'C'` and `warnings: string[]` so callers can preflight before submitting.

**Review UI — candidate list**
- Add a confidence slider filter: range 0.0–1.0, step 0.05, default threshold 0.7.
- Candidates below the threshold are hidden; candidates with NULL confidence are ALWAYS visible regardless of threshold (unmarked = "unknown", not "below").
- Tier badge per candidate mapped to existing success/warning/caution/danger CSS tokens: adapter=success/green, gap-fill=warning/yellow, ir-guided=caution/orange, solo=danger/red. If a single token is missing in `DiscoveryRunDetailView.module.css` / `gridConfigs.ts`, introduce at most one new CSS variable rather than introducing four new colors.

**Review UI — run detail + runs list**
- Run detail view: warnings banner visible only when tier is B or C, rendering `warnings[]` verbatim.
- Runs list: gain a small `tier` column/badge so reviewers can identify B/C runs before opening detail.
- Tier C gate 409 from `POST /discovery/runs` triggers a frontend confirm dialog that, on confirm, retries the same request body with `confirmLlmSolo: true`.

**Warning copy (exact strings)**
- Tier A: `[]`
- Tier B: `["Discovery will run in language-only mode. No framework-specific adapter matches your service's tech stack. Candidate quality depends on LLM gap-fill."]`
- Tier C: `["Discovery will run in LLM-only mode. No language or framework pack matches. Pass confirmLlmSolo: true to proceed."]`

**Acceptance criteria**
- Tier C run without `confirmLlmSolo: true` → 409 with `LLM_SOLO_CONFIRMATION_REQUIRED` and no row persisted.
- Tier C run with `confirmLlmSolo: true` → proceeds; persisted row has `confirmed_llm_solo = TRUE`, `mode = 'C'`, populated `warnings`.
- Tier A and Tier B runs proceed unchanged (no gate, no new opt-in).
- New candidates carry confidence at emission time per centralized module; existing candidate rows are not modified.
- UI shows banner + filter + badges; runs list shows tier column.
- Liquibase 084 and 085 apply cleanly, are reversible, and do not require backfill.

## Visual Design
No visual assets provided. `planning/visuals/` folder is empty.

## Existing Code to Leverage

**`discovery-service/src/services/extensionPackRegistry.ts::computeTier`**
- Already returns `'A'|'B'|'C'` from techHints; reuse directly — do NOT reimplement.
- Called once at the route after techHints are built, result passed through to `runDiscoveryV3`.

**`discovery-service/src/utils/coreTechParser.ts::parseCoretech`**
- Already parses a service's `core_tech` string into techHints; reuse for the service-scoped run branch when building inputs to `computeTier`.

**`discovery-service/src/services/archModelClient.ts`**
- `getService(projectId, serviceId)` and `getDiscoveryConfig(projectId)` feed techHint synthesis before the gate.
- `createDiscoveryRun` / `updateDiscoveryRun` gain additive fields (`mode`, `tier`, `warnings`, `confirmedLlmSolo`) passed through to archmodel; persists what discovery-service sends (no re-validation).

**`discovery-service/src/routes/runs.ts`**
- Existing 409 conflict pattern is the template for the new `LLM_SOLO_CONFIRMATION_REQUIRED` 409 response shape.
- This route owns tier computation + gate enforcement — single source of truth.

**`architecture-model-service/src/main/resources/db/changelog/sql/083-discovery-run-mode.sql` + `db.changelog-master.yaml`**
- Follow its SQL style, file naming convention, and master-changelog registration pattern for `084-discovery-run-confirmed-llm-solo.sql` and `085-discovery-run-warnings.sql`.

**`DiscoveryRunEntity.java` / `DiscoveryRunDto.java` / `DiscoveryRunService.java`**
- Prior revisions already followed an additive-field pattern (e.g., the `mode` column added by spec 1). Replicate that approach for `confirmedLlmSolo` and `warnings`; derive `tier` on the DTO from the existing single-char `mode` column value.

**`frontend/src/components/DashboardView/DiscoveryCandidateTable.tsx` + `DiscoveryRunDetailView.module.css` + `frontend/src/config/gridConfigs.ts`**
- Candidate table is where the confidence slider filter and tier badge column are wired in.
- Module CSS + grid configs already expose success/warning/caution/danger tokens; reuse them rather than introducing parallel colors. Introduce at most one new CSS variable only if a single token is genuinely missing.

## Out of Scope
- Building new language packs to upgrade any Tier C stack to Tier B.
- Policy enforcement layer (e.g., "never run Tier C in production").
- Override/warnings audit log beyond the persisted `confirmed_llm_solo` flag.
- Email / Slack notifications on Tier B/C runs.
- Tier-change-on-rerun semantics (tier at creation is what persists).
- Retroactive confidence backfill for existing candidate rows.
- Re-validating the Tier C gate inside archmodel (bypass via direct archmodel call is acceptable for a backend-internal endpoint).
- Replacing the `warnings TEXT` JSON-encoded column with JSONB (keeping TEXT matches the project's existing Liquibase portability pattern).
- Automated tier-based triggers or ML-learned confidence values (midpoints are fixed, env-overridable only).
