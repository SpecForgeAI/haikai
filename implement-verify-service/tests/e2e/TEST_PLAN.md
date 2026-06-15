# Test Plan: repo_url Feature + E2E Repo Validation

## Context

We added `repo_url` support to two endpoints (`POST /api/v1/structural/analyze` and `POST /api/v1/analyze-repo/stream`). They accept a GitHub/GitLab/Bitbucket URL and shallow-clone the repo before running analysis. Source file extensions are discovered dynamically via `CtagsProvider.get_supported_extensions()` (queries `ctags --list-maps`) — no hardcoded language list.

This needs tests at four levels: ctags extension discovery, clone unit tests, API integration, and E2E against real repos.

## Test Files to Create

### 0. `tests/ast/test_ctags_extensions.py` — Extension discovery unit tests (no network)

Tests for `CtagsProvider.get_supported_extensions()` in `src/ast/ctags_provider.py`. All subprocess calls mocked.

| Test | What it validates |
|------|-------------------|
| `test_parses_ctags_list_maps` | Mocked `ctags --list-maps` output parsed into extension set |
| `test_includes_common_extensions` | Result contains `.py`, `.java`, `.ts`, `.go`, `.rb`, `.cs`, `.rs` |
| `test_caches_result` | Second call returns same set without spawning subprocess again |
| `test_fallback_when_ctags_missing` | `shutil.which("ctags")` returns None -> uses built-in fallback set |
| `test_fallback_on_subprocess_error` | Non-zero exit code -> uses built-in fallback set |
| `test_fallback_on_timeout` | `subprocess.TimeoutExpired` -> uses built-in fallback set |
| `test_fallback_includes_ruby` | Fallback set includes `.rb` |

### 1. `tests/api/test_clone_repo.py` — Unit tests (no network)

Tests for `_clone_repo()` in `src/structural_endpoints.py`. All git/filesystem mocked.

| Test | What it validates |
|------|-------------------|
| `test_github_url_clones_correctly` | Parses URL, builds correct git clone command |
| `test_branch_from_url` | URL-embedded branch (e.g. `/tree/develop`) passed to git |
| `test_branch_param_overrides_url` | Explicit `branch` param wins over URL branch |
| `test_gitlab_url` | GitLab URL produces correct clone URL |
| `test_bitbucket_url` | Bitbucket URL produces correct clone URL |
| `test_github_token_auth` | `GITHUB_TOKEN` env var embedded in clone URL |
| `test_no_token_public_url` | No token = plain HTTPS URL |
| `test_invalid_url_raises` | Unparseable URL raises ValueError |
| `test_shallow_clone_depth_1` | `--depth 1` always present in command |
| `test_clone_dir_is_correct` | Clones into `.specforge/repos/{owner}/{repo}` |
| `test_clone_failure_returns_400` | Non-zero exit = HTTPException 400 |
| `test_existing_dir_cleaned_up` | Old clone dir removed before re-cloning |
| `test_readonly_file_cleanup` | Windows read-only `.git` files handled by onerror |
| `test_returns_path` | Return value is a Path to clone dir |

### 2. `tests/api/test_structural_analyze_url.py` — API integration (no network)

TestClient tests for `POST /api/v1/structural/analyze` with `repo_url`. Mocks `_clone_repo` and the pipeline.
Note: `test_empty_repo_400` must also mock `CtagsProvider.get_supported_extensions()` since extensions are now dynamic.

| Test | What it validates |
|------|-------------------|
| `test_repo_url_triggers_clone` | `_clone_repo` called, 200 returned with snapshot |
| `test_repo_url_precedence` | `repo_url` used even when `local_path` also provided |
| `test_neither_url_nor_path_400` | Empty request = 400 |
| `test_clone_failure_bubbles_400` | Clone error returns 400 to client |
| `test_branch_forwarded` | `branch` field passed through to `_clone_repo` |
| `test_empty_repo_400` | Clone succeeds but no source files = 400 (mock `get_supported_extensions`) |

### 3. `tests/api/test_analyze_repo_stream_url.py` — SSE endpoint (no network)

TestClient tests for `POST /api/v1/analyze-repo/stream` with `repo_url`. Mocks `_clone_repo` and chat executor.

| Test | What it validates |
|------|-------------------|
| `test_repo_url_triggers_clone` | `_clone_repo` called before streaming |
| `test_repo_url_precedence` | `repo_url` wins over `repo_path` |
| `test_no_url_falls_back_to_workspace` | Without URL, uses `workspace_dir/company/project` |

### 4. `tests/e2e/test_repo_url_e2e.py` — Real repo E2E (network required, gpt-5.4-mini)

Marked `@pytest.mark.e2e` and `@pytest.mark.slow`. All LLM discovery uses **gpt-5.4-mini**.

| Class | Repo | Language | What it validates |
|-------|------|----------|-------------------|
| `TestDiscourseRuby` | `discourse/discourse` | Ruby | ctags-only path (no tree-sitter), Rails controllers, endpoint + interaction discovery |
| `TestFastAPIPython` | `tiangolo/fastapi` | Python | tree-sitter + ctags, imports/calls extracted |
| `TestNestJSTypeScript` | `nestjs/nest` | TypeScript | .ts extraction, decorators, modules |
| `TestPetclinicJava` | `spring-projects/spring-petclinic` | Java | Spring Boot, small/fast, annotations |
| `TestGinGo` | `gin-gonic/gin` | Go | structs, interfaces, Go ctags |
| `TestEShopCSharp` | `dotnet/eShop` | C# | ASP.NET controllers, .cs files |

Each class has:
- `test_clone_and_analyze` — POST with repo_url, assert 200, file_count > 0, symbol_count > threshold
- Discourse additionally: `test_endpoint_discovery` and `test_interaction_discovery` (with gpt-5.4-mini)

### 5. `tests/conftest.py` — Shared markers + fixtures

- Register `e2e`, `network`, `slow` markers
- `e2e_client` fixture with `LLM_PROVIDER=openai`, `LLM_MODEL=gpt-5.4-mini`
- `e2e_auth_headers` fixture

## Execution

```bash
# Ctags extension discovery + clone unit tests + API integration (fast, no network)
pytest tests/ast/test_ctags_extensions.py tests/api/test_clone_repo.py tests/api/test_structural_analyze_url.py tests/api/test_analyze_repo_stream_url.py -v

# E2E against real repos (slow, needs network + OPENAI_API_KEY)
LLM_PROVIDER=openai LLM_MODEL=gpt-5.4-mini pytest tests/e2e/test_repo_url_e2e.py -m e2e -v --timeout=600
```

## Critical files to modify/create

| Action | File |
|--------|------|
| **Create** | `tests/ast/test_ctags_extensions.py` |
| **Create** | `tests/api/test_clone_repo.py` |
| **Create** | `tests/api/test_structural_analyze_url.py` |
| **Create** | `tests/api/test_analyze_repo_stream_url.py` |
| **Create** | `tests/e2e/test_repo_url_e2e.py` |
| **Create** | `tests/conftest.py` |
