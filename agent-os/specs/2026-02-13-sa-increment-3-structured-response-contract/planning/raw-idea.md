# Raw Idea

## Title
SA Increment 3 – Structured SA Response Contract + Skip/Unknown Handling + Readiness Gate

## Description
Formalize the Solution Architect (SA) JSON response contract, enforce validation with corrective retry, support user skip/unknown handling, and implement a deterministic readiness gate. This increment remains tool-less and does NOT persist architecture data.

## Key Scope
- Strict JSON response schema for solution_architect mode with expanded section enum (adds artefact_review, final_review, non_functional replaces non_functional_requirements)
- Server-side validation + single corrective retry on parse failure (already exists from SA Inc 1, needs updates)
- Enumerated section progression model in system prompt
- Explicit skip/unknown handling logic in system prompt
- Deterministic readiness gate with minimum baseline requirements
- Minor frontend adjustments to SolutionArchitectChatPanel

## Excludes
- MCP tools
- Architecture meta-model writes
- Diagram creation
- Changes to product_manager mode
- Changes to standards/mission injection
