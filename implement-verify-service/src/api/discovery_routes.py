"""REST endpoints for V1 LLM-driven discovery + diagnostics.

Mounted under `/api/discovery`. Wraps the V1 discovery functions
(`endpoint_discoverer.discover_endpoints`, `diagram_discoverer.discover_diagrams`)
so they can be invoked standalone (previously only reachable via the
internal AST pipeline or Haikai skills). Also exposes the conversation
trace files saved by `discovery_loop._save_trace` for debugging.

All discovery operations need an existing structural-store snapshot.
Produce one first via `POST /api/v1/structural/analyze` or the
`analyze` CLI command.
"""
from __future__ import annotations

import json
import logging
import re
import tempfile
from dataclasses import asdict
from pathlib import Path
from typing import Any, Literal, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from src.llm_client_factory import build_llm_client

# Model identifiers we accept in path-forming params. Real model names look
# like "claude-sonnet-4-6" or "gpt-5.4-mini". The negative lookahead forbids
# any "..", since `model=..` alone would form `<discovery>_trace_...json` —
# weird input that has no legitimate use.
_SAFE_MODEL_RE = re.compile(r"^(?!.*\.\.)[A-Za-z0-9._-]+$")

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/discovery", tags=["discovery"])


# No code-level defaults for LLM configuration. Caller must supply provider,
# model, and (for provider='custom') base_url via the request body or env
# vars: LLM_PROVIDER, LLM_MODEL, LLM_BASE_URL. Missing config → 400.


class DiscoverEndpointsRequest(BaseModel):
    project_root: str = Field(
        ...,
        description="Absolute path to the codebase root.",
        examples=["/repos/spring-petclinic"],
    )
    snapshot_path: str = Field(
        ...,
        description=(
            "Absolute path to a structural-store snapshot directory "
            "(must contain `_index.txt`). Produce one via the `analyze` "
            "CLI or `POST /api/v1/structural/analyze`."
        ),
        examples=["/repos/spring-petclinic/.specforge/structural/spring-petclinic/c7ee170"],
    )
    provider: Optional[str] = Field(
        None,
        description=(
            "LLM provider. Required: pass here or set env `LLM_PROVIDER`. "
            "No code-level default."
        ),
        examples=["custom"],
    )
    model: Optional[str] = Field(
        None,
        description=(
            "LLM model identifier. Required: pass here or set env `LLM_MODEL`. "
            "No code-level default."
        ),
    )
    log_dir: Optional[str] = Field(
        None,
        description=(
            "Where Claude CLI ('custom' provider) writes its endpoints JSON. "
            "Defaults to system temp."
        ),
    )


class DiscoverEndpointsResponse(BaseModel):
    count: int = Field(..., description="Number of endpoints discovered.")
    endpoints: list[dict[str, Any]] = Field(
        ...,
        description="Serialized `EndpointInfo` records (type, path, operation, handler_class, handler_method, file, line, framework, ...).",
    )
    provider: str = Field(..., description="LLM provider that was actually used.")
    model: str = Field(..., description="LLM model that was actually used.")


def _build_llm_client(provider: Optional[str], model: Optional[str], log_dir: Optional[str]):
    """Web wrapper around `build_llm_client` — translates ValueError → 400 and
    LLMClient construction failures → 500. The actual logic lives in
    `src.llm_client_factory` so the CLI can use it without dragging in the
    FastAPI app.
    """
    try:
        return build_llm_client(provider, model, log_dir)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"failed to construct LLM client: {e}")


@router.post(
    "/endpoints",
    response_model=DiscoverEndpointsResponse,
    summary="Discover API endpoints (V1, LLM-driven)",
    operation_id="discover_endpoints",
    responses={
        404: {"description": "`project_root` or `snapshot_path` does not exist."},
        400: {"description": "`snapshot_path` is not a valid structural store (missing `_index.txt`)."},
        500: {"description": "LLM client construction failed or discovery raised."},
    },
)
def post_discover(req: DiscoverEndpointsRequest) -> DiscoverEndpointsResponse:
    """Run V1 LLM-driven endpoint discovery on an existing structural-store snapshot.

    The agent reads the snapshot's structural data (imports, calls, index) and
    target source files, then identifies HTTP/WebSocket/MQ/gRPC/scheduled
    endpoints using its framework knowledge. No hard-coded pattern matching.

    **Prerequisites:** a structural-store snapshot built by the `analyze` CLI
    or `POST /api/v1/structural/analyze`.

    **LLM config is required** (no defaults). Provide via request body or
    env: `LLM_PROVIDER`, `LLM_MODEL`, and (for `provider=custom`) `LLM_BASE_URL`.
    """
    project_root = Path(req.project_root)
    snapshot_path = Path(req.snapshot_path)

    if not project_root.exists():
        raise HTTPException(404, f"project_root not found: {project_root}")
    if not snapshot_path.exists():
        raise HTTPException(404, f"snapshot_path not found: {snapshot_path}")
    if not (snapshot_path / "_index.txt").exists():
        raise HTTPException(
            400,
            f"snapshot_path does not look like a structural store (missing _index.txt): {snapshot_path}",
        )

    llm_client = _build_llm_client(req.provider, req.model, req.log_dir)

    from src.ast.endpoint_discoverer import discover_endpoints

    try:
        endpoints = discover_endpoints(
            llm_client=llm_client,
            project_root=str(project_root),
            snapshot_path=str(snapshot_path),
        )
    except Exception as e:
        logger.exception("V1 discovery failed")
        raise HTTPException(500, f"discovery failed: {e}")

    return DiscoverEndpointsResponse(
        count=len(endpoints),
        endpoints=[asdict(ep) for ep in endpoints],
        provider=llm_client.provider,
        model=llm_client.model,
    )


# ─── POST /api/discovery/diagrams ────────────────────────────────────────────


class DiscoverDiagramsRequest(DiscoverEndpointsRequest):
    """Same shape as endpoint discovery — agent reads the snapshot, decides
    which diagrams (class / inheritance / dependency / component / pattern)
    are worth generating, and emits DiagramModel JSON."""


class DiscoverDiagramsResponse(BaseModel):
    count: int = Field(..., description="Number of diagrams generated.")
    diagrams: list[dict[str, Any]] = Field(
        ...,
        description="Serialized `DiagramModel` records (diagram_type, title, entities, relationships, metadata).",
    )
    provider: str
    model: str


@router.post(
    "/diagrams",
    response_model=DiscoverDiagramsResponse,
    summary="Generate architecture diagrams (V1, LLM-driven)",
    operation_id="discover_diagrams",
    responses={
        404: {"description": "`project_root` or `snapshot_path` does not exist."},
        400: {"description": "`snapshot_path` missing required structural data, or LLM config missing."},
        500: {"description": "LLM client construction failed or discovery raised."},
    },
)
def post_diagrams(req: DiscoverDiagramsRequest) -> DiscoverDiagramsResponse:
    """Run V1 LLM-driven diagram discovery on an existing snapshot.

    The agent surveys what enrichment data exists (endpoints, interactions,
    calls, index, imports, inheritance), picks which diagrams are worth
    generating, and emits DiagramModel JSON.

    **Prerequisites:** `_endpoints.txt` and/or `_interactions.txt` in the
    snapshot (otherwise no diagrams are generated). Run endpoint /
    interaction discovery first.

    **LLM config is required** — same as `/endpoints`.
    """
    project_root = Path(req.project_root)
    snapshot_path = Path(req.snapshot_path)

    if not project_root.exists():
        raise HTTPException(404, f"project_root not found: {project_root}")
    if not snapshot_path.exists():
        raise HTTPException(404, f"snapshot_path not found: {snapshot_path}")
    if not (snapshot_path / "_index.txt").exists():
        raise HTTPException(
            400,
            f"snapshot_path does not look like a structural store (missing _index.txt): {snapshot_path}",
        )

    llm_client = _build_llm_client(req.provider, req.model, req.log_dir)

    from src.ast.diagram_discoverer import discover_diagrams

    try:
        diagrams = discover_diagrams(
            llm_client=llm_client,
            project_root=str(project_root),
            snapshot_path=str(snapshot_path),
        )
    except Exception as e:
        logger.exception("V1 diagram discovery failed")
        raise HTTPException(500, f"discovery failed: {e}")

    return DiscoverDiagramsResponse(
        count=len(diagrams),
        diagrams=[asdict(d) for d in diagrams],
        provider=llm_client.provider,
        model=llm_client.model,
    )


# ─── GET /api/discovery/trace ────────────────────────────────────────────────


class TraceResponse(BaseModel):
    discovery: str = Field(..., description="Discovery name (endpoint, interaction, diagram).")
    model: str = Field(..., description="Model identifier.")
    path: str = Field(..., description="Filesystem path of the trace file.")
    turns: int = Field(..., description="Number of conversation turns recorded.")
    trace: list[dict[str, Any]] = Field(..., description="Full conversation trace.")


@router.get(
    "/trace",
    response_model=TraceResponse,
    summary="Fetch the most recent V1 conversation trace",
    operation_id="get_trace",
    responses={
        404: {"description": "Trace file not found for the given discovery + model."},
    },
)
def get_trace(
    discovery: Literal["endpoint", "interaction", "diagram"] = Query(
        "endpoint",
        description="Discovery name: endpoint, interaction, or diagram",
    ),
    model: str = Query(..., description="Model identifier used during discovery (matches the saved file)"),
) -> TraceResponse:
    """Return the conversation trace JSON saved by `discovery_loop._save_trace`.

    Trace files are written to the system temp dir as
    `<discovery>_trace_<model>.json` after each V1 discovery run; this is a
    debugging surface for inspecting prompts, tool calls, and responses.
    """
    if not _SAFE_MODEL_RE.match(model):
        raise HTTPException(400, "invalid model identifier")

    tempdir = Path(tempfile.gettempdir()).resolve()
    trace_path = tempdir / f"{discovery}_trace_{model}.json"
    # Defense in depth — even with the regex above, refuse anything that
    # resolves outside tempdir.
    try:
        trace_path.resolve().relative_to(tempdir)
    except ValueError:
        raise HTTPException(400, "invalid model identifier")

    if not trace_path.exists():
        raise HTTPException(404, "trace not found")
    try:
        trace = json.loads(trace_path.read_text(encoding="utf-8"))
    except Exception as e:
        raise HTTPException(500, f"failed to read trace: {e}")
    return TraceResponse(
        discovery=discovery,
        model=model,
        path=str(trace_path),
        turns=len(trace) if isinstance(trace, list) else 0,
        trace=trace if isinstance(trace, list) else [],
    )
