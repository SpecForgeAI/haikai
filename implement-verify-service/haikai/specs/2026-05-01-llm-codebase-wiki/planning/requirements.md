# Requirements — LLM Codebase Wiki

## Functional

### F1: Wiki initialization
- `wiki init <target>` scaffolds `<target>/.wiki/` with:
  - `index.md` (empty catalog with section headers)
  - `log.md` (with init entry)
  - `schema.md` (default page-type conventions, editable by user)
  - `raw/`, `pages/services/`, `pages/endpoints/`, `pages/entities/`,
    `pages/concepts/`, `pages/decisions/`, `pages/architecture/`
- Idempotent: re-running on existing wiki preserves user edits, only
  re-creates missing scaffolding.

### F2: V2 extraction ingest
- Input: target with completed V2 extraction output
- LLM reads structural store + endpoints + interactions
- Drafts pages: one per discovered service/module, one per endpoint
  group, one per data entity
- Writes cross-links between related pages
- Updates `index.md`
- Appends to `log.md`
- Filed in `raw/` as a snapshot reference

### F3: Git-range ingest
- Input: `<ref1>..<ref2>`
- LLM reads diff
- Identifies which pages need update (by symbol → page mapping)
- Updates only affected pages
- Flags contradictions with prior page claims (LLM judgment)
- Notes substantial changes that warrant a `decisions/` entry
- Appends to `log.md`

### F4: Note ingest
- Input: path to a user-authored markdown file
- LLM reads the note and integrates it: typically creates or updates a
  `decisions/` or `concepts/` page; adds cross-refs to existing pages
- Original note filed in `raw/`

### F5: Query
- Input: a natural-language question
- LLM reads `index.md`, picks relevant pages, reads them, returns a
  synthesized answer with page-path citations
- Answers can be filed back as new pages on user request

### F6: Lint
- Scans wiki for:
  - Orphan pages (no inbound `[[links]]`)
  - Broken `[[links]]` (target page missing)
  - Stale pages (page mtime older than git mtime of referenced source
    symbols by > N days, configurable)
  - Contradictions (LLM-judged: pages claiming opposing facts)
  - Missing pages (concepts mentioned ≥ 3 times across the wiki but
    lacking their own page)
- Returns structured report; does not auto-fix

### F7: Frontmatter schema
- Each page has YAML frontmatter with: `type`, `title`, `sources` (list),
  `last_updated`, `related` (list of page paths), `confidence`
- `index.md` is rebuilt from frontmatter on every ingest

### F8: API endpoints
- `POST /api/v1/wiki/init` — body `{repo_url|local_path}`
- `POST /api/v1/wiki/ingest` — body `{repo_url|local_path, source_type, source_ref}`
- `GET /api/v1/wiki/page?path=...&target=...`
- `GET /api/v1/wiki/index?target=...`
- `POST /api/v1/wiki/query` — body `{target, question}`
- `POST /api/v1/wiki/lint` — body `{target}`

### F9: CLI
- `python -m src.cli wiki <subcommand> <target> [args]`
- Subcommands: `init`, `ingest`, `query`, `lint`, `serve`

## Non-functional

### N1: Performance
- Initial v2-extraction ingest on openmrs-core (1,273 files, ~13
  endpoints): under 5 minutes wall-clock with gpt-5.4-mini
- Incremental git-range ingest of a single-file change: under 60 seconds
- `query` round-trip: under 30 seconds for typical questions
- `lint` on a wiki of ~200 pages: under 60 seconds (excluding LLM
  contradiction checks; those are opt-in)

### N2: No new heavy dependencies
- BM25 via existing search infra or a lightweight pure-Python lib
- Markdown parsing via existing tooling
- YAML via existing yaml dep

### N3: Determinism in scaffolding
- `wiki init` is fully deterministic (no LLM)
- LLM-driven steps (ingest, query, lint contradiction checks) are
  reproducible-ish: same model + same input + same temperature should
  produce semantically equivalent output (not byte-equal)

### N4: Incremental writes
- Re-ingesting the same source should not rewrite unchanged pages
- Page mtime is a meaningful signal — preserve it on no-op ingests

### N5: User-editable schema
- `schema.md` is the source of truth for page-type conventions
- LLM reads it on every ingest; user can extend without code changes

## Constraints

### C1: Single-user, single-target per invocation
- No concurrent ingests against the same wiki
- No multi-target ingest in one call

### C2: LLM is required
- All ingest, query, and contradiction-lint operations require an LLM
- Init, lint (mechanical checks), and search are LLM-free

### C3: Wiki artifact is markdown + YAML, full stop
- No SQLite index, no graph DB, no embeddings store
- Page metadata lives in frontmatter; index lives in `index.md`

### C4: Lives in the target repo
- `<target>/.wiki/` is the artifact location
- Whether to commit it is the target repo owner's decision; we don't
  enforce either way

### C5: Reuse V2's existing extraction
- Wiki is a synthesis layer; it does not re-run AST extraction
- Requires V2 to have run first for `--source v2-extraction`

## Inputs

- A target codebase path or git URL
- (Optional) V2 extraction output for that target
- (Optional) Git ref or ref-range
- (Optional) User notes as markdown files
- (Optional) `schema.md` overrides

## Outputs

- `<target>/.wiki/` directory containing:
  - `index.md`, `log.md`, `schema.md`
  - `raw/<dated-snapshots-and-notes>`
  - `pages/<category>/<title>.md` files with prose + frontmatter

## Success criteria (mirror spec.md)

1. Bootstrap on openmrs-core produces ≥ 1 page per service/endpoint
   group/entity, fully cross-linked, under 5 minutes
2. Bootstrap on spring-petclinic produces a coherent OwnerService /
   Owner / owner-routes triplet
3. Query returns synthesis with citations
4. Incremental ingest touches only affected pages
5. Lint flags stale pages after a referenced symbol is removed
6. Side-by-side comparison vs `gitnexus wiki` shows synthesis advantage
   on 3 hand-rated queries
