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
               calls=None, home=None):
    """Substitute the locator's platform/shutil/subprocess module handles.

    run_results: list of stdout strings returned by successive
    subprocess.run calls; calls (if given) collects each argv; home (if
    given) pins Path.home() so a real native install can't short-circuit.
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
        if calls is not None:
            calls.append(cmd)
        stdout = run_results.pop(0) if run_results else ""
        return types.SimpleNamespace(stdout=stdout, returncode=0)

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


def test_kiro_cli_args_prefixes_wsl_with_posix_path():
    # Path("/x/y") on Windows str()s to backslashes — the builder must
    # emit the POSIX form when invoking through wsl.
    args = kiro_cli_args(Path("/home/u/.local/bin/kiro-cli"), True, "chat", "--resume")
    assert args == ["wsl", "/home/u/.local/bin/kiro-cli", "chat", "--resume"]


def test_kiro_cli_args_native_passthrough():
    args = kiro_cli_args("/usr/bin/kiro-cli", False, "chat")
    assert args == ["/usr/bin/kiro-cli", "chat"]
