# V2 extraction pipeline

Playbook-driven framework detection + endpoint extraction. Lives in `src/ast/v2/`. All 11 phases implemented as of branch `feature/agentic-discovery-v2` (per `src/ast/v2/STATUS.md`).

## What's different from V1

V1 ([[agentic-discovery]]) discovers endpoints by running an LLM loop against the [[structural-store]]. V2 inverts the order: try **deterministic playbooks first**, fall back to LLM only when nothing matches. Side-by-side trade-off: [[../comparisons/v1-vs-v2-discovery]].

| | V1 (agentic) | V2 (playbook + fallback) |
|---|---|---|
| Speed | LLM-bound (seconds-minutes per repo) | Mostly deterministic (sub-second on known frameworks) |
| Coverage | Any framework the LLM knows | 18 framework playbooks + 2 stack playbooks shipped |
| Failure mode | Hallucinated endpoints | Empty result → LLM fallback → if still empty, prompt to author a new playbook |
| Cost | One LLM call per repo per question | LLM only on fallback or unknown stacks |

V2 keeps the [[ast-vs-llm-split]] intact: playbooks are *data*, the executor is generic, framework patterns live in YAML.

## The 11 phases

| Phase | Item | Lives in |
|---|---|---|
| 1 | Lazy queries (imports/index/inheritance/files/cache) | `src/ast/v2/queries/` |
| 2 | Annotations via tree-sitter `.scm` files (java/python/ts/csharp/php/ruby) | `src/ast/v2/queries/annotations.py` + 7 `.scm` |
| 3 | Call_args via `.scm` (go/ts/python/php) | `src/ast/v2/queries/call_args.py` + 4 `.scm` |
| 4 | Config parsers (rails_dsl, django_urls, symfony_yaml, drupal, strapi, web_xml, spring_xml) | `src/ast/v2/queries/configs.py` |
| 5 | Framework detector (confidence + multi-signal + language gate) | `src/ast/v2/framework_detector.py` |
| 6 | Pydantic playbook schema + 18 framework playbooks + 2 stacks | `src/ast/v2/playbook_schema.py` |
| 7 | Playbook executor (annotations / call_args / configs / method_decls / files) | `src/ast/v2/playbook_executor.py` |
| 8 | Multi-framework merger (dedup + conflict_rules + transport profile) | `src/ast/v2/multi_framework_merger.py` |
| 9 | Independent verifier (per-language regex + per-playbook YAML rules) | `src/ast/v2/verifiers/independent_regex.py` |
| 10 | LLM fallback (lightweight, retry-on-empty, evidence_globs) — uses [[llm-client]] | `src/ast/v2/llm_fallback.py` |
| 11 | Playbook author CLI + auto-trigger on empty + review CLI | `src/ast/v2/playbook_writer.py`, `scripts/{propose,review}_playbook.py` |

## Entry points

- **Single repo:** `src.ast.v2.discovery_agent.discover(project_root, snapshot_path, ...)`
- **Benchmark harness:** `scripts/run_v2_50_repos.py`
- **Playbook author:** `python scripts/propose_playbook.py <repo>`
- **Playbook review:** `python scripts/review_playbook.py [name] [--promote|--reject]`

## Tree-sitter `.scm` query files

11 hand-authored query files at `src/ast/v2/tree_sitter_queries/`:

```
java/annotations.scm
python/{decorators,call_args}.scm
typescript/{decorators,call_args}.scm
csharp/attributes.scm
php/{attributes,annotations,call_args}.scm
ruby/call_args.scm
go/call_args.scm
```

All wired through `src/ast/v2/tree_sitter_runner.py` (LRU-cached Query API, language-module dispatch).

## Why two pipelines coexist

V1 still handles interaction discovery (`src/ast/interaction_discoverer.py` — DB calls, message bus, HTTP clients). V2 currently focuses on endpoint discovery. The interaction equivalent is on the roadmap but not yet implemented as a V2 path.

## Cross-references

- [[ast-vs-llm-split]] — V2 honors the same rule: playbook YAML is data, executor is generic
- [[structural-store]] — V2 reads structural store via lazy queries
- [[agentic-discovery]] — V1 discovery loop, the alternative path

## Sources

- `src/ast/v2/STATUS.md` — phase-by-phase status doc
- `src/ast/v2/` — implementation
- [[../../raw/2026-05-04_codebase-walk]]
