# Claude Code Project Instructions

## Bug Triage — Don't Defer Real Bugs

When a smoke test, manual run, or any other check surfaces broken behavior, **treat it as a bug to investigate and resolve, not a "follow-up" to defer**. Specifically:

- **Don't separate "mechanism" from "outcome".** Phrases like "the mechanism works, the content is wrong" are downgrading. If the user-visible result is wrong, the feature is broken — full stop.
- **Don't downgrade severity by attribution.** "Pre-existing on main" / "not a merge regression" / "happens deterministically but isn't blocking" are excuses to move past it. They're not reasons the bug is OK.
- **Don't bundle unresolved bugs into PR descriptions as 'follow-ups'** unless the user has explicitly agreed they're acceptable. Surface the bug, propose to investigate now, and let the user decide.
- **A discovered bug is a stopping point**, not a footnote. Pause the original task, report the finding clearly with severity, and ask before continuing past it.

The cost of "shipping with known bugs" is paid by future readers and users. Investigation now is almost always cheaper than carrying a bug forward.

## Process: helper-exists-sibling-missed (the 5-pass pattern)

Five consecutive autoresearch:debug passes (260504-0823, -0934, -1127, -1229, -1301) each surfaced an instance of: **a hardening helper lands in module A; sibling sites in module B/C/D/E aren't grep'd and patched.** The lineage:

| Pass | Helper | Bypassed sites |
|---|---|---|
| 260504-0823 | `_get_store` (project-root anchor) | `_clone_repo` |
| 260504-0934 | `_tsv_safe` (interaction_classifier) | `store.write_*` writers neutralized fix on disk |
| 260504-1127 | (test-pollution `set_api_key`) | 3 sites pop'd unconditionally |
| 260504-1229 | `_safe_project_dir` | 17 sites in api/__init__.py |
| 260504-1301 | `stop_flag` (SSE handlers) | 2 v2 SSE handlers — and the test asserted `>=4` instead of equality, hiding the gap |
| 260815 | `GuardedProcess` (stream_watchdog) | both CLI chat executors read child stdout with a bare unbounded `for line in process.stdout` and never drained stderr — a silent/wedged pipe hung jobs FOREVER while the heartbeat stayed fresh (overnight spec deaths). Guard: every `subprocess.Popen(` in the chat executors must be wrapped in `GuardedProcess(` (equality count) |

When you add a hardening helper or fix:

1. **Grep for the anti-pattern across the whole codebase**, not just the file you're working in. The same shape almost always exists in 2+ other places.
2. **Patch every instance in the same commit.** A "deferred follow-up" sibling site becomes the next debug pass's headline finding.
3. **Add a guard test that asserts ZERO bypasses remain** — see `tests/test_anti_pattern_guards.py` for the pattern. Use `count == 0` or `count == total`, NEVER `count >= N` (the >=N test is what hid the v2 SSE gap for an entire pass).
4. **The guard test is the load-bearing artifact.** A new contributor adding a sibling endpoint will be told by the failing test that they need to use the helper.

If you find yourself writing "the other sites are fine because they don't currently use this code path," stop. Add the guard anyway. The point is the *next* author who introduces a sibling site can't slip past.

## Architecture Principle: AST vs LLM Responsibilities

The AST layer does MECHANICAL, framework-agnostic structural extraction:
- Symbols, call sites, imports, inheritance, assignments, annotations
- This data goes into the structural store (_index.txt, _calls.txt, etc.)

The LLM layer does FRAMEWORK INTERPRETATION:
- Endpoint discovery (understanding that `@GetMapping` means a REST endpoint)
- Interaction discovery (understanding that `repository.save()` means a DB write)
- Target resolution (understanding that the DB table is "orders")
- Data entity resolution (understanding the DTO type)

**NEVER add framework-specific pattern matching to the AST extractors.**
New framework support = the LLM already knows it. No code changes needed.

The agentic discovery loop uses hypothesis→probe→assess with structural store tools.
Skill files: `haikai-profiles/default/commands/discover-endpoints/` and `discover-interactions/`.
Discovery modules: `src/ast/endpoint_discoverer.py` and `interaction_discoverer.py`.

## Windows Compatibility

This project runs on Windows (MSYS/Git Bash). **NEVER** use `/dev/null` in bash commands. On Windows, redirecting to `/dev/null` creates a literal file named `nul` instead of discarding output.

Instead of:
- `command 2>/dev/null` — just omit the redirect, or use `command 2>&1` if you need to merge stderr into stdout
- `command &> /dev/null` — just omit the redirect
- `command > /dev/null 2>&1` — just omit the redirect

## LLM Wiki

The `wiki/` directory is an LLM-maintained knowledge base for project-level synthesis (architecture decisions, comparison findings, framework insights, cross-cutting analysis) that doesn't fit Haikai specs or short-form auto-memory. Pattern from Karpathy: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f

Structure:
- `wiki/raw/` — immutable source documents (transcripts, dumps, exported notes). Filename: `YYYY-MM-DD_short-slug.md`. Never edit; supersede with a new dated file if findings change.
- `wiki/pages/` — LLM-curated synthesis pages. Subdirectories grow organically: `tools/`, `comparisons/`, `findings/`, `decisions/`, `concepts/`, etc.
- `wiki/index.md` — catalog of all pages, grouped by category. Update on every ingest.
- `wiki/log.md` — append-only timeline. Entry header: `## [YYYY-MM-DD] {init|ingest|query|lint} | <title>`.

Operations:
- **Ingest:** file the raw doc under `raw/`, extract key facts, create or update relevant pages under `pages/`, add cross-links, update `index.md`, append to `log.md`.
- **Query:** read `index.md` first, drill into relevant pages, synthesize with citations to wiki pages and (if needed) raw sources.
- **Lint:** scan for contradictions across pages, orphan pages, missing cross-references, stale claims.

Conventions:
- Use `[[wikilinks]]` (Obsidian-style) between pages — cross-references are the primary value.
- Keep pages tight and encyclopedic — one concept per page.
- Pages cite sources by linking back to `raw/...` files.
- Distinct from Haikai specs (work-tracking lifecycle) and the auto-memory system (collaboration preferences).
