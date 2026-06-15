# Requirements: Git History Analysis Skill

## Feature Description

Analyze git history to surface evolving coding standards — how patterns, conventions, and architectural decisions have changed over time. Uses git blame, commit frequency, PR history, and diff analysis to add a temporal dimension to standards extraction. Answers questions like "when did the team migrate from callbacks to async/await?" and "which patterns are trending vs declining?"

## Technology Stack

- Python 3.11+ (FastAPI backend)
- `subprocess` for git CLI operations (already in Docker)
- `httpx` for GitHub/Bitbucket API calls (PR data, already a dependency)
- Existing `src/git/git_manager.py` for repository access
- `pandas` for time-series pattern analysis (optional, lightweight)

## Requirements

### Git History Parser
- New module at `src/git/history_analyzer.py`
- Parse `git log` output: commits, authors, dates, file changes, diffs
- Parse `git blame` per file: line-level authorship and timestamp
- Configurable time range: `--since`, `--until` (default: last 12 months)
- Support filtering by path, author, file type

### Pattern Evolution Tracking
- Track import statement changes over time (e.g., migration from `require` to `import`)
- Track decorator/annotation adoption curves
- Track testing pattern evolution (framework changes, coverage trends)
- Track error handling pattern shifts (callbacks → promises → async/await)
- Identify "big bang" refactors vs gradual migrations via commit clustering

### Commit Pattern Analysis
- Commit frequency by directory/module (identify active vs stale areas)
- Author contribution patterns per module (identify domain experts)
- Commit message convention analysis (conventional commits, prefixes, issue refs)
- File churn rate: frequently modified files suggest unstable patterns
- Co-change analysis: files that always change together suggest coupling

### PR/Review Analysis (GitHub/Bitbucket)
- Fetch merged PR data via API (requires existing git integration)
- Review comment patterns: what do reviewers commonly flag?
- PR size distribution: small focused PRs vs large sweeping changes
- Time-to-merge trends per module
- Review comment extraction for standards discovery (e.g., "we should always...")

### Integration with Extraction Pipeline
- New strategy: `src/strategies/git_history_strategy.py` extending `BaseStrategy`
- Temporal context injected into LLM prompts during standards extraction
- "This pattern appeared 6 months ago and is used in 80% of new files"
- Evolution timeline included in generated standard documents

### API Surface
- `GET /api/v1/projects/{company}/{project}/history/patterns` — pattern evolution timeline
- `GET /api/v1/projects/{company}/{project}/history/hotspots` — frequently changed files/modules
- `GET /api/v1/projects/{company}/{project}/history/authors` — contributor expertise map
- Query params: `since`, `until`, `path`, `author`

## Constraints
- Git history analysis is I/O bound (subprocess calls) — run in thread pool
- Large repos (>50K commits) need pagination/sampling, not full scan
- PR API access requires GitHub/Bitbucket tokens (already configured for git integration)
- Historical analysis only available for git repositories (not zip uploads)
- Blame analysis on large files (>5000 lines) should be skipped or sampled

## Out of Scope
- Real-time commit monitoring (webhook-based)
- Predictive analysis ("this pattern will likely be replaced")
- Individual developer performance metrics (avoid surveillance patterns)
- Non-git VCS (SVN, Mercurial)
- Git bisect or automated regression detection
- Merge conflict analysis
