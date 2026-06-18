Topic: Full-response reconcile fidelity & distinct break types — make the oracle reconciliation diff engine compare EVERY dimension of the response and classify each divergence with its own break type.

Problem: Today the reconcile diff compares STATUS + BODY only. Response HEADERS are captured but never compared; timing isn't; arrays are diffed strict-positional. So a migration that changes Content-Type, drops/adds a header, returns a different 4xx subtype, or reorders a collection is a real behavioural divergence the oracle SILENTLY MISSES. And there is no per-dimension break TYPE, so body breaks and (future) header breaks can't be told apart in triage/UI.

Decisions ALREADY made (fixed constraints, do not relitigate):
1. Diff EVERY response dimension: HTTP status (incl. status-class), response HEADERS, body SHAPE (key add/remove, type change), body VALUE, and array ORDERING. "Clearly check and diff everything to do with the response."
2. Distinct break TYPES per dimension — e.g. Break(status), Break(headers), Break(body-shape), Break(body-value), Break(ordering) — each its own classification + severity, surfaced distinctly in findings and the frontend break list. (Today status + body classifications exist; headers/ordering/status-class are new.)
3. Header volatile-allowlist: ignore known-volatile headers (Date, timestamp-ish, request/correlation IDs, etc.) by default so header noise doesn't flood breaks — reuse the determinism spec's volatile-handling idiom (the `expected_volatile` visible disposition) for header VALUES. A header appearing/disappearing, or a NON-allowlisted header changing, must STILL break.
4. Preserve the load-bearing oracle invariant: NO silent suppression of real divergences. The allowlist is narrow, visible, and auditable (same philosophy as the 2026-06-16 determinism spec: visible disposition, never silent).

Out of scope: capture-side coverage scoring (Spec A), baseline integrity/provenance (Spec C), mutating/stateful reconcile (deferred). This is Spec B of a 3-spec series (A=coverage scoring, B=this, C=baseline integrity & provenance).
