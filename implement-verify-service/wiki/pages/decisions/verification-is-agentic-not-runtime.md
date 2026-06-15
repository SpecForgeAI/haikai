# Decision: verification is agentic instructions, not a runtime

**Decision (spec D10–D10.3, 2026-05-31).** The verification flow — firing
hooks, evaluating the D5 gate, branching, dispatching repair, maintaining the
checklist — is delivered as **markdown instructions an agent follows** (the
`verify-task-group` command + the `verification-loop` agent), exactly like
`/orchestrate-tasks`. There is no `orchestrate` Python engine that fires hooks
or owns the gate. See [[../concepts/async-verification-orchestration]].

## What stays code

Only irreducible I/O the agent cannot be:

- the **inbound-gateway** (a FastAPI webhook route with a stable URL — correlate an
  async CI verdict by the authenticated SHA→cell binding (D10.4), record it,
  re-invoke the loop; owns the TTL sweeper, D10.5),
- **`jobs.db`** (the state store, written through the **guarded** recorder
  tools — they refuse a red-gate advance, double-advance, or over-cap repair),
- the **SSE** progress projection (D6).

Everything that takes judgement is the agent's.

## Sub-decisions

- **D10.1 — judgement is agentic; the recorder tools are guarded writes**
  (amended 2026-05-31 after a `:predict` multi-persona critique). The agent
  owns all judgement; but `advance`/`open_repair`/`record_verdict` enforce
  mechanical invariants *in the write* (guarded SQL in one transaction):
  `advance` writes `terminal:pass` only on a green, not-yet-advanced gate
  (`UNIQUE(orch,group)`); `open_repair` refuses past the cap; `record_verdict`
  dedups on the delivery id. Bookkeeping, not judgement — it lives in the
  irreducible-I/O layer D10 already permits, and is a pure fold over rows
  already in `jobs.db`. **This supersedes the original "no code guards / the
  cap is a pure instruction" stance**, which the critique broke on two
  points: a wrong `advance` is *not* git-revertible in effect (it dispatches
  downstream implementers that commit + trigger CI), and CLAUDE.md's mandated
  `count == 0` guard test is unwritable unless advancing-on-red is a refusable
  code path. Hooks still never gate (a gating check is a verdict cell).
- **D10.2 — async re-entry = a fresh invocation, never a resumed session.**
  On a late verdict the inbound-gateway starts a **fresh** loop run that
  reconstructs from `jobs.db` (context is always provided from the db, not a
  conversation). Re-entry must be idempotent; single-flight is a
  per-orchestration queue (D10.6).
- **D10.3 — `advance()` records, the loop dispatches dependents.** `advance`
  only records `terminal:pass`; the loop reads `orchestration.yml` and
  dispatches the now-ready groups' implementers. No runtime scheduler.

## Why

Same principle as [[../concepts/ast-vs-llm-split]] /
[[never-add-framework-patterns-to-ast]]: **judgment → LLM/agent; mechanism →
code.** A new framework, verifier, or hook should need *instructions + yaml*,
not engine code. Putting the gate/routing/firing in a Python runtime couples
verification to a code engine and recreates the brittleness the AST/LLM split
exists to avoid.

## Rejected

- A runtime that fires an in-process Python `@hook` registry and owns
  gate-routing / drift-reopen in `events.py` (the pre-D10 model in
  `hooks-design.md`) — collapsed.
- A `blocking`/`advisory` hook split and hook *directives* mutating gate
  state — rejected; hooks never gate (a gating check is a verdict cell).
- A *policy* hard stop (a hook that vetoes the run) — rejected. Note the
  distinction from D10.1's adopted guards: the recorder write-guards enforce
  mechanical invariants over recorded state (gate-validity, no-double-advance,
  cap), not policy; they are I/O bookkeeping, not a runtime that judges.

## Consequences

- `hooks-design.md` collapsed 719→~140 lines (declaration + handler-ref
  grammar + transition points only).
- `verify-task-group` is a flat, flag-guarded command (modelled on
  `/orchestrate-tasks`) that only invokes the `verification-loop` agent — the
  one source of the procedure; the command restates nothing.
- The recorder tools (`advance`/`open_repair`/`record_verdict`) are guarded
  SQL writes against `jobs.db`, giving the `count == 0` guard test CLAUDE.md
  mandates.
- The inbound-gateway correlates by an **authenticated SHA→cell binding** recorded at
  CI-trigger time (D10.4), not by grepping commit-message trailers.
- Hooks fire in-process (not `.sh`) for the same Windows reason as the rest
  of the system ([[windows-first-compatibility]]).
- Further hardening from the same critique: the inbound-gateway owns a TTL sweeper
  and `timeout` is terminal (D10.5, liveness); re-invocation is single-flight
  per orchestration with last-writer cell projection + forward-reconciled
  dependent dispatch (D10.6); inputs are untrusted — profile-shipped hooks
  only, scoped tokens, delimited `failure_log` (D10.7). The spec carries a
  **DESIGN — NOT IMPLEMENTED** banner + build order (none of the runtime
  exists yet).

## Sources

- `haikai/specs/2026-05-20-async-verification-orchestration/spec.md` (D10–D10.7)
- [[../../raw/2026-05-31_async-verification-self-repair]]
