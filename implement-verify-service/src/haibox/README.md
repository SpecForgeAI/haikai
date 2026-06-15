# haibox — Haikai's lightweight local sandbox runner

**Warm a box, serve the target, replay against it.** A single-machine take on the
crabbox model (we took the *ideas*, not the code): prepare an isolated workspace,
start a target as a child process, health-check it, hand back a `base_url` to
replay against, then tear it down. Built to answer the migration-reconciliation
question *"who deploys the target so the reconciler can replay against it?"*

## Architecture (the part that lets it scale without a rewrite)

```
caller (worker / Haikai / CLI)
        │  HTTP (127.0.0.1, bearer)
        ▼
haiboxd  — control service (FastAPI)        ← STAYS IDENTICAL as you scale
  POST/GET/DELETE /boxes  + TTL/idle reaper + concurrency cap + registry
        │
        ▼  Backend protocol:  launch(spec) -> handle ; is_alive ; terminate
   LocalSubprocessBackend  (today — child process on this machine)
   DockerBackend / RemoteSSHBackend / K8sBackend  (add a class, not a rewrite)
```

Only the **backend** knows *where* a box runs. The service, registry, reaper,
health prober, client, CLI, and every caller are backend-agnostic. Readiness is
a transport-agnostic probe against `base_url`, so it lives in `wait_healthy`, not
in the backend.

## Run it

```sh
# start the control service (loopback only)
STANDARDS_API_KEY=… python -m src.haibox.service      # haiboxd on 127.0.0.1:8780

# serve a target by hand (optional --setup runs a build/deps step first)
python -m src.haibox.cli serve --source ./repo --setup "pip install -r requirements.txt" \
    --health-path /healthz -- python app.py
python -m src.haibox.cli list
python -m src.haibox.cli logs box-abc123        # tail of the target's stdout/stderr
python -m src.haibox.cli release box-abc123
```

If a target never goes healthy you get a `502` whose error carries the log tail,
and the box is kept (state `failed`) so `logs`/`GET /boxes/{id}/logs` still work
until the TTL reaps it. A `setup` step that exits non-zero fails the launch with
its log tail in the error.

| Env | Default | Meaning |
|---|---|---|
| `HAIBOX_HOST` | `127.0.0.1` | bind host — **keep it loopback** (see Security) |
| `HAIBOX_PORT` | `8780` | service port |
| `HAIBOX_WORK_ROOT` | `<tmp>/haibox` | where box workdirs live |
| `HAIBOX_MAX_BOXES` | `8` | concurrency cap |
| `HAIBOX_REAP_INTERVAL` | `15` | reaper period (seconds) |
| `STANDARDS_API_KEY` | — | bearer key (shared with the main API) |
| `HAIBOX_URL` | `http://127.0.0.1:8780` | client/CLI target |

## Run mode — async ephemeral execution (crabbox "run a suite")

Alongside *serve* (host a long-lived target), haibox can *run* a command/suite:
submit it, get a `run_id` back **immediately**, the command executes in the
background, stdout/stderr **stream**, and the **exit code** is captured. Run
records are persisted to SQLite so they're pollable and **survive a restart**
(a run left mid-flight is recovered as `interrupted`).

```sh
# run a suite; stream output live; the CLI exits with the run's exit code
python -m src.haibox.cli run --source ./repo -- pytest -q
python -m src.haibox.cli runs                 # list runs (state + exit_code)
python -m src.haibox.cli run-status run-abc123
python -m src.haibox.cli run-logs run-abc123
```

| Endpoint | Purpose |
|---|---|
| `POST /runs` | submit a command/suite → **202 immediately** with `run_id` (async) |
| `GET /runs` · `GET /runs/{id}` | list / poll (state, `exit_code`) |
| `GET /runs/{id}/logs?tail=N` | output snapshot |
| `GET /runs/{id}/stream` | **SSE**: `event: log` chunks as they're written, then `event: exit` with the code |
| `DELETE /runs/{id}` | stop + clean up |

Serve vs run: **serve** returns a `base_url` to replay HTTP against (long-lived);
**run** returns an `exit_code` after the command finishes (ephemeral). Both share
the same Backend (workspace + setup + process), so both scale via new backends.

## Use from the verification worker

```python
from src.haibox.integration import serving_target

with serving_target(command=["python", "app.py"], source_dir=repo_dir,
                    health_path="/healthz") as box:
    reconcile_against(box["base_url"])   # replay captured ops here
# box is released here even if reconcile_against raised
```

`provision_for_job(payload)` reads an optional `payload["target"]` block so the
worker can branch on whether a job needs a deployed target. Nothing in the
existing verify flow changes unless a job asks for one.

## Adding a backend (the scale path)

Implement the `Backend` protocol (`src/haibox/backends.py`) and pass an instance
to `Registry`. The service, registry, reaper, health prober, and callers are untouched.

```python
class DockerBackend:
    name = "docker"

    def launch(self, box_id, spec, work_root) -> dict:
        # 1. SOURCE TRANSFER is YOUR job here (see caveat): build/COPY spec.source_dir
        #    into the image/container — work_root is a LOCAL hint, not your filesystem.
        # 2. docker run -d -p <free>:<inner> ...  (inject the port as spec.port_env)
        # return {"base_url", "port", "container_id", ...}
        ...
    def is_alive(self, handle) -> bool:  ...   # docker inspect .State.Running
    def stop(self, handle) -> None:      ...   # docker stop/kill — KEEP logs (idempotent)
    def cleanup(self, handle) -> None:   ...   # docker rm -v (idempotent)
    def read_log(self, handle, max_bytes=65536) -> str:  ...   # docker logs --tail
    def terminate(self, handle) -> None: self.stop(handle); self.cleanup(handle)
```

Contract:
- `launch` returns a JSON-able handle with at least `base_url` and `port`, and
  **owns getting the source into its environment**. Raise on setup/provision
  failure — the message surfaces as `box.error`.
- `stop` kills the workload but **keeps logs**; `cleanup` removes artifacts; both
  idempotent. `read_log` returns the tail. (`stop`/`cleanup` are split so a
  *failed* box can be stopped while its log survives for inspection — see G1.)
- Readiness is NOT the backend's job — `wait_healthy` probes `base_url` for you.

**Honest caveat on the scale path (source sync).** The seam is proven for
`LocalSubprocessBackend` (it `copytree`s a local dir into `work_root`). A
**remote** backend (SSH / Docker-on-a-remote-host / K8s) must transfer source
itself inside `launch` — there is **no shared sync primitive yet** and
`work_root` is meaningless off-machine. When a remote backend lands, add a
`sync(spec, dest)` step to the protocol (or a shared `SourceSync` helper) so
transfer isn't reimplemented per backend. Until then, "just add a class" holds
for *local-like* backends; remote ones also carry the sync work.

Natural next backends: **DockerBackend** (real isolation; same machine or remote
Docker host), **RemoteSSHBackend** (another machine — crabbox's model),
**K8sBackend** (GKE — each box a pod/Job). The service is just a FastAPI app, so
containerizing *it* and deploying to Docker/GKE is independent and trivial.

## Security posture (read before exposing)

- **Loopback + bearer is the trust boundary.** Every `/boxes` route requires the
  bearer key; the service binds `127.0.0.1` by default. **A bearer-key holder can
  run arbitrary processes** — that's the feature, so treat the key like an RCE
  credential and **do not bind haiboxd to a non-loopback interface** without a
  real auth proxy in front. The service logs a warning if `HAIBOX_HOST` isn't loopback.
- **Lightweight isolation ≠ containment.** A box is a separate workdir + process
  group, running with the *same privileges as haiboxd*. It is not a security
  sandbox. For untrusted code use a future `DockerBackend`/`K8sBackend`.
- **No per-box CPU/memory limits** (subprocess). The concurrency cap + TTL/idle
  reaper bound *count* and *lifetime*, not resource usage. Known gap; add cgroup/
  container limits via a containerized backend if you need them.
- Box logs (`_haibox.log`) may contain target output — treat as secret-bearing.
