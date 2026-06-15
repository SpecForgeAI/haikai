# Spec 7 — Confidence, Tier, and Runtime Badges (shaping notes)

Date: 2026-05-11
Spec scope: Frontend-only display layer. NO backend, NO new persistence, NO log parsing. Reads data already produced by Specs 5 + 6.

---

## 1. Current state of `DiscoveryCandidateTable.tsx`

### Header order (verified from `<thead>`)

```
Name | Tier | Type | Confidence | Review Status | Synthesized At | Actions
```

`CANDIDATE_TABLE_COLUMN_COUNT = 7` is centralised so adding/removing a column is a single edit.

### Tier column representation (today)

- Renders `<TierBadge addedBy={addedBy} data-testid="candidate-tier-badge" />`
- `addedBy = candidate.data._addedBy` (a single string).
- `TierBadge` maps:
  - `*-adapter`     → green pill, label "adapter"
  - `llm-gap-fill`  → yellow pill, label "gap-fill"
  - `llm-ir-guided` → orange pill, label "ir-guided"
  - `llm-solo`      → red pill, label "llm-solo"
  - `null`/unknown  → grey pill, label "—"
- Label is short (one short word). NO existing "+ LOGS" semantics.

### Confidence column representation (today)

- Single `<td data-testid="candidate-confidence-cell">{formatConfidence(candidate.confidence)}</td>`
- `formatConfidence` = `${(c * 100).toFixed(0)}%` or `"—"` for null/undefined
- Plain text. No badge, no tooltip, no impact text.

### Existing chip/badge components (audit)

- `TierBadge` (DashboardView) — small coloured pill. Reusable styling for new runtime badges via the same variant tokens (success/warning/caution/danger/neutral) but Spec 7 should NOT re-use `TierBadge` itself because its semantic axis is "where the candidate came from", not "what runtime evidence says".
- `runRowLogsAttachWarningChip` (Spec 4) lives on `DiscoveryRunsList`, not on the candidate table. It is a run-row chip, not a candidate-row chip. Different surface.
- No reusable generic `Chip` component exists in `DashboardView/`. Spec 7 will need a small new `RuntimeBadge` component (one new component, one CSS module, ~50 LOC) that reuses TierBadge's CSS variant tokens.

---

## 2. Adapter vs LLM provenance — discriminator

### Single discriminator: `candidate.data._addedBy`

- Adapter values: `'<framework>-adapter'` (e.g. `'spring-boot-adapter'`, `'angularjs-classic-adapter'`, etc — see ~18 adapters in `discovery-service/src/services/extensionPacks/frameworkAdapters/`)
- LLM values: `'llm-gap-fill'` | `'llm-ir-guided'` | `'llm-solo'`
- These are **MUTUALLY EXCLUSIVE** at the candidate level. A candidate is created by exactly one stage; its `_addedBy` is set once at creation and survives the round-trip (see `llmGapFillStep.ts:691`).

### Can a candidate carry BOTH adapter + LLM contribution?

**No.** Verified via:

1. The `_addedBy` field is a single string.
2. `dedupLlmCandidates` in `discovery-service/src/services/prompts/dedup.ts` actively DROPS LLM candidates whose `(type, normalize(name), filePath)` collides with a pack-adapter candidate. The LLM stage is instructed not to restate adapter output, and dedup enforces it. The remaining LLM candidates are wholly new — they do not become an adapter candidate plus an LLM marker.
3. There is no merge step that fuses an adapter candidate with an LLM candidate into a single row.

**Consequence for the spec:**
- "ADAPTER + LLM" and "ADAPTER + LLM + LOGS" labels in the brief's suggested label list never appear in practice today.
- "ADAPTER + LOGS", "LLM + LOGS", and the bare "ADAPTER" / "LLM" labels are the only realistic combinations.

(See §3 below for what "LOGS" means in this context.)

### Can a single candidate have log evidence?

Yes — `logEnrichment.runtime` is populated additively per Spec 5 for `endpoints` candidates. For the three indirection-driven types (`interfaces`, `logical_data_entities`, `interface_logical_entities`) Spec 6's `runtimeEvidenceContextBuilder` derives rollups from related endpoints' runtime blocks. A candidate can carry log evidence regardless of whether its `_addedBy` is adapter or LLM.

---

## 3. Per-candidate runtime data Spec 7 will read

### For `endpoints` candidates (direct)

- `candidate.logEnrichment.runtime` narrowed via Spec 6's `readRuntimeBlock`:
  - `{ matched: MatchedRuntimeEvidence }` — has `observedUsageCount`, `status5xxCount`, `totalLogRequests`, `status2xxCount`, `status3xxCount`, `status4xxCount`, etc. All threshold inputs Spec 7 needs.
  - `{ noUsageObserved: true, ...zero counts }` — for "logs were processed, this endpoint never appeared".
  - `undefined` — no runtime block at all (logs not uploaded for this run, or upload failed).

### For `interfaces` / `logical_data_entities` / `interface_logical_entities`

- Read from the **already-built** `RuntimeEvidenceContext` that `DiscoveryCandidateTable` produces via `useMemo` (Spec 6, Task Group 4.4) and threads into `<CandidateDetailsPanel>`.
- The same context can be threaded into a Spec 7 helper for table-row badges (no rebuild).
- Each rollup map keyed by candidate id provides aggregate `totalObservedCalls`, `observedEndpointCount`, etc.

### For UNSUPPORTED types

- `RuntimeEvidenceContext` does not contain entries for them.
- Brief mandates: no badges, no `+ LOGS`, no confidence uplift. Easy gate via `supportsDetails(candidate.candidate_type)` (already used by the expansion toggle).

---

## 4. Spec 3 contract — `confidenceImpactLabel` / `confidenceImpactReason`

- Defined on `CandidateEvidenceSection` (one section = one column body).
- Three sections per panel: `codeDetection`, `logScans`, `llmReview`.
- `CandidateEvidenceSectionCard` renders the impact block conditionally per section:
  ```
  Impact: {confidenceImpactLabel}
  {confidenceImpactReason if present}
  ```
- This means **each section renders its own impact block independently**. There is no merged panel-level impact block, and no contract change is required to put one impact block on Code Detection ("Base confidence") and a second on Log Scans ("Confidence increased") — both will render in their respective columns.
- Spec 7 will populate `confidenceImpactLabel`/`Reason` in:
  - `codeDetectionEvidenceBuilder.ts` (when adapter contributed): "Base confidence" + reason
  - `logScansEvidenceBuilder.ts` (per-type, when matched evidence corroborates): "Confidence increased" + reason quoting the rule that fired (e.g. "+5pp from 1,847 observed calls")

---

## 5. Confidence — display vs persistence

- `DiscoveryCandidateDto.confidence: number | null` — persisted, 0..1, may be null for legacy rows.
- Brief explicitly says: compute `displayConfidence` in the frontend; do NOT mutate the persisted base confidence.
- Implementation: a pure helper `getDisplayConfidence(candidate, runtimeContext)` returning `{ percent: number, basePercent: number, upliftPp: number, capped: boolean, reason: string }`. The table cell renders `percent + "%"` (formatting unchanged); the expanded panel reads the same helper to populate `confidenceImpactReason` so the displayed value and the explanation are always in sync.

---

## 6. Suggested implementation shape (to confirm with spec-writer, not the user)

### New module: `runtimeBadgeThresholds.ts`

Single source of truth for the six thresholds named in the brief:
```ts
export const HIGH_USAGE_ENDPOINT_THRESHOLD = 1000;
export const MEDIUM_USAGE_ENDPOINT_THRESHOLD = 100;
export const ELEVATED_5XX_COUNT_THRESHOLD = 10;
export const ELEVATED_5XX_RATE_THRESHOLD = 0.01;
export const MAX_LOG_CORROBORATED_CONFIDENCE = 99;
export const MAX_LLM_LOG_ONLY_CONFIDENCE = 95;
```
Compile-time constants, no UI to tune. Brief says "Do not introduce complex user-configurable settings in this spec unless straightforward." Defaulting to constants here.

### New helpers (pure functions, table-cell consumers)

- `getRuntimeBadge(candidate, runtimeContext)` → `RuntimeBadge | null`
- `getRuntimeDisplayText(candidate, runtimeContext)` → `string | null` (e.g. "Observed 1.8k", "High usage", "Elevated errors")
- `hasAssociatedLogEvidence(candidate, runtimeContext)` → boolean
- `getEvidenceSourceLabel(candidate, runtimeContext)` → string (the `+ LOGS` decorator logic)
- `getDisplayConfidence(candidate, runtimeContext)` → `DisplayConfidence`

### New component

- `RuntimeBadge` — small pill, reuses TierBadge's variant CSS tokens, semantically distinct.

### Wiring

- Update `DiscoveryCandidateTable`'s Tier `<td>` to render `<TierBadge addedBy={addedBy} />` PLUS a "+ LOGS" suffix (or a sibling small "LOGS" pill — see open question).
- Either add a new `Runtime` column OR put the `RuntimeBadge` inline next to the candidate name (open question — the table is already 7 columns wide).
- Update `formatConfidence` callsite to use `getDisplayConfidence(...).percent`.
- Update `codeDetectionEvidenceBuilder.ts` and `logScansEvidenceBuilder.ts` to populate `confidenceImpactLabel` / `confidenceImpactReason`.

---

## 7. Autonomous decisions (no need to ask user)

- **Number formatting**: `Intl.NumberFormat({ notation: 'compact', maximumFractionDigits: 1 })` for "Observed 1.8k". Standard.
- **Threshold values**: take the brief's defaults verbatim (1000/100/10/0.01/99/95).
- **Threshold tunability**: compile-time constants in `runtimeBadgeThresholds.ts`. Brief defers user-configurable UI explicitly.
- **CSS reuse**: extend the TierBadge variant CSS tokens (success/warning/caution/danger/neutral) via a new `RuntimeBadge.module.css` that imports/aliases the same colour tokens. No new design tokens.
- **Test framework**: Vitest (frontend standard).
- **File naming**: kebab-case helpers (`runtimeBadgeHelpers.ts`, `runtimeBadgeThresholds.ts`, `displayConfidence.ts`). Match the codebase pattern of `runtimeEvidenceContextBuilder.ts` / `logScansEvidenceBuilder.ts`.
- **Wording**: take the brief's "Important wording" list verbatim (Observed in supplied logs, Runtime observed, No log evidence, etc.).
- **`runtimeEvidenceContext` reuse**: thread the SAME memo from `DiscoveryCandidateTable` into the new badge helpers. No second pass over candidates.
- **Don't show "ADAPTER + LLM" combinations**: based on §2 finding, a candidate cannot today carry both. Skip that label and "ADAPTER + LLM + LOGS"; emit the brief's other four (`ADAPTER`, `ADAPTER + LOGS`, `LLM`, `LLM + LOGS`).

---

## 8. Genuine product/architecture questions for the user

These are real decisions that affect how the spec is built and that I cannot reasonably default.

### Q1 — New "Runtime" column vs inline badge

The candidate table is already 7 columns wide. Adding an 8th column ("Runtime") is more discoverable but reduces width per existing column on smaller laptops; an inline badge next to the candidate name (or beside the Tier pill) is more compact but less scannable. Brief explicitly leaves this call open ("Add a compact Runtime column if the table has enough width. If adding a new column is too disruptive, show a small badge…").

### Q2 — How to attach the "LOGS" suffix to Tier

Two options:
- (a) Modify the existing TierBadge label to say "adapter + logs" / "gap-fill + logs" (one wider pill).
- (b) Render a SECOND small pill ("+ LOGS") immediately adjacent to the existing TierBadge.

Option (b) keeps `TierBadge`'s single-axis meaning ("provenance") clean and lets the new RuntimeBadge styling carry the logs signal; option (a) is more compact but couples two semantic axes into one badge.

### Q3 — "LLM + LOGS" label appears in practice?

Per §2, a candidate's `_addedBy` is one of `{*-adapter, llm-gap-fill, llm-ir-guided, llm-solo}`. So an `llm-gap-fill` candidate WITH log evidence WILL show as "LLM + LOGS". Should the rendered label use the LLM sub-tag verbatim (e.g. "gap-fill + logs", "ir-guided + logs", "llm-solo + logs"), or collapse all three LLM tags to a single "LLM + LOGS"?

The current TierBadge already shows the sub-tag (`gap-fill`, `ir-guided`, `llm-solo`). Collapsing for the suffix would create an inconsistency with the base label.

### Q4 — Confidence impact text on Code Detection column

For an adapter-detected candidate, do we want `confidenceImpactLabel: "Base confidence"` rendered on the Code Detection column EVEN WHEN there is no log evidence (so every adapter candidate's panel shows "Base confidence" as a baseline statement), or only when log evidence is also present (so the impact text appears only when there's an actual change to explain)?

The brief mentions both wordings as possibilities. Always-on is more explanatory; only-when-changed is less noisy.

### Q5 — "No log evidence" badge on the table row

When logs WERE uploaded for the run AND the candidate's type is supported AND no associated log evidence exists, should the table show a neutral "No log evidence" badge (taking up row space for a non-event), or omit the badge and let the expanded panel state it?

Brief says "Optionally show a neutral 'No log evidence' badge only if the table already has a compact place for it". Hinges on Q1's answer (column vs inline) but is a separate call about whether to surface a non-event at row level at all.

---

## 9. Visual assets

`planning/visuals/` is empty. No mockups, wireframes, or screenshots provided.

---

## Resolved decisions (user-confirmed 2026-05-11)

The five clarifying questions raised during shaping have been resolved by the user. All five match the shaper's recommended defaults.

1. **Runtime signal placement → inline pill adjacent to the existing TierBadge.**
   - No new table column. The 7-column header (Name | Tier | Type | Confidence | Review Status | Synthesized At | Actions) is preserved verbatim.
   - The Tier `<td>` becomes a small inline cluster: `<TierBadge ... />` + (optional) `<RuntimeBadge ... />`.
   - Compact wording: "Observed 1.8k", "High usage", "Elevated errors". Compact-numeric formatting via `Intl.NumberFormat({ notation: 'compact', maximumFractionDigits: 1 })` — "1842" → "1.8k", "12430" → "12k".
   - Runtime badge styling reuses TierBadge CSS variant tokens (success / warning / caution / danger / neutral). NO new CSS module file.
   - When the candidate has no associated log evidence, NO RuntimeBadge is rendered (per resolved decision 5).

2. **"+ LOGS" attachment to Tier → separate sibling pill, not a wider TierBadge label.**
   - `TierBadge` label remains BYTE-IDENTICAL to today (`adapter` / `gap-fill` / `ir-guided` / `llm-solo` / `—`). NO edits to `TierBadge.tsx` or its CSS.
   - The new `RuntimeBadge` is the sibling pill that carries the log signal. When the candidate has matched runtime evidence, RuntimeBadge renders with the appropriate compact label ("Observed N", "High usage", "Elevated errors"). The "+ LOGS" semantic is conveyed by RuntimeBadge's PRESENCE; no extra "+LOGS" pill is needed.
   - This means the spec's earlier "Tier label rules" section's "append + LOGS" wording is interpreted as: present a sibling RuntimeBadge whose existence indicates "+ LOGS" provenance; the runtime metric (count / high-usage / errors) is the badge's own label text.
   - Tier-source labels with LLM are NOT compound today (per code finding: `_addedBy` is a single string and `dedupLlmCandidates` collides one-or-the-other). So "LLM + LOGS" / "ADAPTER + LOGS" rendering reduces to: `TierBadge('llm-solo')` + sibling `RuntimeBadge('Observed 1.8k')` — same render path for both, no special-casing.

3. **LLM sub-tag preserved → keep the candidate's actual `_addedBy` sub-tag in the TierBadge.**
   - Existing TierBadge labels (`gap-fill`, `ir-guided`, `llm-solo`, `adapter`, etc.) are unchanged.
   - Spec 7 does NOT collapse LLM provenance to a single "LLM" label. The provenance is owned by the existing TierBadge; Spec 7 only adds the runtime-signal sibling.

4. **Code Detection "Base confidence" impact text → only when there is an actual log-based confidence delta to explain.**
   - When `displayConfidence === baseConfidence` (no log uplift): NEITHER section's `confidenceImpactLabel` / `confidenceImpactReason` is populated. The card's existing conditional-render rule already hides the impact block in this case.
   - When `displayConfidence > baseConfidence` (log uplift applied): BOTH sections populate their impact fields:
     - Code Detection card: `confidenceImpactLabel: "Base confidence"`, `confidenceImpactReason: "Deterministic code adapter evidence."` (or analogous wording when the candidate is `llm-*` sourced — e.g. `"Initial LLM-derived confidence."`)
     - Log Scans card: `confidenceImpactLabel: "Confidence increased"`, `confidenceImpactReason: "Runtime logs observed N successful/redirect calls matching this candidate."` (with N populated from `observedUsageCount`)
   - This keeps the panel clean for the common no-logs case while providing a side-by-side base-then-uplift explanation when the row's Confidence column has changed.
   - For `interfaces` / `logical_data_entities` / `interface_logical_entities` candidates, the Log Scans confidenceImpactReason wording matches the candidate type's evidence shape (e.g. "Related endpoint runtime usage observed.").

5. **"No log evidence" badge → omitted at row level. Explained only inside the expanded Log Scans panel.**
   - When a run has uploaded logs AND the candidate type is supported AND no associated runtime evidence exists, the row displays NO RuntimeBadge.
   - The expanded Log Scans column already shows the Spec 6 fallback string `"Log scan evidence was not found for this run."`. That is the sole explanation surface in this spec.
   - This avoids row-level noise on every candidate when most candidates won't have log evidence.

