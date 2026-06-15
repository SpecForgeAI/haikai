"""haibox — Haikai's lightweight local sandbox runner.

"Warm a box, serve the target, replay against it." A single-machine take on the
crabbox model: prepare an isolated workspace, start a target as a child process,
health-check it, hand back a base_url to replay against, then tear it down.

Design (the part that lets this scale later without a rewrite):

    control service (haiboxd, FastAPI on 127.0.0.1)   ← stays identical
          │   POST/GET/DELETE /boxes  + TTL/idle reaper + concurrency cap
          ▼   Backend protocol:  launch(spec) -> handle ; terminate ; is_alive
      LocalSubprocessBackend  (today)
      DockerBackend / RemoteSSHBackend / K8sBackend  (add a class, not a rewrite)

Only the backend knows *where* a box runs. The service, its API, the registry,
the reaper, and every caller are backend-agnostic. See README.md → "Adding a
backend".
"""

from .models import Box, BoxSpec, BoxState
from .backends import Backend, LocalSubprocessBackend, wait_healthy

__all__ = [
    "Box",
    "BoxSpec",
    "BoxState",
    "Backend",
    "LocalSubprocessBackend",
    "wait_healthy",
]
