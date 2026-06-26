"""Background maintenance for async verification — the liveness backstops.

Two pieces existed but nothing in the running system ever drove them:
  - D10.5 TTL sweeper (`sweeper.sweep`): a `pending` cell's only backstop.
  - D9.1 poll-fallback (`connectors.*.poll`): recovers a verdict whose webhook
    never arrived (no public URL, dropped re-invoke, provider outage).

This module runs both on a timer in a daemon thread, started at API boot — the
same pattern as the startup job-recovery (`src/api/recovery.py`).

Order per tick: POLL first (record any finished pipeline's verdict), THEN sweep
(time out whatever is still pending past the TTL) — so a result that's actually
available is never lost to a TTL timeout.
"""

from __future__ import annotations

import logging
import os
import threading
from datetime import datetime

from src.verification import recorder, store
from src.verification.sweeper import sweep

logger = logging.getLogger(__name__)

TERMINAL = {"pass", "fail", "skipped", "timeout"}


def _default_poll(provider: str, project: str, head_sha: str) -> str | None:
    """Query the provider for a SHA's folded verdict (the poll-fallback). Returns
    a verdict string or None. Uses the default credentials/base URL — a best-
    effort backstop, not per-repo-configured."""
    try:
        if provider == "gitlab":
            from src.connectors.gitlab.client import resolve_base_url
            from src.verification.connectors import gitlab_ci
            return gitlab_ci.poll(resolve_base_url(), project, head_sha, "default").get("verdict")
        if provider == "github":
            from src.verification.connectors import github_actions
            return github_actions.poll(project, head_sha, "default").get("verdict")
    except Exception as e:  # provider down / auth / no pipelines — leave it pending
        logger.debug("poll-fallback failed for %s %s@%s: %s", provider, project, head_sha[:8], e)
    return None


def _reinvoke(binding: dict) -> str | None:
    from src.api.routes.inbound import _enqueue_reinvoke
    return _enqueue_reinvoke(binding)


def poll_open_cells(conn, poll_fn=None, reinvoke_fn=None) -> list[dict]:
    """Poll every pending cell that has a binding; a terminal verdict is recorded
    (guarded) and a fresh verify-task-group run enqueued (D10.2). A cell that's
    still pending (or unreachable) is left untouched."""
    poll_fn = poll_fn or _default_poll
    reinvoke_fn = reinvoke_fn or _reinvoke
    driven = []
    for cell in store.pending_cells(conn):
        binding = store.binding_for_cell(conn, cell["orchestrate_id"], cell["task_group_id"], cell["repo"])
        if not binding:
            continue
        verdict = poll_fn(binding["provider"], cell["repo"], binding["head_sha"])
        if verdict not in TERMINAL:
            continue
        ok, reason = recorder.record_verdict(
            conn, cell["orchestrate_id"], cell["task_group_id"], cell["repo"], cell["verifier"],
            verdict, detail={"polled": True, "head_sha": binding["head_sha"]},
        )
        job_id = reinvoke_fn(binding) if ok else None
        if ok:
            store.append_event(
                conn, cell["orchestrate_id"], cell["task_group_id"],
                "reinvoke_requested" if job_id else "reinvoke_failed",
                {"job_id": job_id, "trigger": "poll"}, cell["repo"],
            )
        driven.append({"cell": [cell["repo"], cell["verifier"]], "verdict": verdict,
                       "recorded": ok, "reason": reason, "reinvoke_job": job_id})
    return driven


def run_once(ttl_hours: float | None = None, poll_fn=None, now: datetime | None = None) -> dict:
    """One maintenance tick: poll-drive finished pipelines, then TTL-sweep the rest."""
    ttl_hours = ttl_hours if ttl_hours is not None else float(os.getenv("VERIFY_TTL_HOURS", "24"))
    conn = store.connect()
    try:
        driven = poll_open_cells(conn, poll_fn=poll_fn)
        swept = sweep(conn, ttl_hours, now=now)
    finally:
        conn.close()
    if driven or swept:
        logger.info("verification maintenance: poll-driven=%d swept=%d", len(driven), len(swept))
    return {"driven": driven, "swept": swept}


def start_background(interval: float | None = None, ttl_hours: float | None = None,
                     poll_fn=None) -> threading.Event:
    """Spawn a daemon thread running `run_once` every `interval` seconds. Returns a
    stop Event (set it to halt). Off when VERIFY_MAINTENANCE in {off,false,0}.
    The first tick waits one interval, so importing the app stays cheap."""
    stop = threading.Event()
    if os.getenv("VERIFY_MAINTENANCE", "on").strip().lower() in ("off", "false", "0"):
        logger.info("verification maintenance disabled (VERIFY_MAINTENANCE=off)")
        return stop
    interval = interval if interval is not None else float(os.getenv("VERIFY_MAINTENANCE_INTERVAL", "60"))

    def _loop():
        while not stop.wait(interval):  # wait-then-run; exits promptly when stopped
            try:
                run_once(ttl_hours=ttl_hours, poll_fn=poll_fn)
            except Exception:
                logger.exception("verification maintenance tick failed")

    threading.Thread(target=_loop, name="verify-maintenance", daemon=True).start()
    logger.info("verification maintenance started (interval=%ss)", interval)
    return stop
