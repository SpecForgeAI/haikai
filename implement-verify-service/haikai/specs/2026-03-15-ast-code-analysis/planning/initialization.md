# Initialization

**Spec:** 2026-03-15-ast-code-analysis
**Date:** 2026-03-15
**Source:** User request

## Raw Idea

Add structural code analysis to the standards extraction pipeline using existing language tooling (universal-ctags, LSP servers) rather than building custom parsers. A two-tier provider model gives us universal-ctags as a fast, zero-config baseline (symbols, signatures, inheritance for 100+ languages) and optional LSP servers for deep analysis (call graphs, references, type info). Both tiers feed into a unified StructuralAnalysis model that enriches LLM prompts, improves chunking, and enables deterministic pattern detection.

Key shift: when structural providers are enabled, the LLM receives structured output (~200 tokens) instead of raw source code (~2000+ tokens). The LLM moves from "code parser" to "structural interpreter."

## Prior Work

- `src/file_analyzer.py` — existing file analysis pipeline (integration point)
- `src/chunking/` — existing chunking pipeline (integration point)
- `src/strategies/*.py` — existing analysis strategies (unchanged in Phase 1)
