"""Single source of truth for locating and invoking the kiro-cli binary.

kiro-cli is a Linux binary. On Linux/WSL the API finds it natively (PATH or
~/.local/bin). On Windows the API runs natively but kiro-cli lives INSIDE the
default WSL distro, so discovery AND every subsequent invocation must go
through ``wsl.exe``.

The critical subtlety (live-hit 2026-07-27, first Stage-1 shape-spec
dispatch): the Kiro install script drops the binary in ``~/.local/bin``,
which Ubuntu puts on PATH via ``~/.profile`` — read by LOGIN shells only.
An interactive ``wsl`` session is a login shell, so ``kiro-cli`` works when
the user types it; but ``wsl which kiro-cli`` (the old probe) runs a
NON-login shell, misses ``~/.local/bin``, and reported "not found" on a
machine where kiro-cli was installed and logged in. The probe here uses
``bash -lc`` first, then falls back to testing the well-known install dirs
explicitly (which also covers root installs inside VHDX-backed distros that
are not reachable as Windows file paths).

Per the helper-exists-sibling-missed doctrine, BOTH executors
(src/kiro_cli_executor.py orchestration, src/chat/kiro_chat_executor.py
chat) delegate discovery to :func:`locate_kiro_cli` and build every
subprocess argv via :func:`kiro_cli_args` — a guard test in
tests/test_anti_pattern_guards.py asserts no sibling probes or bare argv
lists remain.
"""
from __future__ import annotations

import logging
import platform
import shutil
import subprocess
from pathlib import Path
from typing import List, Tuple, Union

logger = logging.getLogger(__name__)

# One probe budget: a cold WSL VM can take several seconds to boot.
_WSL_PROBE_TIMEOUT_SECONDS = 15.0

# Well-known install locations, probed inside WSL independent of shell PATH.
_WSL_CANDIDATE_SCRIPT = (
    'for p in "$HOME/.local/bin/kiro-cli" /usr/local/bin/kiro-cli '
    '/root/.local/bin/kiro-cli; do '
    'if [ -x "$p" ]; then printf %s "$p"; exit 0; fi; done'
)


def _clean_wsl_output(raw: str) -> str:
    """wsl.exe emits its own errors as UTF-16; NULs survive text decoding."""
    return raw.replace("\x00", "").strip()


def _probe_wsl(cmd: List[str]) -> str:
    """Run one WSL probe command; empty string on any failure."""
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            errors="replace",
            timeout=_WSL_PROBE_TIMEOUT_SECONDS,
        )
    except Exception as e:
        logger.debug(f"WSL probe {cmd} failed: {e}")
        return ""
    return _clean_wsl_output(result.stdout or "")


def locate_kiro_cli() -> Tuple[str, bool]:
    """Locate kiro-cli. Returns ``(cli_path, use_wsl)``.

    ``cli_path`` is a native path when ``use_wsl`` is False, a POSIX path
    inside the default WSL distro when True. Raises ``ValueError`` listing
    every probe that came up empty (the message travels to the client as
    the 400 detail, so it must be actionable).
    """
    probes_failed: List[str] = []

    kiro_path = shutil.which("kiro-cli")
    if kiro_path:
        return kiro_path, False
    probes_failed.append("PATH")

    for candidate in (
        Path.home() / ".local" / "bin" / "kiro-cli",
        Path("/usr/local/bin/kiro-cli"),
    ):
        if candidate.exists():
            return str(candidate), False
    probes_failed.append("native ~/.local/bin and /usr/local/bin")

    if platform.system() == "Windows":
        if shutil.which("wsl"):
            # LOGIN shell: sources ~/.profile so ~/.local/bin is on PATH —
            # matches what the user's interactive `wsl` session sees.
            found = _probe_wsl(["wsl", "--", "bash", "-lc", "command -v kiro-cli"])
            if found.startswith("/"):
                logger.info(f"Using kiro-cli via WSL (login-shell PATH): {found}")
                return found, True
            probes_failed.append("WSL login shell (bash -lc 'command -v kiro-cli')")

            found = _probe_wsl(["wsl", "--", "sh", "-c", _WSL_CANDIDATE_SCRIPT])
            if found.startswith("/"):
                logger.info(f"Using kiro-cli via WSL (well-known dir): {found}")
                return found, True
            probes_failed.append(
                "WSL well-known dirs ($HOME/.local/bin, /usr/local/bin, /root/.local/bin)"
            )
        else:
            probes_failed.append("wsl.exe (not on PATH)")

    raise ValueError(
        "kiro-cli not found. Probed: " + "; ".join(probes_failed) + ". "
        "Install it via the Kiro CLI install script inside your default WSL "
        "distro (see docs/ENABLING_KIRO_CLI.md), then verify with "
        "'wsl kiro-cli whoami'."
    )


def kiro_cli_args(cli_path: Union[str, Path], use_wsl: bool, *args: str) -> List[str]:
    """Build a kiro-cli argv, prefixing ``wsl`` on Windows.

    ALWAYS build kiro-cli invocations through this helper: ``str(Path)`` of
    a POSIX path on Windows flips the slashes to backslashes, which is the
    bug this helper exists to prevent (clear_session hit it).
    """
    if use_wsl:
        return ["wsl", Path(cli_path).as_posix(), *args]
    return [str(cli_path), *args]
