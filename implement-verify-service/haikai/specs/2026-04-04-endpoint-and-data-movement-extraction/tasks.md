# Tasks: Endpoint & Data Movement Extraction

> **REVISED 2026-04-07:** AST-based endpoint/interaction detection reverted.
> Detection is now fully agentic — the LLM reads the structural store and
> source code to discover endpoints and interactions using its framework knowledge.
> Hard-coded pattern matching removed from AST extractors.

## Phase 1: Models + Base Class (kept)

- [x] T1.1: `EndpointInfo` and `InteractionInfo` dataclasses in `src/ast/models.py` (kept as output format)
- [x] T1.2: `LanguageExtractor` base class has `extract_endpoints()` and `extract_interactions()` — default empty list returns (extractors no longer override these)
- [~] T1.3: `config/endpoint_patterns.yaml` — DEPRECATED, retained as reference only
- [~] T1.4: `config/interaction_patterns.yaml` — DEPRECATED, retained as reference only
- [~] T1.5: `src/ast/extractors/endpoint_config.py` — DELETED (YAML pattern loading no longer needed)

## Phase 2: AST Endpoint Detection (REVERTED)

- [~] T2.1–T2.6: All per-language `extract_endpoints()` implementations REVERTED to base class default (return `[]`)
- Framework-specific endpoint detection methods removed from all 5 extractors (Python, Java, TypeScript, Go, C#)

## Phase 3: AST Data Movement Detection (REVERTED)

- [~] T3.1–T3.6: All per-language `extract_interactions()` implementations REVERTED to base class default (return `[]`)
- Framework-specific interaction detection methods (including gRPC walkers) removed from all 5 extractors

## Phase 4: Agentic Discovery (NEW)

- [x] T4.1: Create `src/ast/endpoint_discoverer.py` — LLM agent discovers endpoints via structural store tools
- [x] T4.2: Create `src/ast/interaction_discoverer.py` — LLM agent discovers interactions via structural store tools
- [x] T4.3: Create `haikai-profiles/default/commands/discover-endpoints/single-agent/discover-endpoints.md`
- [x] T4.4: Create `haikai-profiles/default/commands/discover-interactions/single-agent/discover-interactions.md`
- [x] T4.5: Remove `extractor.extract_endpoints()` / `extract_interactions()` calls from `TreeSitterProvider.analyze_batch()`

## Phase 5: Store Writers + Pipeline (kept)

- [x] T5.1: `FileStore.write_endpoints()` — TSV output to `_endpoints.txt` (unchanged)
- [x] T5.2: `FileStore.write_data_movements()` — TSV output to `_data_movements.txt` (unchanged)
- [x] T5.3: `StructuralAnalysis` model has `endpoints` and `interactions` fields (populated by agentic discovery, not AST)

## Phase 6: Directives + Specs Updated

- [x] T6.1: CLAUDE.md updated with AST vs LLM architecture principle
- [x] T6.2: This spec and the metamodel mapping spec updated to reflect agentic approach
- [x] T6.3: Config YAML files marked as deprecated reference
