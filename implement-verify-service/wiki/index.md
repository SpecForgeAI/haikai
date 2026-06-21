# Wiki Index

LLM-maintained knowledge base for standards-extractor. Schema lives in [CLAUDE.md](../CLAUDE.md#llm-wiki).

## Concepts
- [[pages/concepts/api-layer]] — FastAPI app structure: ~836-line mounting shell + 17 route modules, the 3 repeated patterns, two-layer auth
- [[pages/concepts/endpoint-reference]] — authoritative census of all ~74 endpoints (method/path/auth/dispatch), grouped by router module
- [[pages/concepts/inbound-gateway]] — verification webhook re-entry: the one non-Bearer router, the 8-step receipt contract, SHA→cell re-invoke
- [[pages/concepts/job-queue]] — SQLite async jobs; 11 JobTypes incl. the verification re-entries
- [[pages/concepts/openapi-canonicalization]] — when a project ships a spec, treat it as authoritative truth
- [[pages/concepts/refactoring-engines]] — change_detector / rename_engine / staleness on top of the dep-graph
- [[pages/concepts/depgraph-commit-sha]] — pin snapshots to real git SHAs instead of placeholders
- [[pages/concepts/async-verification-orchestration]] — per-`(group,repo,verifier)` cells, D5 AND gate, inbound-gateway re-invoke, self-repair

## Tools
- [[pages/tools/gitnexus]] — third-party code-analysis tool used as comparison baseline

## Findings
- [[pages/findings/gitnexus-no-routes]] — GitNexus extracts zero HTTP routes; central V2 differentiator
- [[pages/findings/agentos-rename-inventory]] — every agent-os reference (280 files) + why agent-os→haikai is not a safe mechanical rename

## Comparisons
- [[pages/comparisons/gitnexus-vs-v2]] — empirical head-to-head across petclinic, openmrs-core, kibana

## Decisions
- [[pages/decisions/six-thread-commit-batching]] — landed ~5,000 LOC as 6 logical commits, not one mega-commit
- [[pages/decisions/verification-is-agentic-not-runtime]] — verification = agent instructions (D10–D10.3); runtime is only I/O

## Sources
- [[raw/2026-05-01_gitnexus_session]] — GitNexus install + comparison session notes
- [[raw/2026-05-01_commit-batch]] — 7 commits landed on feature/agentic-discovery-v2
- [[raw/2026-05-31_async-verification-self-repair]] — verification feature design + D1–D10.3 + grill outcomes
- [[raw/2026-06-21_verify-service-endpoint-deep-dive]] — full HTTP surface census post Phase A.x modularization (~74 endpoints, 17 modules)
