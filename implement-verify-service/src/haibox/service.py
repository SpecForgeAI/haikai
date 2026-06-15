"""haiboxd — the haibox local control service (FastAPI on 127.0.0.1).

Owns box lifetime independently of any caller, so a served target survives the
worker (or Haikai) restarting and can be re-used across a scoped re-run. Endpoints:

    POST   /boxes            launch -> health-check -> return base_url   (202)
    GET    /boxes            list
    GET    /boxes/{id}       inspect
    POST   /boxes/{id}/heartbeat   bump idle deadline (keep-alive)
    DELETE /boxes/{id}       release (terminate + cleanup)
    GET    /healthz          service liveness (no auth)

Auth: the same bearer scheme as the rest of the surface (verify_api_key /
STANDARDS_API_KEY) — every /boxes route is authed, matching the "all endpoints
authed" rule. Bind to 127.0.0.1 only; this is a local control plane.

Env:
    HAIBOX_WORK_ROOT     where box workdirs live (default: <tmp>/haibox)
    HAIBOX_MAX_BOXES     concurrency cap (default 8)
    HAIBOX_REAP_INTERVAL reaper period seconds (default 15)
    STANDARDS_API_KEY    bearer key (shared with the main API)
"""

from __future__ import annotations

import os
import tempfile
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from fastapi.responses import StreamingResponse

from ..api_auth import verify_api_key
from .backends import backend_aliases, build_backends
from .models import HEALTH_HTTP, BoxSpec, RunSpec
from .registry import CapacityError, LaunchError, Registry, make_reaper
from .runs import RunManager, RunStore


# ─────────────────────────────── wire shapes ────────────────────────────────


class CreateBoxRequest(BaseModel):
    command: list[str] | str = Field(..., description="Process to start (argv list or shell string)")
    setup: Optional[list[str] | str] = Field(None, description="Build/deps step run before command")
    setup_timeout: float = 300.0
    source_dir: Optional[str] = Field(None, description="Tree copied into the box workdir")
    env: dict[str, str] = Field(default_factory=dict)
    port_env: str = "PORT"
    health_type: str = HEALTH_HTTP
    health_path: str = "/"
    readiness_timeout: float = 30.0
    ttl_seconds: float = 1800.0
    idle_seconds: float = 600.0
    name: Optional[str] = None
    image: Optional[str] = Field(None, description="Container image (required by the docker backend)")
    host: Optional[str] = Field(None, description="SSH target user@host[:port] (required by the remote-ssh backend)")
    backend: Optional[str] = Field(None, description="'local'|'docker'|'remote-ssh'; default = HAIBOX_BACKEND")

    def to_spec(self) -> BoxSpec:
        return BoxSpec(
            command=self.command, setup=self.setup, setup_timeout=self.setup_timeout,
            source_dir=self.source_dir,
            env=self.env, port_env=self.port_env, health_type=self.health_type,
            health_path=self.health_path, readiness_timeout=self.readiness_timeout,
            ttl_seconds=self.ttl_seconds, idle_seconds=self.idle_seconds, name=self.name,
            image=self.image, host=self.host,
        )


# ───────────────────────────────── app ──────────────────────────────────────


class CreateRunRequest(BaseModel):
    command: list[str] | str = Field(..., description="Command/suite to run (argv list or shell string)")
    setup: Optional[list[str] | str] = None
    setup_timeout: float = 300.0
    source_dir: Optional[str] = None
    env: dict[str, str] = Field(default_factory=dict)
    timeout_seconds: float = 1800.0
    name: Optional[str] = None
    image: Optional[str] = Field(None, description="Container image (required by the docker backend)")
    host: Optional[str] = Field(None, description="SSH target (required by the remote-ssh backend)")
    backend: Optional[str] = Field(None, description="'local'|'docker'|'remote-ssh'; default = HAIBOX_BACKEND")

    def to_spec(self) -> RunSpec:
        return RunSpec(command=self.command, setup=self.setup, setup_timeout=self.setup_timeout,
                       source_dir=self.source_dir, env=self.env,
                       timeout_seconds=self.timeout_seconds, name=self.name, image=self.image,
                       host=self.host)


def _work_root() -> str:
    work_root = os.getenv("HAIBOX_WORK_ROOT") or os.path.join(tempfile.gettempdir(), "haibox")
    os.makedirs(work_root, exist_ok=True)
    return work_root


def canonical_backend(name: str) -> str:
    """Map an alias ('local'/'docker'/...) to a registered canonical name, or raise.
    Aliases come from the backend registry — no hardcoded table here."""
    key = backend_aliases().get((name or "").lower())
    if key is None:
        raise ValueError(f"unknown backend {name!r} (have {sorted(set(backend_aliases().values()))})")
    return key


def _resolve_backend(req_backend, available, default: str) -> str:
    """Resolve the request's backend choice to a registered key. Omitted -> the
    server default; unknown -> ValueError (the caller 422s). Per-backend spec
    preconditions live on the backend (validate_spec), NOT here — so this stays
    generic as more backends arrive."""
    name = canonical_backend(req_backend) if req_backend else default
    if name not in available:
        raise ValueError(f"backend {name!r} not available (have {sorted(available)})")
    return name


def _build_backends() -> tuple[dict, str]:
    """Every registered backend, keyed by canonical name, plus the DEFAULT from
    HAIBOX_BACKEND. Built from the registry — adding a backend needs NO edit here.
    Per-request routing chooses among them; the env just sets the default."""
    backends = build_backends()
    default = canonical_backend(os.getenv("HAIBOX_BACKEND", "local"))
    return backends, default


def _build_backend():
    """Back-compat: the DEFAULT backend instance (used by the factory test)."""
    backends, default = _build_backends()
    return backends[default]


def _build_registry() -> Registry:
    backends, default = _build_backends()
    return Registry(backends, work_root=_work_root(), default=default,
                    max_boxes=int(os.getenv("HAIBOX_MAX_BOXES", "8")))


def _build_run_manager() -> RunManager:
    work_root = _work_root()
    db = os.getenv("HAIBOX_RUNS_DB") or os.path.join(work_root, "haibox-runs.db")
    backends, default = _build_backends()  # same map + default as the registry
    return RunManager(backends, work_root=work_root, store=RunStore(db), default=default,
                      max_concurrent=int(os.getenv("HAIBOX_MAX_RUNS", "8")))


def create_app(registry: Registry | None = None, run_manager: RunManager | None = None) -> FastAPI:
    registry = registry or _build_registry()
    run_manager = run_manager or _build_run_manager()
    reap_interval = float(os.getenv("HAIBOX_REAP_INTERVAL", "15"))

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        import logging
        import threading
        # G2: a previous haiboxd may have died leaving detached boxes (processes
        # AND/OR containers). Reclaim across ALL registered backends before handing
        # out new ones — the service doesn't branch on which backend it is.
        orphans = registry.sweep_orphans()
        if orphans:
            logging.getLogger(__name__).info("haibox: swept %d orphaned box(es) on startup", len(orphans))
        reaper = make_reaper(registry, interval=reap_interval)
        thread = threading.Thread(target=reaper, name="haibox-reaper", daemon=True)
        thread.start()
        try:
            yield
        finally:
            reaper.stop.set()  # type: ignore[attr-defined]
            registry.shutdown()
            run_manager.shutdown()

    app = FastAPI(title="haiboxd", description="Haikai local sandbox runner", lifespan=lifespan)
    app.state.registry = registry
    app.state.run_manager = run_manager

    @app.get("/healthz")
    def healthz():
        return {"status": "ok", "backend": registry.backend.name,
                "backends": sorted(registry.backends), "default_backend": registry.default_backend,
                "active": len(registry.list()), "max": registry.max_boxes}

    @app.post("/boxes", status_code=status.HTTP_201_CREATED)
    def create_box(req: CreateBoxRequest, _: bool = Depends(verify_api_key)):
        try:
            spec = req.to_spec()
            backend_name = _resolve_backend(req.backend, registry.backends, registry.default_backend)
            registry.backends[backend_name].validate_spec(spec)  # per-backend precondition
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        try:
            box = registry.create(spec, backend=backend_name)
        except CapacityError as exc:
            raise HTTPException(status_code=429, detail=str(exc))
        except LaunchError as exc:
            raise HTTPException(status_code=502, detail=str(exc))
        return box.to_public()

    @app.get("/boxes")
    def list_boxes(_: bool = Depends(verify_api_key)):
        return {"boxes": [b.to_public() for b in registry.list()]}

    @app.get("/boxes/{box_id}")
    def get_box(box_id: str, _: bool = Depends(verify_api_key)):
        box = registry.get(box_id)
        if not box:
            raise HTTPException(status_code=404, detail=f"no box {box_id}")
        return box.to_public()

    @app.get("/boxes/{box_id}/logs")
    def get_logs(box_id: str, tail: int = 65536, _: bool = Depends(verify_api_key)):
        log = registry.read_log(box_id, max_bytes=tail)
        if log is None:
            raise HTTPException(status_code=404, detail=f"no box {box_id}")
        return {"box_id": box_id, "log": log}

    @app.post("/boxes/{box_id}/heartbeat")
    def heartbeat(box_id: str, _: bool = Depends(verify_api_key)):
        box = registry.touch(box_id)
        if not box:
            raise HTTPException(status_code=404, detail=f"no box {box_id}")
        return box.to_public()

    @app.delete("/boxes/{box_id}")
    def delete_box(box_id: str, _: bool = Depends(verify_api_key)):
        if not registry.release(box_id):
            raise HTTPException(status_code=404, detail=f"no box {box_id}")
        return JSONResponse({"status": "released", "box_id": box_id})

    # ── runs: async ephemeral execution (crabbox "run a suite") ──────────────
    @app.post("/runs", status_code=status.HTTP_202_ACCEPTED)
    def create_run(req: CreateRunRequest, _: bool = Depends(verify_api_key)):
        """Submit a command/suite. Returns IMMEDIATELY with a run_id (202) —
        the command runs in the background; poll GET /runs/{id} or stream."""
        try:
            spec = req.to_spec()
            backend_name = _resolve_backend(req.backend, run_manager.backends, run_manager.default_backend)
            run_manager.backends[backend_name].validate_spec(spec)  # per-backend precondition
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        try:
            run = run_manager.submit(spec, backend=backend_name)
        except CapacityError as exc:
            raise HTTPException(status_code=429, detail=str(exc))
        return run.to_public()

    @app.get("/runs")
    def list_runs(_: bool = Depends(verify_api_key)):
        return {"runs": [r.to_public() for r in run_manager.list()]}

    @app.get("/runs/{run_id}")
    def get_run(run_id: str, _: bool = Depends(verify_api_key)):
        run = run_manager.get(run_id)
        if not run:
            raise HTTPException(status_code=404, detail=f"no run {run_id}")
        return run.to_public()

    @app.get("/runs/{run_id}/logs")
    def get_run_logs(run_id: str, tail: int = 1_000_000, _: bool = Depends(verify_api_key)):
        run = run_manager.get(run_id)
        if not run:
            raise HTTPException(status_code=404, detail=f"no run {run_id}")
        return {"run_id": run_id, "log": run_manager.read_log(run, max_bytes=tail)}

    @app.get("/runs/{run_id}/stream")
    async def stream_run(run_id: str, _: bool = Depends(verify_api_key)):
        """SSE: stream stdout/stderr as it's written, then a final `exit` event
        carrying the state + exit code."""
        if not run_manager.get(run_id):
            raise HTTPException(status_code=404, detail=f"no run {run_id}")

        async def _gen():
            import asyncio
            import json as _json
            sent = 0
            for _ in range(7200):  # bounded long-poll
                run = run_manager.get(run_id)
                full = run_manager.read_log(run, max_bytes=5_000_000)
                if len(full) > sent:
                    yield f"event: log\ndata: {_json.dumps(full[sent:])}\n\n"
                    sent = len(full)
                if run.state.terminal:
                    yield ("event: exit\ndata: "
                           + _json.dumps({"state": run.state.value, "exit_code": run.exit_code})
                           + "\n\n")
                    return
                await asyncio.sleep(0.4)

        return StreamingResponse(_gen(), media_type="text/event-stream")

    @app.delete("/runs/{run_id}")
    def delete_run(run_id: str, _: bool = Depends(verify_api_key)):
        if not run_manager.delete(run_id):
            raise HTTPException(status_code=404, detail=f"no run {run_id}")
        return JSONResponse({"status": "deleted", "run_id": run_id})

    return app


app = create_app()


def main() -> None:
    import logging
    import uvicorn

    host = os.getenv("HAIBOX_HOST", "127.0.0.1")  # local control plane: loopback only
    port = int(os.getenv("HAIBOX_PORT", "8780"))
    if host not in ("127.0.0.1", "localhost", "::1"):
        # A bearer-key holder can launch arbitrary processes; off-loopback that's
        # remotely reachable RCE. Surface it loudly (see README → Security).
        logging.getLogger(__name__).warning(
            "haiboxd binding NON-LOOPBACK host %r — anyone who can reach this port "
            "+ holds the bearer key can run arbitrary processes. Put a real auth "
            "proxy in front or bind 127.0.0.1.", host,
        )
    uvicorn.run("src.haibox.service:app", host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
