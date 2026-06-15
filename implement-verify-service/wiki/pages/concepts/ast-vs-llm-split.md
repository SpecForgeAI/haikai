# AST vs LLM split

The architectural principle that determines what code goes in `src/ast/` and what goes in skills/prompts.

## The rule (from `CLAUDE.md`)

| Layer | Responsibility |
|---|---|
| **AST** | Mechanical, framework-agnostic structural extraction: symbols, call sites, imports, inheritance, assignments, annotations |
| **LLM** | Framework *interpretation*: understanding that `@GetMapping` means a REST endpoint, that `repository.save()` is a DB write, that the target table is `orders`, that the DTO is `OrderRequest` |

## Why the split exists

Adding a new framework to support — Spring, FastAPI, Express, Rails, Strapi, whatever — should not require code changes to the AST extractors. The LLM already knows what `@GetMapping` means. So the AST layer's job is to surface raw structural facts (the annotation existed at this site, with these args, on this method) and let the LLM (in a discovery skill) interpret them.

This is enforced as a hard rule: **NEVER add framework-specific pattern matching to the AST extractors.**

## Concrete consequences

- `src/ast/extractors/*.py` extract calls, imports, assignments, annotations *generically*. They don't know about `@RequestMapping`, `@app.route`, or `@RestController`.
- `src/ast/v2/playbook_loader.py` reads YAML playbooks per-framework, but the playbook engine ([[v2-extraction-pipeline]]) is itself framework-agnostic — playbooks are *data*, the engine is generic.
- Endpoint discovery happens in [[agentic-discovery]] — the LLM reads the structural store, hypothesizes "this looks like Spring", probes, and reports endpoints. No framework code in `src/ast/`.
- Interaction discovery (DB calls, message bus, HTTP clients) follows the same pattern.

## Why this matters

The alternative — bake framework knowledge into extractors — is the path most code-analysis tools take. Compare with [[../tools/gitnexus]]: it has TypeScript code that knows about specific annotations. Result: extracts custom `@interface` declarations correctly but produces zero `Route` nodes for standard HTTP frameworks (see [[../findings/gitnexus-no-routes]]). Standards-extractor avoids that failure mode by structure.

The trade-off: agentic discovery is slower per repo than baked-in pattern matching. Standards-extractor accepts that cost.

## Cross-references

- Decision page: [[../decisions/never-add-framework-patterns-to-ast]]
- Discovery loop: [[agentic-discovery]]
- V2 playbooks: [[v2-extraction-pipeline]]
- Same judgment/mechanism split applied to verification: [[async-verification-orchestration]] / [[../decisions/verification-is-agentic-not-runtime]]

## Sources

- `CLAUDE.md` — Architecture Principle section
- [[../../raw/2026-05-04_codebase-walk]]
