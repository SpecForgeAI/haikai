# haibox — live run against REAL projects

Goal: actually run haibox (the real `haiboxd` service, not TestClient) and prove
the feature works against real GitHub repos; fix anything that breaks.

## Result: works end-to-end ✓

Booted the real service:
`STANDARDS_API_KEY=… HAIBOX_PORT=8785 HAIBOX_WORK_ROOT=…/haibox-live python -m src.haibox.service`
→ `healthz {"status":"ok","backend":"local-subprocess"}`.

| Target | Real repo | What it proved | Result |
|---|---|---|---|
| A | `render-examples/fastapi` (Python) | source-copy → serve → base_url → HTTP replay → logs → release | `GET /` → `200 {"message":"Hello World"}`; `GET /items/42?q=live` → `200 {"item_id":42,"q":"live"}`; logs retrievable; released |
| B | `digitalocean/sample-flask` (Python) | **setup/deps step (G5)** with a real `pip install flask` (Flask was NOT in the venv) → serve → replay | setup ran (pip in log), `GET /` → `200` HTML (7392 bytes, real template); released |
| C | `spring-guides/gs-rest-service` (Java/**Spring Boot 4**) | heavy path: real **Maven build** (`.\mvnw.cmd package`) in `setup` + JVM boot + **`port_env=SERVER_PORT`** | served in 12s; `GET /greeting?name=Live` → `200 {"id":2,"content":"Hello, Live!"}`; DispatcherServlet in logs; released |
| D | `spring-projects/spring-petclinic` (Java/**Spring Boot 4**, canonical) | a substantial real app (Thymeleaf templates, embedded DB, webjars) | served in 25s; `GET /` → `200` (2751B welcome page, "petclinic" present); `GET /owners/find` → `200`; Tomcat started in logs; released |
| — | (deliberate bad target) | **failure debuggability (G1)** live | `502` with `"FATAL: cannot bind, aborting"` captured in the error tail |

Polyglot proof: Python (FastAPI, Flask) + Java (two Spring Boot apps). The
`setup` step (G5) exercised with real `pip install` AND real `mvnw package`;
`port_env` exercised with both `PORT` and Spring's `SERVER_PORT`.

Replays hit the real apps on real OS-assigned ports (52862, 54236, …) via the
`base_url` haibox returned — exactly the "deploy a target, replay against it"
loop the migration-reconciliation contract needs.

## Pre-run fixes (round-2 review defects, fixed before the live run)
- **N1** fd leak — parent's log file handle now closed after `Popen`.
- **N2** unbounded `setup` — now bounded by `setup_timeout` (default 300s); a
  hanging build fails the launch with its tail instead of blocking forever.
- **N3** pid-reuse hazard in `sweep_orphans` — only kills a recorded pid if its
  workdir still exists.

## Fixed DURING the run (surfaced live by the Spring Boot test)
- **N5** On a `setup` failure the workdir was `rmtree`d *while its log file was
  still open*, so on Windows the (open) `_haibox.log` couldn't be deleted and a
  stray dir leaked. Fixed: defer the cleanup until after the log handle closes.
  (Surfaced when the first Java attempt failed with `'mvnw.cmd' is not
  recognized` — itself a driver fix: use `.\mvnw.cmd` since Windows `cmd` doesn't
  search the box cwd. haibox behaved correctly throughout — G1 gave the reason.)

## Tests
31 haibox unit/integration tests green (incl. N1 repeated-launch smoke + N2
setup-timeout). The live run added empirical proof on top: 2 real repos, real
HTTP, a real dependency install, and live failure-log capture.

## Drivers (reproducible)
`driver.py` (target A + failure path), `driver_b.py` (target B + setup deps).
Point them at a running haiboxd on `127.0.0.1:8785` with the bearer key.

## Async RUN mode (crabbox "run a suite") — added + verified live

The synchronous serve mode was joined by an **async run mode**: submit a
command/suite, get a `run_id` back immediately, stream stdout/stderr, capture the
exit code. Run records persist to SQLite (pollable + restart-recoverable).

| Run | Real repo | Proof | Result |
|---|---|---|---|
| A | `gs-rest-service` | real JUnit suite via `.\mvnw.cmd test`, **async + SSE stream** | submitted in **0.02s** (state=queued); streamed log events + `event: exit`; **exit_code 0** |
| B | `render-examples/fastapi` | `pytest` (no tests) — non-zero exit capture | async submit; **exit_code 5** (failed), captured from a real tool |

`GET /runs` listed both with their states + exit codes. This is the observability
gap addressed: durable run IDs, poll/stream, and restart-recovery (a run left
mid-flight is recovered as `interrupted` — unit-tested). Driver: `driver_run.py`.

## Boundary / honest notes
- The in-repo **diagrams** node app was NOT used as a target: serving it needs
  `node_modules` in the box (a 14-min reinstall or a huge copy), too heavy for a
  quick live run — a future `DockerBackend` (image with deps baked) is the right
  home for node targets.
- The worker still doesn't call `provision_for_job` inside the verify flow
  (opt-in/library + the compose service); wiring that is the remaining last mile.
- The `setup` step installed Flask into the shared venv (uninstalled afterward).
