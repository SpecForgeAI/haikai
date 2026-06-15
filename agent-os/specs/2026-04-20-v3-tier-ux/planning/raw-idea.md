## Raw Idea

Expose the V3 pipeline's tier model (A/B/C) to API consumers and the review UI. Gate Tier C (LLM-only) runs behind an explicit opt-in. Propagate tier-based confidence scores through candidates so reviewers can filter by trust level.

## Context

Spec 1 added internal `computeTier()` logic. Spec 2 wired the tiered prompt variants. Spec 4 ensured all packs work in A/B/C modes. This spec surfaces the tier through the API so callers know what they're getting before paying for an LLM run, and reviewers can filter candidate lists accordingly.

## In scope

1. `POST /discovery/runs` response enrichment:
   - New field `mode`: `'pack-supervised' | 'language-only' | 'llm-solo'` (A/B/C respectively).
   - New field `tier`: `'A' | 'B' | 'C'`.
   - New field `warnings: string[]` with tier-appropriate messages.

2. Tier C gate:
   - `POST /discovery/runs` returns 409 + warning payload when tier would be C and request body does NOT include `confirmLlmSolo: true`.
   - When `confirmLlmSolo: true`, run proceeds in Tier C mode.
   - Tier A and B runs proceed automatically (no gate).

3. Extend `GET /discovery/packs/applicable` to also return:
   - `tier: 'A' | 'B' | 'C'`
   - `warnings: string[]` (same shape as run creation)
   - This lets callers preflight-check before submitting.

4. Confidence propagation on candidates:
   - Adapter-tagged: 0.85-0.95 (current).
   - `'llm-gap-fill'`: 0.7-0.8.
   - `'llm-ir-guided'` (Tier B): 0.5-0.7.
   - `'llm-solo'` (Tier C): 0.3-0.5.
   - Values computed at candidate emission — no post-hoc rewrite.

5. Architecture-model-service updates:
   - Persist `mode`, `tier`, and `warnings` as columns on `discovery_runs`.
   - Candidate DTO exposes `confidence` and `_addedBy` (already does) — ensure both surface to the review UI.

6. Review UI updates (frontend):
   - Run-level banner for Tier B/C showing warnings.
   - Candidate list filter: "confidence ≥ X", default 0.7.
   - Tag badge per candidate: green (adapter), yellow (gap-fill), orange (ir-guided), red (solo).

7. Documentation:
   - `DISCOVERY_SERVICE_EXPLAINER.md` expands tier section with examples of each mode.
   - API documentation for new fields.

## Out of scope

- Upgrading any Tier C stack to Tier B by building new language packs (future work).
- Automated tier-based triggers (e.g. "never run Tier C in production") — that's policy, not pipeline.

## Key constraints

- Existing Tier A runs (spring-boot, django, etc.) must not regress or require opt-in — they were accepted before this spec and must keep being accepted transparently.
- Backward compatibility on API: new fields are additive. Existing clients ignoring them must still work.
- Database migration must be reversible (nullable new columns, default values).

## Done when

- Tier C run against an unsupported stack requires explicit `confirmLlmSolo: true`.
- `POST /discovery/runs` response shows tier + mode + warnings for all three tiers.
- Review UI filters candidates by confidence and shows tier banners.
- Database migration applied and verified on a local DB.
- Documentation updated.
