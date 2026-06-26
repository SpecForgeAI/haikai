"""Tool registry — plain specs wrapping connector functions.

Importing this never requires the `mcp` SDK; the runtime server
(`gitlab_server.py`) consumes `TOOLS` and registers each spec. Keeping the
registry SDK-free means tool names, grouping, and the `destructive` flag are
unit-testable before the SDK is even installed.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from src.connectors.gitlab import environments, merge_requests, pipelines, runners


@dataclass(frozen=True)
class ToolSpec:
    name: str
    fn: Callable
    description: str
    destructive: bool = False


TOOLS: list[ToolSpec] = [
    # --- Runners -----------------------------------------------------------
    ToolSpec(
        "gitlab_list_runners",
        runners.list_runners,
        "List CI runners, optionally filtered by status and tags.",
    ),
    ToolSpec(
        "gitlab_get_runner",
        runners.get_runner,
        "Get a single runner by id.",
    ),
    ToolSpec(
        "gitlab_pause_runner",
        runners.pause_runner,
        "Pause a runner so it stops taking new jobs.",
        destructive=True,
    ),
    ToolSpec(
        "gitlab_resume_runner",
        runners.resume_runner,
        "Resume a paused runner.",
    ),
    ToolSpec(
        "gitlab_delete_runner",
        runners.delete_runner,
        "Delete a runner (irreversible).",
        destructive=True,
    ),
    # --- Pipelines & Jobs --------------------------------------------------
    ToolSpec("gitlab_list_pipelines", pipelines.list_pipelines,
             "List a project's pipelines, optionally filtered by ref/status."),
    ToolSpec("gitlab_get_pipeline", pipelines.get_pipeline, "Get one pipeline by id."),
    ToolSpec("gitlab_list_jobs", pipelines.list_jobs, "List the jobs of a pipeline."),
    ToolSpec("gitlab_get_job_log", pipelines.get_job_log, "Read a job's log (trace)."),
    ToolSpec("gitlab_trigger_pipeline", pipelines.trigger_pipeline,
             "Trigger a pipeline for a ref, with optional variables."),
    ToolSpec("gitlab_retry_pipeline", pipelines.retry_pipeline, "Retry a pipeline's failed jobs."),
    ToolSpec("gitlab_cancel_pipeline", pipelines.cancel_pipeline,
             "Cancel a running pipeline.", destructive=True),
    # --- Merge Requests ----------------------------------------------------
    ToolSpec("gitlab_list_merge_requests", merge_requests.list_merge_requests,
             "List a project's merge requests, optionally filtered by state."),
    ToolSpec("gitlab_get_merge_request", merge_requests.get_merge_request, "Get one MR by iid."),
    ToolSpec("gitlab_create_merge_request", merge_requests.create_merge_request,
             "Open a merge request from a source branch to a target branch."),
    ToolSpec("gitlab_merge_merge_request", merge_requests.merge_merge_request,
             "Merge a merge request.", destructive=True),
    ToolSpec("gitlab_close_merge_request", merge_requests.close_merge_request,
             "Close a merge request without merging.", destructive=True),
    # --- Environments & Deployments ----------------------------------------
    ToolSpec("gitlab_list_environments", environments.list_environments,
             "List a project's environments."),
    ToolSpec("gitlab_get_environment", environments.get_environment, "Get one environment by id."),
    ToolSpec("gitlab_list_deployments", environments.list_deployments,
             "List a project's deployments, optionally filtered by environment/status."),
    ToolSpec("gitlab_get_deployment", environments.get_deployment, "Get one deployment by id."),
    ToolSpec("gitlab_stop_environment", environments.stop_environment,
             "Stop an environment.", destructive=True),
]


def tool_names() -> list[str]:
    return [t.name for t in TOOLS]
