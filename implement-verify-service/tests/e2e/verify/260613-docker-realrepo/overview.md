# Docker backend — REAL repo, REAL container, full haiboxd path

Date: 2026-06-13 · haikai default loop · bounded (1) · **DOCKER_REALREPO_OK (6/6)**

## What it proved
The new `DockerBackend` serves a real repo end-to-end through the unchanged haiboxd
control path — `HAIBOX_BACKEND=docker`, real Docker daemon (26.0.0):

- haiboxd control-plane `/healthz` reports `backend=docker`.
- `HaiboxClient().serve(...)` deployed the on-disk Spring Boot repo
  (`msb-springboot`) as a CONTAINER: image `maven:3.9-eclipse-temurin-17`, setup
  `mvn -q -B package -DskipTests` (built `target/msb.jar` in the bind-mounted
  workdir), command `java -jar target/msb.jar` binding `$PORT`.
- The box became healthy; `GET base_url/healthz → 200 "ok"` came from INSIDE the
  real container (`box-73cb364cf985`, host port 51762 → container 8080).
- The box record reports `backend=docker`; `docker ps` showed one container labeled
  `haibox.box_id=…` on the maven image.
- Release removed the container; haiboxd shut down cleanly; no stray
  `haibox.work_root`-labeled containers.

## Why this is a meaningful validation
Same seam as the local-backend Spring Boot e2e, but every layer is the Docker path:
the control service, API, registry, reaper, and `HaiboxClient` are byte-identical —
only `HAIBOX_BACKEND=docker` changed. The maven container actually compiled the real
repo and served it; the host never ran the build. This is the "add a class, not a
rewrite" claim demonstrated on a real workload.

## Lifecycle
Harness-owned: boots haiboxd, and in a `finally` releases the box, shuts haiboxd
down (graceful CTRL_BREAK → lifespan `registry.shutdown()`), waits for the port to
free, and force-removes any stray labeled container. Maven image pre-pulled so the
serve didn't time out.

## Guard
No `src/` change this round (driver is verify/ only) — the haibox suites remain
green from the DockerBackend implementation run (71 passed: local + docker, incl.
the gated real-daemon smoke).

## Reproduce
`python verify/260613-docker-realrepo/e2e_docker_realrepo.py` (project venv; needs a
Docker daemon + the msb-springboot repo on disk).
