# V1 + V2 Discovery — Current State (2026-04-25)

> Picks up from the original V2 spec at
> `haikai/specs/2026-04-20-agentic-discovery-v2/spec.md` (lives on the
> `feature/benchmark-optimization` branch). This file captures what's
> happening NOW on `feature/agentic-discovery-v2`: both pipelines coexist;
> tests run; outstanding issues; next steps.

## Goals

### V1 — agentic LLM discovery (the original)
- One LLM (Claude Sonnet via local proxy) given tool access (read_file,
  grep, glob, ctags/tree-sitter readers, write+run a parser script).
- Investigates the codebase multi-turn, writes a Python parser, runs it,
  iterates until verification accepts.
- Strength: very wide framework coverage (works on whatever the model
  understands).
- Weakness: every repo costs LLM tokens; some hangs; output quality varies
  with model + prompt state.
- **Goal here:** keep V1 working on this branch as the LLM-driven safety
  net for repos V2 can't deterministically extract. Use it as the
  reference baseline for accuracy comparison.

### V2 — deterministic playbooks + agentic fallback
- Playbooks (YAML) describe each framework's extraction recipe using a
  fixed set of generic engine primitives (annotations / call_args /
  configs / method_decls / files).
- Multi-framework: detection returns a list, all matching playbooks run,
  merger dedupes.
- Phase 10 LLM fallback when nothing matched.
- Phase 11 playbook writer agent when no framework detected — proposes
  a new YAML for human review and promotion.
- **Goal here:** mechanical precision on covered frameworks (no LLM cost),
  and an agentic loop that grows the playbook DB over time. Engine MUST
  remain framework-agnostic — playbooks encode framework conventions, not
  engine code.

### How they coexist on this branch
- V1 lives in `src/ast/{endpoint_discoverer,discovery_loop,enrichment_tools,...}.py`
- V2 lives in `src/ast/v2/`
- They share `src/llm_client.py`, `src/ast/pipeline.py`,
  `src/ast/enrichment_tools.py`
- Same proxy (localhost:3456/v1 → Claude Sonnet/Haiku)

## What's done (this branch's deltas vs the V2 spec)

### Phases delivered
| Phase | Spec scope | Status here |
|---|---|---|
| 1 | Lazy queries (imports/index/inheritance/files/cache) | ✅ |
| 2 | `.scm`-driven annotation extraction (Java, Python, TS, C#, PHP attrs, PHP doc, Ruby) | ✅ — all 7 .scm files wired via `tree_sitter_runner.py` |
| 3 | `.scm`-driven call_args extraction (Go, TS, Python, PHP) | ✅ — all 4 wired |
| 4 | Config parsers (rails_dsl, django_urls, symfony_yaml, drupal_routing_yml, strapi_routes_json, web_xml, spring_xml) + `query: files` for page-based PHP | ✅ |
| 5 | Framework detector with confidence + multi-signal + language gate | ✅ — `framework_detector.py` |
| 6 | Pydantic schema, stack composition, 18 framework playbooks + 2 stacks | ✅ |
| 7 | Playbook executor handles all 5 query types; per-playbook verb_annotations / path_only_annotations / verb_via_methods_arg | ✅ — engine no longer hardcodes Spring/JAX-RS/etc. |
| 8 | Multi-framework merger (dedup + conflict_rules + transport profile) | ✅ |
| 9 | Independent verifier per language; reads per-playbook `verification:` blocks | ✅ |
| 10 | LLM fallback (lightweight, retry-on-empty, evidence_globs hints, sonnet+streaming) | ✅ |
| 11 | Playbook writer + auto-trigger when discover() returns 0 + review CLI | ✅ |

### Engine extension points added (generic, encoded in YAML)
- `query: files` (page-based routing)
- `path_from: file_path | class_name_strip | method_name_strip`
- `class_pattern` (restrict method_decls to enclosing class regex)
- `exclude_globs` (drop unwanted matches in files step)
- `evidence_globs` (playbook hint to LLM where routes live)
- Object-key path extraction in `_collect_args` — generic capability that
  reads `path:`/`url:`/`route:`/`uri:` from object-literal first args
  (Hapi, Kibana, Fastify object form).

### Cross-cutting infra
- **Streaming with inactivity timeout** in `LLMClient` — solves V1's
  cli-delegated hangs on big repos. Set `stream_inactivity_timeout` +
  `stream_wall_timeout` in config to opt in.
- **`AST_SKIP_CALLS=true`** env var — bypasses tree-sitter call
  resolution (V2 doesn't need `_calls.txt`); cuts huge-Java-repo time.
- **Adaptive 2-tier file scope** in `run_v2_50_repos.py` — TIER1
  (routing-suspect: controllers, *.routing.yml, web.xml, ...) capped at
  3000; TIER2 (everything else) capped at 1500.
- **Two new tools** in V1's `TOOLS`: `read_manifest_contents`,
  `list_directory_names`. V2's `_evidence_pack` uses the same primitives.
- **`ImportsQuery.files_importing` tightened** — was substring match
  (matched `'express'` against `'@kbn/expressions-plugin'`); now exact
  package or `<pkg>/` subpath.

## Tests we run

### Single-repo smoke (after every change)
- `spring-petclinic` (Java/Spring): expected 17/17. V1 and V2 both pass.
- `nestjs-realworld` (TS/NestJS): expected 21/21. V2 passes (V1 not run).
- `redmine` (Ruby/Rails): V2 finds 409 unique vs grep 480 (~85%).
- `shopware` (PHP/Symfony with `#[Route]`): V2 finds 478 unique.

### 50-repo benchmark
`scripts/run_v2_50_repos.py` runs sequentially; per-repo subprocess with
timeout; writes `temp/v2_50_results/row_<repo>.json` per repo + a final
canonical box-drawing comparison table. Latest results in
`temp/v2_50_results/all_*.json`.

### Single-repo deep dive (Kibana)
- V1 cli-delegated (sonnet, streaming, AST_SKIP_CALLS=true): **2,272
  endpoints in 36 min**.
- V2 (post object-key extraction): expected ~107 endpoints once the new
  engine extension is exercised end-to-end (test in flight at time of
  writing).

## Issues faced (chronological-ish; remaining items called out)

### Resolved this round
- ❌→✅ V1 was unreachable on this branch — the V1 fixes (file-output
  protocol + 12 commits) lived only on `feature/benchmark-optimization`.
  Cherry-picked the relevant files; kept V2 untouched.
- ❌→✅ V1 hung on Kibana — fixed-180s SDK timeout × 4 retries = 12 min
  of dead waiting. Replaced with streamed inactivity-only timeout; V1
  Kibana now completes.
- ❌→✅ Express playbook false-positive on Kibana — `imports_match`
  substring matched `@kbn/expressions-plugin`. Changed to exact-package
  or subpath match.
- ❌→✅ Express playbook false-positive via `manifest_contains` —
  removed; the `"express"` substring is too generic to be useful.
- ❌→✅ ctags timed out on huge multi-module Java repos (alfresco,
  keycloak, fineract). `AST_SKIP_CALLS=true` bypasses the slow call
  resolution; alfresco/keycloak now run (alfresco 11, keycloak 486).
- ❌→✅ Big disk usage from snapshot dirs — cleaned manually; runner now
  reuses the same dir.
- ❌→✅ Phase 11 wasn't auto-triggering — wired into `discover()` to fire
  whenever `endpoints == 0 AND frameworks == []`. 9 staged proposals
  exist now.
- ❌→✅ Per-playbook `verification:` blocks were a no-op — now actually
  re-grep the repo and compare to the playbook's emitted count.

### Open
- **Page-based-php playbook over-aggressive on Laravel** — when both
  Laravel and page-based-php detect on the same repo (firefly-iii,
  monica, invoiceninja), the merger collapses Laravel routes against
  the file-emit, dropping count to ~0. Need to gate page-based-php as
  fallback-only or use priority/conflict-rule.
- **Mastodon Rails over-restrict** — went 366 → 103 after honoring
  `only:`/`except:`. Could be parser bug or correct semantics; needs
  manual ground-truth check.
- **Phase 10 single-prompt insufficient on Kibana-scale repos** —
  sonnet returned `[]` in 5.5 min from a 14 KB evidence pack. V1's
  multi-turn cli-delegated path got 2,272 in 36 min on the same repo.
  V2's Phase 10 is fundamentally lighter than V1.
- **`_evidence_pack` glob list is fixed in code** — playbook can
  contribute evidence_globs but the default glob list is hardcoded.
- **Phase 10/11 trigger is `endpoints == 0`** — Kibana with 69
  incidental matches doesn't fire either; partial coverage is silent.
- **Some playbooks still have generic detection FPs** (yii2 detected
  on espocrm/owncloud via files glob; still emits 0).

## Latest 50-repo numbers (current canonical view)

Most recent per-repo `row_*.json` files in `temp/v2_50_results/` —
mixed dates because each repo is its own subprocess. Headlines:

- **≥80% of grep**: petclinic (100%), nestjs (100%), oatpp (100%),
  drupal (98%), dotcms (98%), fineract (90%), redmine (85%),
  jenkins (87%), flarum (87%), mediawiki (74%), piwigo (96%),
  shopware (73%), xwiki (107%), keycloak (88%) — **14 repos**
- **30–80%**: BroadleafCommerce, ampache, bonita, camunda, mantisbt,
  akeneo, mastodon, passbolt — **8 repos**
- **0**: ~14 repos (kibana before this commit; gerrit; gitea after
  Phase 10 variance; opensearch; mautic; monica; opencart; orangehrm;
  phpbb; sonarqube tiny; suitecrm tiny; wordpress; odoo; beer-shop-go)

Total V2 unique endpoints: ~8,100. V1 sonnet baseline: 21,850.
Grep ground truth: 20,663.

## Next steps (priority order)

1. **Confirm object-key extraction lifts Kibana V2** (run in flight) —
   expected ~107 endpoints from `router.versioned.get({path:...})`
   variants. If yes, also benefits Hapi-based codebases.
2. **Re-run full V2 50-repo benchmark with sonnet+streaming on Phase
   10/11** — current canonical numbers are from haiku without streaming;
   sonnet should both find more (Phase 10) and propose better (Phase 11).
3. **Fix page-based-php / Laravel interaction** — make page-based-php a
   priority-low fallback, or add a conflict_rule that drops it when
   Laravel detects.
4. **Loosen Phase 10/11 trigger** to also fire when verifier reports
   low coverage (e.g. `extractor_count < 0.3 × verifier_count`). Single
   conditional in `discovery_agent.discover()`. Catches Kibana-style
   partial-coverage cases.
5. **Review the 9 staged playbook proposals** in `playbooks/proposed/`
   (directus, gitea, kanboard, kibana, kratos, mautic, opencart,
   php-mvc, phpbb). Promote good ones; reject overfit ones.
6. **kibana / moodle / strapi remaining hard cases** — kibana now
   covered by object-key; moodle ctags-timeout (try smaller tier1 cap or
   skip ctags); strapi routes/*.json not in repo head (different repo
   structure than expected).
7. **V1 streaming as default for big repos** — adjust V1 invocations
   throughout to use streaming so users don't have to know to pass it.
8. **Document playbook authoring** — `docs/playbook-guide.md` with the
   schema reference + example playbooks for common shapes.

## Where everything lives

```
src/ast/v2/                          ← V2 engine
src/ast/v2/STATUS.md                 ← V2-specific pickup notes
src/ast/{endpoint_discoverer,         ← V1 (restored from benchmark branch)
        discovery_loop,
        enrichment_tools,
        store, ...}.py
src/llm_client.py                    ← shared; streaming added here
src/ast/pipeline.py                  ← shared; AST_SKIP_CALLS env gate
playbooks/frameworks/                ← 18 V2 playbooks
playbooks/stacks/                    ← 2 V2 stacks
playbooks/proposed/                  ← 9 Phase 11 staged proposals
scripts/run_v2_50_repos.py           ← V2 benchmark runner
scripts/test_consistency_5x.py       ← V1 benchmark runner (cherry-picked)
scripts/{propose,review}_playbook.py ← Phase 11 CLIs
haikai/specs/2026-04-20-agentic-discovery-v2/  ← original V2 spec
                                        (lives on benchmark branch)
haikai/specs/2026-04-25-v1-v2-state/spec.md    ← THIS FILE
temp/v2_50_results/                  ← per-repo + combined run results
```

## Quick-start

```bash
# Run V2 on a single repo with sonnet+streaming
PYTHONIOENCODING=utf-8 PYTHONUTF8=1 AST_SKIP_CALLS=true \
  python scripts/run_v2_50_repos.py kibana

# Run V2 on all 50
python scripts/run_v2_50_repos.py

# Run V1 on a single repo (Python script with snapshot setup)
# See examples in this conversation history; uses
# discover_endpoints(llm_client, project_root, snapshot_path)

# Review staged playbook proposals
python scripts/review_playbook.py
python scripts/review_playbook.py kibana --promote
```
