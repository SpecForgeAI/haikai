# V2 Discovery — Implementation Status

> Pick-up doc for resuming work in a new session. Captures what's built,
> what's open, and where the artifacts live.

## Branch + entry points

- **Branch:** `feature/agentic-discovery-v2`
- **Main runner:** `scripts/run_v2_50_repos.py`  (50-repo benchmark harness)
- **Single-repo entry:** `src.ast.v2.discovery_agent.discover(project_root, snapshot_path, ...)`
- **Phase 11 author CLI:** `python scripts/propose_playbook.py <repo>`
- **Phase 11 review CLI:** `python scripts/review_playbook.py [name] [--promote|--reject]`

## What's implemented

| Phase | Item | Status | Lives in |
|---|---|---|---|
| 1 | Lazy queries (imports/index/inheritance/files/cache) | ✅ | `src/ast/v2/queries/` |
| 2 | Annotations via `.scm`: java/python/ts/csharp/php attributes/php doc/ruby | ✅ | `src/ast/v2/queries/annotations.py` + 7 `.scm` |
| 3 | Call_args via `.scm`: go/ts/python/php | ✅ | `src/ast/v2/queries/call_args.py` + 4 `.scm` |
| 4 | Configs parsers: rails_dsl, django_urls, symfony_yaml, drupal_routing_yml, strapi_routes_json, web_xml, spring_xml | ✅ | `src/ast/v2/queries/configs.py` |
| 4 | `query: files` + `path_from: file_path` (page-based) | ✅ | `playbook_executor.py` |
| 4 | `path_from: class_name_strip` + `class_pattern` (mediawiki-style) | ✅ | `playbook_executor.py` |
| 5 | Framework detector with confidence + multi-signal + language gate | ✅ | `src/ast/v2/framework_detector.py` |
| 6 | Pydantic schema, stack composition, 18 framework playbooks + 2 stacks | ✅ | `src/ast/v2/playbook_schema.py`, `playbooks/{frameworks,stacks}/` |
| 7 | Playbook executor (annotations / call_args / configs / method_decls / files) | ✅ | `src/ast/v2/playbook_executor.py` |
| 7 | Per-playbook `verb_annotations` / `path_only_annotations` / `verb_via_methods_arg` (engine no longer hardcodes Spring/JAX-RS/etc.) | ✅ | YAML + executor |
| 8 | Multi-framework merger (dedup + conflict_rules + transport profile) | ✅ | `src/ast/v2/multi_framework_merger.py` |
| 9 | Independent verifier (per-language patterns + per-playbook YAML verification blocks) | ✅ | `src/ast/v2/verifiers/independent_regex.py` |
| 10 | LLM fallback (lightweight, retry-on-empty, playbook `evidence_globs`) | ✅ | `src/ast/v2/llm_fallback.py` |
| 11 | Playbook writer + auto-trigger when `endpoints == 0 and frameworks == []` + review CLI | ✅ | `src/ast/v2/playbook_writer.py`, `scripts/{propose,review}_playbook.py` |

### `.scm` files (11)

```
src/ast/v2/tree_sitter_queries/
  java/annotations.scm
  python/{decorators,call_args}.scm
  typescript/{decorators,call_args}.scm
  csharp/attributes.scm
  php/{attributes,annotations,call_args}.scm
  ruby/call_args.scm
  go/call_args.scm
```

All 11 are wired through `src/ast/v2/tree_sitter_runner.py` (Query API,
LRU-cached, language module dispatch).

### Engine-level extension points (added during this work)

- `query: files` — emit one endpoint per file matching a glob.
- `path_from: file_path` — derive URL from repo-relative file path.
- `path_from: class_name_strip` — derive URL from enclosing class name.
- `class_pattern` on `method_decls` — restrict to enclosing class regex.
- `exclude_globs` on `query: files` — drop matches before emit.
- `evidence_globs:` on a playbook — hint to Phase 10 LLM where to look.
- Per-playbook `verb_annotations` / `path_only_annotations` / `verb_via_methods_arg` (formerly hardcoded in engine).

### Adaptive file scope (in `run_v2_50_repos.py`)

Two-tier scanning:
- **Tier 1** (route-suspect markers: `controller`, `resource`, `endpoint`, `router`, `handler`, `/routes/`, `routing.yml`, `/api/`, `web.xml`, `urls.py`, `routes.rb`, `routes.php`) — capped at `TIER1_HARD_CAP=3000`.
- **Tier 2** (rest) — capped at `MAX_FILES_PER_REPO=1500`.

Set `AST_SKIP_CALLS=true` to bypass tree-sitter call resolution (V2's
critical path doesn't read `_calls.txt`; this slashes runtime on big Java
repos like alfresco/keycloak).

## Latest 50-repo benchmark — results snapshot

Most recent full run: `temp/v2_50_results/all_20260422_050931.json` (50 rows).
Most recent timeout-retry: `temp/v2_50_results/all_20260422_074657.json` (6 rows).

| Bucket vs grep | Count |
|---|---|
| ≥80% (strong) | 13 (petclinic 100, nestjs 100, oatpp 100, drupal 98, dotcms 98, fineract 90, redmine 85, jenkins 87, flarum 87, mediawiki 74, piwigo 96, shopware 73, xwiki 107, keycloak 88) |
| 30–80% (partial) | 6–8 (BroadleafCommerce, ampache, bonita, camunda, mantisbt, akeneo, mastodon, passbolt) |
| 0 endpoints | ~14 |
| Engine timeout | 2 (kibana, moodle — ctags itself stalls on 7000+ files) |

V2 totals: ~10–11k endpoints across 50 repos vs V1 sonnet's 21,850 vs grep's 20,663. V1 still wider; V2 more precise on covered frameworks.

## Open issues (priority order)

### P0 — engine bugs introduced during this work

1. **`page-based-php` hijacks Laravel apps**
   - Symptom: firefly-iii went 80 → 1, monica 2 → 0, invoiceninja 14 → 5.
   - Cause: `page-based-php` detection fires on Laravel's `public/index.php`. The merger then dedups Laravel routes against page-based file emits and drops most.
   - Fix: gate page-based-php to ONLY fire when no other PHP framework was detected (priority/role mechanism, OR conflict_rules).

2. ~~Mastodon Rails `only:`/`except:` over-aggressive~~ — **CLOSED 2026-04-25, not a bug**
   - Investigation: mastodon/config/routes.rb has 48 `resources` lines, all 48 use `only:` or `except:`. Honouring them correctly = ~103 endpoints (matches V2). Ignoring them = 336 inflated.
   - Grep baseline (591) and V1 (559) both over-count because grep can't honour `only:` either.
   - Conclusion: V2's 103 is the correct Rails-runtime number. The earlier 366 was the bug.

### P1 — extractor/playbook gaps

3. **odoo `@http.route` not parsed**
   - 1514 endpoints lost. `python/decorators.scm` captures dotted decorators but the args-handler doesn't extract the path correctly when the decorator name is dotted.

4. **Laravel chained `Route::middleware([...])->group(fn)`**
   - inner `Route::get()` IS captured by `php/call_args.scm` but gets misdedup'd by page-based-php interference (see P0 #1).

5. **Symfony bundle YAML on mautic**
   - 716 endpoints. Files live in `app/bundles/*/Config/routing.yaml` — not in playbook glob set.

6. **Strapi routes/*.json missed in current strapi clone**
   - The repo head we cloned doesn't contain the routes/*.json files (they live in plugin/example dirs).

### P2 — infrastructure

7. **kibana / moodle ctags timeout**
   - ctags itself stalls on 7000+ files even with `AST_SKIP_CALLS=true`.
   - Fix candidates: batch ctags into chunks of ~1500; OR allow V2 to skip ctags entirely (since it only consumes `_imports.txt`, which tree-sitter writes anyway).

8. **`TIER1_HARD_CAP` per-language tuning**
   - 3000 works for Java multi-module. May need different defaults per language.

### P3 — open-but-known

9. **Phase 10 LLM variance** (gitea was 55/55/0/55 across runs).
   - Retry-on-empty exists but haiku still occasionally returns `[]` even on 2nd attempt.
   - Fix: bump retry to 3, or route to opus on empty.

10. **Several frameworks have NO playbook yet**
    - kratos+gRPC (beer-shop-go), gerrit RestView, kanboard custom dispatch, opencart MVC, phpbb modules, custom moodle WS, custom WordPress plugin tree (which lives outside the wp-core repo).
    - **Phase 11 has staged proposals for: gitea, kanboard, kratos, mautic, opencart, phpbb (in `playbooks/proposed/`).** Run `python scripts/review_playbook.py` to list them; promote with `--promote`.

## Documents to read for context

- `src/ast/v2/STATUS.md` ← this file
- `haikai/specs/2026-04-20-agentic-discovery-v2/spec.md` (lives on `feature/benchmark-optimization` branch — original V2 spec, decisions, tasks)
- `temp/v2_50_results/SUMMARY.md` — first-run benchmark analysis (older numbers; latest is the JSON files dated 04-22)

## Quick-start commands

```bash
# Run V2 on a single repo
python -c "from src.ast.v2.discovery_agent import discover; print(discover('/path/to/repo', '/path/to/snapshot'))"

# Run 50-repo benchmark
PYTHONIOENCODING=utf-8 PYTHONUTF8=1 AST_SKIP_CALLS=true \
  USE_LLM_FALLBACK=1 PROXY_URL=http://localhost:3456/v1 FALLBACK_MODEL=claude-haiku-4-5 \
  python scripts/run_v2_50_repos.py

# Run on a subset
python scripts/run_v2_50_repos.py spring-petclinic redmine drupal

# Propose a playbook for one repo (auto-staged in playbooks/proposed/)
python scripts/propose_playbook.py /path/to/repo

# Review staged proposals
python scripts/review_playbook.py
python scripts/review_playbook.py kratos
python scripts/review_playbook.py kratos --promote
```
