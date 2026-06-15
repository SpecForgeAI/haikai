"""inline_runner — execute pinned verifier commands (linters, test suites).

The commands come from coordination.lock.yaml / the spec's verifier config —
pinned, repo-scoped, trusted at the level of "the repo owner chose them"
(verification spec D3/D10.7). Output is captured and tail-truncated; the
combined result folds to one cell verdict for the (task_group, repo, inline)
slot.

Usage (CLI):
    python -m src.verification.inline_runner --cwd <repo> --commands-json '["ruff check .", "python -m pytest -q"]'

Exit code: 0 = pass, 1 = fail, 2 = config error.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

DEFAULT_TIMEOUT_S = 1800
LOG_TAIL_CHARS = 4000


def _split(command: str | list[str]) -> list[str]:
    """Split a command string Windows-safely.

    Neither shlex mode fits: posix=True mangles backslashed paths
    (C:\\x -> C:x), posix=False splits inside '--name="a b"'. Small state
    machine instead: whitespace-delimited tokens, quotes toggle a no-split
    span and are dropped from the value, backslashes are literal (C7).
    """
    if isinstance(command, list):
        return command
    tokens: list[str] = []
    cur: list[str] = []
    quote: str | None = None
    started = False
    for ch in command:
        if quote:
            if ch == quote:
                quote = None
            else:
                cur.append(ch)
        elif ch in "\"'":
            quote = ch
            started = True
        elif ch.isspace():
            if started or cur:
                tokens.append("".join(cur))
                cur, started = [], False
        else:
            cur.append(ch)
    if started or cur:
        tokens.append("".join(cur))
    return tokens


def _kill_tree(proc: subprocess.Popen) -> None:
    """Kill the child AND its descendants — test runners spawn workers that
    inherit the output pipes and would block communicate() past the timeout."""
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
            capture_output=True,
            timeout=30,
        )
    else:
        import signal

        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            proc.kill()


def run_command(command: str | list[str], cwd: str, timeout_s: int = DEFAULT_TIMEOUT_S) -> dict:
    """Run one verifier command. shell=False; strings are quote-aware split."""
    argv = _split(command)
    started = time.monotonic()
    timed_out = False
    try:
        proc = subprocess.Popen(
            argv,
            cwd=cwd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            shell=False,
            start_new_session=(os.name != "nt"),
        )
        try:
            output, _ = proc.communicate(timeout=timeout_s)
            exit_code: int | None = proc.returncode
        except subprocess.TimeoutExpired:
            timed_out = True
            exit_code = None
            _kill_tree(proc)
            try:
                output, _ = proc.communicate(timeout=30)
            except subprocess.TimeoutExpired:
                output = ""
        output = output or ""
    except FileNotFoundError as exc:
        exit_code = 127
        output = str(exc)
    duration_ms = int((time.monotonic() - started) * 1000)
    return {
        "command": command if isinstance(command, str) else " ".join(command),
        "exit_code": exit_code,
        "timed_out": timed_out,
        "duration_ms": duration_ms,
        "log_tail": output[-LOG_TAIL_CHARS:],
    }


def run_inline(commands: list[str], cwd: str, timeout_s: int = DEFAULT_TIMEOUT_S) -> dict:
    """Run all commands; verdict = pass iff every command exits 0.

    A timeout counts as fail (it is the inline analogue of the gateway's
    TTL sweeper verdict — D10.5: never a permanent hold).
    """
    if not commands:
        return {"verdict": "fail", "results": [], "reason": "no commands configured"}
    if not Path(cwd).is_dir():
        return {"verdict": "fail", "results": [], "reason": f"cwd does not exist: {cwd}"}
    results = [run_command(cmd, cwd, timeout_s) for cmd in commands]
    ok = all(r["exit_code"] == 0 and not r["timed_out"] for r in results)
    return {"verdict": "pass" if ok else "fail", "results": results}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run inline verifier commands")
    parser.add_argument("--cwd", required=True)
    parser.add_argument("--commands-json", required=True, help='JSON array, e.g. \'["ruff check ."]\'')
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT_S)
    args = parser.parse_args(argv)

    try:
        commands = json.loads(args.commands_json)
        assert isinstance(commands, list)
    except (json.JSONDecodeError, AssertionError):
        print(json.dumps({"error": "commands-json must be a JSON array of strings"}), file=sys.stderr)
        return 2

    result = run_inline(commands, args.cwd, args.timeout)
    json.dump(result, sys.stdout)
    return 0 if result["verdict"] == "pass" else 1


if __name__ == "__main__":
    sys.exit(main())
