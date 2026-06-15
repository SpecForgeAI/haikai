# Raw Idea: Oracle Integrity & Determinism

HAIKAI Phase-2 "oracle perfection." **Spec #3 of 6.** Built strictly sequentially
AFTER Spec #1 (response-contract scanner) and Spec #2 (capture-coverage seeding),
so it extends their committed scanners + run/readiness DTO rather than racing them.

Two bars to hold:

1. **A discovery run must not be SILENTLY incomplete.** Today a framework scanner
   can throw and silently delete that framework's endpoints from a run still marked
   `COMPLETED`; a partial/failed LLM gap-fill stage still completes; `filesFailed`
   is hardcoded `0`; method/token caps and contract/runtime-pass failures leave no
   trace on the run. We add a run-level **advisory "degraded/incomplete" signal**
   (never blocking) that downstream consumers (Spec 5 coverage, the harness) can see.

2. **The oracle's own extraction must be reproducible.** Gap-fill has no
   prompt-hash response cache, so re-runs differ even with `temperature: 0`
   (already wired by quick-win **W2**). We add a content-addressed LLM output cache
   keyed on `(normalized-prompt hash + model + temperature)`, modelled on the
   behaviour stage's `source_hash` hashing.

Plus three correctness/visibility guards so nothing is silently lost or false-bound:
- **Below-gate visibility:** below-0.75 candidates must be persisted as reviewable
  candidates with an explicit "below auto-accept" status + a run-summary count.
- **False-merge guard:** normalized (non-exact) name matches must not silently bind;
  record a low-confidence/reviewable binding OR emit a `possible_entity_collision`
  Finding. Only EXACT matches bind silently.
- **Non-pure endpoint flagging:** a new deterministic scanner emits a
  `non_deterministic_endpoint` evidence-gap Finding for endpoints whose handler
  reaches `@Scheduled`/`@Cacheable`/`@Async`/`@Profile`-gated beans / session state /
  clock / random — so the harness does not false-diff a legitimate variance.

This combines the program's **integrity** cluster and **non-determinism** cluster
into one spec.

**Two carved quick-wins are ALREADY DONE on HEAD and must be EXTENDED, not redone:**
- **W2** — `temperature: 0` on the gap-fill/behaviour/decision LLM relays in
  `gateway/src/routes/discovery*.ts`.
- **W4** — a `scanner_failed` evidence-gap Finding emitted at soft-fail catch sites
  in `discoveryV3Pipeline.ts` + `packFindingScanners/index.ts`, with the
  `scanner_failed` sentinel in `findings/emissionSources.ts`.

**Ethos:** advisory throughout. Degraded is a visible quality signal, never a block.
No auto-remediation. Spring/Spring Classic only.

All decisions in `requirements.md` are FINAL and user-pre-approved — autonomous build.
