---
description: Tree-sitter parse of the repo. Sole source of truth for record locations.
type: tool
version: 1.0
encoding: UTF-8
---

# AST Index Builder (spec)

> See [`../architecture.md`](../architecture.md) — Step 3 of the pipeline. Everything downstream trusts this index absolutely.

<ai_meta>
  <rules>Deterministic. No LLM. Output is canonical and immutable for the run.</rules>
</ai_meta>

## Overview

<purpose>
  - Parse every supported file in repo_path.
  - Persist a queryable index used by ast_query and post_check.
</purpose>

<inputs>
  - repo_path
  - language_config (which grammars to load)
</inputs>

<output_schema>
  sqlite at out/ast/repo.idx:
    files(file, lang, sha, mtime)
    nodes(id, file, lang, kind, name, start_line, end_line, parent_id, exported, signature, hash)
</output_schema>

<required_queries>
  - by kind
  - by file glob
  - by symbol name
  - has(file, start_line, end_line) → bool
  - children(node_id)
</required_queries>

<process_flow>

<step number="1" name="enumerate">
  <instructions>Walk repo respecting .gitignore. Skip binaries, generated files, vendored deps.</instructions>
</step>

<step number="2" name="parse">
  <instructions>
    Select grammar from language_config; parse; insert nodes.
    On unsupported language: emit ONE warning per language, then skip.
  </instructions>
</step>

<step number="3" name="finalize">
  <instructions>VACUUM + ANALYZE. Verify required_queries all work before exiting.</instructions>
</step>

</process_flow>
