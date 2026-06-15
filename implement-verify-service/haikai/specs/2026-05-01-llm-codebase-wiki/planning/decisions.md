# Planning notes — LLM Codebase Wiki

## Context

The standards-extractor today produces *facts* about a codebase
(structural store, endpoints, interactions). Empirical comparison with
GitNexus on openmrs-core (see `wiki/pages/comparisons/gitnexus-vs-v2.md`
in this repo) showed both tools converge on the same idea — graph + CLI
queries — but neither captures the *meaning* of the codebase: what each
service is for, why the architecture is shaped the way it is, what the
non-obvious decisions are.

Karpathy's LLM Wiki gist describes a pattern that solves exactly this
class of problem for human-curated knowledge. This spec applies the
pattern to *codebase* synthesis, with V2's extraction as the primary
ingest source and git history as the secondary.

## Key decisions

### D1: Wiki is a synthesis layer above V2, not a replacement
**Rationale:** V2's extraction is the right thing — fast, deterministic,
exhaustive. The wiki layer is *additive*: it consumes V2's facts and
produces prose synthesis with cross-references. The wiki cannot replace
V2 (no facts without extraction); V2 cannot replace the wiki (no prose
synthesis from facts alone).
**Implication:** ingest from V2 is the primary onramp; nothing in V2
needs to change.

### D2: Wiki artifact lives in the target repo
**Rationale:** the wiki is *about* the target. Putting it next to the
code it describes (a) keeps it discoverable, (b) lets it be committed
or .gitignore'd per target's policy, (c) survives standards-extractor
upgrades and database resets.
**Alternative considered:** central wiki store keyed by repo identity.
Rejected — synchronization, ownership, and discoverability all worse.
**Naming:** `.wiki/` (dot-prefixed) so it doesn't clash with target's
own `wiki/` directory if any. Override-able via flag.

### D3: Markdown + YAML frontmatter, no graph DB
**Rationale:** Karpathy's gist explicitly avoids embedding-based RAG
infrastructure for a reason — the markdown-and-index approach scales to
hundreds of pages without operational overhead. We already have a graph
(V2's structural store) for graph-shaped queries; the wiki is the prose
layer.
**Implication:** no new infra. Page metadata in frontmatter, index
rebuilt from frontmatter, search via BM25 + grep.

### D4: Schema co-evolves with the user
**Rationale:** every codebase has different idioms (Rails apps care
about controllers + models + jobs; Spring apps care about
@Service/@Repository; FastAPI apps care about routers + dependencies).
A fixed schema would be wrong for half of them.
**Mechanism:** `schema.md` in each wiki, editable by the user, read by
the LLM on every ingest. Default schema is sensible-but-overridable.

### D5: Source taxonomy is explicit
**Rationale:** an ingest of V2 output is fundamentally different from
an ingest of a git-range diff or a user note. The LLM needs to know
which mode to operate in (bulk-fill vs incremental-update vs note-
integration). Forcing a `--source <type>` flag prevents the LLM from
guessing.
**Source types in v1:** `v2-extraction`, `git-range`,
`endpoint-discovery`, `note`, `web`.

### D6: Confidence markers on LLM claims
**Rationale:** the LLM will infer things the code doesn't explicitly
say (e.g. "this service appears to be a thin wrapper around the
repository, possibly added during a 2018 refactor"). Users need to
distinguish derived-from-facts from derived-with-judgment.
**Mechanism:** `confidence: low|medium|high` field per page (or per
section if needed). Lint can downgrade confidence when sources change.

### D7: Lint is mostly mechanical, optionally LLM-driven
**Rationale:** orphan detection, broken-link detection, stale-page
detection are pure file/git operations — no LLM cost, fast, run
frequently. Contradiction detection requires LLM and is expensive — opt-in.
**Default behavior:** mechanical checks always, contradiction check on
explicit flag.

### D8: Comparison with gitnexus wiki is a success criterion
**Rationale:** the central thesis of this spec — "synthesis adds value
over template-driven dumps" — is testable. We have gitnexus installed,
and we can run `gitnexus wiki openmrs-core` to produce their artifact,
then compare to our wiki on the same target.
**Mechanism:** 3 hand-rated queries on each artifact, qualitative
judgment.

### D9: Incremental ingest is the long-term value
**Rationale:** anyone can produce a wiki from a snapshot. The Karpathy
pattern's actual claim is that the LLM can *maintain* the wiki as the
codebase evolves — pages that update themselves, contradictions flagged
automatically, drift kept in check. This is the bet.
**Implication:** git-range ingest is not optional; it's central. Spend
real design effort on the symbol-to-page mapping and the contradiction-
detection prompt.

### D10: No vector embeddings in v1
**Rationale:** at hundreds of pages, BM25 + grep is sufficient. Adding
embeddings adds infra (vector store, embedding API costs, refresh
logic) for a marginal recall win. Defer until measurably needed.
**Re-eval trigger:** wiki exceeds ~500 pages OR query recall drops
below acceptable on hand-rated queries.

## Risks tracked

| Risk | Likelihood | Mitigation |
|---|---|---|
| LLM hallucinates facts not in source | High | Confidence markers; lint catches contradictions over time; users review pages |
| Initial ingest takes hours on a large repo | Medium | Bound by file count × per-file LLM cost; chunk and parallelize; offer `--scope <subset>` flag |
| Wiki pages drift from code without users running incremental ingest | High | Document the "git-range ingest after each PR" workflow; consider git hook in a future spec |
| Symbol-to-page mapping is fragile (renames break it) | Medium | Use stable identifiers (file path + symbol name) with fallback fuzzy match; surface mismatches in lint |
| Schema customization leads to incoherent wikis across targets | Low | Default schema is good enough for 80% of cases; users opt into customization |
| User abandons the wiki because maintenance burden | Medium | The whole point is LLM does maintenance; if it's still too much, reduce per-ingest scope |
| Wiki output is just rephrased V2 extraction (no real synthesis) | Medium | Validate via the 3-query comparison vs gitnexus wiki; iterate prompts if synthesis is shallow |
| Page-by-page LLM calls cost too much | Medium | Batch by category; cache per-source ingest decisions; offer cheaper-model option |

## Sequencing rationale

Phase 1 (init + scaffolding) is risk-free and enables everything else.

Phase 2 (v2-extraction ingest) is the primary onramp — most users will
start here. Build it carefully; this is the page-authoring prompt that
sets the quality bar.

Phase 3 (query + index navigation) makes the wiki useful before
incremental ingest is built.

Phase 4 (git-range ingest) is the differentiator from gitnexus wiki and
the central long-term value. Real design effort here.

Phase 5 (lint, mechanical) is a small but high-value addition.

Phase 6 (comparison study) validates the thesis.

Phase 7 (skills + LLM lint) is optional polish.

## Effort estimate (one engineer, with LLM pair)

| Phase | Effort | Notes |
|---|---|---|
| 1 | 0.5 day | scaffolding + schema.md template |
| 2 | 2 days | v2-extraction ingest + page-authoring prompt + page model |
| 3 | 1 day | query path + index reading + citation formatting |
| 4 | 2 days | git-range ingest + symbol→page mapping + contradiction prompt |
| 5 | 0.5 day | mechanical lint |
| 6 | 0.5 day | gitnexus comparison study + writeup |
| 7 | 1 day | skills (`/wiki-ingest`, `/wiki-query`) + LLM-driven lint |
| **Total** | **~7.5 days** | |

## Open items

- **O1:** Should the wiki capture *test* coverage and intent? Tests are
  often the best documentation of expected behavior. Possible page type:
  `pages/behaviors/` derived from test files. Defer.
- **O2:** Should the wiki integrate with our existing memory system?
  The memory system captures user-collaboration preferences; the wiki
  captures codebase synthesis. Different scopes. Likely: no integration,
  just a cross-reference in CLAUDE.md.
- **O3:** What happens when V2 re-extracts and produces different facts?
  The wiki references things by stable identifier; if facts change, the
  next ingest updates pages. But what if V2 *removes* a discovered
  endpoint? The page about it becomes a stub or gets archived. Decide
  during Phase 4.
- **O4:** Should `wiki query` be allowed to *modify* the wiki (file the
  answer back as a new page)? Karpathy's gist suggests yes. Adds a
  permission/authorization concern. Default: no, opt-in via flag.
- **O5:** Multi-repo wikis — when a target is part of a system of
  related repos (cross-repo groups, spec #90), should there be one
  wiki spanning all of them? Likely yes, but defer to spec #90's scope.
- **O6:** Wiki schema versioning — if we ship a schema migration, how
  do user-customized schemas get updated? Probably: schema.md has a
  `schema_version` field, init detects mismatches and offers migration.
  Not v1.
