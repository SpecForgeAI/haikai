# Full verification — polyrepo, all three verifier types, real CI/CD

No existing polyrepo had real self-verification (the petclinic fixtures use
mock URLs), so per instruction two PRIVATE GitHub repos were created with
real Actions CI/CD and the complete verify-task-group flow run over them.

## The task group

orchestrate_id=orch-poly2, task_group_id=g1, touched_repos=[slugify-svc, textfmt-svc].
- slugify-svc = the real feature built earlier via the SDD APIs (11 tests).
- textfmt-svc = a sibling truncate util (5 tests); had a genuine word-boundary
  bug caught by its own test locally and fixed before push.

## The 6-cell matrix (verifier types, all real)

| repo | inline | rubric | ci-trigger |
|---|---|---|---|
| slugify-svc | pass (local pytest 11/11) | pass (rubric-verifier agent) | pass (live GitHub Actions → webhook) |
| textfmt-svc | pass (local pytest 5/5)   | pass (rubric-verifier agent) | pass (live GitHub Actions → webhook) |

- inline: src/verification/inline_runner ran compileall+pytest for real.
- rubric: two rubric-verifier AGENTS scored each repo against rubrics/g1.md
  (5 qualitative signals) and recorded via the guarded recorder.
- ci-trigger: each repo pushed → real private-repo Actions run → HMAC-signed
  workflow_run webhooks through a cloudflared tunnel to the inbound-gateway →
  correlated by the D10.4 binding → verdict pending→pending→pass (last-writer).

## The gate

A FRESH verification-loop agent reconstructed all 6 cells from the db, folded
the D5 AND gate over the full expected_cells list, and the guarded advance
ACCEPTED (a red gate or double-advance would have refused — so the fold is
store-validated, not eyeballed).

## Durable evidence (verify.db)

- 6 logical cells, all latest verdict = pass
- task_group_state: g1 = advanced
- checklist: g1-verification = done
- 7 real webhook deliveries recorded (dedup table)

## Teardown

Both webhooks deleted; tunnel + API stopped; creds destroyed. Two private
repos remain (deletable): OzzieBelazi/sx-slugify-svc, sx-textfmt-svc.
