"""haibox ↔ verification worker integration.

The worker provisions a serving target, replays/verifies against its base_url,
and is guaranteed teardown — even on error. This is the concrete answer to the
migration-reconciliation "who deploys + run the suite against a target" gap:

    from src.haibox.integration import serving_target

    with serving_target(command=["python", "app.py"], source_dir=repo_dir,
                        health_path="/healthz", idle_seconds=300) as box:
        base_url = box["base_url"]
        reconcile_against(base_url)      # replay captured ops here (any duration)
    # box is released here, even if reconcile_against raised

A background heartbeat keeps the box past its idle deadline for the WHOLE block,
so a long reconciliation can't get its target reaped out from under it (G3).

Opt-in: nothing in the existing verify flow changes unless a job asks for a
target. `provision_for_job` reads an optional `target` block from a job payload.
"""

from __future__ import annotations

import threading
from contextlib import contextmanager
from typing import Any, Iterator, Optional

from .client import HaiboxClient


def _heartbeat_loop(client: HaiboxClient, box_id: str, interval: float,
                    stop: threading.Event) -> None:
    while not stop.wait(interval):
        try:
            client.heartbeat(box_id)
        except Exception:
            pass  # a missed beat isn't fatal; the next one (or the TTL) covers it


@contextmanager
def serving_target(command, *, client: Optional[HaiboxClient] = None,
                   heartbeat_interval: Optional[float] = None,
                   **spec) -> Iterator[dict[str, Any]]:
    """Serve a target for the duration of the block, then release it. A daemon
    heartbeat thread runs for the whole block so the reaper won't kill an in-use
    box (G3). `spec` accepts the same kwargs as HaiboxClient.serve."""
    client = client or HaiboxClient()
    box = client.serve(command, **spec)
    idle = float(spec.get("idle_seconds", 600.0))
    interval = heartbeat_interval if heartbeat_interval is not None else max(5.0, idle / 3.0)
    stop = threading.Event()
    beat = threading.Thread(
        target=_heartbeat_loop, args=(client, box["box_id"], interval, stop),
        name=f"haibox-hb-{box['box_id']}", daemon=True,
    )
    beat.start()
    try:
        yield box
    finally:
        stop.set()
        try:
            client.release(box["box_id"])
        except Exception:
            # Best-effort: the reaper's TTL/idle deadline is the backstop.
            pass


def provision_for_job(payload: dict[str, Any],
                      client: Optional[HaiboxClient] = None) -> Optional[dict[str, Any]]:
    """If a job payload carries a `target` block, serve it and return the box;
    otherwise return None. Does NOT mutate the caller's payload (G6).

    Expected shape:
        payload["target"] = {"command": [...] | "...", "source_dir": "...",
                             "setup": "...", "health_path": "/healthz", ...}

    The caller owns the box lifetime (release it, or let the reaper expire it).
    Use `serving_target` when the lifetime is a single code block.
    """
    raw = payload.get("target")
    if not raw or not raw.get("command"):
        return None
    target = dict(raw)               # copy — never mutate the caller's dict
    command = target.pop("command")
    client = client or HaiboxClient()
    return client.serve(command, **target)
