"""Anti-pattern guard tests — process protection against the recurring
"helper exists, sibling sites missed" failure mode.

The last 5 autoresearch:debug passes have each surfaced an instance of:
**a hardening helper lands in module A, sibling sites in module B/C/D
are not patched.** This file enforces the discipline by source-grepping
for the anti-patterns and asserting zero matches.

When you add a new anti-pattern guard here, also document it in
CLAUDE.md (`Process: helper-exists-sibling-missed`).
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).parent.parent
SRC = REPO_ROOT / "src"
API_INIT = SRC / "api" / "__init__.py"


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


# ─── Guard 1: API_WORKSPACE_DIR / company / project ──────────────────────────


class TestApiWorkspaceDirRawConcat:
    """`_safe_project_dir(company, project)` is the only allowed primitive
    for building workspace-relative paths from API request fields. The
    raw `API_WORKSPACE_DIR / company / project` pattern was the
    260504-1229 finding that affected 17 sites.
    """

    def test_no_raw_workspace_concat_in_api(self):
        text = _read_text(API_INIT)
        # Drop the docstring example line which intentionally contains the pattern
        # (that line teaches readers what NOT to do).
        lines = [
            l for l in text.split("\n")
            if "API_WORKSPACE_DIR / company / project" in l
            and "Use this everywhere" not in l
        ]
        assert lines == [], (
            "Found raw `API_WORKSPACE_DIR / company / project`. Use "
            "`_safe_project_dir(company, project)` instead. Sites:\n"
            + "\n".join(f"  {l.strip()}" for l in lines)
        )


# ─── Guard 2: chat-executor project_dir construction ─────────────────────────


class TestChatExecutorProjectDir:
    """Each chat executor's `__init__` builds `workspace_dir / company /
    project`. The 260504-0934 fix added `safe_segment(company)` /
    `safe_segment(project)` ABOVE that join in all three executors.
    Guard: each file with that pattern must also contain the validation
    in the same module.
    """

    EXECUTORS = [
        SRC / "chat" / "claude_chat_executor.py",
        SRC / "chat" / "oauth_chat_executor.py",
        SRC / "chat" / "openai_chat_executor.py",
    ]

    def test_each_executor_validates_company_project(self):
        bad = []
        for path in self.EXECUTORS:
            text = _read_text(path)
            if "workspace_dir / company / project" not in text:
                continue  # not the pattern; nothing to guard
            # Validation must appear before the join (use line numbers)
            lines = text.split("\n")
            join_line = next(
                i for i, l in enumerate(lines)
                if "workspace_dir / company / project" in l
            )
            preamble = "\n".join(lines[:join_line])
            if 'safe_segment(company, "company")' not in preamble:
                bad.append(f"{path.name}: missing safe_segment(company) before join at line {join_line+1}")
            if 'safe_segment(project, "project")' not in preamble:
                bad.append(f"{path.name}: missing safe_segment(project) before join at line {join_line+1}")
        assert bad == [], "Chat executors with unguarded project_dir join:\n" + "\n".join(bad)


# ─── Guard 3: SSE handler stop_flag (the 260504-1301 finding #1) ─────────────


class TestSseHandlerStopFlag:
    """Every `loop.run_in_executor(None, _run_sync*)` site MUST be
    paired with a `stop_flag.is_set()` check inside the inner
    function and a `stop_flag.set()` in the outer `finally`. The
    previous test asserted `>=4` instead of equality, letting two v2
    handlers slip through (260504-1301 #1).
    """

    def test_run_in_executor_count_matches_stop_flag_count(self):
        # SSE handlers were moved from api/__init__.py to
        # src/api/routes/chat.py in Phase A.6d. Scan that file.
        chat_path = REPO_ROOT / "src" / "api" / "routes" / "chat.py"
        text = _read_text(chat_path)
        run_in_exec_count = len(
            re.findall(r"loop\.run_in_executor\(None,\s*_run_sync", text)
        )
        is_set_count = text.count("stop_flag.is_set()")
        set_count = text.count("stop_flag.set()")

        assert run_in_exec_count > 0, (
            "Sanity: expected at least one SSE handler in routes/chat.py"
        )
        assert is_set_count == run_in_exec_count, (
            f"Mismatch: {run_in_exec_count} `loop.run_in_executor(None, _run_sync*)` "
            f"sites but only {is_set_count} `stop_flag.is_set()` checks. "
            "Every SSE handler must check the flag in its inner loop."
        )
        assert set_count == run_in_exec_count, (
            f"Mismatch: {run_in_exec_count} SSE sites but only "
            f"{set_count} `stop_flag.set()` calls. Every SSE handler "
            "must set the flag in its outer `finally`."
        )


# ─── Guard 4: orchestration_id validator usage ───────────────────────────────


class TestOrchestrationIdValidator:
    """`_safe_orchestration_id` was added so URL-supplied
    orchestration_id values can't traverse `..`. Both the `/status`
    and `/logs` handlers should call it.
    """

    def test_safe_orchestration_id_called_in_both_handlers(self):
        # /status and /logs handlers moved to src/api/routes/orchestration.py
        # per spec Phase A.5. Scan the right file.
        path = REPO_ROOT / "src" / "api" / "routes" / "orchestration.py"
        text = _read_text(path)
        count = text.count("_safe_orchestration_id(orchestration_id)")
        assert count >= 2, (
            f"Expected `_safe_orchestration_id(orchestration_id)` in "
            f"both /status and /logs handlers (src/api/routes/orchestration.py), "
            f"found {count}"
        )


# ─── Guard 5b: no datetime.utcnow() (deprecated in Python 3.12+) ─────────────


class TestNoDatetimeUtcnow:
    """`datetime.utcnow()` is deprecated since 3.12 and scheduled for
    removal. Use `datetime.now(timezone.utc)` instead. Repo-wide
    grep guard so a future regression can't reintroduce it."""

    def test_no_utcnow_in_src_or_tests(self):
        # Skip THIS file (it mentions the pattern in error messages /
        # docstrings — the grep would otherwise self-match).
        self_file = Path(__file__).resolve()
        offenders = []
        for root in (REPO_ROOT / "src", REPO_ROOT / "tests"):
            for p in root.rglob("*.py"):
                if "__pycache__" in p.parts:
                    continue
                if p.resolve() == self_file:
                    continue
                text = p.read_text(encoding="utf-8", errors="replace")
                lines = [
                    f"{p.relative_to(REPO_ROOT)}:{i+1}"
                    for i, l in enumerate(text.split("\n"))
                    if "datetime.utcnow(" in l
                ]
                offenders.extend(lines)
        assert offenders == [], (
            "Found datetime utcnow call sites — use datetime.now(timezone.utc):\n"
            + "\n".join(f"  {o}" for o in offenders)
        )

    def test_no_naive_datetime_now_in_api_init(self):
        """`datetime.now()` (no args) returns server-local time. In
        api/__init__.py specifically, that value flows into git branch
        names and stream-log filenames that must be consistent across
        servers. autoresearch:debug 260504-1635 (B5) found 5 sibling
        sites leaking local time into branch names.

        Scoped to api/__init__.py for now — broader rollout across src/
        is a separate task (~45 other sites, most of which are local
        start/end-time deltas that are correctly naive).

        Allowlist: lines with a `# naive-on-purpose` comment on the
        same line OR within the 5 lines above (multi-line block
        comments explaining the exception)."""
        text = _read_text(API_INIT)
        lines = text.split("\n")
        offenders = []
        for i, l in enumerate(lines):
            if "datetime.now()" not in l:
                continue
            if "naive-on-purpose" in l:
                continue
            preamble = "\n".join(lines[max(0, i - 5):i])
            if "naive-on-purpose" in preamble:
                continue
            offenders.append(f"line {i + 1}: {l.strip()}")
        assert offenders == [], (
            "Found bare `datetime.now()` (no tz) in api/__init__.py — "
            "use `datetime.now(timezone.utc)` or annotate with "
            "`# naive-on-purpose: <reason>` if local time is required:\n"
            + "\n".join(f"  {o}" for o in offenders)
        )


# ─── Guard 6: no Pydantic V1 patterns ────────────────────────────────────────


class TestNoPydanticV1Patterns:
    """Pydantic V2 migration: `class Config:` → `model_config = ConfigDict(...)`,
    `@validator` → `@field_validator`. Will hard-break on Pydantic V3.
    """

    def test_no_class_config_in_src(self):
        offenders = []
        for p in (REPO_ROOT / "src").rglob("*.py"):
            if "__pycache__" in p.parts:
                continue
            text = p.read_text(encoding="utf-8", errors="replace")
            for i, l in enumerate(text.split("\n")):
                # Match `class Config:` (V1 form) — be precise to avoid
                # false-positive matches in unrelated nested classes
                if re.match(r"^\s+class Config:\s*$", l):
                    offenders.append(f"{p.relative_to(REPO_ROOT)}:{i+1}")
        assert offenders == [], (
            "Found Pydantic V1 `class Config:` — use "
            "`model_config = ConfigDict(...)` instead:\n"
            + "\n".join(f"  {o}" for o in offenders)
        )

    def test_no_pydantic_v1_validator(self):
        offenders = []
        for p in (REPO_ROOT / "src").rglob("*.py"):
            if "__pycache__" in p.parts:
                continue
            text = p.read_text(encoding="utf-8", errors="replace")
            for i, l in enumerate(text.split("\n")):
                # Match `@validator(` exactly — not `@field_validator(`
                # nor `@model_validator(`
                if re.match(r"^\s*@validator\(", l):
                    offenders.append(f"{p.relative_to(REPO_ROOT)}:{i+1}")
        assert offenders == [], (
            "Found Pydantic V1 `@validator` — use `@field_validator` "
            "instead:\n" + "\n".join(f"  {o}" for o in offenders)
        )


# ─── Guard 7: no print() in production modules ───────────────────────────────


class TestNoPrintInProductionModules:
    """`print()` skips structured logging — bypass log levels, no
    correlation, no exc_info. Use `logger.error(..., exc_info=True)`
    instead. Limited to certain known-clean modules; expand the
    allowlist as more files are cleaned up."""

    PRODUCTION_FILES = [
        REPO_ROOT / "src" / "repo_fetcher.py",
        # Add more files here as their print() calls get cleaned up.
    ]

    def test_no_print_in_repo_fetcher(self):
        for path in self.PRODUCTION_FILES:
            text = path.read_text(encoding="utf-8")
            offenders = [
                f"{path.relative_to(REPO_ROOT)}:{i+1}"
                for i, l in enumerate(text.split("\n"))
                if re.search(r"\bprint\(", l) and not l.lstrip().startswith("#")
            ]
            assert offenders == [], (
                f"Found print() in {path.name} — use logger.error/info "
                f"instead:\n" + "\n".join(f"  {o}" for o in offenders)
            )


# ─── Guard 8: no clone_url / auth_url in raise statements ────────────────────


class TestNoCloneUrlInRaises:
    """`clone_url` (and `auth_url`) embed the GITHUB_TOKEN. Putting
    them in error messages leaks the token to API clients (the 6th
    instance of the helper-exists-sibling-missed pattern, surfaced
    in autoresearch:debug 260504-1448 finding M1).
    """

    def test_no_clone_url_in_raise_strings(self):
        offenders = []
        for p in (REPO_ROOT / "src").rglob("*.py"):
            if "__pycache__" in p.parts:
                continue
            text = p.read_text(encoding="utf-8", errors="replace")
            for i, l in enumerate(text.split("\n")):
                # Look for an f-string in a raise that interpolates {clone_url}
                # or {auth_url}. Keep the matching narrow — full f-string
                # parser is overkill.
                if (
                    "raise" in l
                    and ("{clone_url}" in l or "{auth_url}" in l)
                ):
                    offenders.append(
                        f"{p.relative_to(REPO_ROOT)}:{i+1}: {l.strip()}"
                    )
        assert offenders == [], (
            "Found `raise ... {clone_url|auth_url} ...` — these embed "
            "GITHUB_TOKEN and leak it to API clients. Use the bare "
            "public URL (https://github.com/{owner}/{repo}.git) in error "
            "messages instead.\n" + "\n".join(f"  {o}" for o in offenders)
        )


# ─── Guard 5: spec_name validation in package endpoints ──────────────────────


class TestSpecNameValidation:
    """`safe_segment(spec_name, "spec_name")` should be applied in both
    package endpoints (zip + json). Mirrors finding 260504-1229 #2.
    """

    def test_safe_segment_spec_name_in_package_handlers(self):
        # Package handlers moved to src/api/packages.py per spec
        # Phase A.4. Scan the right file.
        packages_path = REPO_ROOT / "src" / "api" / "packages.py"
        text = _read_text(packages_path)
        count = text.count('safe_segment(spec_name, "spec_name")')
        assert count >= 2, (
            f"Expected `safe_segment(spec_name, ...)` in both package "
            f"zip + json handlers (src/api/packages.py), found {count}"
        )


# ─── Guard 9: missing-API-key uses 503 (operator action), not 500 ────────────


class TestCommitAllPrecededByBranchCreation:
    """Per spec 2026-03-15-deferred-branch-creation, every V2 git
    handler that calls `gm.commit_all` MUST first call
    `gm.create_feature_branch(...)` so the commit lands on the spec's
    feature branch (not whatever the working tree happens to be on).

    Five sibling sites missed this when the spec landed — only
    `job_queue/tasks.py:151` got the call. autoresearch:debug 260504-1620
    finding B1 surfaced the gap; this guard prevents regression.

    Allowlist: a `gm.commit_all` site can be exempted with a
    `# branch-checkout-elsewhere` comment within the 3 lines above
    (e.g. when a sibling helper has already done the checkout)."""

    def test_every_commit_all_preceded_by_branch_creation(self):
        text = _read_text(API_INIT)
        lines = text.split("\n")
        offenders = []
        for i, l in enumerate(lines):
            if "gm.commit_all" not in l:
                continue
            # Look 5 lines above for create_feature_branch OR the
            # explicit opt-out marker.
            preamble = "\n".join(lines[max(0, i - 5):i])
            if "gm.create_feature_branch" in preamble:
                continue
            if "branch-checkout-elsewhere" in preamble:
                continue
            offenders.append(f"line {i + 1}: {l.strip()}")
        assert offenders == [], (
            "Found `gm.commit_all` without a preceding "
            "`gm.create_feature_branch` (5-line lookback). Per spec "
            "2026-03-15-deferred-branch-creation, the branch must be "
            "created at commit time so the commit lands on the spec's "
            "feature branch. Sites:\n"
            + "\n".join(f"  {o}" for o in offenders)
        )


class TestPushPrGoThroughHelper:
    """The git push + PR sequence has ONE home: `apply_git_workflow`
    (`src/api/git_workflow.py`), with a single documented auto_push/auto_pr
    gating + error-handling policy. A sibling that calls `gm.push_branch` /
    `gm.create_pull_request` directly re-implements that policy and drifts
    (the helper-exists-sibling-missed pattern). `_finalize_batch_git` was such
    a sibling until it was folded into the helper via `push_pr_only=True`.

    Only the helper itself and the `GitManager` definition may name these.
    """

    ALLOWED = {Path("src/api/git_workflow.py"), Path("src/git/git_manager.py")}

    def test_push_and_pr_only_in_git_workflow_helper(self):
        offenders = []
        for p in (REPO_ROOT / "src").rglob("*.py"):
            if "__pycache__" in p.parts:
                continue
            rel = p.relative_to(REPO_ROOT)
            if rel in self.ALLOWED:
                continue
            text = p.read_text(encoding="utf-8", errors="replace")
            for i, l in enumerate(text.split("\n")):
                if re.search(r"\.push_branch\(|\.create_pull_request\(", l):
                    offenders.append(f"{rel}:{i + 1}: {l.strip()}")
        assert offenders == [], (
            "Found a direct `.push_branch(` / `.create_pull_request(` outside "
            "apply_git_workflow. Route push+PR through "
            "`apply_git_workflow(..., push_pr_only=True)` so the auto_push/"
            "auto_pr gating + error policy stays in one home:\n"
            + "\n".join(f"  {o}" for o in offenders)
        )


class TestMissingApiKeyUses503:
    """`structural_endpoints.py:372` set the precedent: missing-dependency
    errors return 503 ("operator action needed") not 500 ("server crash").
    The autoresearch:debug 260504-1635 prose pass found 4 sibling sites
    in api/__init__.py still using 500 for ANTHROPIC_API_KEY-missing —
    same helper-exists-sibling-missed pattern.

    The original guard checked only the same line, but the actual
    HTTPException is multi-line:

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="ANTHROPIC_API_KEY not configured on server"
        )

    debug 260517-2335 found two sites (1259, 2513) still using the
    constant form — both slipped past the old guard. This version
    catches both the literal (`status_code=500`) and the constant
    (`HTTP_500_INTERNAL_SERVER_ERROR`) in a small line window around
    any `API_KEY` mention.
    """

    def test_no_500_for_missing_api_key_in_api(self):
        text = _read_text(API_INIT)
        lines = text.split("\n")
        offenders = []
        for i, line in enumerate(lines, 1):
            has_500 = (
                "status_code=500" in line
                or "HTTP_500_INTERNAL_SERVER_ERROR" in line
            )
            if not has_500:
                continue
            # Window of ±4 lines around the 500 marker — the API_KEY
            # detail string sits either above (rare) or below (common,
            # because `detail=` follows `status_code=` in HTTPException).
            window = "\n".join(lines[max(0, i - 5): i + 4])
            if "API_KEY" in window.upper():
                offenders.append(f"line {i}: {line.strip()}")
        assert offenders == [], (
            "Found a 500 status code (literal or HTTP_500_INTERNAL_SERVER_ERROR) "
            "near a missing-API-key detail message in api/__init__.py — use 503 "
            "instead (per `structural_endpoints.py:372` precedent: 503 means "
            "'operator action needed', 500 means 'server crash'):\n"
            + "\n".join(f"  {o}" for o in offenders)
        )


class TestChatExecutorRequiresExplicitConfig:
    """`CHAT_EXECUTOR` is a required env var with no auto-detection.

    The kiro-cli integration briefly added PATH-probing for `kiro-cli`
    and `claude` so the factory could auto-fallback to Kiro when Claude
    was unavailable. That was reverted on user demand: the choice must
    be explicit (`claude` or `kiro`) or the request fails.

    Guard against the auto-fallback creeping back in:
    - No `shutil.which("kiro-cli")` or `shutil.which("claude")` inside
      `src/api/`.
    - Only `_executor_backend()` itself reads `CHAT_EXECUTOR`.
    """

    def test_no_path_probe_for_kiro_cli_in_api(self):
        text = _read_text(API_INIT)
        offenders = []
        for i, line in enumerate(text.split("\n"), 1):
            stripped = line.strip()
            if stripped.startswith("#"):
                continue
            if 'shutil.which("kiro-cli")' in line or "shutil.which('kiro-cli')" in line:
                offenders.append(f"line {i}: {stripped}")
        assert offenders == [], (
            "Found PATH probe for kiro-cli in src/api/__init__.py. "
            "CHAT_EXECUTOR=kiro must be explicit — no auto-detection or "
            "fallback. See docs/ENABLING_KIRO_CLI.md.\n"
            + "\n".join(f"  {o}" for o in offenders)
        )

    def test_chat_executor_env_read_only_in_helper(self):
        # After CO1 (debug 260518-0633) the helper moved to
        # `src/backend_registry.py`. The env read must be the sole
        # one across both `api/__init__.py` AND `backend_registry.py`.
        files_to_scan = [
            API_INIT,
            REPO_ROOT / "src" / "backend_registry.py",
        ]
        offenders: list[str] = []  # "file:line"
        for path in files_to_scan:
            text = _read_text(path)
            for i, line in enumerate(text.split("\n"), 1):
                stripped = line.strip()
                if stripped.startswith("#"):
                    continue
                if 'os.getenv("CHAT_EXECUTOR"' in line or "os.getenv('CHAT_EXECUTOR'" in line:
                    offenders.append(f"{path.name}:{i}")
                elif 'os.environ.get("CHAT_EXECUTOR"' in line or "os.environ.get('CHAT_EXECUTOR'" in line:
                    offenders.append(f"{path.name}:{i}")
                elif 'os.environ["CHAT_EXECUTOR"]' in line or "os.environ['CHAT_EXECUTOR']" in line:
                    offenders.append(f"{path.name}:{i}")
        # Exactly one read is expected: the one inside _executor_backend
        # in backend_registry.py. Locate it by finding the function body.
        registry_path = REPO_ROOT / "src" / "backend_registry.py"
        registry_text = _read_text(registry_path)
        m = re.search(
            r"^def _executor_backend\b.*?(?=^def |\Z)",
            registry_text,
            re.MULTILINE | re.DOTALL,
        )
        assert m, "could not locate _executor_backend in backend_registry.py"
        helper_start = registry_text[: m.start()].count("\n") + 1
        helper_end = helper_start + m.group(0).count("\n")
        bad = [
            o for o in offenders
            if not (
                o.startswith("backend_registry.py:")
                and helper_start <= int(o.split(":")[1]) <= helper_end
            )
        ]
        assert bad == [], (
            "Found `os.getenv('CHAT_EXECUTOR')` (or equivalent) outside "
            "`_executor_backend()`. All reads must route through the "
            "helper so validation stays single-sourced.\n"
            f"  offending sites: {bad}\n"
            f"  helper body lines {helper_start}-{helper_end} "
            "in backend_registry.py"
        )


class TestResolveTemplateSingleSource:
    """`resolve_template` (the `{{...}}` placeholder expander) was
    copy-pasted into 5 files before debug 260517-2335 surfaced it. The
    canonical impl now lives at `src/chat/template_resolver.py` and the
    5 sites delegate to it. Guard: only ONE substantive implementation
    of the resolver is allowed under `src/`.

    A substantive impl = a function body that itself does the regex
    substitution (`re.sub(r'\\{\\{...\\}\\}', ...)`). Delegate methods
    (one-line `return resolve_template(...)`) don't count.
    """

    def test_only_one_canonical_resolve_template(self):
        # A substantive impl contains the UNLESS-block regex literal.
        # Delegates that just call resolve_template() don't.
        UNLESS_LITERAL = r"\{\{UNLESS"
        substantive = []
        for p in (REPO_ROOT / "src").rglob("*.py"):
            if "__pycache__" in p.parts:
                continue
            text = p.read_text(encoding="utf-8", errors="replace")
            if UNLESS_LITERAL in text:
                substantive.append(p.relative_to(REPO_ROOT).as_posix())
        assert substantive == ["src/chat/template_resolver.py"], (
            "Found more than one substantive implementation of the "
            "`{{...}}` template resolver. The canonical impl is "
            "`src/chat/template_resolver.py` — other call sites must "
            "delegate to it with `from .chat.template_resolver import "
            "resolve_template`.\n"
            f"  files with substantive impl: {substantive}"
        )


# ─── Guard 7: credential-gate inline pattern (post-pass2 C3') ───────────────


class TestCredentialGateAdoption:
    """Every endpoint that needs an Anthropic API key MUST call
    `require_credentials()` rather than inline the
    `load_env_config()` → `config.get('anthropic_api_key')` → 503-raise
    dance. The helper is the only path that consults
    `_credentials_satisfied`, so backends that bring their own auth
    (Kiro SSO) get a correct gate result. Inline gates wrongly require
    `ANTHROPIC_API_KEY` even for Kiro.

    See `debug/260520-1700-executor-smell-taxonomy-pass2/findings.md` C3'.
    """

    def test_no_inline_credential_gate_in_routes(self):
        # Scan every file under src/api/routes/ for the inline gate
        # fingerprint: a `config.get('anthropic_api_key')` followed (in
        # the same function) by a `503` raise. The single legitimate
        # caller is `gates.require_credentials` itself, which is
        # in src/api/gates.py — NOT in routes/.
        routes_dir = REPO_ROOT / "src" / "api" / "routes"
        offenders = []
        for p in routes_dir.rglob("*.py"):
            text = _read_text(p)
            # Tight fingerprint: the exact line shape that all 9 pre-fix
            # sites used. Catches both single-line v2 form
            # ("config = load_env_config()" then "anthropic_api_key = config.get(...)")
            # and multi-line v1 form.
            if "config.get('anthropic_api_key')" in text or 'config.get("anthropic_api_key")' in text:
                offenders.append(str(p.relative_to(REPO_ROOT)))
        assert offenders == [], (
            "Inline credential-gate pattern detected in routes/. Each "
            "endpoint must call `require_credentials()` "
            "(imported `from ..gates`). The inline pattern bypasses "
            "`_credentials_satisfied` and breaks for `CHAT_EXECUTOR=kiro`.\n"
            f"  offenders: {offenders}"
        )

    def test_no_post_construction_session_uuid_mutation(self):
        # O4' regression guard: `chat_executor.session_uuid = ...` is a
        # Temporary Field smell — the executor accepts `session_uuid` as
        # a ctor kwarg and callers must use that path. The orchestrator
        # had 2 sites where it built the executor without the kwarg and
        # then mutated the field; fixed by routing through
        # `_build_chat_executor(..., session_uuid=...)`.
        offenders = []
        for p in (REPO_ROOT / "src").rglob("*.py"):
            for ln, line in enumerate(_read_text(p).splitlines(), 1):
                # Match assignment-to-attribute, not comparison or kwarg use.
                if re.search(r"\bchat_executor\.session_uuid\s*=\s*", line):
                    offenders.append(f"{p.relative_to(REPO_ROOT)}:{ln}: {line.strip()}")
        assert offenders == [], (
            "Post-construction `chat_executor.session_uuid = ...` "
            "mutation detected (Temporary Field smell). Pass `session_uuid` "
            "as a ctor kwarg via `_build_chat_executor(..., session_uuid=X)` "
            "or `create_chat_executor(..., session_uuid=X)` instead.\n"
            "  offenders:\n    " + "\n    ".join(offenders)
        )


# ─── Guard: no inline git workflow outside api/git_workflow.py ───────────────


class TestNoInlineGitWorkflowInRoutes:
    """`apply_git_workflow(...)` (src/api/git_workflow.py) is the single
    source of truth for the create-branch → commit → push → PR sequence.
    Pre-extraction (learn/260520-1850-deep-src-smells, D-C1/D-D2), 4 sites
    in src/api/routes/ + src/job_queue/ carried near-identical bodies
    with subtly divergent error handling — every git-policy change had
    to be replicated 4 ways and risked leaving one out (Shotgun Surgery).

    Guard: in src/ (excluding the helper itself + git_manager internals),
    no file may contain BOTH `gm.create_feature_branch(` AND
    `gm.commit_all(` — that's the shape of an inline duplication.
    """

    ALLOWED = {
        # The helper itself contains the only legitimate co-occurrence.
        Path("src/api/git_workflow.py"),
    }

    def test_no_inline_create_feature_branch_plus_commit_all(self):
        offenders = []
        for p in (REPO_ROOT / "src").rglob("*.py"):
            if "__pycache__" in p.parts:
                continue
            rel = p.relative_to(REPO_ROOT)
            if rel in self.ALLOWED:
                continue
            text = _read_text(p)
            if "gm.create_feature_branch(" in text and "gm.commit_all(" in text:
                offenders.append(str(rel))
        assert offenders == [], (
            "Inline create_feature_branch + commit_all detected — use "
            "`apply_git_workflow(...)` from src/api/git_workflow.py "
            "instead (deep-src-smells finding D-C1/D-D2).\n"
            f"  offenders: {offenders}"
        )

    def test_no_private_run_git_outside_git_manager(self):
        """D-D3: `gm._run_git(...)` is private; callers in routes/jobs
        previously reached in to run `git checkout default_branch`.
        Use `gm.checkout_default_branch()` (public API) instead.
        """
        offenders = []
        for p in (REPO_ROOT / "src").rglob("*.py"):
            if "__pycache__" in p.parts:
                continue
            rel = p.relative_to(REPO_ROOT)
            # Only git_manager.py is allowed to call its own private method.
            if rel == Path("src/git/git_manager.py"):
                continue
            for ln, line in enumerate(_read_text(p).splitlines(), 1):
                if re.search(r"\bgm\._run_git\b", line):
                    offenders.append(f"{rel}:{ln}: {line.strip()}")
        assert offenders == [], (
            "External callers reaching into `gm._run_git(...)` (private). "
            "Add a public method to GitManager (e.g. "
            "`checkout_default_branch()`) instead.\n"
            "  offenders:\n    " + "\n    ".join(offenders)
        )


# ─── Guard 9: safe_segment(company,...) + safe_segment(project,...) clump ─


class TestSafeSegmentCompanyProjectPairUsesProjectRef:
    """C-B3 / D-B2: the recurring pair

        safe_segment(company, "company") / safe_segment(project, "project")

    is the WORST manifestation of the (company, project) data clump.
    Sites doing the pair as a path-join MUST use
    `ProjectRef.from_strings(...)` so the validation lives in one
    place.

    The chat executors (`{claude,kiro,oauth,openai}_chat_executor.py`)
    are intentionally allowed to call the bare `safe_segment` twice —
    they normalize the inputs ABOVE the join in order to set
    `self.company` and `self.project` to the validated values. Their
    pattern is "validate then store on self," not "validate then join,"
    so ProjectRef.from_strings would force a refactor of every test
    that constructs an executor.
    """

    PATTERN_COMPANY = re.compile(
        r'safe_segment\([^)]*\bcompany\b[^)]*,\s*[\'"]company[\'"]'
    )
    PATTERN_PROJECT = re.compile(
        r'safe_segment\([^)]*\bproject\b[^)]*,\s*[\'"]project[\'"]'
    )
    ALLOWED = {
        # The single dispatch site — required by design.
        Path("src/project_ref.py"),
        # The chat-executor cluster (normalize-then-store, not
        # normalize-then-join — see class docstring).
        Path("src/chat/claude_chat_executor.py"),
        Path("src/chat/kiro_chat_executor.py"),
        Path("src/chat/oauth_chat_executor.py"),
        Path("src/chat/openai_chat_executor.py"),
        # HaikaiOrchestrator also normalizes-then-stores into
        # request fields before passing to other layers.
        Path("src/haikai_orchestrator.py"),
    }

    def test_no_inline_safe_segment_company_pair_outside_project_ref(self):
        """Catch only the company+project PAIR (the data clump). A site
        that uses bare `safe_segment(company, "company")` without a
        matching `safe_segment(project, "project")` is doing a
        company-only path — not the clump this guard exists to catch.
        """
        offenders = []
        for p in (REPO_ROOT / "src").rglob("*.py"):
            if "__pycache__" in p.parts:
                continue
            rel = p.relative_to(REPO_ROOT)
            if rel in self.ALLOWED:
                continue
            text = _read_text(p)
            # Only flag files that have BOTH halves of the pair —
            # company-only paths (e.g. `_safe_company_dir`) are not the
            # data clump and have their own raison d'être.
            if not (self.PATTERN_COMPANY.search(text)
                    and self.PATTERN_PROJECT.search(text)):
                continue
            for ln, line in enumerate(text.splitlines(), 1):
                if self.PATTERN_COMPANY.search(line) or self.PATTERN_PROJECT.search(line):
                    offenders.append(f"{rel}:{ln}: {line.strip()}")
        assert offenders == [], (
            "Inline `safe_segment(company, \"company\")` + "
            "`safe_segment(project, \"project\")` pair outside the "
            "whitelisted normalize-then-store sites — use "
            "`ProjectRef.from_strings(company, project).as_dir(base)` "
            "instead (C-B3 + D-B2).\n"
            "  offenders:\n    " + "\n    ".join(offenders)
        )


# ─── Guard 8a: provider switch outside provider_strategy ────────────────────


class TestNoProviderSwitchOutsideProviderStrategy:
    """D-O1: the `if self.provider == "github" / elif "bitbucket" /
    elif "gitlab"` chain in GitManager was a 2-site shotgun-surgery
    smell. The fix lifted the per-provider behavior into
    `src/git/provider_strategy.py`; `GitConfig.get_provider_strategy`
    is the ONLY switch on a provider string.
    """

    PATTERN = re.compile(
        r'(if|elif)\s+[^:]*\bprovider\s*==\s*[\'"](github|bitbucket|gitlab)[\'"]'
    )
    ALLOWED = {
        # The single dispatch site — required by design.
        Path("src/git/config.py"),
        # GitManager keeps a parallel dispatch for callers that
        # construct it without a GitConfig (notably tests).
        Path("src/git/git_manager.py"),
    }

    def test_no_inline_provider_switch(self):
        offenders = []
        for p in (REPO_ROOT / "src" / "git").rglob("*.py"):
            if "__pycache__" in p.parts:
                continue
            rel = p.relative_to(REPO_ROOT)
            if rel in self.ALLOWED:
                continue
            for ln, line in enumerate(_read_text(p).splitlines(), 1):
                if self.PATTERN.search(line):
                    offenders.append(f"{rel}:{ln}: {line.strip()}")
        assert offenders == [], (
            "Inline `if provider == \"<name>\"` switch outside the "
            "single dispatch — call `git_config.get_provider_strategy()` "
            "and use the returned strategy instead (D-O1 + D-B3).\n"
            "  offenders:\n    " + "\n    ".join(offenders)
        )


# ─── Guard 8: HAIKAI_PROFILES_ROOT — chat-executor cluster ────────────────


class TestNoInlineHaikaiProfilesReconstruction:
    """B-N5: every chat executor used to rebuild
    `Path(__file__).parent.parent.parent / "haikai-profiles"` ad-hoc.
    The fix lifted that into `src/chat/profiles_path.py` as
    `HAIKAI_PROFILES_ROOT`. Guard: the inline pattern must remain at
    exactly one site (the constant itself).
    """

    PATTERN = re.compile(
        r'Path\(__file__\)\.parent\.parent\.parent\s*/\s*"haikai-profiles"'
    )
    ALLOWED_FILE = Path("src/chat/profiles_path.py")

    def test_only_profiles_path_owns_the_reconstruction(self):
        offenders = []
        for p in (REPO_ROOT / "src" / "chat").rglob("*.py"):
            if "__pycache__" in p.parts:
                continue
            rel = p.relative_to(REPO_ROOT)
            if rel == self.ALLOWED_FILE:
                continue
            for ln, line in enumerate(_read_text(p).splitlines(), 1):
                if self.PATTERN.search(line):
                    offenders.append(f"{rel}:{ln}: {line.strip()}")
        assert offenders == [], (
            "Inline `Path(__file__).parent.parent.parent / \"haikai-profiles\"` "
            "in src/chat/ — use `HAIKAI_PROFILES_ROOT` from "
            "`src.chat.profiles_path` instead (B-N5).\n"
            "  offenders:\n    " + "\n    ".join(offenders)
        )


# ─── Guard: ClaudeChatExecutor.__new__ mocks must set extra_dirs ─────────────


class TestExecutorMockExtraDirs:
    """A functional `ClaudeChatExecutor.__new__(...)` test mock (one that sets
    `.project_dir`, i.e. is complete enough to build CLI commands) MUST also set
    `.extra_dirs`. The real `__init__` sets it (added in b44ac09, polyrepo
    Phase 4) but `__new__` bypasses `__init__`; `_build_cli_command` reads
    `self.extra_dirs` and AttributeErrors without it. 8 SSE tests broke this way.

    Bare parse-only mocks (no `.project_dir`) are exempt — they never reach the
    CLI path. count == 0 violations.
    """

    TESTS = Path(__file__).parent

    def _functional_mocks_missing_extra_dirs(self) -> list[str]:
        offenders: list[str] = []
        for p in self.TESTS.rglob("test_*.py"):
            if "__pycache__" in p.parts:
                continue
            text = _read_text(p)
            if "ClaudeChatExecutor.__new__(ClaudeChatExecutor)" not in text:
                continue
            # Per assigned variable: was it given .project_dir but not .extra_dirs?
            new_vars = re.findall(
                r"(\w+)\s*=\s*ClaudeChatExecutor\.__new__\(ClaudeChatExecutor\)", text
            )
            for var in set(new_vars):
                sets_pd = re.search(rf"\b{re.escape(var)}\.project_dir\s*=", text)
                sets_ed = re.search(rf"\b{re.escape(var)}\.extra_dirs\s*=", text)
                if sets_pd and not sets_ed:
                    offenders.append(f"{p.relative_to(REPO_ROOT)}: '{var}' sets project_dir but not extra_dirs")
        return offenders

    def test_functional_executor_mocks_set_extra_dirs(self):
        offenders = self._functional_mocks_missing_extra_dirs()
        assert offenders == [], (
            "Functional ClaudeChatExecutor __new__ mock missing `.extra_dirs` "
            "(real __init__ sets it — b44ac09). Add `<var>.extra_dirs = []`.\n"
            "  offenders:\n    " + "\n    ".join(offenders)
        )


# ─── Guard: job-queue path resolves via jobs_db_path() (predict R2) ──────────


class TestJobsDbPathSingleSource:
    """`jobs_db_path()` (src/safe_paths.py) is the single source of truth for
    the job-queue file. Every enqueue site (api/__init__, routes/bugs,
    routes/inbound) AND the worker that polls MUST resolve via it — a site that
    re-reads JOBS_DB_PATH with its own hardcoded default can split enqueue from
    poll so the job sits invisible forever (predict R2; 4 siblings had to be
    patched when the resolver landed — the helper-exists-sibling-missed shape).

    The legitimate exception is the VERIFICATION-store path resolver
    (`VERIFICATION_DB_PATH or JOBS_DB_PATH`), where JOBS_DB_PATH is only a
    fallback for a *different* db — those lines mention VERIFICATION_DB_PATH and
    are allowed. count == 0 bare jobs-queue defaults remain.
    """

    # A JOBS_DB_PATH read WITH an inline default (the comma is the tell).
    PATTERN = re.compile(r'(getenv|environ\.get)\(\s*[\'"]JOBS_DB_PATH[\'"]\s*,')

    def test_no_bare_jobs_db_default_outside_resolver(self):
        offenders = []
        for p in (REPO_ROOT / "src").rglob("*.py"):
            if "__pycache__" in p.parts:
                continue
            rel = p.relative_to(REPO_ROOT)
            if rel == Path("src/safe_paths.py"):
                continue  # the resolver itself
            for ln, line in enumerate(_read_text(p).splitlines(), 1):
                if self.PATTERN.search(line) and "VERIFICATION_DB_PATH" not in line:
                    offenders.append(f"{rel}:{ln}: {line.strip()}")
        assert offenders == [], (
            "Found a JOBS_DB_PATH read with an inline default that is NOT part "
            "of the verification-store fallback chain. Call `jobs_db_path()` "
            "(from src.safe_paths) so enqueue sites and the worker poll the same "
            "file (predict R2).\n  offenders:\n    " + "\n    ".join(offenders)
        )


# ─── Guard: any executor setting ANTHROPIC_API_KEY must branch on OAuth ──────


class TestNoAttemptReadModifyWrite:
    """R3: the verdict attempt ordinal must be derived ATOMICALLY inside
    recorder.record_verdict (attempt=None -> MAX(attempt)+1 in the same write
    txn). The recurring sibling shape was: read `latest_verdicts(...)`, compute
    `attempt = prev["attempt"] + 1`, pass it to `record_verdict(..., attempt=...)`.
    Under concurrent deliveries that read-modify-write loses updates — the UNIQUE
    constraint turns a second LEGITIMATE verdict into a false 'duplicate' 409 and
    drops it. Three sites carried this (inbound.py x2, tasks.py); guard count == 0.
    """

    PATTERN = re.compile(r'\[["\']attempt["\']\]\s*\+\s*1')

    def test_no_attempt_plus_one_rmw_in_src(self):
        offenders = []
        for p in (REPO_ROOT / "src").rglob("*.py"):
            if "__pycache__" in p.parts:
                continue
            for ln, line in enumerate(_read_text(p).splitlines(), 1):
                if self.PATTERN.search(line):
                    offenders.append(f"{p.relative_to(REPO_ROOT)}:{ln}: {line.strip()}")
        assert offenders == [], (
            "Found `[...\"attempt\"] + 1` read-modify-write. Don't compute the "
            "attempt and pass it to record_verdict — leave attempt=None so the "
            "recorder derives MAX(attempt)+1 atomically (R3).\n"
            "  offenders:\n    " + "\n    ".join(offenders)
        )


class TestOAuthTokenBranching:
    """A subprocess executor that sets ANTHROPIC_API_KEY for the `claude` CLI
    must also handle OAuth tokens (sk-ant-oat) via CLAUDE_CODE_OAUTH_TOKEN —
    a raw OAuth token in ANTHROPIC_API_KEY is rejected by the CLI. The CLI
    executor lacked this while the chat executor had it (helper-exists-
    sibling-missed); surfaced live when the worker launched a loop session.
    count == 0 executors set the key without the OAuth branch.
    """

    EXECUTORS = [
        REPO_ROOT / "src" / "claude_cli_executor.py",
        REPO_ROOT / "src" / "chat" / "claude_chat_executor.py",
    ]

    def test_every_executor_handles_oauth_tokens(self):
        offenders = []
        for path in self.EXECUTORS:
            text = _read_text(path)
            sets_key = '"ANTHROPIC_API_KEY":' in text
            handles_oauth = "sk-ant-oat" in text and "CLAUDE_CODE_OAUTH_TOKEN" in text
            if sets_key and not handles_oauth:
                offenders.append(str(path.relative_to(REPO_ROOT)))
        assert offenders == [], (
            "executor sets ANTHROPIC_API_KEY without OAuth-token branching "
            "(sk-ant-oat -> CLAUDE_CODE_OAUTH_TOKEN): " + ", ".join(offenders)
        )


# ─── Guard: worktree orchestration must run /write-spec FRESH ────────────────


class TestWorktreeFreshWriteSpec:
    """Every orchestration function that allocates a run WORKTREE must start
    step 1 (`/write-spec`) with a FRESH session in the worktree
    (`fresh_session_start`), NOT by resuming the shape-spec session.

    A resumed session's conversation history is anchored to the live-tree cwd
    (its transcript records live-tree absolute paths), so `/write-spec` follows
    that context and writes `spec.md` OUTSIDE the worktree — even with the
    process cwd set to the worktree and the transcript re-homed. Confirmed live
    driving the UI end-to-end (56/67 transcript messages recorded the live-tree
    cwd). requirements.md is already SEEDED into the worktree, which is all
    `/write-spec` needs, so a fresh in-worktree session is correct and robust.

    Guard: any function that CALLS `_allocate_run_worktrees(` must also pass
    `fresh_session_start` to `run_workflow` (both the single-spec
    `run_orchestration` and the per-spec `_run_per_spec_orchestration`).
    """

    TASKS = SRC / "job_queue" / "tasks.py"

    @staticmethod
    def _function_bodies(text: str) -> dict[str, str]:
        """Map each top-level `def name` to its body (until the next
        top-level def or EOF)."""
        lines = text.split("\n")
        starts = [
            (i, re.match(r"def (\w+)\(", l).group(1))
            for i, l in enumerate(lines)
            if re.match(r"def \w+\(", l)
        ]
        bodies: dict[str, str] = {}
        for idx, (start, name) in enumerate(starts):
            end = starts[idx + 1][0] if idx + 1 < len(starts) else len(lines)
            bodies[name] = "\n".join(lines[start:end])
        return bodies

    def test_worktree_allocating_functions_start_fresh(self):
        bodies = self._function_bodies(_read_text(self.TASKS))
        offenders = []
        for name, body in bodies.items():
            # A *call* to _allocate_run_worktrees (not its own definition).
            if not re.search(r"(?<!def )_allocate_run_worktrees\(", body):
                continue
            if "fresh_session_start" not in body:
                offenders.append(name)
        assert offenders == [], (
            "Orchestration function(s) allocate a run worktree but never run "
            "step 1 fresh (no `fresh_session_start`) — /write-spec will resume "
            "the shape-spec session, which is anchored to the live tree and "
            "writes spec.md outside the worktree: " + ", ".join(offenders)
        )
