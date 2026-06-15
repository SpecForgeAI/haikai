# Per-request backend — ONE haiboxd serves local + docker at once

Date: 2026-06-13 · haikai · **DUAL_BACKEND_OK (8/8)**

## What it proved
A single haiboxd (default `local`, both backends registered) routed two boxes to two
different backends by the per-request `backend` flag, simultaneously:
- control `/healthz` lists `backends == {local-subprocess, docker}`.
- a LOCAL box (no flag → default) served on a host subprocess; `box.backend ==
  local-subprocess`; `GET / == 200`.
- a DOCKER box (`backend=docker`, `image=node:22`) served in a CONTAINER on the SAME
  daemon; `box.backend == docker`; `GET / == 200`.
- both listed concurrently with distinct backends; a real `node:22` container exists
  for the docker box ONLY (the local box has none).
- release removed the container; haiboxd shut down cleanly; no stray containers.

## Why it matters
This is the integration Gary asked for: both implementations live behind ONE
control plane, and the caller picks per request (default = HAIBOX_BACKEND). The
Registry + RunManager now hold a backend MAP and route each box/run to the backend
it was created with; the API validates the choice early (`docker` w/o `image` → 422).
The flag threads down to HaiboxClient and up through the verification `target` serve
spec, so a bug fix or orchestration deploy can choose docker per job.

## Reproduce
`python verify/260613-dual-backend/e2e_dual_backend.py` (project venv; Docker daemon +
node:22 local).
