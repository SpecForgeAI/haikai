# Spec Initialization

**Spec Name:** Fix UI Characteristics Picker Grouping and Key Suggestions
**Date:** 2026-01-20
**Status:** Requirements Research

## Initial Idea

From raw-idea.md:
- Fix two UX issues in the UI Characteristics grid
- Part A: UI column (Application Point picker) should group by Application Point kind (Application / Application Component / Service) instead of generic "Application Points" section
- Part B: Key column suggestions should be sourced from backend config (bootstrap), display human-friendly labels but store raw key values, and be type-dependent
- Scope: Frontend + architecture-model-service bootstrap/config only. No persistence schema changes.
