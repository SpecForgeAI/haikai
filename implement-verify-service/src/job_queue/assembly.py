"""Run assembly for the DB-plane execution chain (WS2, 2026-07-31).

After a migration run's specs implement, the gateway submits an
``assemble-run`` job: merge the run's per-spec ``feature/<spec>[--<folder>]``
branches into ONE new branch off the default branch, overlay the COMPLETE DB
pack (fetched from AMS by the gateway and inlined in the request — IVS never
talks to AMS), structurally validate the assembled pack, then commit + push +
open a merge request.

Why this exists (live 2026-07-30 dataset review): the pack's main
``manifest.json`` was never committed to ANY feature branch (it had to be
recovered from AMS), the pack was split across 15 branches with no runnable
whole, and the master changelog carried a dangling include — none of which is
detectable per-spec. Assembly is the one place the WHOLE artifact exists, so
the runnable-pack invariants are enforced here, before anything touches the
target database.

Validation gate (assembly FAILS before push on any problem):
  * master changelog parses as XML (Python's expat also rejects ``--`` inside
    XML comments — the live "illegal XML" generator bug);
  * every ``<include file=...>`` resolves to a file on disk (no dangling
    includes);
  * every ``--changeset author:id`` id is parser-safe
    (``[A-Za-z0-9._-]``, and never ``--`` which breaks Liquibase's
    formatted-SQL parser);
  * ``manifest.json`` parses as JSON and carries no UTF-8 BOM.

Credentials posture: none — this module does git + filesystem work only.
"""
from __future__ import annotations

import json
import logging
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from ..git.git_manager import GitManager
from ..haikai_models import AssemblePackFile, AssembleRunRequest
from .job_models import JobStatus

logger = logging.getLogger(__name__)

#: ``--changeset <author>:<id>`` at line start (Liquibase formatted SQL).
CHANGESET_HEADER_RE = re.compile(r"^--changeset\s+([^:\s]+):(\S+)", re.MULTILINE)

#: Parser-safe changeset id charset (single dashes fine; ``--`` never is).
SAFE_CHANGESET_ID_RE = re.compile(r"^[A-Za-z0-9._-]+$")

#: Branch names the request may ask us to create.
SAFE_BRANCH_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]*$")

LIQUIBASE_XMLNS = "{http://www.liquibase.org/xml/ns/dbchangelog}"


class AssemblyError(Exception):
    """A named assembly failure (surfaced verbatim as the job error)."""


def _safe_relpath(path: str) -> Optional[Path]:
    """Normalise a pack file path to a safe repo-relative Path, or None.

    Rejects absolute paths, drive letters, and ``..`` traversal — the pack
    file set arrives over HTTP and must never write outside the repo target.
    """
    if not path or "\x00" in path:
        return None
    normalised = path.replace("\\", "/").strip()
    if normalised.startswith("/") or re.match(r"^[A-Za-z]:", normalised):
        return None
    parts = [p for p in normalised.split("/") if p not in ("", ".")]
    if not parts or any(p == ".." for p in parts):
        return None
    return Path(*parts)


def validate_pack_on_disk(
    repo_dir: Path, pack_files: List[AssemblePackFile]
) -> List[str]:
    """Structural runnable-pack validation, post-overlay. Returns problems."""
    problems: List[str] = []

    master_rel = next(
        (f.path for f in pack_files if f.path.endswith("db.changelog-master.xml")),
        None,
    )
    if master_rel is None:
        problems.append("pack has no db.changelog-master.xml (liquibase master changelog)")
    else:
        safe_master = _safe_relpath(master_rel)
        master = repo_dir / safe_master if safe_master else None
        if master is None or not master.exists():
            problems.append(f"master changelog '{master_rel}' was not overlaid")
        else:
            try:
                tree = ET.parse(master)
            except ET.ParseError as exc:
                problems.append(
                    f"{master_rel}: not well-formed XML ({exc}) — a '--' inside "
                    "an XML comment is the known generator bug shape"
                )
                tree = None
            if tree is not None:
                for inc in tree.getroot().iter(f"{LIQUIBASE_XMLNS}include"):
                    rel = (inc.get("file") or "").strip()
                    if not rel:
                        continue
                    if not (master.parent / rel).exists():
                        problems.append(
                            f"{master_rel}: dangling include '{rel}' — the file "
                            "was never generated/overlaid"
                        )

    for f in pack_files:
        if not f.path.endswith(".sql"):
            continue
        safe = _safe_relpath(f.path)
        target = repo_dir / safe if safe else None
        if target is None or not target.exists():
            continue
        try:
            text = target.read_text(encoding="utf-8")
        except OSError:
            continue
        for match in CHANGESET_HEADER_RE.finditer(text):
            changeset_id = match.group(2)
            if "--" in changeset_id or not SAFE_CHANGESET_ID_RE.match(changeset_id):
                problems.append(
                    f"{f.path}: changeset id '{changeset_id}' is not parser-safe "
                    "(charset [A-Za-z0-9._-]; '--' breaks the formatted-SQL parser)"
                )

    for f in pack_files:
        if Path(f.path).name != "manifest.json":
            continue
        safe = _safe_relpath(f.path)
        target = repo_dir / safe if safe else None
        if target is None or not target.exists():
            continue
        raw = target.read_bytes()
        if raw.startswith(b"\xef\xbb\xbf"):
            problems.append(f"{f.path}: carries a UTF-8 BOM (pack writers must be BOM-free)")
            raw = raw[3:]
        try:
            json.loads(raw.decode("utf-8"))
        except Exception as exc:  # json/unicode errors both mean "not runnable"
            problems.append(f"{f.path}: not valid JSON ({exc})")

    return problems


def _resolve_ref(gm: GitManager, candidates: List[str]) -> Optional[str]:
    """First existing ref among candidates, checking local then origin."""
    for candidate in candidates:
        for full in (candidate, f"origin/{candidate}"):
            if gm.ref_exists(full):
                return full
    return None


def assemble_run(request: AssembleRunRequest, workspace_dir: str) -> dict:
    """Execute the assembly. Returns the result dict; raises AssemblyError."""
    # Reuse the orchestration git resolution: targets first, then the config
    # fallback chain (env -> target repos' .haikai/config.json). Push + MR go
    # through apply_git_workflow (push_pr_only) so the auto_push/auto_pr
    # gating + error policy stay in their one home.
    import types as _types

    from ..api.git_workflow import apply_git_workflow
    from ..git.git_manager import GitManagerError
    from .tasks import _resolve_git_targets

    if not SAFE_BRANCH_RE.match(request.branch_name) or ".." in request.branch_name:
        raise AssemblyError(f"branch name not safe: {request.branch_name!r}")

    resolved, err = _resolve_git_targets(request, workspace_dir)
    if err:
        raise AssemblyError(err)
    git_config, targets = resolved
    folder, repo_dir = targets[0]
    if len(targets) > 1:
        logger.warning(
            "assembly: %d repo targets resolved; assembling into the first (%s). "
            "Multi-repo assembly is out of scope for the DB pack (one artifact repo).",
            len(targets), folder,
        )

    gm = GitManager(
        project_dir=str(repo_dir),
        provider=git_config.provider,
        default_branch=git_config.default_branch,
        github_token=git_config.github_token,
        bitbucket_username=git_config.bitbucket_username,
        bitbucket_app_password=git_config.bitbucket_app_password,
    )

    gm.fetch_origin()
    base = f"origin/{gm.default_branch}"
    if not gm.ref_exists(base):
        base = gm.default_branch
    try:
        gm.checkout_new_branch_from(request.branch_name, base)
    except GitManagerError as exc:
        raise AssemblyError(str(exc)) from exc

    merged: List[str] = []
    try:
        for spec in request.spec_names:
            candidates = ([f"feature/{spec}--{folder}"] if folder else []) + [f"feature/{spec}"]
            ref = _resolve_ref(gm, candidates)
            if ref is None:
                raise AssemblyError(
                    f"no branch found for spec '{spec}' (tried {candidates} locally and on origin)"
                )
            try:
                gm.merge_no_ff(ref, f"Assemble {spec}")
            except GitManagerError as exc:
                raise AssemblyError(f"merge conflict assembling '{ref}': {exc}") from exc
            merged.append(ref)

        overlaid = 0
        for pack_file in request.pack_files:
            rel = _safe_relpath(pack_file.path)
            if rel is None:
                raise AssemblyError(f"pack file path not safe: {pack_file.path!r}")
            dest = repo_dir / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            # UTF-8, no BOM, LF endings — the pack is byte-deterministic.
            with open(dest, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(pack_file.content)
            overlaid += 1

        problems = validate_pack_on_disk(repo_dir, request.pack_files)
        if problems:
            raise AssemblyError(
                "assembled pack failed validation (nothing was pushed):\n- "
                + "\n- ".join(problems)
            )

        gm.commit_all(
            f"Assemble DB migration pack: {len(request.spec_names)} spec(s) + pack overlay"
        )

        title = (
            (request.mr_title
             or f"DB migration pack — assembled run ({len(request.spec_names)} specs)")
            if request.open_merge_request else None
        )
        body = request.mr_body or (
            "Assembled by the DB-plane execution chain.\n\nSpecs (in order):\n"
            + "\n".join(f"- {s}" for s in request.spec_names)
            + f"\n\nPack overlay: {overlaid} file(s), structural validation passed."
        )
        outcome = _types.SimpleNamespace(errors=[], commit_sha=None, branch=None, pr_url=None)
        apply_git_workflow(
            gm=gm,
            git_config=git_config,
            branch=request.branch_name,
            commit_msg="",  # already committed above
            pr_title=title,
            pr_body=body,
            response_obj=outcome,
            push_pr_only=True,
            error_label=f"assembly {request.branch_name}",
        )
        if outcome.errors:
            raise AssemblyError(f"push/MR failed: {outcome.errors[0]}")
        mr_url = outcome.pr_url
    finally:
        gm.checkout_default_branch()

    return {
        "success": True,
        "branch": request.branch_name,
        "mr_url": mr_url,
        "merged_branches": merged,
        "overlaid_files": overlaid,
    }


def run_assembly(job_id: str, storage) -> None:
    """Job-runner entry for JobType.ASSEMBLE_RUN (claimed RUNNING upstream)."""
    import os

    job = storage.get_job(job_id)
    if not job:
        logger.error("assembly job %s not found", job_id)
        return
    job.started_at = datetime.now(timezone.utc)
    storage.save_job(job)

    try:
        request = AssembleRunRequest(**(job.request_payload or {}))
        workspace_dir = str(Path(os.environ["API_WORKSPACE_DIR"]).resolve())
        result = assemble_run(request, workspace_dir)
        job = storage.get_job(job_id) or job
        job.status = JobStatus.COMPLETED
        job.completed_at = datetime.now(timezone.utc)
        job.result = result
        storage.save_job(job)
        logger.info(
            "assembly job %s completed: branch=%s mr=%s merged=%d overlay=%d",
            job_id, result["branch"], result["mr_url"],
            len(result["merged_branches"]), result["overlaid_files"],
        )
    except Exception as exc:
        logger.error("assembly job %s failed: %s", job_id, exc, exc_info=True)
        job = storage.get_job(job_id) or job
        job.status = JobStatus.FAILED
        job.completed_at = datetime.now(timezone.utc)
        job.error = str(exc)
        storage.save_job(job)
