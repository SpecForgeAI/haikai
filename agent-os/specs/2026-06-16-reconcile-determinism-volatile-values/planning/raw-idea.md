Topic: Reconcile-time determinism & volatile-value handling for the oracle reconciliation engine (api-migration-validation-service + AMS + gateway + frontend).

Problem: the reconcile diff engine compares responses byte-exact, so legitimate non-determinism (timestamps, generated IDs, unordered collections) floods every reconcile with false breaks and drowns real divergences. The `non_deterministic_endpoint` discovery signal (built by spec 2026-05-30-oracle-integrity-determinism) is never consumed by the diff engine and is Spring-only + endpoint-coarse.

Decisions ALREADY made by the user (fixed constraints — do not relitigate):
1. Scope = FULL fix (field-level volatile handling, works on any target), not a thin endpoint-only slice.
2. Detection = EMPIRICAL: at capture/pin time, replay each current-state scenario k=3 times against the current system (HTTP-only, no LLM) and self-diff to MEASURE which JSON paths vary; record that envelope on the IMMUTABLE baseline item. Complement with the existing `non_deterministic_endpoint` signal, conservative timestamp/UUID heuristics, and human-declared paths.
3. Break policy = VISIBLE disposition: a new `expected_volatile` state (plain TEXT, NO DDL, mirrors `expected_net_new` in MigrationReconciliationBreakStatus.java) that is auto-set but visible/auditable/human-overridable. NEVER silent suppression — must preserve the load-bearing oracle invariant ("oracle = current-state; no override; a deliberately-changed NON-volatile value MUST still break").

Constraints/notes: highest applied Liquibase changeset is 186 (new column = 187); mutating scenarios can't be probed (state changes between replays) — fall back to heuristic/declared, mark not_probed (ties to a separate Row 9 mutating-replay concern, out of scope here); shape diffs (key add/remove, type change) on a volatile path must STILL break — volatility tolerates values + ordering only.

Reference: the existing hand-authored `spec.md` + `tasks.md` in this same folder (modeled on the 2026-05-30-oracle-integrity-determinism spec) capture the intended design and should be used as input for shaping/writing.
