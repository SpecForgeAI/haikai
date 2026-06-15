# V1 vs V2 discovery

Two approaches to "find all endpoints / DB interactions in this codebase" coexist in standards-extractor. Both honor [[../decisions/never-add-framework-patterns-to-ast]] (no framework code in the AST layer) — they differ in *where* the framework knowledge lives and *when* the LLM enters.

## At a glance

| | V1 ([[../concepts/agentic-discovery]]) | V2 ([[../concepts/v2-extraction-pipeline]]) |
|---|---|---|
| Approach | LLM-driven loop: hypothesize → probe → assess | Playbook-driven: deterministic match first, LLM only on fallback |
| Framework knowledge lives in | LLM pretraining + skill prompt | YAML playbooks (`haikai-profiles/.../playbooks/frameworks/*.yaml`) |
| Speed per repo | Seconds-to-minutes (LLM-bound) | Sub-second on known frameworks; LLM-bound only on unknowns |
| Cost per repo | At least one LLM call per discovery question | Often zero LLM calls (when a playbook matches) |
| New framework support | Zero code/config — LLM already knows it | New YAML playbook (write or auto-author via `propose_playbook.py`) |
| Failure mode | Hallucinated endpoints; LLM confidence variance | Empty result → LLM fallback → if still empty, prompt to author a new playbook |
| Verification | LLM self-assesses + skill prompt asks for confidence/gaps | Independent regex verifier + per-playbook YAML verification rules |
| Active path | Interaction discovery (DB, queues, HTTP outbound) | Endpoint discovery |
| Implementation | `src/ast/endpoint_discoverer.py`, `src/ast/interaction_discoverer.py` + skills | `src/ast/v2/` (11 phases) |

## Why both exist

V1 was first. It established the model — [[../concepts/agentic-discovery]] reading the [[../concepts/structural-store]] and using the LLM as the framework interpreter. Worked, but every analysis paid an LLM call.

V2 inverts: known frameworks have YAML playbooks that extract deterministically (cheaper, faster, more deterministic). Unknown frameworks fall back to an LLM call (V2's `llm_fallback.py`). If even that returns empty, V2's playbook author CLI (Phase 11) can propose a new playbook for review.

V2 doesn't fully replace V1 yet:
- **Endpoints**: V2 handles them. 18 framework playbooks shipped; LLM fallback for the rest.
- **Interactions** (DB writes, queue publishes, HTTP outbound): still V1 only. A V2 playbook system for interactions is on the roadmap but not implemented.

## What's the same in both

- **Both honor [[../decisions/never-add-framework-patterns-to-ast]].** V2's YAML playbooks are *data*, not code; the playbook executor itself is generic.
- **Both read from [[../concepts/structural-store]].** Neither path goes back to raw source as a primary input.
- **Both honor [[../decisions/structural-first-in-discovery]].** V1's skill prompts list structural-store tools first; V2's lazy queries operate on the store and only escalate to source via `evidence_globs` when explicitly needed.
- **Both produce the same output shape.** Endpoints → records with `(operation, path, framework, handler_symbol, file, line)`. Interactions → records with `(mechanism, direction, target, data_hint, source_symbol)`. Downstream consumers ([[../concepts/dep-graph]], [[../concepts/diagram-generation]]) don't care which path produced them.

## When to use which

In practice the choice is automatic — V2 is the active endpoint path, V1 is the interaction path. But conceptually:

- **Pick V2** when the framework is known and a playbook exists. Cheap, fast, deterministic, verifiable.
- **Pick V1** when the question is open-ended ("what *kind* of interactions exist?"), when the framework is custom or unknown, or for interactions (until V2 covers them).
- **Both fail gracefully** — V2 falls back to LLM, V1's loop reports gaps with confidence scores.

## What V1 does that V2 doesn't (yet)

- Confidence scoring per discovered endpoint/interaction.
- Self-reported gap list ("I think I missed these").
- Iterative refinement when the assess step finds mismatches.

These are features of an LLM-loop architecture. V2 trades them for determinism. The right model going forward is probably *hybrid*: deterministic playbook for known frameworks + LLM-loop for confidence/gap reporting on top. Spec'd nowhere yet.

## Sources

- [[../concepts/agentic-discovery]] — V1 detail
- [[../concepts/v2-extraction-pipeline]] — V2 detail
- `src/ast/v2/STATUS.md` — V2 phase-by-phase status
- [[../../raw/2026-05-04_codebase-walk]]
