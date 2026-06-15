# Decision: Never add framework patterns to the AST layer

The load-bearing architectural rule. Documented in `CLAUDE.md` and reinforced across the codebase.

## The decision

**The AST layer (`src/ast/`) does mechanical, framework-agnostic structural extraction. The LLM layer does framework interpretation. New framework support requires zero code changes — the LLM already knows it.**

## What this rules out

- Adding `if framework == "spring": ...` branches to extractors.
- Adding annotation-name lists (`SPRING_REST_ANNOTATIONS = ["@GetMapping", "@PostMapping", ...]`) to `src/ast/`.
- Adding URL-routing-DSL parsers to extractors. (V2 has them — but in *YAML playbooks*, not in extractor Python code. See [[../concepts/v2-extraction-pipeline]].)
- Adding `is_endpoint(symbol)` helpers in `src/ast/`.

## What this rules in

- Generic extraction: "give me every annotation, with its target symbol, args, and source location."
- Generic queries: "give me every call edge from `OrderService.placeOrder`."
- Framework detection lives in playbooks (V2) or skill prompts (V1) — both data, not code.
- All framework-specific reasoning happens in the LLM, prompted via the [[../concepts/agentic-discovery]] loop or [[../concepts/v2-extraction-pipeline]] playbook fallback.

## Why this rule exists

The alternative is the path most code-analysis tools take: bake framework knowledge into extractors. Every new framework = a code change + tests + maintenance. Frameworks evolve; extractors rot.

The structural-first approach trades extractor speed for adaptability. Adding Strapi support, FastAPI v2 support, or a brand-new framework released next year requires no code change to standards-extractor. The LLM already knows it (or learns it from its training data on its own schedule).

Empirical contrast: [[../tools/gitnexus]] bakes annotation knowledge into extractors. Result: produces zero `Route` nodes for standard HTTP frameworks ([[../findings/gitnexus-no-routes]]) because its extractor doesn't know `@RestController`. Standards-extractor avoids this failure mode by structure.

## Trade-off

Agentic discovery is slower per repo than baked-in pattern matching (LLM round-trip vs static dispatch). V2 mitigates this with playbooks for common frameworks while preserving the rule (playbooks are data).

## Enforcement

- `CLAUDE.md` — the rule is documented and load-bearing.
- Code review heuristic: if a PR adds a framework name as a string literal in `src/ast/*.py`, that's a smell. Push it to a playbook or a skill prompt.
- The [[../concepts/v2-extraction-pipeline]] design preserves the rule: 18 framework playbooks live in YAML, the executor that runs them is generic.

## Cross-references

- [[../concepts/ast-vs-llm-split]] — concept-page version of this rule
- [[../concepts/agentic-discovery]] — V1 discovery loop, where framework reasoning lives
- [[../concepts/v2-extraction-pipeline]] — V2 alternative, still rule-conformant

## Sources

- `CLAUDE.md` — "Architecture Principle: AST vs LLM Responsibilities"
- [[../../raw/2026-05-04_codebase-walk]]
