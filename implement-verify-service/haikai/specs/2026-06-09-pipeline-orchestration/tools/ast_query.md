---
description: Mechanical candidate lookup over the snapshot (code path A).
type: function
version: 2.0
encoding: UTF-8
---

# AST Query (spec)

> Implemented as `src/pipeline/index.py::AstIndex.query` + the CLI
> `python -m src.pipeline.tools.ast_query --index <snapshot> --filter '<json>'`.
> Updated 2026-06-10 to the shipped filter surface.

<ai_meta>
  <rules>
    MECHANICAL filters only (D1). Semantic values — endpoint, route, handler,
    controller, query, interaction, data_movement — raise SemanticFilterError
    (CLI exit 2). Framework knowledge enters as LLM-SUPPLIED patterns; this
    layer just matches them.
  </rules>
</ai_meta>

<filter_keys all_optional="true">
  - node_kinds: ["function", "method", "class", ...]  — store SymbolKind values
  - name_regex: "save|persist"                        — over symbol names
  - file_glob:  "src/services/*.py"
  - has_decorator: true | false | "<regex>"           — boolean = any decorator;
    a STRING is a regex over decorator NAMES (store flag
    "decorated:Name1|Name2"; e.g. "(Get|Post).*Mapping" — the agent knows the
    framework, the tool greps the names). Old snapshots with a bare
    "decorated" flag degrade to boolean-only.
</filter_keys>

<output>
  JSON array of candidate rows:
  { file, kind, name, scope, signature, line, flags }
</output>

<exit_codes>
  - 0: candidates on stdout
  - 2: bad filter json / semantic filter value / missing snapshot (stderr)
</exit_codes>
