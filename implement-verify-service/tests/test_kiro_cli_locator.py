"""Pins for the shared kiro-cli locator (src/kiro_cli_locator.py, 2026-07-27).

The live failure this module exists for: kiro-cli installed at
~/.local/bin inside WSL and logged in (interactive `wsl` = LOGIN shell,
~/.profile puts ~/.local/bin on PATH), but the executors probed with
`wsl which kiro-cli` — a NON-login shell without that PATH entry — got
empty output, and raised "kiro-cli not found" on the first shape-spec
dispatch. The load-bearing pin here is that the Windows probe runs
`bash -lc` (login shell).
"""
from __future__ import annotations

import types
from pathlib import Path

import pytest

import src.kiro_cli_locator as locator_mod
from src.kiro_cli_locator import kiro_cli_args, locate_kiro_cli


def _patch_env(monkeypatch, *, system="Windows", which=None, run_results=None,
               calls=None, home=None, warm_calls=None):
    """Substitute the locator's platform/shutil/subprocess module handles.

    run_results: list of stdout strings (or exceptions to RAISE) returned by
    successive PROBE subprocess.run calls; calls (if given) collects each
    probe argv; home (if given) pins Path.home() so a real native install
    can't short-circuit.

    The best-effort warm-up call (``wsl -- true``, 2026-08-04) is EXCLUDED
    from probe accounting — it lands in warm_calls (if given) and consumes
    no run_results entry — so the existing login-shell ordering pins stay
    meaningful rather than being weakened to index arithmetic.
    """
    which = which or {}
    run_results = list(run_results or [])

    monkeypatch.setattr(
        locator_mod, "platform", types.SimpleNamespace(system=lambda: system)
    )
    if home is not None:
        monkeypatch.setattr(Path, "home", staticmethod(lambda: home))
    monkeypatch.setattr(
        locator_mod, "shutil", types.SimpleNamespace(which=lambda name: which.get(name))
    )

    def fake_run(cmd, **kwargs):
        if list(cmd) == ["wsl", "--", "true"]:
            if warm_calls is not None:
                warm_calls.append(cmd)
            return types.SimpleNamespace(stdout="", returncode=0)
        if calls is not None:
            calls.append(cmd)
        item = run_results.pop(0) if run_results else ""
        if isinstance(item, BaseException):
            raise item
        return types.SimpleNamespace(stdout=item, returncode=0)

    monkeypatch.setattr(locator_mod, "subprocess", types.SimpleNamespace(run=fake_run))


def test_native_path_hit_wins(monkeypatch):
    _patch_env(monkeypatch, system="Linux", which={"kiro-cli": "/usr/bin/kiro-cli"})
    assert locate_kiro_cli() == ("/usr/bin/kiro-cli", False)


def test_native_home_candidate_hit(monkeypatch, tmp_path):
    _patch_env(monkeypatch, system="Linux", which={})
    fake_bin = tmp_path / ".local" / "bin"
    fake_bin.mkdir(parents=True)
    (fake_bin / "kiro-cli").write_text("#!/bin/sh\n")
    monkeypatch.setattr(Path, "home", staticmethod(lambda: tmp_path))

    cli_path, use_wsl = locate_kiro_cli()
    assert cli_path == str(fake_bin / "kiro-cli")
    assert use_wsl is False


def test_windows_probe_uses_login_shell(monkeypatch, tmp_path):
    # THE regression pin: the first WSL probe must be a LOGIN shell
    # (bash -lc) so ~/.profile's ~/.local/bin PATH entry is in effect.
    calls: list = []
    _patch_env(
        monkeypatch,
        which={"wsl": r"C:\Windows\System32\wsl.exe"},
        home=tmp_path,
        run_results=["/home/user/.local/bin/kiro-cli\n"],
        calls=calls,
    )
    assert locate_kiro_cli() == ("/home/user/.local/bin/kiro-cli", True)
    assert calls[0][:4] == ["wsl", "--", "bash", "-lc"]


def test_windows_falls_back_to_well_known_dirs(monkeypatch, tmp_path):
    calls: list = []
    _patch_env(
        monkeypatch,
        which={"wsl": r"C:\Windows\System32\wsl.exe"},
        home=tmp_path,
        run_results=["", "/root/.local/bin/kiro-cli"],
        calls=calls,
    )
    assert locate_kiro_cli() == ("/root/.local/bin/kiro-cli", True)
    assert len(calls) == 2
    # Second probe tests explicit locations, shell-PATH-independent.
    assert "$HOME/.local/bin/kiro-cli" in calls[1][-1]


def test_wsl_utf16_nul_noise_is_stripped(monkeypatch, tmp_path):
    # wsl.exe's own error text is UTF-16; NULs must not poison the path.
    _patch_env(
        monkeypatch,
        which={"wsl": r"C:\Windows\System32\wsl.exe"},
        home=tmp_path,
        run_results=["\x00/\x00h\x00o\x00m\x00e\x00/u/kiro-cli\x00\n"],
    )
    cli_path, use_wsl = locate_kiro_cli()
    assert cli_path == "/home/u/kiro-cli"
    assert use_wsl is True


def test_not_found_raises_with_probe_diagnostics(monkeypatch, tmp_path):
    _patch_env(
        monkeypatch,
        which={"wsl": r"C:\Windows\System32\wsl.exe"},
        home=tmp_path,
        run_results=["", ""],
    )
    with pytest.raises(ValueError) as ei:
        locate_kiro_cli()
    message = str(ei.value)
    assert "ENABLING_KIRO_CLI" in message
    assert "login shell" in message
    assert "wsl kiro-cli whoami" in message


def test_warm_up_runs_first_and_is_excluded_from_probe_accounting(monkeypatch, tmp_path):
    # 2026-08-04: `wsl -- true` warms the VM so a cold boot isn't charged to
    # a probe that must return a path. It must not consume a run_results
    # entry or shift the probe order the pins above assert on.
    calls: list = []
    warm_calls: list = []
    _patch_env(
        monkeypatch,
        which={"wsl": r"C:\Windows\System32\wsl.exe"},
        home=tmp_path,
        run_results=["/home/user/.local/bin/kiro-cli\n"],
        calls=calls,
        warm_calls=warm_calls,
    )
    assert locate_kiro_cli() == ("/home/user/.local/bin/kiro-cli", True)
    assert warm_calls == [["wsl", "--", "true"]]
    assert calls[0][:4] == ["wsl", "--", "bash", "-lc"]


def test_probe_timeout_is_reported_as_cold_distro_not_missing_install(monkeypatch, tmp_path):
    # THE 2026-08-04 regression pin: a cold-WSL timeout must NOT masquerade
    # as "not installed" — the old message pushed a reinstall of a binary
    # that was present and reachable the whole time.
    from subprocess import TimeoutExpired

    _patch_env(
        monkeypatch,
        which={"wsl": r"C:\Windows\System32\wsl.exe"},
        home=tmp_path,
        run_results=[
            TimeoutExpired(cmd=["wsl"], timeout=45.0),
            TimeoutExpired(cmd=["wsl"], timeout=45.0),
        ],
    )
    with pytest.raises(ValueError) as ei:
        locate_kiro_cli()
    message = str(ei.value)
    assert "TIMED OUT" in message
    assert "cold/stopped" in message
    assert "wsl -- true" in message
    # And it does NOT push a reinstall.
    assert "Install it via" not in message


def test_kiro_cli_args_prefixes_wsl_with_posix_path():
    # Path("/x/y") on Windows str()s to backslashes — the builder must
    # emit the POSIX form when invoking through wsl.
    args = kiro_cli_args(Path("/home/u/.local/bin/kiro-cli"), True, "chat", "--resume")
    assert args == ["wsl", "/home/u/.local/bin/kiro-cli", "chat", "--resume"]


def test_kiro_cli_args_native_passthrough():
    args = kiro_cli_args("/usr/bin/kiro-cli", False, "chat")
    assert args == ["/usr/bin/kiro-cli", "chat"]


# ---------------------------------------------------------------------------
# WSL env prefix (2026-09-08): kiro-cli is exec'd through `wsl` directly, not a
# shell, so ~/.profile never runs and JAVA_HOME is absent -> Maven refuses to
# start and no test can run. KIRO_WSL_ENV injects `env KEY=VAL` ahead of the
# binary; malformed pairs are skipped, never re-parsed by a shell.
# ---------------------------------------------------------------------------

def test_wsl_env_prefix_empty_when_unset(monkeypatch):
    monkeypatch.delenv(locator_mod.WSL_ENV_VAR, raising=False)
    assert locator_mod.wsl_env_prefix() == []
    assert kiro_cli_args("/home/u/.local/bin/kiro-cli", True, "chat") == [
        "wsl", "/home/u/.local/bin/kiro-cli", "chat",
    ]


def test_wsl_env_prefix_injects_env_assignments_ahead_of_the_binary(monkeypatch):
    monkeypatch.setenv(locator_mod.WSL_ENV_VAR,
                       "JAVA_HOME=/home/u/jdks/jdk-21.0.12+8; MAVEN_OPTS=-Xmx1g ;")
    assert locator_mod.wsl_env_prefix() == [
        "env", "JAVA_HOME=/home/u/jdks/jdk-21.0.12+8", "MAVEN_OPTS=-Xmx1g",
    ]
    argv = kiro_cli_args("/home/u/.local/bin/kiro-cli", True, "chat", "--no-interactive")
    assert argv == [
        "wsl", "env", "JAVA_HOME=/home/u/jdks/jdk-21.0.12+8", "MAVEN_OPTS=-Xmx1g",
        "/home/u/.local/bin/kiro-cli", "chat", "--no-interactive",
    ]
    # Native (non-WSL) invocations are untouched.
    assert kiro_cli_args(r"C:\\tools\\kiro-cli.exe", False, "chat")[0].endswith("kiro-cli.exe")


def test_wsl_env_prefix_skips_malformed_pairs(monkeypatch):
    monkeypatch.setenv(locator_mod.WSL_ENV_VAR,
                       "not-a-pair;1BAD=x;bad key=y;GOOD=1;NL=a\nb;OK2=two=parts")
    # Only POSIX-named KEY=VALUE pairs survive; a value may itself contain '='.
    assert locator_mod.wsl_env_prefix() == ["env", "GOOD=1", "OK2=two=parts"]
    monkeypatch.setenv(locator_mod.WSL_ENV_VAR, "  ;  ;nope")
    assert locator_mod.wsl_env_prefix() == []
