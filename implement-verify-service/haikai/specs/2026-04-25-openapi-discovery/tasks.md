# Tasks: OpenAPI Discovery (Skill + Parser)

## Phase 1 — Parser

- [ ] T1.1: `parse_openapi_spec(file_path, source) -> list[RouteEntry]` in `src/ast/v2/queries/configs.py`
  - YAML/JSON auto-detect (file extension + content sniff)
  - Swagger 2.0 vs OpenAPI 3.x detection (`swagger:` vs `openapi:` field)
  - Walk `paths` block; emit one RouteEntry per (verb, path)
  - Carry through `operationId` → `RouteEntry.handler`
  - Reject non-spec files (no `paths:` + no `swagger:`/`openapi:`)
- [ ] T1.2: Register in `PARSERS` dict
- [ ] T1.3: Add to `src/ast/v2/playbook_schema.py` allowed values for `parser:` field
- [ ] T1.4: Smoke-test on `oas_docs/output/kibana.yaml` — must return 596 ops
- [ ] T1.5: Smoke-test on a Swagger 2.0 file (find one in petclinic? otherwise synth)

## Phase 2 — Generic stack playbook

- [ ] T2.1: Create `playbooks/stacks/openapi-driven.yaml`
  - Detection: any `*.yaml`/`*.json` at common spec paths
    (`oas_docs/`, `openapi/`, `docs/api/`, `api/`, root)
  - Compose: empty (this stack adds the openapi parser, not other playbooks)
  - Add an extract step using `parse_openapi_spec` with broad file_glob
- [ ] T2.2: Wire stacks into `discover()` so this stack runs alongside detected playbooks
- [ ] T2.3: Verify on Kibana: stack matches → parser fires → 596 endpoints emitted

## Phase 3 — Per-framework integration

- [ ] T3.1: Add `openapi_spec` extract step to `playbooks/frameworks/kibana.yaml`
  pointing at `oas_docs/output/*.yaml` (more specific than the generic stack)
- [ ] T3.2: Identify other repos in the 50-set that ship OpenAPI specs:
  shopware, akeneo-pim, strapi, dotcms, gerrit (review their repo trees)
- [ ] T3.3: Add similar steps to those playbooks where a spec exists

## Phase 4 — Skill (REMOVED — see spec.md, not needed)
~~Detection is content-sniffable; no LLM judgment required. Original
spec over-designed. Phases 4-6 below preserved as historical record.~~

## ~~Phase 4 — Skill~~ (skipped)

- [ ] T4.1: Create `haikai-profiles/default/commands/discover-openapi/single-agent/discover-openapi.md`
- [ ] T4.2: Skill instructions (Karpathy style: deterministic checks first, LLM judgment only where needed):
  - Step 1: deterministic glob for `**/openapi*.{yaml,json}`, `**/swagger*.{yaml,json}`, `oas_docs/**/*.yaml`, `**/api/**/*.yaml`
  - Step 2: read first 50 lines of each candidate (LLM tool: `read_source`)
  - Step 3: LLM judgment — which are real specs vs examples/fixtures/schemas?
  - Step 4: if multiple real specs, pick canonical (manifest hints, file size, last-modified date)
  - Step 5: call `parse_openapi_spec` on the chosen file
  - Step 6: return endpoints; if non-standard path, propose a playbook update
- [ ] T4.3: Skill output shape: same EndpointInfo[] V2 expects + a one-line summary

## Phase 5 — Discovery integration

- [ ] T5.1: Add Phase-10.5 hook in `src/ast/v2/discovery_agent.py`:
  fires when `endpoints == 0` AND no openapi_spec parser-step has matched yet
  AND `llm_client` is present
- [ ] T5.2: Skill invocation similar to existing Phase 10/11 pattern
- [ ] T5.3: Track in `llm_call_log` like Phase 10/11

## Phase 6 — Merger priority

- [ ] T6.1: When both `openapi_spec` and `call_args` produced endpoints in the
  same merge, prefer the openapi entries (set higher per-playbook priority)
- [ ] T6.2: Update `multi_framework_merger.DEFAULT_FRAMEWORK_PRIORITY` so a
  framework's `openapi_spec` step beats its own `call_args` step

## Phase 7 — Validation

- [ ] T7.1: Kibana V2 reaches **596 endpoints** (canonical OpenAPI count)
- [ ] T7.2: 50-repo benchmark: any repo with a shipped spec uses it
- [ ] T7.3: No regression on existing strong repos
  (petclinic 17/17, drupal 845, redmine 409, jenkins 315, ...)
- [ ] T7.4: Document expected gain: ~5-8 of the 50 repos likely ship OpenAPI

## Phase 8 — Done criteria

- [ ] T8.1: parser tested on Kibana, Swagger 2.0 sample, OpenAPI 3.0 sample, OpenAPI 3.1 sample
- [ ] T8.2: skill tested on Kibana (well-known path), and on a synthetic repo with non-standard path
- [ ] T8.3: stack catches OpenAPI specs in repos that have NO playbook
- [ ] T8.4: STATUS.md updated with new artifact paths
