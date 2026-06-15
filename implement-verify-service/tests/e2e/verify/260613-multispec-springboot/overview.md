# Multi-spec orchestration arc — REAL Spring Boot e2e

Date: 2026-06-13 · haikai default loop · bounded (1 iteration) · **MULTISPEC_OK (15/15)**

## Goal
Prove the campaign's deploy/git fixes (Units 2/6/7) end-to-end against a REAL,
actually-running Spring Boot application with TWO features.

## App under test
A minimal but real Spring Boot 3.4.2 app (`spring-boot-starter-web`, embedded
Tomcat, executable jar) at `C:/Users/ozzie/AppData/Local/Temp/msb-springboot`.
Chosen over spring-petclinic deliberately: petclinic's JPA/H2/full-build weight is
orthogonal to the git+deploy+callback arc under test and risks the haibox build
timeout; a minimal real Spring Boot app exercises the same deploy mechanics (Maven
build → jar → embedded Tomcat → REST endpoints) deterministically and fast.
Spring Boot 3.4.2 deps were already cached in `~/.m2` from prior petclinic runs.

## Fidelity
Same level as `verify/260613-full-arc`: every code path the campaign changed is
REAL — `_git_one_spec` (the per-spec interleaved commit run_workflow's
on_spec_complete fires), `consolidate_and_deploy`, the haibox deploy (real
`mvn package` + `java -jar` inside the box), and `_emit_orchestration_callback`.
Only the LLM implement-tasks leg is stood in for: two real Java `@RestController`s
(`GreetingController` → `/api/one`, `FarewellController` → `/api/two`) represent
the per-spec generated code. haiboxd ran on 127.0.0.1:8785.

## What it proved (15 assertions, all PASS)
- **Unit 7 / B2** — each spec committed to its OWN branch with ONLY its files:
  `feature/add-greeting` has GreetingController and NOT FarewellController;
  `feature/add-farewell` the inverse. (This is the exact aliasing B2 caused; here
  it's proven absent through the real `_git_one_spec`.)
- **Unit 6 / L3** — `consolidate_and_deploy` merged both branches into an isolated
  worktree carrying BOTH controllers; the LIVE repo stayed on `main` with a clean
  working tree (no feature files leaked into it).
- **Deploy** — haibox built the merged source (`mvn package`) and ran the jar; the
  real Spring Boot server answered BOTH features live: `GET /api/one` → `200
  feature-one`, `GET /api/two` → `200 feature-two`.
- **Unit 2 / C5** — `_emit_orchestration_callback` returned `outcome=deployed` with
  `target_base_url` set and `callback_delivered=True` (bool captured, L10).
- Box released cleanly at the end.

## Guard
Affected unit suites stayed green: 94 passed
(`test_orchestration_multispec_b2`, `test_consolidate_deploy`,
`test_orchestration_deploy`, `test_callback_safety`, `test_inbound_gateway`,
`test_verification_store`, `test_anti_pattern_guards`).

## Honest notes
- LLM generation is stubbed (real Java controllers stand in), as in the prior
  full-arc. The B2 wiring (run_workflow → on_spec_complete → _git_one_spec) is
  unit-covered in `tests/test_orchestration_multispec_b2.py`; this e2e proves the
  REAL deploy of the integrated result on a running Spring Boot server.
- GitManager auto-appended its standard `.gitignore` patterns on each branch
  (expected behavior); it did not affect the per-spec file separation.

## haiboxd lifecycle (shutdown is part of the flow)
The driver OWNS haiboxd as a flow-scoped resource via a `haiboxd_running()` context
manager: started on enter, ALWAYS shut down on exit — success, assertion failure,
exception, or Ctrl-C. Shutdown is graceful-first: a `CTRL_BREAK_EVENT` (Windows
own-process-group) / `SIGTERM` triggers uvicorn's lifespan `finally` →
`registry.shutdown()`, which releases every box AND removes its workdir; a force
tree-kill is the fallback if it doesn't exit in 15s. The port is then polled until
free (escalates if a stray process holds it). Start failure kills the spawned-but-
unhealthy daemon before raising — no leaked process. Verified: graceful path frees
8785, and a fault-injected mid-flow exception still tears down cleanly.

## Reproduce
`python verify/260613-multispec-springboot/e2e_multispec.py` (with the project venv).
The driver boots haiboxd itself and shuts it down at the end — no manual daemon
management needed.
