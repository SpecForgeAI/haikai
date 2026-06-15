# Specification: Git History Analysis Skill

## Summary

Add temporal analysis to standards extraction by mining git history. Analyze commit logs, blame data, diff patterns, and PR reviews to understand how coding patterns evolve over time. This surfaces migration trends, identifies emerging vs declining patterns, maps domain expertise by contributor, and enriches extracted standards with "when" and "why" context that static code analysis cannot provide.

---

## Current Flow

```
1. Git integration clones/pulls repo → provides current snapshot
2. file_scanner → discovers files at HEAD
3. Analysis pipeline → examines current code only
4. Standards output → "the codebase uses X pattern" (no temporal context)
```

### Current flow issues

- Standards are a point-in-time snapshot — no sense of trajectory
- Can't distinguish legacy patterns (being phased out) from adopted standards
- No visibility into why patterns exist (PR discussions, review feedback)
- Active vs stale code areas are indistinguishable
- Contributor expertise invisible — can't identify pattern authors/champions

---

## Proposed Flow

```
1. Git integration provides repo access
2. history_analyzer.py → parses git log, blame, diffs within configured time range
   ├─ Commit pattern analysis (frequency, churn, co-change)
   ├─ Pattern evolution tracking (import migrations, decorator adoption)
   ├─ Author expertise mapping (who owns which patterns)
   └─ PR review mining (reviewer feedback → implicit standards)
3. git_history_strategy.py → synthesizes temporal context
4. file_analyzer.py → receives temporal annotations per file
5. Standards output → "pattern X adopted 6 months ago, used in 80% of new files,
   championed by @alice, replacing pattern Y"
```

---

## Code Changes

### 1. New: `src/git/history_analyzer.py`

Core git history analysis module.

- `HistoryAnalyzer` class initialized with repo path and time range
- `analyze_commits(path_filter, since, until)` → commit metadata + file changes
- `analyze_blame(file_path)` → line-level authorship with timestamps
- `analyze_diffs(since, until, path_filter)` → added/removed pattern tracking
- `analyze_churn(top_n)` → most frequently modified files with change counts
- `analyze_cochange(min_correlation)` → files that consistently change together
- All git operations via `subprocess.run()` with JSON/porcelain output formats
- Async wrappers with `asyncio.to_thread` for non-blocking execution

### 2. New: `src/git/pattern_tracker.py`

Pattern evolution over time.

- `PatternTracker` class consuming diff data from `HistoryAnalyzer`
- Track import statement changes: `require` → `import`, library migrations
- Track decorator/annotation adoption: first appearance, adoption rate, current coverage
- Track error handling evolution: callback → promise → async/await transitions
- Track testing framework changes: framework adoption/abandonment dates
- Output: `PatternTimeline` — pattern name, first_seen, adoption_curve, current_status (growing/stable/declining)

### 3. New: `src/git/pr_analyzer.py`

PR and review data mining (requires GitHub/Bitbucket API access).

- `PRAnalyzer` class using existing git manager's API credentials
- Fetch merged PRs within time range
- Extract review comments, categorize by type (style, architecture, bug, naming)
- Identify recurring review feedback → implicit standards candidates
- PR size and time-to-merge metrics per module/path
- Graceful no-op if API credentials unavailable or provider unsupported

### 4. New: `src/git/models.py`

Pydantic models for history analysis.

- `CommitInfo`: sha, author, date, message, files_changed, insertions, deletions
- `BlameInfo`: line_range, author, commit_sha, date, content
- `ChurnInfo`: file_path, change_count, last_changed, authors
- `CoChangeGroup`: files, correlation_score, change_count
- `PatternTimeline`: pattern, first_seen, last_seen, adoption_rate, status, evidence
- `ReviewInsight`: category, frequency, example_comments, implied_standard

### 5. New: `src/strategies/git_history_strategy.py`

Strategy extending `BaseStrategy`.

- Generates "Pattern Evolution" section in standards output
- Timeline visualization data (text-based for markdown, structured for API)
- Hot file / cold file classification
- Contributor expertise map per module
- Declining pattern warnings ("this pattern is being actively replaced")

### 6. Modified: `src/file_analyzer.py`

- Accept optional `HistoryContext` per file from `HistoryAnalyzer`
- Include in LLM prompt: "This file was last modified 2 days ago by @alice.
  The async/await pattern was introduced 3 months ago. This file has high churn (modified 47 times in 12 months)."
- Context helps LLM distinguish established standards from experiments

### 7. Modified: `src/api.py`

- `GET /api/v1/projects/{company}/{project}/history/patterns` — pattern evolution timelines
- `GET /api/v1/projects/{company}/{project}/history/hotspots` — high-churn files and modules
- `GET /api/v1/projects/{company}/{project}/history/authors` — expertise map
- All endpoints accept `since`, `until`, `path` query params
- Results cached with TTL (default 1 hour) — history doesn't change between pushes

### 8. Config

- New env vars: `GIT_HISTORY_MONTHS` (default 12), `GIT_HISTORY_MAX_COMMITS` (default 10000)
- `GIT_PR_ANALYSIS` (default true if credentials available)
- `GIT_BLAME_ENABLED` (default true, disable for very large repos)

---

## Sampling Strategy for Large Repos

- Repos > 10K commits: sample every Nth commit based on `GIT_HISTORY_MAX_COMMITS`
- Blame on files > 5000 lines: skip (too expensive, low signal-to-noise)
- PR analysis: fetch last 500 merged PRs max (most recent = most relevant)
- Churn analysis: top 100 most-changed files only

---

## Error Handling

- Git not initialized → skip history analysis entirely, log info
- Shallow clone (no history) → warn user, suggest `git fetch --unshallow`
- API rate limit (GitHub/Bitbucket) → exponential backoff, partial results OK
- Author email privacy → use git username, never expose emails in output
- Corrupt git history → catch subprocess errors, skip affected analysis, continue
