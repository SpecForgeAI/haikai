"""Execution-environment preflight for orchestration jobs (2026-09-09).

WHY. Before this, the only environment checks were: does the API key exist
(executor-aware), do the spec files exist, and does the repo carry a test
runner manifest (file existence). Nothing probed the RUNTIME the agent's
tests need. Live shape: a Java repo whose integration tests use
Testcontainers, dispatched onto a host with no Docker daemon. Nothing
failed at dispatch. Hours later every Testcontainers class was skipped, the
suite exited 0, both verification gates read it as green, and the run
reported implemented work that had never been verified.

The checks here are REQUIREMENT-driven: a repo is only gated on a runtime it
actually needs (a repo with no Testcontainers must never be blocked on
Docker). They run in :func:`src.job_queue.tasks._resolve_request_context`,
which already raises ``ValueError`` for missing credentials and whose failure
already reaches the caller as an ``error`` outcome via the failure callback --
so a run item never strands at ``submitted`` and the operator sees the named
reason on the same path every other prologue failure uses.

This IVS-side check is the authoritative one: only the build service knows
the execution environment the agent will actually run in.
"""

from __future__ import annotations

import logging
import os
import platform
import re
import shutil
import subprocess
from pathlib import Path
from typing import Callable, List, Optional, Tuple

logger = logging.getLogger(__name__)

#: Build files inspected for a Testcontainers dependency.
_BUILD_FILES = ("pom.xml", "build.gradle", "build.gradle.kts")
#: Test-source roots scanned (shallowly, bounded) for the Testcontainers annotation.
_TEST_SOURCE_ROOTS = ("src/test", "src/integrationTest", "src/it", "test", "tests")
_TESTCONTAINERS_RE = re.compile(r"testcontainers|@Testcontainers", re.IGNORECASE)
#: Upper bound on test files scanned so the gate never spends real IO.
_MAX_TEST_FILES_SCANNED = 400


def repo_requires_docker(repo_dir: Path) -> bool:
    """True when the repo's build file or test sources reference Testcontainers.

    Build files first (cheap, one read each); then a bounded scan of the test
    source roots for ``@Testcontainers`` / the package name. A repo that never
    mentions Testcontainers is not gated on Docker.
    """
    root = Path(repo_dir)
    for name in _BUILD_FILES:
        f = root / name
        try:
            if f.is_file() and _TESTCONTAINERS_RE.search(f.read_text(encoding="utf-8", errors="replace")):
                return True
        except OSError:
            continue
    scanned = 0
    for rel in _TEST_SOURCE_ROOTS:
        base = root / rel
        if not base.is_dir():
            continue
        for path in base.rglob("*"):
            if scanned >= _MAX_TEST_FILES_SCANNED:
                return False
            if not path.is_file() or path.suffix not in (".java", ".kt", ".groovy", ".scala"):
                continue
            scanned += 1
            try:
                if _TESTCONTAINERS_RE.search(path.read_text(encoding="utf-8", errors="replace")):
                    return True
            except OSError:
                continue
    return False


def repo_requires_jdk(repo_dir: Path) -> bool:
    """True when the repo is a JVM build (Maven / Gradle manifest at the root)."""
    root = Path(repo_dir)
    return any((root / name).is_file() for name in _BUILD_FILES)


def docker_available(timeout_s: float = 5.0, runner: Callable[..., subprocess.CompletedProcess] = subprocess.run) -> Tuple[bool, str]:
    """``(available, detail)``. The cheapest RELIABLE probe is ``docker info``:
    under WSL-from-Windows a socket-existence check is not enough (Testcontainers
    tries the unix socket, then Docker Desktop, and both can be absent while a
    ``docker`` binary is on PATH)."""
    if shutil.which("docker") is None:
        return False, "no `docker` binary on PATH"
    try:
        cp = runner(["docker", "info"], capture_output=True, text=True, timeout=timeout_s)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return False, f"`docker info` failed: {exc}"
    if cp.returncode != 0:
        tail = ((cp.stderr or cp.stdout or "").strip().splitlines() or [""])[-1]
        return False, f"`docker info` exited {cp.returncode}: {tail[:200]}"
    return True, "docker daemon reachable"


def jdk_available(
    timeout_s: float = 20.0,
    runner: Callable[..., subprocess.CompletedProcess] = subprocess.run,
) -> Tuple[bool, str]:
    """``(available, detail)`` for the environment the AGENT runs in.

    On Windows with the WSL-hosted CLI the agent's shell is WSL, and its
    environment is exactly what :func:`src.kiro_cli_locator.wsl_env_prefix`
    injects -- so the probe runs there, with that prefix, rather than asking
    the Windows host (which has no bearing on what the agent can execute).
    Elsewhere: ``JAVA_HOME/bin/java`` or a ``java`` on PATH.
    """
    if platform.system() == "Windows" and os.getenv("CHAT_EXECUTOR", "").strip().lower() == "kiro":
        try:
            from .kiro_cli_locator import wsl_env_prefix
        except Exception:  # stripped environment
            from kiro_cli_locator import wsl_env_prefix  # type: ignore[no-redef]
        argv = [
            "wsl", *wsl_env_prefix(), "sh", "-c",
            'if [ -n "$JAVA_HOME" ] && [ -x "$JAVA_HOME/bin/java" ]; then echo "JAVA_HOME=$JAVA_HOME"; '
            'elif command -v java >/dev/null 2>&1; then echo "java=$(command -v java)"; '
            'else echo "NO_JDK"; exit 3; fi',
        ]
        try:
            cp = runner(argv, capture_output=True, text=True, timeout=timeout_s)
        except (OSError, subprocess.TimeoutExpired) as exc:
            return False, f"WSL JDK probe failed: {exc}"
        out = (cp.stdout or "").replace("\x00", "").strip()
        if cp.returncode != 0 or "NO_JDK" in out:
            return False, (
                "no JDK in the agent's WSL shell (JAVA_HOME unset/invalid and no `java` on PATH); "
                "set KIRO_WSL_ENV=JAVA_HOME=<wsl jdk dir> in .env.local"
            )
        return True, out.splitlines()[-1][:200] if out else "jdk reachable"
    java_home = os.getenv("JAVA_HOME", "").strip()
    if java_home:
        candidate = Path(java_home) / "bin" / ("java.exe" if platform.system() == "Windows" else "java")
        if candidate.is_file():
            return True, f"JAVA_HOME={java_home}"
        return False, f"JAVA_HOME={java_home} has no bin/java"
    if shutil.which("java"):
        return True, f"java={shutil.which('java')}"
    return False, "no JAVA_HOME and no `java` on PATH"


def preflight_repo_targets(
    targets: List[Tuple[Optional[str], Path]],
    *,
    docker_probe: Optional[Callable[[], Tuple[bool, str]]] = None,
    jdk_probe: Optional[Callable[[], Tuple[bool, str]]] = None,
) -> List[str]:
    """Return the environment problems that would make the run unverifiable.

    Empty list = go. Each entry names the repo folder, the requirement, and
    the probe's own detail, so the operator can act without reading logs.
    Probes run at most once per requirement across all targets.
    """
    # Resolved at CALL time (not bound as defaults) so a test or an operator
    # override of the module-level probes takes effect.
    docker_probe = docker_probe or docker_available
    jdk_probe = jdk_probe or jdk_available
    problems: List[str] = []
    docker_result: Optional[Tuple[bool, str]] = None
    jdk_result: Optional[Tuple[bool, str]] = None
    for folder, repo_dir in targets:
        label = folder or Path(repo_dir).name
        if repo_requires_jdk(repo_dir):
            if jdk_result is None:
                jdk_result = jdk_probe()
            ok, detail = jdk_result
            if not ok:
                problems.append(
                    f"repo '{label}' is a JVM build (Maven/Gradle) but no JDK is reachable "
                    f"in the agent's environment -- {detail}. Its tests cannot run; the "
                    "agent would mark them BLOCKED or fall back to static verification."
                )
        if repo_requires_docker(repo_dir):
            if docker_result is None:
                docker_result = docker_probe()
            ok, detail = docker_result
            if not ok:
                problems.append(
                    f"repo '{label}' uses Testcontainers but Docker is not available -- "
                    f"{detail}. Every Testcontainers class would be SKIPPED and the suite "
                    "would exit 0 without verifying anything."
                )
    return problems
