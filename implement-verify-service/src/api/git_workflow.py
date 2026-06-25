"""Shared V2 git-workflow helper.

Centralises the create-branch + commit + push + PR sequence that V2
HTTP endpoints and the orchestration job runner used to copy-paste.

Before extraction, ~4 sites carried near-identical bodies with subtly
divergent error handling — adding any git-policy change required
editing N files and risked leaving one out (Shotgun Surgery). The
extraction also closes a duplication finding (D-C1/D-D2) and a smaller
pass-1 finding (HIGH-3) flagged by the deep-src-smells pass.

Sites collapsed:
- `src/api/routes/orchestration.py:398-426` (full sequence, per-spec loop)
- `src/api/routes/standards.py:143-164`     (pull + full sequence, single spec)
- `src/api/routes/specs.py:336-341`         (branch + commit only — uses commit_only=True)
- `src/job_queue/tasks.py:136-183`          (full sequence, per-spec loop)

NOT extracted: `src/api/routes/haikai.py:319-324` does `gm.pull_latest()`
only — no commit/push/PR — so it isn't an instance of this pattern.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from ..git.config import GitConfig, GitConfigError
from ..git.git_manager import GitManager, GitManagerError

logger = logging.getLogger(__name__)


def apply_git_workflow(
    gm: GitManager,
    git_config: Optional[GitConfig],
    branch: str,
    commit_msg: str,
    pr_title: Optional[str] = None,
    pr_body: Optional[str] = None,
    response_obj: Optional[Any] = None,
    *,
    commit_only: bool = False,
    checkout_back_to_default: bool = False,
    push_pr_only: bool = False,
    error_label: Optional[str] = None,
) -> None:
    """Run the create-branch → commit → push → PR sequence.

    Single documented error-handling policy: catches `GitManagerError`
    + `GitConfigError`, logs at ERROR, and (if `response_obj` is
    provided and exposes the attributes) mutates it in-place:

      - ``response_obj.commit_sha`` ← latest commit SHA (or unchanged if commit was a no-op)
      - ``response_obj.branch``     ← branch name
      - ``response_obj.pr_url``     ← PR URL (if push + PR succeeded)
      - ``response_obj.errors``     ← list appended with the failure message

    Args:
        gm:              Pre-built GitManager for the target project.
        git_config:      Loaded git config — read for `auto_push` + `auto_pr`.
        branch:          Branch name to create (e.g. `feature/<spec_name>`).
        commit_msg:      Commit message.
        pr_title:        PR title. Required for PR creation; if None, PR is
                         skipped even when `git_config.auto_pr` is true.
        pr_body:         PR body. Treated as "" if None and a PR is created.
        response_obj:    Optional response object to mutate in-place.
                         Attributes set only if present (uses `hasattr`),
                         so Pydantic models with `model_config = ConfigDict(
                         extra='forbid')` won't blow up.
        commit_only:     If True, skip push + PR regardless of git_config.
                         Used by `specs.py:write_spec_v2`, which only
                         records work-in-progress per spec
                         2026-03-15-deferred-branch-creation.
        push_pr_only:    If True, the branch ALREADY exists and already carries
                         its commits — skip create-branch + commit and only run
                         push + PR (still gated by `auto_push`/`auto_pr`). NOT
                         gated on a fresh commit SHA (there is none this call).
                         Used by `tasks.py:_finalize_batch_git` to push the one
                         shared batch branch + open a single PR after the run.
                         Mutually exclusive with `commit_only`.
        checkout_back_to_default: If True, attempt
                         `git checkout <default_branch>` at the end.
                         Used by per-spec loops in orchestration.py +
                         tasks.py so the next iteration starts from a
                         clean state.
        error_label:     Optional prefix for error messages — typically a
                         spec name or operation label. Defaults to the
                         branch name.
    """
    label = error_label or branch

    if push_pr_only:
        # The branch is already created + committed (e.g. per-spec commit_only
        # calls accumulated onto it). Push it + open one PR, reusing this helper's
        # single error policy. No create, no commit, and NOT gated on a fresh sha.
        try:
            if response_obj is not None and hasattr(response_obj, "branch"):
                response_obj.branch = branch
            push_ok = False
            if git_config is not None and git_config.auto_push:
                gm.push_branch(branch)
                push_ok = True
            if push_ok and git_config is not None and git_config.auto_pr and pr_title:
                pr_url = gm.create_pull_request(
                    title=pr_title, branch=branch, body=pr_body or "",
                )
                if response_obj is not None and hasattr(response_obj, "pr_url"):
                    response_obj.pr_url = pr_url
            logger.info("Git workflow (push/PR only) OK for %s: branch=%s push=%s",
                        label, branch, push_ok)
        except (GitManagerError, GitConfigError) as e:
            error_msg = f"Git workflow failed for {label}: {e}"
            logger.error(error_msg)
            if response_obj is not None and hasattr(response_obj, "errors"):
                existing = getattr(response_obj, "errors", None) or []
                existing.append(error_msg)
                response_obj.errors = existing
        return

    try:
        gm.create_feature_branch(branch)
        sha = gm.commit_all(commit_msg)

        if response_obj is not None:
            if hasattr(response_obj, "branch"):
                response_obj.branch = branch
            # Only update commit_sha if commit produced one (empty string
            # = nothing to commit). Don't overwrite a prior SHA from an
            # earlier spec in the loop.
            if sha and hasattr(response_obj, "commit_sha"):
                response_obj.commit_sha = sha

        push_ok = False
        if not commit_only and git_config is not None and git_config.auto_push and sha:
            gm.push_branch(branch)
            push_ok = True

        if push_ok and git_config is not None and git_config.auto_pr and pr_title:
            pr_url = gm.create_pull_request(
                title=pr_title,
                branch=branch,
                body=pr_body or "",
            )
            if response_obj is not None and hasattr(response_obj, "pr_url"):
                response_obj.pr_url = pr_url

        sha_short = sha[:8] if isinstance(sha, str) and sha else "(no-op)"
        logger.info(
            "Git workflow OK for %s: branch=%s sha=%s push=%s",
            label, branch, sha_short, push_ok,
        )

    except (GitManagerError, GitConfigError) as e:
        error_msg = f"Git workflow failed for {label}: {e}"
        logger.error(error_msg)
        if response_obj is not None and hasattr(response_obj, "errors"):
            # `errors` may be None on a fresh Pydantic response — replace
            # with a fresh list rather than calling .append on None.
            existing = getattr(response_obj, "errors", None) or []
            existing.append(error_msg)
            response_obj.errors = existing

    if checkout_back_to_default:
        try:
            gm.checkout_default_branch()
        except Exception:
            # Best-effort — a failed checkout shouldn't override the
            # caller's success/failure decision for the workflow itself.
            logger.debug("checkout-back-to-default failed for %s", label, exc_info=True)
