# RepositoryFetcher

Fetches files from remote git hosts via their REST APIs (no clone). Lives at `src/repo_fetcher.py`. Used by the [[standards-pipeline]] when a `--source` is a URL rather than a local path.

## Supported hosts

| Host | Auth | Library |
|---|---|---|
| GitHub | personal access token | `pygithub` |
| GitLab | private token | `python-gitlab` |
| Bitbucket | username + app password | `requests` (raw REST) |

## URL parsing

`parse_repo_url(url)` returns `(platform, owner, repo, branch, path, is_file)`. It accepts five URL shapes per host:

- repo root: `github.com/owner/repo`
- repo with branch: `github.com/owner/repo/tree/main`
- directory: `github.com/owner/repo/tree/main/src/auth`
- single file: `github.com/owner/repo/blob/main/README.md`
- with optional `.git` suffix

Strips trailing slashes; returns `None` for `branch`/`path` when not in URL.

## Two modes of fetching

1. **`fetch_directory(url)`** — for directory or repo URLs. Walks the tree via the host's API, returns `Dict[path, content]` for text files. No clone, no git history.
2. **`fetch_file(url)`** — for single-file URLs. Returns raw text.

GitHub and GitLab use base64-decoded API responses. Bitbucket uses raw `src/<branch>/<path>` endpoints.

## Hardened in 2026-05-03

The 2026-05-03-chat-and-fetcher-hardening spec landed five fixes here (see `haikai/specs/2026-05-03-chat-and-fetcher-hardening/spec.md`):

| Severity | Fix |
|---|---|
| MEDIUM (M4) | All `requests.get` calls got `timeout=30`. The pygithub `Github` client also got `timeout=30`. Without these, a slow Bitbucket response could hang the analyze pipeline indefinitely. |
| LOW (L1) | URL segments interpolated into Bitbucket URLs (`owner`, `repo`, `branch`, `file_path`) now go through `urllib.parse.quote(..., safe="/")`. `parse_repo_url`'s regex limits inputs, but `file_path` could contain `?` or `#` and break URL semantics. |
| LOW (L2) | Replaced `print(...)` error reporting with `logger.error(...)` — was inconsistent with the rest of the codebase. |
| LOW (L3) | `_fetch_github_file` now passes `errors="replace"` to `.decode("utf-8")` after b64-decoding — handles binary files (images, PDFs) checked into the repo without crashing. |

## What this is *not*

- **Not a git client.** No clone, no history, no diff, no commit-SHA pinning. For full-history operations, the pipeline uses `git clone` via `src/git/git_manager.py` instead, and pins to commit SHAs ([[depgraph-commit-sha]]).
- **Not the path used by V2.** V2's structural extraction operates on a local working tree — repos must be cloned first. `RepositoryFetcher` is for the original standards pipeline that just needs file *content*, not history.

## Cross-references

- [[standards-pipeline]] — the consumer
- [[../decisions/windows-first-compatibility]] — encoding hygiene applies here too
- Hardening spec: `haikai/specs/2026-05-03-chat-and-fetcher-hardening/spec.md`

## Sources

- `src/repo_fetcher.py`
- `haikai/specs/2026-05-03-chat-and-fetcher-hardening/spec.md`
- [[../../raw/2026-05-04_codebase-walk]]
