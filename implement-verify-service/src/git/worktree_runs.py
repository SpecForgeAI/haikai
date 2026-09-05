"""Per-run git worktree allocation / reclamation (parallel-worktrees spec v2).

One job (or one spec of a per-spec run) = one worktree set at
``<workspace>/wt/<job_id8>[/<spec>]``, on its own branch, seeded with the
untracked live-checkout state the runtime hard-requires. The live checkout's
repo tree is never mutated (W1); the shared ``.git`` is mutated only under
the narrowed project lock (W4: worktree add/remove/prune).

Reclamation is governed by the D14 predicate — job status alone NEVER
authorizes removal — and always copies observability artifacts out first
(predicate condition 6). Windows removal ladder per W8.
"""

from __future__ import annotations

import hashlib
import logging
import os
import shutil
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Optional

logger = logging.getLogger(__name__)

# Heartbeat staleness beyond which a non-running job's process is presumed
# dead (mirrors recovery's discriminator; D14 condition 4).
STALE_HEARTBEAT_SECONDS = 300


class WorktreeAllocationError(RuntimeError):
    """Fail-fast allocation errors (W5): branch active elsewhere, submodule
    repo, missing base, seed-source missing, checksum mismatch."""


class WorktreeReclaimError(RuntimeError):
    pass


def _git(repo_dir, *args) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(repo_dir), *args],
                          capture_output=True, text=True)


def _require(cp: subprocess.CompletedProcess, what: str) -> subprocess.CompletedProcess:
    if cp.returncode != 0:
        raise WorktreeAllocationError(f"{what}: {(cp.stdout + cp.stderr)[-400:]}")
    return cp


def project_git_lock(workspace_dir: str, company: str, project: str):
    """The narrowed shared-.git lock (same file the orchestration phase used
    pre-worktrees, now held only around worktree add/remove/prune)."""
    from src.file_lock import exclusive_lock

    key = hashlib.sha256(f"{company}/{project}".encode()).hexdigest()[:16]
    lock_path = Path(workspace_dir) / ".locks" / f"orch-git-{key}.lock"
    return exclusive_lock(lock_path)


def run_key(job_id: str) -> str:
    """Collision-proof short key for a job's run root. 16 hex chars of the
    uuid (dashes stripped) — a bare [:8] prefix collides for real (two jobs
    sharing 8 chars corrupted each other's trees in the S9 evidence run);
    16 chars keeps the W8 path budget with negligible birthday risk."""
    return job_id.replace("-", "")[:16]


def run_root(workspace_dir: str, job_id: str, spec: Optional[str] = None) -> Path:
    """Short root (W8 path budget): <workspace>/wt/<run_key>[/<spec>].

    ALWAYS absolute (2026-07-28): with a RELATIVE workspace_dir (the literal
    env value "api_workspace"), `git -C <live_repo> worktree add <dest>`
    resolved the relative dest against the LIVE REPO — the worktree landed
    inside the live clone while Python seeded and validated an empty
    cwd-relative twin, and the run failed "no repo targets after seeding".
    """
    root = Path(workspace_dir).resolve() / "wt" / run_key(job_id)
    return root / spec if spec else root


# ── D4 branch policy ─────────────────────────────────────────────────────────

def branch_checked_out_at(live_repo: Path, branch: str) -> Optional[str]:
    """Path of the worktree that has `branch` checked out, else None."""
    cp = _git(live_repo, "worktree", "list", "--porcelain")
    if cp.returncode != 0:
        return None
    current_path = None
    for line in cp.stdout.splitlines():
        if line.startswith("worktree "):
            current_path = line[len("worktree "):].strip()
        elif line.startswith("branch ") and current_path:
            if line.strip() == f"branch refs/heads/{branch}":
                return current_path
    return None


def _branch_exists(live_repo: Path, branch: str) -> bool:
    return _git(live_repo, "show-ref", "--verify", "--quiet",
                f"refs/heads/{branch}").returncode == 0


def _has_submodules(live_repo: Path) -> bool:
    return (Path(live_repo) / ".gitmodules").exists()


def add_worktree(live_repo: Path, path: Path, branch: str, base: str,
                 job_id: str = "", force_base: bool = False) -> None:
    """The three-way allocation rule (D4, user ruling verbatim):
    absent → add -b; exists+active elsewhere → fail clearly;
    exists+free → add without -b. Detached mode: branch=None.

    ``force_base`` (2026-08-15, explicit-branch base): the operator's chosen
    base is a HARD contract. Same-day Re-start reuses the deterministic spec
    name, so a leftover FREE branch from the abandoned attempt would be
    attached silently — planting the new run on the old attempt's base, the
    exact silent-divergence class explicit bases fail-close against. With
    ``force_base`` the free branch is reset to ``base`` before attach (live
    holders still fail loudly above; the old tip stays reachable via reflog,
    and auto-retry ``-rN`` attempts already start clean from base)."""
    # Resolve BOTH to absolute (2026-07-28): git resolves a relative dest
    # against the `-C <live_repo>` directory, NOT the process cwd — a
    # relative `path` silently plants the worktree inside the live clone
    # while every Python-side check looks at the cwd-relative twin.
    live_repo = Path(live_repo).resolve()
    path = Path(path).resolve()
    if _has_submodules(live_repo):
        raise WorktreeAllocationError(
            f"repo {live_repo} uses submodules — unsupported under worktree "
            "mode (W5 fail-fast; use WORKTREE_RUNS=off)")
    path.parent.mkdir(parents=True, exist_ok=True)
    if branch is None:
        _require(_git(live_repo, "worktree", "add", "--detach", str(path), base),
                 f"cannot create detached worktree at {base}")
    else:
        holder = branch_checked_out_at(live_repo, branch)
        if holder:
            raise WorktreeAllocationError(
                f"branch {branch} is active in another worktree ({holder}) — "
                f"refusing allocation for job {job_id or '?'}")
        if _branch_exists(live_repo, branch):
            if force_base:
                old_tip = (_git(live_repo, "rev-parse", "--short", branch)
                           .stdout or "").strip()
                _require(_git(live_repo, "branch", "-f", branch, base),
                         f"cannot reset stale branch {branch} to explicit "
                         f"base {base}")
                logger.info(
                    "add_worktree: reset FREE stale branch %s (was %s) to "
                    "explicit base %s before attach", branch, old_tip, base)
                _record_branch_base(live_repo, branch, base)
            _require(_git(live_repo, "worktree", "add", str(path), branch),
                     f"cannot attach worktree to existing branch {branch}")
        else:
            _require(_git(live_repo, "worktree", "add", "-b", branch,
                          str(path), base),
                     f"cannot create worktree branch {branch} from {base}")
            _record_branch_base(live_repo, branch, base)
    if job_id:
        _git(live_repo, "worktree", "lock",
             "--reason", f"job {job_id} active", str(path))


def _record_branch_base(live_repo: Path, branch: str, base: str) -> None:
    """Record the sha a spec branch was created from (best-effort). Salvage
    reads it back: a branch whose tip still equals its creation base carries
    ZERO spec work — 'salvaging' it would mark the spec implemented with an
    empty diff, silently losing the spec."""
    sha = (_git(live_repo, "rev-parse", base).stdout or "").strip()
    if sha:
        _git(live_repo, "config", f"branch.{branch}.haikai-base-sha", sha)


def _recorded_branch_base(repo_dir: Path, branch: str) -> str:
    return (_git(repo_dir, "config", "--get",
                 f"branch.{branch}.haikai-base-sha").stdout or "").strip()


def _ref_resolves(live_repo: Path, ref: str) -> bool:
    """True when `ref` resolves to a commit (branch, origin/branch, sha)."""
    return _git(live_repo, "rev-parse", "--verify", "--quiet",
                f"{ref}^{{commit}}").returncode == 0


def resolve_base_ref(live_repo: Path, base_spec: str, folder,
                     default_branch: str) -> str:
    """Resolve the chaining base for a repo target (run-branch chaining,
    2026-08-06): the previous GOOD spec's branch for THIS target —
    `feature/<base_spec>--<folder>` (polyrepo) before `feature/<base_spec>`,
    local before origin, with one fetch-on-miss (a machine swap may hold the
    branch only on origin). No resolvable candidate is a FAIL-FAST allocation
    error (W5): the caller asserted a base that does not exist — silently
    basing off `default_branch` would rebuild the exact blindness this
    feature removes."""
    candidates = ([f"feature/{base_spec}--{folder}"] if folder is not None
                  else []) + [f"feature/{base_spec}"]
    for fetched in (False, True):
        if fetched:
            _git(live_repo, "fetch", "--all", "--quiet")
        for candidate in candidates:
            for ref in (candidate, f"origin/{candidate}"):
                if _ref_resolves(live_repo, ref):
                    return ref
    raise WorktreeAllocationError(
        f"base_spec '{base_spec}' resolves no branch for repo target "
        f"{folder or '(root)'} (tried {candidates} locally and on origin) — "
        "the previous spec's branch was never created or was deleted")


def fresh_default_base(live_repo: Path, default_branch: str) -> str:
    """The base ref for an UNCHAINED run: prefer `origin/<default_branch>`
    after a best-effort fetch, falling back to the local branch offline.
    A stage restarted 'fresh from main' (chaining checkbox B) must see the
    previous stage's MERGED work — the local default branch can be stale
    (same rule assembly already applies at assemble_run)."""
    _git(live_repo, "fetch", "origin", default_branch, "--quiet")  # best-effort
    remote = f"origin/{default_branch}"
    return remote if _ref_resolves(live_repo, remote) else default_branch


# ── Integration base (2026-08-12, stage continuation) ────────────────────────

INTEGRATION_BRANCH_PREFIX = "integration/"


class IntegrationBaseConflict(WorktreeAllocationError):
    """Two accumulated feature branches disagree on the same paths — the
    integration base cannot be built mechanically. Carries the conflicted
    paths so the operator knows exactly what to reconcile."""


def _remote_feature_branches(live_repo: Path, folder) -> list[str]:
    """Every `origin/feature/*` ref belonging to THIS repo target, sorted.
    Polyrepo targets own the `feature/<spec>--<folder>` suffix form; the
    root target (folder None) owns suffix-less names. Sorted for a
    deterministic merge order."""
    cp = _git(live_repo, "for-each-ref", "--format=%(refname:short)",
              "refs/remotes/origin/feature/")
    if cp.returncode != 0:
        return []
    out = []
    for line in (cp.stdout or "").splitlines():
        name = line.strip()
        if not name:
            continue
        short = name[len("origin/"):] if name.startswith("origin/") else name
        tail = short[len("feature/"):] if short.startswith("feature/") else short
        if folder is not None:
            if tail.endswith(f"--{folder}"):
                out.append(name)
        elif "--" not in tail:
            out.append(name)
    return sorted(out)


def _conflicted_paths(repo: Path) -> list[str]:
    cp = _git(repo, "diff", "--name-only", "--diff-filter=U")
    return [ln.strip() for ln in (cp.stdout or "").splitlines() if ln.strip()]


def _remote_db_migration_branches(live_repo: Path) -> list[str]:
    """Every `origin/db-migration/*` ref (the DB assembly branches — each is
    the merged DB spec branches PLUS the assembly-only overlay files that were
    never committed to any feature branch), sorted for deterministic order.
    Merged FIRST by the integration base (2026-08-15): merging the individual
    DB `feature/*` branches afterwards is a clean no-op (they are ancestors),
    but merging ONLY them would silently miss the overlay files."""
    cp = _git(live_repo, "for-each-ref", "--format=%(refname:short)",
              "refs/remotes/origin/db-migration/")
    if cp.returncode != 0:
        return []
    return sorted(ln.strip() for ln in (cp.stdout or "").splitlines() if ln.strip())


def explicit_branch_base(live_repo: Path, base_branch: str) -> str:
    """The base ref for an EXPLICIT-branch run (2026-08-15 — 'start from the
    open Merge Request'): `origin/<base_branch>` after a fetch. FAIL-CLOSED:
    a missing branch raises a NAMED error — silently falling back to the
    default branch would discard the DB plane from every worktree in the run
    (the exact silent-divergence class the operator opted out of)."""
    live_repo = Path(live_repo).resolve()
    _git(live_repo, "fetch", "origin", "--quiet")  # best-effort refresh
    ref = f"origin/{base_branch}"
    if not _ref_resolves(live_repo, ref):
        raise WorktreeAllocationError(
            f"explicit base branch '{base_branch}' does not resolve on origin "
            f"({ref}) — the Merge-Request base cannot be built. Was the DB "
            "assembly branch pushed (and its MR still open)? Choose 'fresh "
            "from main' to opt out explicitly."
        )
    return ref


def integration_base(live_repo: Path, folder, default_branch: str,
                     tag: str) -> str:
    """Build the INTEGRATION base for one repo target: a branch off the
    freshly-fetched default with EVERY remote `feature/*` branch for this
    target merged in (2026-08-12 — the third base behaviour).

    Why: cross-run `base_spec` chaining follows a SINGLE lineage. The picked
    spec's branch may never have existed (a zero-diff no-op spec is honestly
    `implemented` with no branch — the live Stage-2 "resolves no branch"
    start failure), and even a live branch is one of the prior stage's N
    sibling branches, not the accumulated whole. Here specs accumulate onto
    ALL prior unmerged work, and a missing branch is simply absent.

    Merges run in a TEMPORARY worktree — the live checkout is never touched.
    No branches to integrate = the plain fresh default base. A merge
    conflict aborts cleanly and raises IntegrationBaseConflict naming the
    branch + conflicted paths (fail-fast, W5)."""
    live_repo = Path(live_repo).resolve()
    _git(live_repo, "fetch", "--all", "--quiet")  # best-effort
    base = fresh_default_base(live_repo, default_branch)
    # DB assembly branches FIRST (2026-08-15): each db-migration/* branch is
    # the merged DB spec branches + the assembly-only overlay files. The DB
    # feature/* siblings then merge as clean no-ops (ancestors), so the
    # service-plane branches accumulate ON TOP of the complete DB plane.
    branches = (_remote_db_migration_branches(live_repo)
                + _remote_feature_branches(live_repo, folder))
    if not branches:
        return base
    branch = f"{INTEGRATION_BRANCH_PREFIX}{tag}" + (f"--{folder}" if folder else "")
    # Short, collision-safe tmp path (W8 path budget — tags are long spec names).
    tmp_key = hashlib.sha256(branch.encode()).hexdigest()[:12]
    tmp = live_repo.parent / f".integration-{tmp_key}"
    # A crashed prior build may have left the branch held — free the stale
    # worktree so `-B` can reset the branch (the tmp path is ours alone).
    _git(live_repo, "worktree", "remove", "--force", str(tmp))
    _require(_git(live_repo, "worktree", "add", "-B", branch, str(tmp), base),
             f"cannot create integration worktree for {branch}")
    try:
        for ref in branches:
            merged = _git(tmp, "merge", "--no-ff", "--no-edit", ref)
            if merged.returncode != 0:
                paths = _conflicted_paths(tmp)
                _git(tmp, "merge", "--abort")
                raise IntegrationBaseConflict(
                    f"integration base for target {folder or '(root)'} hit merge "
                    f"conflicts merging {ref}"
                    + (f" (conflicted: {', '.join(paths[:10])}"
                       + (f" +{len(paths) - 10} more" if len(paths) > 10 else "")
                       + ")" if paths else "")
                    + " — the accumulated feature branches disagree; resolve by "
                    "merging/closing the conflicting MRs (or start the stage "
                    "'fresh from main' after merging), then retry")
        logger.info("integration base %s for target %s: merged %d branch(es)",
                    branch, folder or "(root)", len(branches))
    finally:
        _git(live_repo, "worktree", "remove", "--force", str(tmp))
    return branch


def _spec_branch_key(short: str, folder: "str | None") -> "str | None":
    """Strip a folder target's ``--<folder>`` suffix from a branch short name.

    Folder targets (a repo folder nested under the project directory, or a
    polyrepo alias) name their branches ``feature/<spec>[-rN]--<folder>``;
    single-repo projects use ``feature/<spec>[-rN]``. Returns the suffix-less
    name when the branch belongs to ``folder`` (``None`` = no suffix
    expected), else ``None``.
    """
    if folder is None:
        return None if "--" in short.rsplit("/", 1)[-1] else short
    suffix = f"--{folder}"
    if not short.endswith(suffix):
        return None
    return short[: -len(suffix)]


def _spec_worktree_candidates(live_repo: Path, spec_name: str,
                              folder: "str | None" = None) -> "list[tuple[str, str]] | None":
    """``[(worktree_path, branch_short), ...]`` holding ``feature/<spec>[-rN]``
    (with the folder suffix when ``folder`` is given). ``None`` = the worktree
    listing itself failed."""
    cp = _git(live_repo, "worktree", "list", "--porcelain")
    if cp.returncode != 0:
        return None
    candidates: list[tuple[str, str]] = []
    path: str | None = None
    base = f"feature/{spec_name}"
    for line in (cp.stdout or "").splitlines():
        line = line.strip()
        if line.startswith("worktree "):
            path = line[len("worktree "):]
        elif line.startswith("branch ") and path:
            short = line[len("branch "):]
            short = short[len("refs/heads/"):] if short.startswith("refs/heads/") else short
            key = _spec_branch_key(short, folder)
            if key is not None and (key == base or key.startswith(f"{base}-r")):
                candidates.append((path, short))
            path = None
    return candidates


def has_spec_worktree(live_repo: Path, spec_name: str, folder: "str | None" = None) -> bool:
    """Does ``live_repo`` hold a worktree for the spec's branch (any attempt)?
    Read-only pre-check used by the folder-aware route to refuse an ambiguous
    polyrepo BEFORE touching anything."""
    return bool(_spec_worktree_candidates(live_repo, spec_name, folder))


def salvage_spec_worktree_in_project(project_dir: Path, spec_name: str,
                                     resolve_targets) -> dict:
    """Folder-aware salvage (2026-09-05).

    The route used to require ``.git`` directly at the project directory and
    refused everything else as "polyrepo salvage is not supported". Every
    other git path in the service resolves repo targets through the shared
    resolver (``.git`` at the root, a coordination file, or a scan of direct
    subfolders for a ``.git``) -- so a folder-target project, the layout the
    tool itself produces, could deploy, commit and open MRs but never salvage.

    ``resolve_targets(project_dir) -> [(folder_label|None, repo_dir), ...]``
    is injected (the job-queue resolver in production; a fake in tests).

    Decision:
      - no target                -> 'error' (nothing to salvage in; loud)
      - one target               -> salvage in it, branch suffixed for a folder
      - several targets          -> only the targets holding a worktree for
                                    the spec count; exactly one -> salvage
                                    there; none -> 'no_worktree'; more than
                                    one -> 'error' BEFORE touching anything
                                    (the run item records ONE branch; the
                                    ambiguous polyrepo stays refused loudly,
                                    never guessed).
    The returned dict carries ``folder`` (``None`` for a root repo).
    """
    try:
        targets = list(resolve_targets(project_dir) or [])
    except Exception as exc:  # resolver failure = cannot judge; refuse loudly
        return {"status": "error",
                "message": f"could not resolve repo targets under {project_dir}: {exc}"}
    if not targets:
        return {"status": "error",
                "message": (f"{project_dir} holds no git repository (no .git at the "
                            "root, no coordination file, no repo subfolder) — "
                            "nothing to salvage in; commit/push the target's "
                            "worktree manually or resume without salvage")}
    if len(targets) > 1:
        holding = []
        for folder, repo_dir in targets:
            if has_spec_worktree(Path(repo_dir), spec_name, folder):
                holding.append((folder, repo_dir))
        if not holding:
            return {"status": "no_worktree",
                    "message": (f"none of the {len(targets)} repo targets under "
                                f"{project_dir} holds a feature/{spec_name}[-rN]--<folder> "
                                "worktree — nothing to salvage (the worktrees may have "
                                "been reclaimed); resume without salvage to retry the spec")}
        if len(holding) > 1:
            names = ", ".join(str(f) for f, _ in holding)
            return {"status": "error",
                    "message": (f"{len(holding)} repo targets ({names}) each hold a "
                                f"worktree for {spec_name}; the run item records ONE "
                                "branch, so a multi-target salvage is refused before "
                                "touching anything — commit/push each target's worktree "
                                "manually, then resume without salvage")}
        targets = holding
    folder, repo_dir = targets[0]
    result = salvage_spec_worktree(Path(repo_dir), spec_name, folder=folder)
    result["folder"] = folder
    return result


def salvage_spec_worktree(live_repo: Path, spec_name: str,
                          folder: "str | None" = None) -> dict:
    """Salvage a dead run item's LOCAL worktree (2026-08-15).

    When a spec's implementation completed but the run died before commit/push
    (the overnight stall shape), the finished work sits uncommitted in the
    spec's worktree. This commits + pushes it as the spec's branch so a
    Resume proceeds to the NEXT spec instead of re-doing finished work — the
    first-class version of the manual git surgery the operator's agent
    performed by hand.

    Finds the worktree holding `feature/<spec>` (or the highest retry
    `feature/<spec>-r<N>`), commits any uncommitted changes, pushes the
    branch, and returns a structured outcome:
      {status: 'salvaged', branch, committed, summary} |
      {status: 'no_worktree', message} | {status: 'error', message}
    Never raises for content reasons.
    """
    live_repo = Path(live_repo).resolve()
    # Folder targets (2026-09-05): the branch carries a ``--<folder>`` suffix;
    # candidates are matched and ranked on the suffix-less name.
    candidates = _spec_worktree_candidates(live_repo, spec_name, folder)
    if candidates is None:
        return {"status": "error", "message": "git worktree list failed"}
    suffix = f"--{folder}" if folder is not None else ""
    if not candidates:
        return {
            "status": "no_worktree",
            "message": (
                f"no local worktree holds a feature/{spec_name}[-rN]{suffix} branch — "
                "nothing to salvage (the worktree may have been reclaimed); "
                "resume WITHOUT salvage to retry the spec"),
        }
    # The item's CURRENT spec_name is the attempt the driver last dispatched —
    # its exact branch wins outright (2026-08-15). "Highest -rN" alone picked
    # a STALE earlier retry over the latest work: a manual Resume re-stamps
    # the item back to the BASE name, so the newest attempt can be suffix-less
    # while an old wedged `-r2` tree still lingers. Only when the exact branch
    # has no worktree does the highest surviving attempt stand in (the caller
    # re-aligns the item's spec_name to the returned branch).
    def _attempt(branch: str) -> int:
        key = _spec_branch_key(branch, folder) or branch
        tail = key.rsplit("-r", 1)
        return int(tail[1]) if len(tail) == 2 and tail[1].isdigit() else 0
    exact = [c for c in candidates if c[1] == f"feature/{spec_name}{suffix}"]
    wt_path, branch = (exact[0] if exact
                       else max(candidates, key=lambda c: _attempt(c[1])))
    wt = Path(wt_path)
    if not wt.exists():
        return {"status": "no_worktree",
                "message": f"worktree path for {branch} no longer exists ({wt})"}

    committed = False
    dirty = _git(wt, "status", "--porcelain")
    if (dirty.stdout or "").strip():
        _git(wt, "add", "-A")
        cm = _git(wt, "commit", "-m",
                  f"salvage: {spec_name} — completed work recovered from a stalled run")
        if cm.returncode != 0:
            return {"status": "error",
                    "message": f"salvage commit failed: {(cm.stderr or cm.stdout or '').strip()[:400]}"}
        committed = True
    if not committed:
        # Vacuous-salvage guard (2026-08-15): a clean tree whose branch tip
        # still equals its recorded creation base carries ZERO spec work (the
        # run died right after allocation). Returning 'salvaged' would mark
        # the spec IMPLEMENTED with an empty diff — the spec silently lost.
        base_sha = _recorded_branch_base(wt, branch)
        tip = (_git(wt, "rev-parse", "HEAD").stdout or "").strip()
        if base_sha and tip == base_sha:
            return {
                "status": "nothing_to_salvage",
                "message": (
                    f"branch {branch} has no commits beyond its creation base "
                    f"({base_sha[:12]}) and the worktree is clean — there is no "
                    "completed work to salvage; resume WITHOUT salvage to run "
                    "the spec"),
            }
    push = _git(wt, "push", "-u", "origin", branch)
    if push.returncode != 0:
        return {"status": "error",
                "message": f"salvage push failed for {branch}: {(push.stderr or '').strip()[:400]}"}
    stat = _git(wt, "show", "--stat", "--format=%s", "HEAD")
    summary = (stat.stdout or "").strip()[:1000]
    logger.info("salvaged worktree for %s: branch=%s committed=%s", spec_name,
                branch, committed)
    return {"status": "salvaged", "branch": branch, "committed": committed,
            "summary": summary}


def free_branch_holder_if_dead(live_repo: Path, branch: str, storage,
                               workspace_dir: str) -> bool:
    """Inline D14-lite reclaim at allocation (run-branch chaining hardening):
    the build-results callback fires BEFORE the finishing job's worktree is
    reclaimed, so a follow-on allocation can find the branch still held by a
    TERMINAL job's tree. Free it iff the full reclaim predicate allows;
    a live holder stays untouched (the caller's add_worktree then fails
    loudly, exactly as before). Only paths under `<workspace>/wt/` are ever
    candidates — the live checkout is never removed. Returns True if freed."""
    holder = branch_checked_out_at(live_repo, branch)
    if not holder:
        return False
    holder_path = Path(holder)
    wt_root = Path(workspace_dir).resolve() / "wt"
    try:
        rel = holder_path.resolve().relative_to(wt_root)
    except ValueError:
        return False  # live checkout or foreign path — never touch
    run_dir = rel.parts[0] if rel.parts else None
    if not run_dir:
        return False
    job = None
    if storage is not None:
        for candidate in storage.list_jobs(limit=1000):
            root = getattr(candidate, "worktree_root", None)
            if root and Path(root).name == run_dir:
                job = candidate
                break
    if job is None:
        return False  # recordless debris is the TTL sweeper's business
    ok, reason = reclaim_allowed(job, storage)
    if not ok:
        logger.info("branch %s held by job %s — not reclaimable (%s)",
                    branch, job.job_id, reason)
        return False
    logs_path = getattr(job, "logs_path", None)
    copy_observability_out(wt_root / run_dir, logs_path)
    remove_worktree(live_repo, holder_path)
    logger.info("freed branch %s: reclaimed dead holder %s (job %s, %s)",
                branch, holder, job.job_id, reason)
    return True


def create_branch_in_worktree(worktree: Path, branch: str, base: str) -> None:
    """Worktree-safe mid-run branch creation: single command with a
    start-point — never checks out the default branch (the linked-worktree
    crash at git_manager's two-step checkout)."""
    _require(_git(worktree, "checkout", "-b", branch, base),
             f"cannot create branch {branch} from {base} in worktree")


def detach_to(worktree: Path, ref: str) -> None:
    """Between-spec reset inside a worktree (never `checkout <default>`)."""
    _require(_git(worktree, "checkout", "--detach", ref),
             f"cannot detach worktree to {ref}")


# ── D2 seeding ───────────────────────────────────────────────────────────────

def _copytree(src: Path, dst: Path) -> None:
    if src.is_dir():
        shutil.copytree(src, dst, dirs_exist_ok=True)
    elif src.is_file():
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)


def seed_run_root(product_root: Path, dest_root: Path,
                  specs: Iterable[str]) -> list[str]:
    """Copy the untracked live-checkout state a fresh worktree lacks:
    the SCOPED spec trees (never the whole haikai/ — a concurrent
    shape-spec session may be mid-write on an unrelated spec),
    coordination files, and the active-session pointer. Returns the list
    of seeded items (for evidence)."""
    seeded: list[str] = []
    for spec in specs:
        src = product_root / "haikai" / "specs" / spec
        if not src.is_dir():
            raise WorktreeAllocationError(
                f"spec folder not found in live checkout: {src} — run "
                "/shape-spec first (F1: shape output is uncommitted state)")
        _copytree(src, dest_root / "haikai" / "specs" / spec)
        seeded.append(f"haikai/specs/{spec}")
    for name in ("coordination.yaml", "coordination.lock.yaml"):
        src = product_root / name
        if src.exists():
            _copytree(src, dest_root / name)
            seeded.append(name)
    pointer = product_root / ".claude" / "active_session.json"
    if pointer.exists():
        _copytree(pointer, dest_root / ".claude" / "active_session.json")
        seeded.append(".claude/active_session.json")
    return seeded


def trust_worktree_path(project_dir: Path, claude_json: Optional[Path] = None) -> None:
    """Mark a worktree path trusted for the Claude Code CLI.

    A fresh worktree is a directory the CLI has never seen, so it treats it as
    UNTRUSTED and ignores the workspace's `.claude/settings.json` permissions
    ("this workspace has not been trusted"), which fails every non-interactive
    session. The live checkout only works because it was trusted once. We seed
    the trust flag the CLI would set after its interactive dialog:
    `projects["<abs path>"].hasTrustDialogAccepted = true` in ~/.claude.json.
    Best-effort — never fail allocation over it.
    """
    import json

    resolved = str(Path(project_dir).resolve())
    # The CLI keys ~/.claude.json by the FORWARD-SLASH path (its own
    # cwd-normalised form), e.g. "C:/ivs-ws/.../taskflow" — a Windows
    # backslash key silently never matches. Seed both forms to be safe.
    keys = {resolved, resolved.replace("\\", "/")}
    cj = claude_json or (Path.home() / ".claude.json")
    try:
        data = json.loads(cj.read_text(encoding="utf-8")) if cj.exists() else {}
    except Exception:
        data = {}
    projects = data.setdefault("projects", {})
    for path in keys:
        entry = projects.setdefault(path, {})
        entry["hasTrustDialogAccepted"] = True
        entry.setdefault("hasCompletedProjectOnboarding", True)
    try:
        cj.write_text(json.dumps(data, indent=2), encoding="utf-8")
    except Exception:
        logger.warning("could not seed CLI trust for %s", path, exc_info=True)


def seed_repo_config(live_repo: Path, worktree: Path) -> bool:
    """.haikai/config.json is gitignored — without it GitManager.load_config
    raises in a fresh worktree (G4)."""
    src = Path(live_repo) / ".haikai" / "config.json"
    if not src.exists():
        return False
    _copytree(src, Path(worktree) / ".haikai" / "config.json")
    return True


def encode_project_dir(project_dir: str) -> str:
    """The Claude CLI's cwd → session-directory encoding (mirror of
    claude_chat_executor.get_session_file)."""
    p = str(project_dir)
    p = p.replace(":\\", "--").replace(":/", "--")
    return p.replace("\\", "-").replace("/", "-").replace("_", "-")


def transplant_session_dir(old_project_dir: str, new_project_dir: str,
                           claude_home: Optional[Path] = None) -> Optional[Path]:
    """Copy the encoded CLI session DIRECTORY verbatim (sidecars included —
    sessions are directories, not one jsonl; D7) so --resume works from the
    worktree cwd. Transcript content is copied AS-IS (stale historical
    paths accepted, grill Q3). Returns the new dir or None if no source."""
    home = claude_home or (Path.home() / ".claude" / "projects")
    src = home / encode_project_dir(old_project_dir)
    if not src.is_dir():
        return None
    dst = home / encode_project_dir(new_project_dir)
    shutil.copytree(src, dst, dirs_exist_ok=True)
    return dst


def sha256_tree(root: Path, rel_files: Iterable[str]) -> str:
    """Stable content checksum over the given files (repair mini-spec
    hand-off verification, D8). Missing files hash as empty."""
    h = hashlib.sha256()
    for rel in sorted(rel_files):
        h.update(rel.encode())
        f = Path(root) / rel
        if f.is_file():
            h.update(f.read_bytes())
    return h.hexdigest()


def spec_planning_checksum(product_root: Path, spec: str) -> Optional[str]:
    """sha256 over a spec's planning files (the repair mini-spec hand-off,
    D8): the SAME function runs at dispatch (enqueue_cli, live product root)
    and at allocation (seeded copy) — mismatch = tampered/partial hand-off,
    fail fast (W5). None if the planning dir doesn't exist."""
    planning = Path(product_root) / "haikai" / "specs" / spec / "planning"
    if not planning.is_dir():
        return None
    rels = sorted(
        str(p.relative_to(product_root)).replace("\\", "/")
        for p in planning.rglob("*") if p.is_file()
    )
    return sha256_tree(product_root, rels)


# ── D14 reclaim ──────────────────────────────────────────────────────────────

def reclaim_allowed(job, storage,
                    stale_seconds: float = STALE_HEARTBEAT_SECONDS,
                    lease_active: bool = False) -> tuple[bool, str]:
    """The six-condition predicate (D14). `job` may be None for a worktree
    registration with no job record (TTL path — caller decides)."""
    from src.job_queue.job_models import (JobStatus, PROTECTED_STATUSES,
                                          TERMINAL_STATUSES)

    if job is None:
        return True, "no job record (TTL path)"
    status = job.status if isinstance(job.status, JobStatus) else JobStatus(job.status)
    if status not in TERMINAL_STATUSES:                       # cond 1
        return False, f"status {status.value} is not terminal"
    if status in PROTECTED_STATUSES:                          # cond 2
        return False, f"status {status.value} is protected"
    # cond 3 (protected resume_from_step + worktree_root state) is subsumed:
    # resume-protected statuses (QUEUED_FOR_RESUME, RECOVERING, RESUMABLE_FAILED)
    # are all non-terminal, so condition 1 already refuses them.
    pid = storage.tracked_pid(job.job_id) if storage else None  # cond 4
    if pid is not None:
        from src.job_queue.process_tracking import pid_alive
        if pid_alive(pid):
            age = storage.heartbeat_age_seconds(job.job_id)
            if age is None or age < stale_seconds:
                return False, f"tracked pid {pid} alive and heartbeat fresh"
    else:
        age = storage.heartbeat_age_seconds(job.job_id) if storage else None
        if age is not None and age < stale_seconds:
            return False, f"heartbeat fresh ({age:.0f}s < {stale_seconds}s)"
    if lease_active:                                          # cond 5
        return False, "active worker lease owns the worktree"
    return True, "reclaimable"                                # cond 6 = caller copies logs first


def copy_observability_out(worktree_root: Path, logs_path: Optional[str]) -> None:
    """D14 condition 6: chat logs (and anything else worth keeping) must be
    copied out BEFORE deletion."""
    if not logs_path:
        return
    src = Path(worktree_root) / "chat_logs"
    if src.is_dir():
        dst = Path(logs_path) / "chat_logs"
        shutil.copytree(src, dst, dirs_exist_ok=True)


def remove_worktree(live_repo: Path, path: Path) -> None:
    """Windows removal ladder (W8): unlock → remove → retry → remove --force
    → delete contents → prune. Never a bare rmtree without prune."""
    path = Path(path)
    _git(live_repo, "worktree", "unlock", str(path))
    for attempt, force in ((1, False), (2, False), (3, True)):
        args = ["worktree", "remove"] + (["--force"] if force else []) + [str(path)]
        cp = _git(live_repo, *args)
        if cp.returncode == 0:
            break
        time.sleep(0.5 * attempt)
    else:  # pragma: no cover
        pass
    if path.exists():
        shutil.rmtree(path, ignore_errors=True)
    _git(live_repo, "worktree", "prune")


def reclaim_run(live_repos: Iterable[Path], worktree_paths: Iterable[Path],
                run_root_dir: Path, logs_path: Optional[str] = None) -> None:
    """Reclaim a run's whole worktree set. Caller has already satisfied the
    D14 predicate (and killed the tracked tree, D13)."""
    copy_observability_out(run_root_dir, logs_path)
    for repo, wt in zip(live_repos, worktree_paths):
        try:
            remove_worktree(repo, wt)
        except Exception:
            logger.warning("remove_worktree(%s) failed", wt, exc_info=True)
    shutil.rmtree(run_root_dir, ignore_errors=True)


def sweep(storage, workspace_dir: str, live_repo_resolver,
          ttl_seconds: float = 7 * 24 * 3600) -> list[str]:
    """Reclaim crash debris under <workspace>/wt/ per D14. `live_repo_resolver`
    maps a Job -> list[(live_repo, worktree_path)] (S4 provides it). Dirs with
    NO matching job record are removed only past `ttl_seconds`. Returns
    reclaimed root names."""
    wt_root = Path(workspace_dir) / "wt"
    if not wt_root.is_dir():
        return []
    by_prefix = {}
    for job in storage.list_jobs(limit=1000):
        if job.worktree_root:
            by_prefix[Path(job.worktree_root).name] = job
    reclaimed = []
    for entry in wt_root.iterdir():
        if not entry.is_dir():
            continue
        job = by_prefix.get(entry.name)
        if job is None:
            age = time.time() - entry.stat().st_mtime
            if age > ttl_seconds:
                shutil.rmtree(entry, ignore_errors=True)
                reclaimed.append(entry.name)
            continue
        ok, reason = reclaim_allowed(job, storage)
        if not ok:
            logger.debug("sweep: keep %s (%s)", entry.name, reason)
            continue
        pairs = live_repo_resolver(job) or []
        reclaim_run([p[0] for p in pairs], [p[1] for p in pairs],
                    entry, logs_path=job.logs_path)
        reclaimed.append(entry.name)
    return reclaimed


# ── D11 composite verify run-root ────────────────────────────────────────────

def _sha_present(repo: Path, sha: str) -> bool:
    return _git(repo, "cat-file", "-e", f"{sha}^{{commit}}").returncode == 0


def allocate_verify_root(workspace_dir: str, company: str, project: str,
                         job_id: str, bindings: dict,
                         specs: Iterable[str]) -> dict:
    """Build the composite verify run-root (spec v2 D11, user ruling):

        verify-root/<id8>/
          context/    coordination.yaml, coordination.lock.yaml,
                      haikai/specs/<spec>/ (planning, rubrics, ...)
          repos/<r>/  detached worktree at r's bound head_sha
          evidence/   setup/ command-results/ verdicts/

    `bindings` maps repo-label -> {live_repo: Path, head_sha: str|None}.
    Repos with head_sha=None are UNPINNABLE — no worktree is created; they
    are returned in `unpinned` (no binding → no code verification; never a
    live-checkout fallback). Fetch-on-miss before the detached add (a
    CI-reported SHA may not exist locally yet).

    Returns {root, context_dir, repos_dir, evidence_dir, repos: {label:
    path}, unpinned: [labels], allocated: [(live_repo, wt_path)]}.
    The product root is a coordination/meta root — NEVER `worktree add`ed.
    """
    live_product = Path(workspace_dir) / company / project
    root = Path(workspace_dir) / "wt" / f"v{run_key(job_id)[:15]}"
    context = root / "context"
    repos_dir = root / "repos"
    evidence = root / "evidence"
    for d in (context, repos_dir, evidence / "setup",
              evidence / "command-results", evidence / "verdicts"):
        d.mkdir(parents=True, exist_ok=True)

    for name in ("coordination.yaml", "coordination.lock.yaml"):
        src = live_product / name
        if src.exists():
            _copytree(src, context / name)
    for spec in specs:
        src = live_product / "haikai" / "specs" / spec
        if src.is_dir():
            _copytree(src, context / "haikai" / "specs" / spec)

    repos, unpinned, allocated = {}, [], []
    with project_git_lock(workspace_dir, company, project):
        for label, b in bindings.items():
            live_repo, sha = Path(b["live_repo"]), b.get("head_sha")
            if not sha:
                unpinned.append(label)
                continue
            if not _sha_present(live_repo, sha):
                _git(live_repo, "fetch", "--all", "--quiet")  # fetch-on-miss
            if not _sha_present(live_repo, sha):
                unpinned.append(label)  # still absent → unpinnable, not a guess
                continue
            dest = repos_dir / label
            _require(_git(live_repo, "worktree", "add", "--detach",
                          str(dest), sha),
                     f"cannot create verify worktree at {sha[:12]}")
            _git(live_repo, "worktree", "lock",
                 "--reason", f"verify job {job_id} active", str(dest))
            repos[label] = dest
            allocated.append((live_repo, dest))
    return {"root": root, "context_dir": context, "repos_dir": repos_dir,
            "evidence_dir": evidence, "repos": repos, "unpinned": unpinned,
            "allocated": allocated}


def run_setup_commands(coordination_lock: Path, repos: dict,
                       evidence_setup_dir: Path) -> list[str]:
    """F6: per-repo pinned setup_commands from coordination.lock.yaml, run
    once at allocation, output under evidence/setup/. A repo whose setup
    fails is returned in the infra list — its cells classify `infra`,
    never `real`. Missing lockfile / no setup_commands → no-op."""
    infra: list[str] = []
    if not coordination_lock.is_file():
        return infra
    try:
        import yaml
        data = yaml.safe_load(coordination_lock.read_text()) or {}
    except Exception:
        return infra
    repo_specs = data.get("repos") or {}
    for label, wt in repos.items():
        entry = repo_specs.get(label) or {}
        cmds = entry.get("setup_commands") or []
        log = Path(evidence_setup_dir) / f"{label}.log"
        lines = []
        failed = False
        for cmd in cmds:
            cp = subprocess.run(cmd, shell=True, cwd=str(wt),
                                capture_output=True, text=True)
            lines.append(f"$ {cmd}\n(exit {cp.returncode})\n"
                         f"{cp.stdout[-2000:]}\n{cp.stderr[-2000:]}\n")
            if cp.returncode != 0:
                failed = True
                break
        if lines:
            log.write_text("".join(lines), encoding="utf-8")
        if failed:
            infra.append(label)
    return infra


def reclaim_verify_root(workspace_dir: str, company: str, project: str,
                        allocated, root: Path) -> None:
    """Tear down a verify root: worktrees under the lock, then the dir.
    Evidence worth keeping must be copied out by the caller first."""
    with project_git_lock(workspace_dir, company, project):
        for live_repo, wt in allocated:
            try:
                remove_worktree(live_repo, wt)
            except Exception:
                logger.warning("remove verify worktree %s failed", wt,
                               exc_info=True)
    shutil.rmtree(root, ignore_errors=True)


def repo_index_lock_path(repo_or_worktree: Path) -> Path:
    """Linked-worktree-safe index.lock resolution (D5: `.git` is a FILE in a
    linked worktree — `<dir>/.git/index.lock` silently misses)."""
    cp = _git(repo_or_worktree, "rev-parse", "--git-path", "index.lock")
    if cp.returncode != 0:
        return Path(repo_or_worktree) / ".git" / "index.lock"
    p = Path(cp.stdout.strip())
    return p if p.is_absolute() else Path(repo_or_worktree) / p
