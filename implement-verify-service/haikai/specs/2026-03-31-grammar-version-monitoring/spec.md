# Specification: Grammar Version Monitoring (Future)

## Summary

Detect when tree-sitter grammar upgrades introduce new AST node types that extractors don't handle, preventing silent gaps in call/import extraction.

**Status:** Placeholder spec. To be discussed and designed separately.

---

## Problem

When a grammar package is upgraded (e.g., `tree-sitter-rust` 0.24 → 0.25), new AST node types may appear for new language syntax. If an extractor's walker doesn't visit these new node types, calls/imports in code using that syntax are silently missed. There's currently no mechanism to detect this.

---

## Key Questions to Discuss

1. **When to check** — on dependency upgrade? CI pipeline? periodic audit?
2. **How to detect** — diff grammar node types vs extractor handlers? log unhandled nodes at runtime? both?
3. **What to do** — warn? fail CI? auto-generate stub handlers?

---

## Possible Approaches

### A. Node Type Inventory (CI check)

On grammar version bump, extract the full list of node types from the grammar and compare against node types referenced in the extractor's `_walk_*` methods. Flag new node types that look like calls/imports but aren't handled.

**Pros:** Catches gaps before code ships. No runtime overhead.
**Cons:** Not all new node types are relevant — need heuristics to filter (e.g., only flag types containing "call", "invocation", "import", "include", "use").

### B. Runtime Unhandled Node Logging

During extraction, log node types encountered but not walked into. Aggregate across real codebases to surface patterns like "saw 47 `async_call_expression` nodes, never extracted."

**Pros:** Only flags what actually matters (real code). Zero false positives on irrelevant node types.
**Cons:** Requires running against real code first. Gap exists until someone happens to analyze code with new syntax.

### C. Fixture Coverage Gate

Maintain fixture files that exercise every major syntax pattern per language version. When a grammar bumps, regenerate or extend fixtures to include new syntax. Core tests fail if extraction counts drop.

**Pros:** Integrates with existing test infrastructure.
**Cons:** Requires manual fixture updates per language version — doesn't scale well.

### D. Grammar Changelog Automation

Parse tree-sitter grammar release notes / changelogs on dependency bump. Extract mentions of new node types. Cross-reference against extractor code.

**Pros:** Fully automated.
**Cons:** Depends on grammar maintainers documenting changes consistently (they don't always).

---

## Recommendation (to discuss)

Likely a combination of A + B:
- **CI check** (approach A) on grammar version bumps — cheap, catches obvious gaps
- **Runtime logging** (approach B) in production — catches real-world gaps the CI misses
- Fixture updates (approach C) as a byproduct of fixing detected gaps

---

## Dependencies

- Tree-sitter grammar packages expose node type lists (`language.node_kind_count`, `language.node_kind_for_id`)
- Extractor code is inspectable (grep for `node.type ==` patterns)
- Existing test infrastructure for integration

---

## Out of Scope

- Automatic extractor code generation from grammar specs
- Supporting multiple grammar versions simultaneously
- Language version detection from source code (e.g., detecting Java 8 vs 21)
