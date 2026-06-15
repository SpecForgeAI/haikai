# Round-2 validation — real tests that VALIDATE the changes

Date: 2026-06-13 · after merging fix/endpoint-rereview-round2 into main (da6f61a).

Two real runs, between them exercising the round-2 fixes — and shown to be
*discriminating* (they fail if the fix regresses), not vacuous green.

## 1. R1 concurrency + cell-owned release + real box teardown
`e2e_r1_concurrency.py` — **R1_VALIDATE_OK (8/8)**. Harness-owned haiboxd (graceful
shutdown). A REAL haibox box serves the msb Spring Boot jar; a cell is recorded
`pending` carrying that box_id (haibox serve-only). Then:
- Two genuinely concurrent HTTP `POST /api/v2/reconciliation` for the SAME cell →
  exactly ONE records (`verdicts=1`), the other is a no-op (`superseded=1`).
- The released box is the SERVER-recorded cell-owned one — the caller-supplied
  `box_id` (`"caller-supplied-should-be-ignored"`) is ignored (S5), released once.
- The real box is actually torn down: gone from the haibox registry AND no longer
  serving (GET fails). Cell settles terminal.
- **Raw concurrency burst**: 8 threads, separate real connections to the same real
  db, a tight barrier — TRUE overlap of the concurrent-read window → exactly ONE
  winner. (The HTTP TestClient serializes through one portal, so this burst is what
  actually stresses the race the unit test also covers.)

**Discriminating (proved):** a NEGATIVE CONTROL running the OLD read-then-write gate
against the same 8-thread burst produced **7 winners** — i.e. the test catches the
regression; R1's one-statement conditional INSERT yields exactly 1.

Validates: R1 (atomic supersede), cell-owned release (S5), real box lifecycle, the
store under real concurrency (R6/R5 — busy_timeout, no WAL).

## 2. Multi-spec deploy arc (re-run, post round-2)
`../260613-multispec-springboot/e2e_multispec.py` — **MULTISPEC_OK (18/18)**.
Validates the deploy-side round-2 changes on the real Spring Boot app:
- **L1**: the deploy worktree is reclaimed (asserted gone + no leftover registration).
- **C2**: no `integration_branch` lie in the deploy result.
- **C1/L3**: both specs' branches recorded (not collapsed to the last).
- **C3**: build-results `outcome=deployed` present.
- Both features served live; haiboxd shut down cleanly.

## Coverage map (round-2 fix → validator)
| Fix | Validated by |
|---|---|
| R1 atomic supersede | e2e #1 (HTTP contract + 8-thread true-overlap burst + negative control) |
| S5 cell-owned release / real teardown | e2e #1 |
| R6 schema sentinel / R5 no-WAL | e2e #1 store under concurrency + unit tests |
| L1 worktree reclaim, C2, C1/L3, C3 | e2e #2 (real Spring Boot) + unit tests |
| L4/L5 partial-failure gating | unit tests (test_haikai_orchestrator) |
| R8 per-project git lock | unit tests (test_file_lock) |

Full unit suite at merge: 1663 passed / 0 failed.
