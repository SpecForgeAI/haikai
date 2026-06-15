# Judgement layer exercised — the real agents, a real bug, a real fix

The mechanism (store/recorder/gateway) was already proven; this run exercised
the JUDGEMENT side: the actual `verification-loop.md` and `repair-engine.md`
prompts, executed by agents, against a really broken repo. Re-entry was
always-fresh per D10.2 (each loop run reconstructed from the db).

## The story (all real — no mocks)

1. demo-repo created with a genuine SyntaxError (`def add(a, b)` — missing colon).
2. **verification-loop run #1** (fresh agent following verification-loop.md):
   ran `compileall` for real → fail → recorded attempt 1 via the guarded CLI →
   tried `advance` and HIT the real D5 refusal ("red-gate advance — fail") →
   classified the failure `code` (D4) → opened repair attempt 1 → returned the
   decision with the failure_log DELIMITED as untrusted text (D10.7).
3. **repair-engine** (agent following repair-engine.md): read the failing
   file, made the MINIMAL fix (`+def add(a, b):` — one line, no drive-bys),
   confirmed locally (exit 0).
4. **verification-loop run #2** (fresh re-entry): re-ran the verifier for
   real → pass → recorded attempt 2 (last-writer, D10.6) → gate folded green →
   `advance` succeeded → second advance REFUSED ("double advance — D10.6") →
   checklist closed.

## Durable evidence (the db)

verdicts:  (demo-repo, inline, 1, fail) → (demo-repo, inline, 2, pass)
state:     g1 = advanced
repairs:   (demo-repo, inline, attempt 1)
events:    verdict_recorded → repair_opened → checklist_updated×3 →
           verdict_recorded → advanced → checklist_updated
file:      calc.py actually fixed on disk

## Guards exercised by the agents (not by tests)

- red-gate advance refusal (D5/D10.1) — loop run #1
- double-advance refusal (D10.6) — loop run #2
- untrusted failure_log delimiting (D10.7) — loop → repair handoff

## Honest boundary

The two loop runs + repair were dispatched by the orchestrating session
(subagents can't spawn subagents); in production the gateway-enqueued job
plays that dispatcher role. Everything below the dispatch — the prompts
followed, the commands run, the refusals hit, the file fixed — was real.
