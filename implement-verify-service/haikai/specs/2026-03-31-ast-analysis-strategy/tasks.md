# Tasks: AST Analysis Strategy

## Phase 1: Framework Detection + Complexity Scoring ✅

- [x] T1.1: Create `src/ast/framework_detector.py` — `FRAMEWORK_SIGNATURES` dict + `detect_frameworks(structural_results)`
- [x] T1.2: Unit tests for framework detection — Python (fastapi, django, flask, sqlalchemy, pydantic, pytest), TypeScript (react, express, vue), Java (spring, junit), C# (EF Core, ASP.NET)
- [x] T1.3: Integration test — run framework detection on standards-extractor repo, verify frameworks detected
- [x] T1.4: Create `src/ast/complexity_scorer.py` — `score_complexity(analysis)` returning 0.0-1.0
- [x] T1.5: Unit tests for complexity scoring — trivial file (≤3 symbols) scores <0.3, complex file (deep inheritance + many calls) scores >0.5
- [x] T1.6: Integration test — score real files from repo, verify complex files score higher than trivial

## Phase 2: Triage System ✅

- [x] T2.1: Create triage function — `triage(structural_results, threshold) -> (skip_files, analyze_files)`
- [x] T2.2: Implement SKIP rules: ≤2 symbols, constants-only, `__init__.py` with only imports
- [x] T2.3: Implement ANALYZE rules: score above threshold (calls, inheritance, complexity weighted)
- [x] T2.4: Unit tests — verify known trivial files get SKIP, known complex files get ANALYZE
- [x] T2.5: Integration test — triage standards-extractor repo, verify some files skipped, some analyzed

## Phase 3: Strategy Implementation ✅

- [x] T3.1: Create `src/strategies/ast_analysis_strategy.py` extending `BaseGlobalStandardStrategy`
- [x] T3.2: Implement `build_context_from_structural(structural_results)` — deterministic context from structural data
- [x] T3.3: Implement `get_extraction_prompts()` — structural output in prompt, not raw code
- [x] T3.4: Implement `build_deterministic_sections(structural_results)` — dependency graph, symbol distribution, inheritance stats, call hotspots, import clustering
- [x] T3.5: System prompt: tell LLM it's interpreting pre-parsed structure, not raw code
- [x] T3.6: Unit tests with mock LLM — verify structural output sent, not raw code (16 tests)
- [x] T3.7: Integration test — run strategy on real repo with real ctags/tree-sitter data

## Phase 4: Pipeline Integration ✅

- [x] T4.1: `file_analyzer.py` already passes structural content — strategy receives it via `get_extraction_prompts()`
- [x] T4.2: Modify `src/standards_orchestrator.py` — register `AstAnalysisStrategy` when `AST_ANALYSIS_ENABLED=true`
- [x] T4.3: Add config: `AST_ANALYSIS_ENABLED`, `AST_ANALYSIS_DETERMINISTIC_ONLY` env vars
- [x] T4.4: Integration test — deterministic pipeline on real repo produces valid markdown
- [ ] T4.5: Token reduction verification — measure actual tokens (tiktoken) for structural vs raw, assert ≥90% per-file reduction

## Phase 5: Deterministic-Only Mode ✅

- [x] T5.1: Implement `deterministic_only=true` path — zero LLM calls, pure structural output
- [x] T5.2: Generate standards document from structural sections only (dependency graph, frameworks, symbol stats, triage, inheritance)
- [x] T5.3: Integration test — run deterministic mode, verify zero LLM calls, valid output
- [ ] T5.4: Performance test — deterministic mode completes in <5 seconds for 500-file project
