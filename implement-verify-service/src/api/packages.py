"""Implementation-package endpoints.

Per spec `haikai/specs/2026-05-18-api-and-stream-modularize/`
Phase A.4: extracted from `src/api/__init__.py`. Two endpoints that
package the artifacts of a completed orchestration for handoff to a
developer machine:

- `GET /api/v2/orchestrations/{company}/{project}/{spec_name}/package`
  → ZIP file download
- `GET /api/v2/orchestrations/{company}/{project}/{spec_name}/package/json`
  → structured JSON for programmatic consumption

Both render artifacts per the active backend's `BackendDescriptor`
(skill path + invocation hint), so a `CHAT_EXECUTOR=kiro` deployment
hands out a Kiro-flavoured package, not the Claude defaults.

First Phase-A step that uses an `APIRouter` (vs the inline `@app.get`
pattern). `src/api/__init__.py` mounts the router via
`app.include_router(packages_router)`.
"""

from __future__ import annotations

import io
import zipfile
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response

from ..haikai_models import ImplementationPackage, ImplementationPackageFile
from ..api_auth import verify_api_key
from ..backend_registry import _active_backend
from ..path_safety import safe_segment

router = APIRouter()


@router.get(
    "/api/v2/orchestrations/{company}/{project}/{spec_name}/package",
    tags=["Orchestration"],
    summary="Download implementation package as ZIP",
    responses={
        200: {"content": {"application/zip": {}}, "description": "ZIP file with implementation artifacts"},
        401: {"description": "Invalid or missing API key"},
        404: {"description": "Spec or artifacts not found"},
    },
)
async def get_implementation_package_zip(
    company: str,
    project: str,
    spec_name: str,
    authenticated: bool = Depends(verify_api_key),
):
    """
    Download the portable implementation package as a ZIP file.

    The ZIP is drop-in ready: extract into your project root and run
    the CLI invocation in the response headers' `instructions` field
    (varies by `CHAT_EXECUTOR`: claude or kiro-cli).

    Contents:
    - `haikai/specs/{spec_name}/planning/requirements.md`
    - `haikai/specs/{spec_name}/planning/initialization.md`
    - `haikai/specs/{spec_name}/spec.md`
    - `haikai/specs/{spec_name}/tasks.md`
    - `<backend-skill-dir>/implement-tasks.<ext>` (per CHAT_EXECUTOR;
      e.g. `.claude/commands/implement-tasks.md` for claude,
      `.kiro/skills/implement-tasks/SKILL.md` for kiro)
    """
    # Lazy import for `_safe_project_dir` — lives in api/__init__.py
    # (its move-out is a future Phase A step). Avoids the api → packages
    # → api load-time cycle.
    from . import _safe_project_dir

    # Validates company/project — see autoresearch:debug 260504-1229 #1.
    project_dir = _safe_project_dir(company, project)
    spec_dir = project_dir / "haikai" / "specs" / safe_segment(spec_name, "spec_name")

    if not spec_dir.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Spec '{spec_name}' not found")

    # Per-backend artifact layout — see BackendDescriptor for the
    # mapping. We render the skill path for whatever backend is active
    # so a user with CHAT_EXECUTOR=kiro gets `.kiro/skills/...`, not
    # the Claude-flavored path.
    backend = _active_backend()
    skill_rel = backend.skill_relpath("implement-tasks")

    file_map: dict[str, Path] = {}
    for rel in [
        f"haikai/specs/{spec_name}/planning/requirements.md",
        f"haikai/specs/{spec_name}/planning/initialization.md",
        f"haikai/specs/{spec_name}/spec.md",
        f"haikai/specs/{spec_name}/tasks.md",
    ]:
        abs_path = project_dir / rel
        if abs_path.exists():
            file_map[rel] = abs_path

    skill_path = project_dir / skill_rel
    if skill_path.exists():
        file_map[skill_rel] = skill_path

    if not file_map:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No artifacts found for this spec")

    # Build ZIP in memory
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for rel_path, abs_path in file_map.items():
            zf.writestr(rel_path, abs_path.read_text(encoding="utf-8"))
    buf.seek(0)

    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{spec_name}-implementation-package.zip"'},
    )


@router.get(
    "/api/v2/orchestrations/{company}/{project}/{spec_name}/package/json",
    tags=["Orchestration"],
    summary="Get implementation package as JSON",
    response_model=ImplementationPackage,
    responses={
        401: {"description": "Invalid or missing API key"},
        404: {"description": "Spec or artifacts not found"},
    },
)
async def get_implementation_package_json(
    company: str,
    project: str,
    spec_name: str,
    authenticated: bool = Depends(verify_api_key),
) -> ImplementationPackage:
    """
    Get the portable implementation package as JSON with file contents as strings.

    Same content as the ZIP endpoint but structured for programmatic consumption.
    """
    from . import _safe_project_dir  # lazy: see ZIP endpoint comment

    # Validates company/project — see autoresearch:debug 260504-1229 #1.
    project_dir = _safe_project_dir(company, project)
    spec_dir = project_dir / "haikai" / "specs" / safe_segment(spec_name, "spec_name")

    if not spec_dir.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Spec '{spec_name}' not found")

    backend = _active_backend()
    skill_rel = backend.skill_relpath("implement-tasks")

    files: list[ImplementationPackageFile] = []
    for rel in [
        f"haikai/specs/{spec_name}/planning/requirements.md",
        f"haikai/specs/{spec_name}/planning/initialization.md",
        f"haikai/specs/{spec_name}/spec.md",
        f"haikai/specs/{spec_name}/tasks.md",
    ]:
        abs_path = project_dir / rel
        if abs_path.exists():
            files.append(ImplementationPackageFile(path=rel, content=abs_path.read_text(encoding="utf-8")))

    skill_path = project_dir / skill_rel
    if skill_path.exists():
        files.append(ImplementationPackageFile(
            path=skill_rel,
            content=skill_path.read_text(encoding="utf-8"),
        ))

    if not files:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No artifacts found for this spec")

    return ImplementationPackage(
        spec_name=spec_name,
        company=company,
        project=project,
        files=files,
        instructions=(
            f"Extract into your project root and run: "
            f"{backend.invocation_hint('implement-tasks', spec_name)}"
        ),
    )
