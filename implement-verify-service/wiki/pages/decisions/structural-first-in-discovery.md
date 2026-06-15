# Decision: Structural-first in discovery

Discovery agents (endpoint discoverer, interaction discoverer, V2 LLM fallback) read **structural data first** ([[../concepts/structural-store]]); raw source code is a last resort.

## The rule

For any discovery question — "what endpoints exist?", "what DB writes happen?", "what does this service call?" — the LLM consults:

1. **First:** the [[../concepts/structural-store]] (`_index.txt`, `_calls.txt`, `_imports.txt`, `_inheritance.txt`).
2. **Then:** targeted file reads via tools like `read_source(file, line, ±N)` — narrow windows around specific symbols.
3. **Last:** whole-file reads. Only when steps 1 and 2 don't yield enough.

This is a memory-pinned project rule.

## Why

- **Token economy.** `_index.txt` for a 50,000-file repo is megabytes; the equivalent raw source is gigabytes. The structural store is *already* a high-signal compression of the codebase.
- **Pre-canonicalized.** No whitespace noise, no comments to skim, no dead code branches. Symbol → file:line, call → caller@site → callee. That's it.
- **Cheap repeatability.** The LLM can run `read_index` ten times for ten hypotheses without paying ten times the source-reading cost.
- **Loop convergence.** [[../concepts/agentic-discovery]] only converges fast when the assess step is cheap. Structural-store reads are cheap; full-source reads burn the loop's budget.

## What "last resort" means in practice

Source reads are still allowed — they're a tool the LLM has. The rule is about *order*, not *availability*. A discovery skill that grepped 200 source files before consulting `_index.txt` would be wasting tokens and time.

The skill prompts at `haikai-profiles/default/commands/discover-endpoints/single-agent/discover-endpoints.md` and `discover-interactions/single-agent/discover-interactions.md` enforce this ordering by listing structural-store tools first in their tool surface and only mentioning source-read tools further down.

## Cross-references

- [[../concepts/structural-store]] — what the store contains
- [[../concepts/agentic-discovery]] — the discovery loop this rule governs
- [[../concepts/v2-extraction-pipeline]] — V2's `evidence_globs` and lazy queries also follow the rule (queries first, source files only when explicitly globbed)
- [[never-add-framework-patterns-to-ast]] — the other load-bearing rule; together they define how discovery works

## Sources

- Memory entry: "Structural first — Discovery agents: AST/structural data first, source code is last resort"
- `haikai-profiles/default/commands/discover-endpoints/single-agent/discover-endpoints.md`
- [[../../raw/2026-05-04_codebase-walk]]
