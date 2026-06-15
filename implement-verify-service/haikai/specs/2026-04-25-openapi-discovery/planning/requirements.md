# Requirements — OpenAPI Discovery

## Functional

### F1: OpenAPI parser
- Input: file_path + source string
- Output: `list[RouteEntry]`, one per (verb, path) operation
- Auto-detect YAML vs JSON (extension + content sniff)
- Auto-detect Swagger 2.0 vs OpenAPI 3.0 vs OpenAPI 3.1 (`swagger:` vs `openapi:` field)
- Skip non-spec files silently (return `[]`)
- Carry `operationId` → `RouteEntry.handler`
- Apply `basePath` (Swagger 2.0) / first server URL (OpenAPI 3.x) as path prefix

### F2: Generic stack
- New `playbooks/stacks/openapi-driven.yaml` triggers on common spec paths
- Detects: `oas_docs/output/*.{yaml,json}`, `openapi/**/*.{yaml,json}`,
  `docs/api/**/*.{yaml,json}`, `*.openapi.{yaml,json}` at root
- Composes one extract step using the openapi parser
- Conservative globs (avoid example/fixture dirs by default)

### F3: Per-framework playbook integration
- Kibana playbook gets an explicit `openapi_spec` step pointing at
  `oas_docs/output/*.yaml`
- Stripe / GitHub / etc. playbooks (when added) follow same pattern

### F4: Skill `/discover-openapi`
- Tool-driven: `glob`, `read_source`, `list_directory_names`, `read_manifest_contents`
- Workflow:
  1. Glob common spec extensions
  2. Sniff first 50 lines of each candidate
  3. LLM judges: real spec or noise?
  4. Pick canonical when multiple
  5. Call `parse_openapi_spec` for chosen
  6. Return endpoints + (optional) playbook patch suggestion
- Skill output: same `EndpointInfo[]` shape as other discovery sources

### F5: Discovery integration
- `discover()` runs openapi steps as part of normal extract loop
- If endpoints == 0 after deterministic pass AND llm_client present
  AND no openapi_spec step matched → fire `/discover-openapi` skill
- Track skill invocations in `llm_call_log`

### F6: Merger priority
- `openapi_spec`-sourced endpoints beat `call_args`-sourced for same (verb, path)
- Configurable per-playbook step (priority field)

## Non-functional

### N1: Performance
- Parser: <100ms per spec file (Kibana's 120k-line spec parses in <2s)
- Skill: <30s end-to-end on big repo (Kibana ~100 candidate files to inspect)

### N2: No new dependencies
- Use existing `yaml` and `json` modules
- Skill uses tools already in V1's TOOLS dict

### N3: No regressions
- petclinic 17/17 unchanged
- redmine ~409 unchanged
- drupal 845 unchanged
- jenkins 315 unchanged

### N4: Determinism
- Parser is fully deterministic
- Skill's pick of canonical spec is reproducible for same input
  (LLM output may vary but content sniff + path heuristics dominate)

## Constraints

### C1: Spec scope
- Only OpenAPI / Swagger format in this iteration
- WADL, RAML, gRPC reflection, GraphQL introspection deferred

### C2: No engine knobs for OpenAPI specifics
- Generic parser, generic skill
- Framework-specific globs in playbook YAML only

### C3: Skill is opt-in via llm_client presence
- Same gate as Phase 10/11 — no LLM client → skill doesn't fire

### C4: Spec parser tolerates partial / malformed specs
- Missing `info:` block: still extract paths
- Malformed operation: skip it, continue with others
- YAML parse error: return `[]`, log warning

## Inputs

- Source files matching `file_glob` from playbook
- The tool list V1 already exposes (no new tools to V1's LLM)

## Outputs

- `RouteEntry` records with: file, line, path, operation, handler, framework
- Skill: same as other discovery skills (writes to standard discovery output)

## Success criteria

1. Kibana V2: 596 endpoints (matches official OpenAPI count exactly)
2. Stack triggers on novel-but-spec-shipping repos with no framework playbook
3. Skill recovers from spec at non-standard path
4. No regressions on existing playbook-strong repos
