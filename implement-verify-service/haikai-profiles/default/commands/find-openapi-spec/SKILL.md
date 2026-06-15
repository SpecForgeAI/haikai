---
name: find-openapi-spec
description: Locate OpenAPI / Swagger specification files in a repository, validate they're real specs by content-sniffing, and report path counts. Use when the user asks to find/check/discover OpenAPI or Swagger specs in any codebase.
---

# Find OpenAPI Spec

This skill finds OpenAPI 3.x and Swagger 2.x specification files in a repo,
content-validates each, and reports a summary.

## When to use

- "Find the openapi spec in <repo>"
- "Does this repo have a swagger file?"
- "What's the canonical openapi spec for this project?"
- "How many endpoints are declared in the openapi spec?"

If the user gives no path, ask once for the repo root. Then proceed.

## Procedure

### 1. Glob candidate paths

Use the Glob tool to search the target repo. These are the conventional
locations, in roughly descending priority:

```
**/openapi.{yaml,yml,json}
**/swagger.{yaml,yml,json}
**/openapi/openapi.{yaml,yml,json}
**/oas_docs/output/*.{yaml,yml,json}
**/api/openapi.{yaml,yml,json}
**/docs/api/openapi.{yaml,yml,json}
**/api-docs/*.{yaml,yml,json}
**/{schema,api-schema}.{yaml,yml,json}
```

Skip `node_modules/`, `vendor/`, `dist/`, `build/`, `.git/` — these often
contain cached or example specs that aren't the project's own.

### 2. Content-sniff each candidate

A file is a real spec if its top-level YAML/JSON has either:
- `openapi: 3.x` (or any string starting with `3.`), OR
- `swagger: "2.0"` (or any 2.x)

Read the first ~100 lines (Read tool with `limit: 100`) and check for these
keys at the top level. Reject files that don't match — many `.yaml` files
sit at these paths but aren't specs (e.g. CI configs, docker-compose).

### 3. Pick canonical (when multiple match)

If more than one valid spec is found, prefer in this order:
1. The one whose filename matches the repo name (e.g. `kibana.yaml` for the kibana repo)
2. The largest by path-count (more `paths:` entries usually means primary spec)
3. The shallowest path

Mention the others as "alternates" — don't drop them silently.

### 4. Count operations

For each valid spec, count operations as: every (path, method) pair under
`paths:` where method is one of `get|put|post|delete|options|head|patch|trace`.
Don't count `parameters:` or `summary:` — those aren't operations.

### 5. Report

Output a table:

```
Found N spec(s) in <repo>:

  Path                                  Version  Title             Operations
  ------------------------------------- -------- ----------------- ----------
  oas_docs/output/kibana.yaml           3.0.3    Kibana API              611
  oas_docs/output/kibana.serverless.yaml 3.0.3   Kibana Serverless API   480

Canonical: oas_docs/output/kibana.yaml (matched repo name)
```

If zero valid specs found, say so explicitly: "No OpenAPI/Swagger spec
files found in <repo> at any conventional location." Don't guess that
the project has no API; just report what was searched.

## Notes

- This is a search-only skill. It does NOT generate specs from source
  code, does NOT call any LLM, and does NOT modify files.
- For YAML, the top-level key check works without parsing the full file —
  just look for `^openapi:` or `^swagger:` in the first lines (after
  optional comments). For JSON, the spec is usually in the first 50 lines
  too; if it's minified, parse it.
- Watch for **YAML/JSON refs** (`$ref: '...'`). A spec that splits across
  many files (`paths/users.yaml`, `paths/orders.yaml`) is still ONE spec —
  the entry point is the file with the top-level `openapi:` key.
- A `swagger.yaml` at the repo root that's actually Swagger 2.0 is still
  valid — don't reject it just because the filename has "swagger" not
  "openapi".

## Related (in this project)

If working inside the standards-extractor repo, this skill complements
the parser at `src/dep/openapi.py` (which does the same detection
mechanically) and the `openapi_spec` extract step in framework
playbooks (e.g. `playbooks/frameworks/kibana.yaml`). For a generic
report on any repo, use this skill; for endpoint extraction inside
the V2 pipeline, use the playbook.
