# Decision: Windows is a first-class dev/runtime platform

Standards-extractor runs on Windows (typically MSYS / Git Bash + native Python). Code must not assume POSIX-only conventions. Documented in `CLAUDE.md`.

## The rule

> This project runs on Windows (MSYS/Git Bash). **NEVER** use `/dev/null` in bash commands. On Windows, redirecting to `/dev/null` creates a literal file named `nul` instead of discarding output.

## What's banned

| Don't | Use instead |
|---|---|
| `command 2>/dev/null` | omit the redirect, or `command 2>&1` to merge into stdout |
| `command &> /dev/null` | omit |
| `command > /dev/null 2>&1` | omit |

## What this implies elsewhere

- **Path separators.** Code joins paths via `pathlib.Path`, never via `"/".join(...)`. Windows-encoded paths (with `:\`) are produced by some subsystems (Claude CLI session storage at `~/.claude/projects/<encoded>/<uuid>.jsonl`) and decoded carefully — see `ClaudeChatExecutor.get_session_file` for the full encoding rules (`:\` → `--`, `\` → `-`, `_` → `-`).
- **Subprocess encoding.** `subprocess.Popen` calls pass `encoding="utf-8", errors="replace"` to avoid Windows cp1252 crashes on non-ASCII output. Same fix applied to `git_manager._run_git`, structural endpoint clones, and several other sites — see commit `27db3ec` for the hygiene pass.
- **Two shells supported.** Bash tool (Git Bash) and PowerShell. Claude CLI invocation prefers PowerShell on Windows; the project's docs and scripts use both forms.
- **Line endings.** Files are committed with project-default line endings; not normalized across platforms because the editors handle it.

## Concrete failure modes seen

- Scripts that wrote `2>/dev/null` produced literal `nul` files in the repo root, which then got committed by accident. Treat as a regression.
- `subprocess.run(..., text=True)` without `encoding="utf-8"` crashes on cp1252-incompatible output. Fixed across the codebase in the H/M/L pass tracked in `haikai/specs/2026-05-03-chat-and-fetcher-hardening/spec.md`.

## What this is *not*

- Not a "support Windows as a secondary platform" stance. Windows is the *primary* dev platform for this project.
- Not a ban on POSIX behavior. Just a ban on POSIX-only assumptions.

## Cross-references

- `CLAUDE.md` — "Windows Compatibility" section
- Subprocess encoding hygiene: `haikai/specs/2026-05-03-chat-and-fetcher-hardening/spec.md` § M2, M3
- [[../concepts/chat-executors]] — Claude CLI subprocess paths use PowerShell on Windows

## Sources

- `CLAUDE.md`
- Commits `27db3ec`, `899b35e`, `42b0e8d`
- [[../../raw/2026-05-04_codebase-walk]]
