# Agentic discovery

The hypothesis → probe → assess loop that powers framework-agnostic endpoint and DB-interaction discovery.

## The pattern

The LLM is asked to find a class of structural fact (e.g. "all HTTP endpoints", "all DB writes") in a codebase. Instead of pattern-matching a fixed list of frameworks, it:

1. **Hypothesizes** — "this looks like Spring Boot based on `@SpringBootApplication` in the manifest."
2. **Probes** — uses structural-store tools (`read_index`, `read_calls`, `read_imports`, `read_source`) to sample evidence.
3. **Assesses** — verifies the hypothesis. Refines on mismatches. Reports findings + confidence + gaps.

This loop lives in **skill files** (markdown prompts), not Python:

- `haikai-profiles/default/commands/discover-endpoints/single-agent/discover-endpoints.md`
- `haikai-profiles/default/commands/discover-interactions/single-agent/discover-interactions.md`

The Python side (`src/ast/endpoint_discoverer.py`, `src/ast/interaction_discoverer.py`) is the orchestrator that runs the LLM with the right tool surface and harvests the result.

## Why this is structural-first

Memory feedback (load-bearing): **"Discovery agents: AST/structural data first, source code is last resort."** The skill prompts enforce this — `_index.txt` and `_calls.txt` are read before raw `.py`/`.java`/`.ts` source, because:

- Structural data is small (KBs vs MBs of source).
- Structural data is pre-canonicalized (no whitespace, no comments, no irrelevant code).
- The LLM rarely needs full source — usually a function signature + neighboring calls is enough.

Reading source is a tool the LLM has but uses last.

## Why no framework code in the loop

Per [[ast-vs-llm-split]] and [[../decisions/never-add-framework-patterns-to-ast]]: the LLM already knows what `@GetMapping` means. Adding a new framework support is "no code changes — the LLM already knows it." The loop is the substrate; framework knowledge is the LLM's pretraining.

## Where it sits in the pipeline

```
┌─────────────────────────────────────────────┐
│ AST V1/V2 extraction                        │
│ → produces structural store                 │
└─────────────────┬───────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────┐
│ Agentic discovery (per skill)               │
│ Loop: hypothesize → probe → assess          │
│ Tools: read_index, read_calls, read_source  │
│ Output: list of {endpoint|interaction}      │
└─────────────────┬───────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────┐
│ Diagrams, metamodel, standards, reports     │
└─────────────────────────────────────────────┘
```

## V2 alternative for endpoints

V2 ([[v2-extraction-pipeline]]) introduces playbook-driven endpoint discovery as a deterministic alternative to the agentic loop — playbooks encode framework-specific extraction declaratively in YAML, with LLM fallback for unknown frameworks. Both paths exist; V2 is the active one for endpoints. See [[../comparisons/v1-vs-v2-discovery]] for the trade-off side by side.

## Sources

- `CLAUDE.md` — "Architecture Principle" + "Agentic discovery loop" notes
- `haikai-profiles/default/commands/discover-endpoints/single-agent/discover-endpoints.md` — the loop in DOT-graph form
- `src/ast/endpoint_discoverer.py`, `src/ast/interaction_discoverer.py`
- Memory entry: structural-first preference
- [[../../raw/2026-05-04_codebase-walk]]
