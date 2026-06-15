# Specification: LLM Codebase Wiki

## Summary

Add an LLM-driven wiki capability to standards-extractor: given a target
codebase, build and incrementally maintain a curated markdown wiki that
synthesizes the codebase's architecture, services, endpoints, data
entities, and decisions into a navigable, cross-linked artifact.

This is a synthesis layer that sits **above** V2's existing structural
extraction. V2 produces facts (symbols, calls, endpoints, interactions);
the wiki layer produces *meaning* (what each service does, why the
architecture is shaped the way it is, where the contradictions and gaps
are).

Distinct from:
- **Gitnexus `wiki` command** — one-shot template dump from a graph.
  No incremental human-LLM curation, no synthesis-over-time, no
  lint operation, no captured intent/decisions beyond the AST.
- **Doxygen / JSDoc / Sphinx autodoc** — line-by-line code description.
  No architectural synthesis, no semantic abstraction.
- **Standards-extractor's existing pipeline** — deterministic structural
  facts. No prose, no synthesis, no curation.
- **The project's own meta-wiki** at `wiki/` (option A) — that wiki
  describes *this project*; this capability builds wikis *for arbitrary
  target codebases*.

Pattern source: Karpathy's LLM Wiki gist
(https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f).

## Core Principle

> V2 extracts what the code *is*. The wiki layer captures what the code
> *means* — and keeps that meaning current as the code evolves.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ Target codebase  (e.g. /repos/openmrs-core)                         │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ V2 extraction pipeline (existing)                                   │
│ - structural store (_index.txt, _calls.txt, ...)                    │
│ - endpoints + interactions (playbook + LLM discovery)               │
│ - dep graph (commit-pinned)                                         │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ src/wiki/  (NEW)                                                    │
│                                                                     │
│ ingest.py     ← LLM-driven page authoring; updates relevant pages   │
│ pages.py     ← page model, cross-link parser, frontmatter handling  │
│ index.py     ← maintains index.md from page metadata                │
│ log.py       ← appends to log.md                                    │
│ lint.py      ← scans for contradictions, orphans, stale claims      │
│ search.py    ← BM25 over wiki pages (grep fallback)                 │
│ schema.py    ← page-type taxonomy + frontmatter schema              │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ <target>/.wiki/  (the artifact, lives in the target repo)           │
│                                                                     │
│ index.md                                                            │
│ log.md                                                              │
│ schema.md         ← per-target conventions, co-evolved with user    │
│ raw/              ← V2 extraction snapshots, user-added notes       │
│ pages/                                                              │
│   services/       ← one page per discovered service/module          │
│   endpoints/      ← one page per endpoint group                     │
│   entities/       ← one page per data entity                        │
│   concepts/       ← domain concepts (LLM-identified)                │
│   decisions/      ← architectural decisions (reverse-engineered     │
│                     from code + git history + user input)           │
│   architecture/   ← cross-cutting synthesis pages                   │
└─────────────────────────────────────────────────────────────────────┘
```

## Components

### 1. `src/wiki/` Python module

| File | Responsibility |
|---|---|
| `ingest.py` | Take a "source" (V2 extraction output, git commit range, or user note) and update relevant pages |
| `pages.py` | Markdown page model: load, save, parse `[[wikilinks]]`, frontmatter |
| `index.py` | Rebuild `index.md` from page frontmatter on each ingest |
| `log.py` | Append-only log entries `## [YYYY-MM-DD] {ingest|query|lint} | <title>` |
| `lint.py` | Detect orphans, missing back-references, stale claims (page mtime older than referenced symbol's last commit), contradictions (LLM-judged) |
| `search.py` | BM25 over page text + grep fallback; returns page paths ranked by relevance |
| `schema.py` | Page-type taxonomy: service/endpoint/entity/concept/decision/architecture |

### 2. New API endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/v1/wiki/init` | Bootstrap `.wiki/` for a target repo (raw scaffold, schema.md, empty index/log) |
| `POST /api/v1/wiki/ingest` | Body: `{repo_url\|local_path, source_type, source_ref}`. Triggers LLM ingest cycle |
| `GET /api/v1/wiki/page` | Query: `path`. Returns page markdown |
| `GET /api/v1/wiki/index` | Returns parsed index of pages by category |
| `POST /api/v1/wiki/query` | Body: `{question}`. LLM reads index → drills into pages → returns synthesis with citations |
| `POST /api/v1/wiki/lint` | Run lint pass; returns list of issues |

### 3. CLI

```
python -m src.cli wiki init <target>
python -m src.cli wiki ingest <target> --source v2-extraction
python -m src.cli wiki ingest <target> --source git-range <ref1>..<ref2>
python -m src.cli wiki ingest <target> --source note <path-to-note.md>
python -m src.cli wiki query <target> "<question>"
python -m src.cli wiki lint <target>
python -m src.cli wiki serve <target>     # optional: HTTP server for browsing
```

### 4. Source types for ingest

| Source type | What it provides | Pages typically updated |
|---|---|---|
| `v2-extraction` | The full V2 structural + endpoint + interaction output | services/, endpoints/, entities/ (bulk initial fill) |
| `git-range` | Diff between two commits | services/ (for changed modules), decisions/ (for non-trivial changes), log.md |
| `endpoint-discovery` | Just the endpoint records | endpoints/ + cross-links into services/ |
| `note` | A user-authored markdown file (decision rationale, comparison finding, intent doc) | decisions/, concepts/, plus cross-refs into existing pages |
| `web` | A URL fetched via the existing fetcher | concepts/, raw/ |

### 5. Page schema (frontmatter)

```yaml
---
type: service          # service|endpoint|entity|concept|decision|architecture
title: PatientService
sources:
  - raw/2026-05-01_v2-extraction.json
  - git:abc123:src/api/patient.java
last_updated: 2026-05-01
related:
  - pages/entities/Patient.md
  - pages/endpoints/patient-routes.md
confidence: high       # high|medium|low — for LLM-inferred claims
---
```

### 6. Distinction from V2's existing outputs

V2 today produces structured records (JSON, TSV) keyed by symbol or
endpoint. The wiki produces *prose* — explanatory text that synthesizes
multiple records, captures intent the records don't carry, and tracks
the *interpretation* across time. A `services/PatientService.md` page
isn't reducible to V2's extraction output; it includes "what this
service is for", "why it exists", "what's surprising about it",
"contradictions noted", "open questions" — content that requires LLM
judgment and accumulates with each ingest.

## How it cooperates with V2

1. User runs V2 extraction on a target repo (existing flow, unchanged).
2. User runs `wiki init <target>` — scaffolds `.wiki/`, writes a starter
   `schema.md` with default page-type conventions.
3. User runs `wiki ingest <target> --source v2-extraction` — LLM reads
   V2's structural output, drafts initial service/endpoint/entity pages,
   writes the index, appends log.
4. User reviews pages, corrects claims, optionally adds notes.
5. As the codebase evolves, user runs `wiki ingest <target> --source
   git-range HEAD~10..HEAD` — LLM updates pages for changed code, flags
   contradictions where new code disagrees with prior pages, appends log.
6. User queries via `wiki query` for synthesis answers ("what services
   write to the orders table?") — LLM reads index → relevant pages →
   answers with citations.
7. Periodically: `wiki lint` — surface stale pages, orphans, gaps.

## Constraints

- **Wiki lives in the target repo, not in standards-extractor.**
  `<target>/.wiki/` keeps the artifact next to the code it describes;
  it can be committed to that repo or `.gitignore`'d per the user's
  preference.
- **Pages are prose-first, machine-friendly second.** Frontmatter
  enables tooling, but the body is what the user reads.
- **Cross-links are `[[wikilinks]]`** — Obsidian-compatible, plain
  markdown viewers degrade gracefully.
- **No graph DB.** This is a markdown-and-frontmatter system. We
  already have V2's structural store for graph-shaped queries.
- **The schema co-evolves with the user.** `schema.md` is editable;
  the LLM reads it on every ingest and follows its conventions.
- **Ingest is incremental.** Re-ingesting the same source should be a
  near-noop (only updates pages where new info contradicts or extends
  existing claims).
- **Confidence is tracked.** LLM-inferred claims carry a
  `confidence: low|medium|high` marker so users can see what's
  speculative.

## Outputs

| Artifact | Lives in | Status |
|---|---|---|
| `src/wiki/` Python module | this repo | new |
| `POST /api/v1/wiki/*` endpoints | `src/api/wiki_routes.py` | new |
| `python -m src.cli wiki ...` | `src/cli.py` | new subcommand |
| Wiki artifact | `<target>/.wiki/` | generated per target |
| `haikai-profiles/default/commands/wiki-*` skills | this repo | optional, Phase 4 |

## Out of scope

- **Visual graph view** like Obsidian's. Use Obsidian itself if needed.
- **Multi-user concurrent editing.** Single-user assumption; concurrent
  writes are git's problem.
- **Auto-publishing wiki to a static site.** Future spec; markdown is
  inherently publish-ready.
- **Vector embeddings for semantic search.** BM25 + grep is enough at
  the page-count scale we expect (~hundreds per medium repo). Add later
  if needed.
- **Auto-ingestion on git push.** Manual trigger only in v1.
- **Replacing V2 extraction.** Wiki is additive synthesis.

## Success criteria

1. **Bootstrap on openmrs-core**: `wiki init` + `wiki ingest --source
   v2-extraction` produces a navigable wiki with at least one page per
   discovered service, endpoint group, and data entity. Pages contain
   prose synthesis, not just structured dumps. Index.md catalogs
   everything. Log.md has a single ingest entry.
2. **Bootstrap on spring-petclinic**: same flow produces a wiki where
   `services/OwnerService.md`, `entities/Owner.md`, and
   `endpoints/owner-routes.md` are all present and cross-linked.
3. **Query**: `wiki query openmrs-core "what writes to the
   patient_identifier table?"` returns a synthesis answer citing
   relevant service and entity pages by path.
4. **Incremental ingest**: after editing one source file in petclinic
   and running `wiki ingest --source git-range HEAD~1..HEAD`, only
   pages relevant to the changed file are updated. Log records the
   ingest. Untouched pages remain byte-identical.
5. **Lint detects stale pages**: deleting a referenced symbol from
   source and running `wiki lint` flags the stale page.
6. **Comparison vs gitnexus wiki**: side-by-side run on openmrs-core
   produces a qualitatively richer artifact (synthesis prose, captured
   decisions, cross-cutting architecture pages) vs gitnexus's
   template-driven graph dump. Quantify by hand-rated usefulness on
   3 sample queries.
