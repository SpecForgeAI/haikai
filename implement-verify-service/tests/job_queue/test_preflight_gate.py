"""Execution-environment preflight (2026-09-09).

A repo is gated only on the runtimes it actually needs; a missing runtime is
a named ValueError from the request-context prologue (the same path as the
credential check, so the failure callback fires and nothing strands).
"""

from __future__ import annotations

import subprocess
import types
from pathlib import Path

import pytest

from src import preflight
from src.job_queue.tasks import _resolve_request_context


# --------------------------------------------------------------- requirement

def test_repo_requires_docker_from_build_file(tmp_path):
    (tmp_path / "pom.xml").write_text("<dependency><groupId>org.testcontainers</groupId></dependency>")
    assert preflight.repo_requires_docker(tmp_path) is True
    assert preflight.repo_requires_jdk(tmp_path) is True


def test_repo_requires_docker_from_test_sources(tmp_path):
    (tmp_path / "build.gradle").write_text("plugins { id 'java' }")
    src = tmp_path / "src" / "test" / "java" / "com" / "x"
    src.mkdir(parents=True)
    (src / "DbIT.java").write_text("@Testcontainers\nclass DbIT {}")
    assert preflight.repo_requires_docker(tmp_path) is True


def test_repo_without_testcontainers_is_not_gated_on_docker(tmp_path):
    (tmp_path / "pom.xml").write_text("<project><artifactId>plain</artifactId></project>")
    src = tmp_path / "src" / "test" / "java"
    src.mkdir(parents=True)
    (src / "PlainTest.java").write_text("class PlainTest {}")
    assert preflight.repo_requires_docker(tmp_path) is False
    assert preflight.repo_requires_jdk(tmp_path) is True


def test_non_jvm_repo_requires_neither(tmp_path):
    (tmp_path / "package.json").write_text("{}")
    assert preflight.repo_requires_jdk(tmp_path) is False
    assert preflight.repo_requires_docker(tmp_path) is False


# -------------------------------------------------------------------- probes

def test_docker_probe_uses_docker_info_not_socket_existence(monkeypatch):
    monkeypatch.setattr(preflight.shutil, "which", lambda name: "/usr/bin/docker")
    calls = []

    def runner(argv, **kw):
        calls.append(argv)
        return subprocess.CompletedProcess(argv, 1, stdout="", stderr="Cannot connect to the Docker daemon")

    ok, detail = preflight.docker_available(runner=runner)
    assert ok is False
    assert calls == [["docker", "info"]]
    assert "Cannot connect" in detail

    ok, detail = preflight.docker_available(
        runner=lambda argv, **kw: subprocess.CompletedProcess(argv, 0, stdout="Server: ok", stderr=""))
    assert ok is True


def test_docker_probe_without_binary(monkeypatch):
    monkeypatch.setattr(preflight.shutil, "which", lambda name: None)
    ok, detail = preflight.docker_available(runner=lambda *a, **k: pytest.fail("must not run"))
    assert ok is False and "no `docker` binary" in detail


def test_jdk_probe_native_paths(monkeypatch, tmp_path):
    monkeypatch.setattr(preflight.platform, "system", lambda: "Linux")
    monkeypatch.delenv("JAVA_HOME", raising=False)
    monkeypatch.setattr(preflight.shutil, "which", lambda name: None)
    assert preflight.jdk_available()[0] is False
    jdk = tmp_path / "jdk" / "bin"
    jdk.mkdir(parents=True)
    (jdk / "java").write_text("")
    monkeypatch.setenv("JAVA_HOME", str(tmp_path / "jdk"))
    ok, detail = preflight.jdk_available()
    assert ok is True and "JAVA_HOME=" in detail


def test_jdk_probe_under_wsl_kiro_runs_in_the_agents_shell_with_the_env_prefix(monkeypatch):
    monkeypatch.setattr(preflight.platform, "system", lambda: "Windows")
    monkeypatch.setenv("CHAT_EXECUTOR", "kiro")
    monkeypatch.setenv("KIRO_WSL_ENV", "JAVA_HOME=/home/u/jdks/jdk-21")
    seen = []

    def runner(argv, **kw):
        seen.append(argv)
        return subprocess.CompletedProcess(argv, 0, stdout="JAVA_HOME=/home/u/jdks/jdk-21\n", stderr="")

    ok, detail = preflight.jdk_available(runner=runner)
    assert ok is True
    assert seen[0][:3] == ["wsl", "env", "JAVA_HOME=/home/u/jdks/jdk-21"]
    assert seen[0][3:5] == ["sh", "-c"]

    ok, detail = preflight.jdk_available(
        runner=lambda argv, **kw: subprocess.CompletedProcess(argv, 3, stdout="NO_JDK\n", stderr=""))
    assert ok is False and "KIRO_WSL_ENV" in detail


# ---------------------------------------------------------------------- gate

def test_preflight_problems_name_repo_requirement_and_detail(tmp_path):
    (tmp_path / "pom.xml").write_text("org.testcontainers")
    problems = preflight.preflight_repo_targets(
        [("svc", tmp_path)],
        docker_probe=lambda: (False, "`docker info` exited 1: daemon down"),
        jdk_probe=lambda: (False, "no JAVA_HOME and no `java` on PATH"),
    )
    assert len(problems) == 2
    assert "repo 'svc' is a JVM build" in problems[0]
    assert "no JAVA_HOME" in problems[0]
    assert "repo 'svc' uses Testcontainers" in problems[1]
    assert "daemon down" in problems[1]


def test_preflight_probes_at_most_once_and_skips_unneeded_runtimes(tmp_path):
    a = tmp_path / "a"; a.mkdir(); (a / "pom.xml").write_text("org.testcontainers")
    b = tmp_path / "b"; b.mkdir(); (b / "pom.xml").write_text("org.testcontainers")
    c = tmp_path / "c"; c.mkdir(); (c / "package.json").write_text("{}")
    counts = {"docker": 0, "jdk": 0}

    def docker():
        counts["docker"] += 1
        return (True, "ok")

    def jdk():
        counts["jdk"] += 1
        return (True, "ok")

    problems = preflight.preflight_repo_targets([("a", a), ("b", b), ("c", c)], docker_probe=docker, jdk_probe=jdk)
    assert problems == []
    assert counts == {"docker": 1, "jdk": 1}


# ------------------------------------------------------- resolver integration

def _job(company="acme", project="proj"):
    return types.SimpleNamespace(
        request_payload={
            "company": company,
            "project": project,
            "spec_intents": [{"spec_name": "2026-09-09-first-spec", "session_id": "sess-1"}],
        }
    )


@pytest.fixture()
def base_env(monkeypatch, tmp_path):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("IVS_SKIP_ENV_PREFLIGHT", raising=False)
    monkeypatch.setenv("CHAT_EXECUTOR", "kiro")
    monkeypatch.setenv("API_WORKSPACE_DIR", str(tmp_path))
    monkeypatch.setattr("src.job_queue.tasks.get_active_session", lambda *a, **k: "sess-1")
    return monkeypatch


def _repo(tmp_path, *, testcontainers: bool):
    repo = tmp_path / "acme" / "proj"
    repo.mkdir(parents=True)
    (repo / ".git").mkdir()
    (repo / "pom.xml").write_text("org.testcontainers" if testcontainers else "<project/>")
    return repo


def test_resolver_fails_fast_with_named_reason_when_docker_is_required_but_absent(base_env, tmp_path):
    _repo(tmp_path, testcontainers=True)
    base_env.setattr(preflight, "docker_available", lambda: (False, "`docker info` exited 1: daemon down"))
    base_env.setattr(preflight, "jdk_available", lambda: (True, "ok"))
    with pytest.raises(ValueError, match="preflight failed") as e:
        _resolve_request_context(_job())
    assert "uses Testcontainers" in str(e.value)
    assert "daemon down" in str(e.value)


def test_resolver_passes_when_the_repo_does_not_need_docker(base_env, tmp_path):
    _repo(tmp_path, testcontainers=False)
    base_env.setattr(preflight, "docker_available", lambda: pytest.fail("docker must not be probed"))
    base_env.setattr(preflight, "jdk_available", lambda: (True, "ok"))
    request, key, workspace_dir, session_id = _resolve_request_context(_job())
    assert session_id == "sess-1"


def test_resolver_preflight_can_be_switched_off(base_env, tmp_path):
    _repo(tmp_path, testcontainers=True)
    base_env.setenv("IVS_SKIP_ENV_PREFLIGHT", "1")
    base_env.setattr(preflight, "docker_available", lambda: pytest.fail("skipped"))
    base_env.setattr(preflight, "jdk_available", lambda: pytest.fail("skipped"))
    assert _resolve_request_context(_job())[3] == "sess-1"


def test_resolver_no_repo_yet_is_not_gated(base_env):
    # A fresh workspace with no checkout resolves no targets -> nothing to check.
    assert _resolve_request_context(_job())[3] == "sess-1"
