# Planning notes — OpenAPI Discovery

## Context

V2 today extracts endpoints from source code via playbooks (`call_args`,
`annotations`, `configs`, `method_decls`, `files`). For Kibana it produces
2,597 — but Kibana's own `oas_docs/output/kibana.yaml` (the OpenAPI spec the
project ships and publishes) says 596.

The OpenAPI spec is **the canonical answer** for any project that publishes
one. Re-deriving from source is reverse-engineering a thing the project has
already declared.

## Key decisions

### D1: Two layers — parser + skill (not one or the other)
**Rationale:** the parser handles the 90% case (project ships one canonical
spec at a discoverable path). It's deterministic, fast, no LLM cost. The
skill handles the remaining 10% (specs in non-standard locations, multiple
specs to disambiguate, fragmentary specs, etc.).
**Alternative considered:** skill-only. Rejected — wastes LLM on the easy
case.

### D2: Generic parser, framework-specific globs
**Rationale:** OpenAPI is a format, not a framework. The parser doesn't
care which framework emitted it. Globs (where to look) live in playbook
YAML — Kibana's playbook says `oas_docs/output/*.yaml`, Stripe's would say
`api/openapi/*.json`, etc.
**Implication:** zero engine-level Kibana logic.

### D3: Spec-detection isn't extension-based
**Rationale:** lots of `*.yaml` files in any repo aren't OpenAPI specs.
Sniff the content for `swagger:` or `openapi:` or `paths:` keys before
treating as a spec. False positives here would emit 100s of fake endpoints.
**Implication:** parser quietly returns `[]` for non-spec YAML.

### D4: Skill uses existing tools, no new ones
**Rationale:** we already have `glob`, `read_source`, `list_directory_names`,
`read_manifest_contents`. The skill is just an LLM-driven flow over them.
Adding a `parse_openapi_spec` tool for the LLM to call is the only new
surface, and it just wraps the parser.
**Why this matters:** the skill stays small, easy to audit, and benefits
from any future improvements to the existing tool set automatically.

### D5: Parser priority over call_args in merger
**Rationale:** when both produce endpoints for the same framework, OpenAPI
is authoritative — it's what the project says it serves. `call_args` is a
heuristic over source code.
**Mechanism:** per-step priority in playbook YAML, picked up by merger.

### D6: Generic stack as the "any spec, anywhere" net
**Rationale:** repos with no framework playbook can still benefit. A stack
called `openapi-driven` detects a spec file at common paths and runs the
parser, regardless of framework.
**Limit:** broad globs increase false-positive risk; stack is conservative
(only well-known paths like `oas_docs/`, `openapi/`, `docs/api/`).

### D7: Skill triggers when parser found nothing
**Rationale:** if the playbook's openapi_spec step matched files, we already
have authoritative data — no LLM needed. Skill only fires when:
   - playbook has no openapi_spec step OR
   - playbook's globs missed the actual spec location
This mirrors the Phase 10/11 trigger logic.

### D8: Spec discoveries can propose playbook updates
**Rationale:** if the skill finds a spec at a non-standard path, the next
deterministic run should find it without LLM. Skill emits a playbook patch
suggestion (similar to Phase 11) — staged for human review.

## Risks tracked

| Risk | Likelihood | Mitigation |
|---|---|---|
| Spec is incomplete (only documents public API, source has more internal routes) | High | Parser reports its source so the merger can decide; skill flags it in notes |
| Spec is generated from source and out of date | Medium | Compare spec mtime vs source mtime; flag if stale |
| Non-OpenAPI YAML files mistaken for specs | Medium | Strict content-sniff (D3); reject silently if no `paths:`/`openapi:`/`swagger:` |
| Multiple specs in one repo (Kibana ships kibana.yaml + kibana.serverless.yaml) | Low | Skill picks canonical via manifest hints; emits both with provenance if unsure |
| Spec format edge cases (Swagger 2.0 with anyOf, OpenAPI 3.1 callbacks) | Low | Parser ignores what it doesn't understand; logs a note |
| LLM mis-identifies an example fixture as the canonical spec | Medium | Skill validates by reading first ~50 lines; rejects files in `examples/`, `fixtures/`, `tests/` paths |

## Sequencing rationale

Phase 1 (parser) ships the most value at lowest cost. After Phase 1 +
Phase 3.1 (kibana playbook update), we've already moved Kibana from
2,597 → 596 — the headline win.

Phase 2 (generic stack) extends to repos without a playbook for
near-zero effort.

Phase 4-5 (skill + integration) covers the long tail.

Phase 6 (merger priority) is a small but important correctness fix.

Phase 7-8 are validation / documentation.

## Effort estimate (one engineer)

| Phase | Effort | Notes |
|---|---|---|
| 1 | 0.5 day | parser + tests |
| 2 | 0.5 day | stack file + wiring |
| 3 | 0.5 day | per-framework integration |
| 4 | 0.5 day | skill markdown |
| 5 | 0.5 day | discover() integration |
| 6 | 0.25 day | merger priority |
| 7 | 0.5 day | benchmark validation |
| 8 | 0.25 day | docs |
| **Total** | **~3.5 days** | |

## Open items

- **O1**: Should parser carry `tags` from OpenAPI as `EndpointInfo.framework`?
  e.g. tagged "auth" → framework="auth"? Could help downstream filtering. Defer until concrete need.
- **O2**: Should the skill stage a "confirmed canonical spec at path X" memory
  so future runs of any similar repo (same manifest fingerprint) skip the LLM?
- **O3**: Multi-spec repos: do we emit endpoints from BOTH or pick one?
  Current proposal: emit from canonical only, skill can override.
- **O4**: For repos that BOTH ship a spec AND have a hand-tuned playbook
  with call_args extraction — do we run both and pick via priority, or run
  only one to save time? Per D5: run both, prefer openapi.
