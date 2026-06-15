# Dependency Analysis Implementation Specs

This directory contains three comprehensive implementation specifications for adding GitNexus-inspired dependency analysis capabilities to Standards Extractor.

## Overview

These specs describe how to build deep code understanding and refactoring safety features using **Python** and **Haikai skills** (not MCP).

## Specifications

### [Spec 1: Deep Dependency Analysis](spec-1-deep-dependency-analysis.md)
**Size:** 94KB, ~1,900 lines  
**Duration:** 6 weeks

Build a complete dependency graph from existing AST analysis outputs:
- SQLite-based graph storage (7 tables)
- Impact analysis, process tracing, context building
- 4 Haikai skills: `/analyze-impact`, `/trace-dependencies`, `/show-context`, `/find-processes`
- 5 REST API endpoints
- Integration with existing ctags + tree-sitter pipeline

**Key Features:**
- Blast radius analysis (what breaks if you change X?)
- Execution flow tracing (how does feature Y work end-to-end?)
- 360° symbol context (complete view of dependencies)
- Process discovery (find all API flows)

---

### [Spec 2: Refactoring Impact Analysis](spec-2-refactoring-impact-analysis.md)
**Size:** 61KB, ~1,300 lines  
**Duration:** 6 weeks  
**Depends on:** Spec 1

Add refactoring safety tools on top of the dependency graph:
- Git integration (parse diffs, track changes)
- Pre-commit change detection (what will this commit affect?)
- Multi-file coordinated rename (graph-based + text search)
- Staleness tracking (is graph in sync with git?)

**Haikai Skills:**
- `/detect-changes` - Pre-commit impact analysis
- `/safe-rename` - Multi-file rename with preview
- `/check-staleness` - Graph freshness check

**Key Features:**
- Maps git diffs → symbols → blast radius
- Dual-mode rename: high-confidence (graph) + low-confidence (grep)
- Risk assessment (LOW/MEDIUM/HIGH/CRITICAL)
- Safety guardrails and pre-commit hooks

---

### [Spec 3: Large-Scale Enterprise Deployment](spec-3-enterprise-deployment.md)
**Size:** 52KB, ~1,100 lines  
**Duration:** 8 weeks  
**Depends on:** Spec 1 & 2

Transform Standards Extractor into an enterprise-ready platform:
- Multi-project registry (PostgreSQL catalog)
- Organization-wide standards library
- Project groups (monorepos, microservices)
- Production deployment (Docker Compose, Kubernetes)
- Monitoring (Prometheus, Grafana)
- Security hardening (API keys, rate limiting, audit logs)

**Key Features:**
- Multi-tenancy (orgs → projects hierarchy)
- Global + project-specific standards merging
- Cross-project dependency analysis
- Complete observability stack
- Production-ready deployment configs

---

## Implementation Summary

| Metric | Total |
|--------|-------|
| **Documentation** | ~207KB across 3 specs |
| **Lines** | ~4,300 lines |
| **Duration** | 20 weeks (can parallelize) |
| **Haikai Skills** | 7+ new skills |
| **REST Endpoints** | 13 new endpoints |
| **Database Tables** | 17 tables (7 SQLite + 10 PostgreSQL) |
| **Python Modules** | ~15 new modules |

## Technology Stack

- **Backend:** Python 3.11+, FastAPI, asyncpg
- **Databases:** SQLite (graphs), PostgreSQL (registry), Redis (cache)
- **Storage:** S3/MinIO for artifacts
- **Graph Analysis:** networkx (Louvain clustering)
- **Monitoring:** Prometheus, Grafana
- **Deployment:** Docker Compose, Kubernetes
- **Dependencies:** asyncpg, redis-py, slowapi, prometheus-client

## Comparison to GitNexus

| Aspect | GitNexus | Standards Extractor Implementation |
|--------|----------|-----------------------------------|
| **Language** | TypeScript | Python |
| **Interface** | MCP stdio | Haikai skills + REST API |
| **Graph DB** | LadybugDB native | SQLite (simpler) |
| **Architecture** | 12-phase DAG pipeline | Builds on existing AST pipeline |
| **Deployment** | Desktop app focus | Enterprise SaaS focus |
| **Multi-tenancy** | Not emphasized | First-class (orgs → projects) |

## Getting Started

### Recommended Order

1. **Start with Spec 1** - Deep Dependency Analysis is the foundation
2. **Add Spec 2** - Refactoring tools build on the dependency graph
3. **Scale with Spec 3** - Enterprise features enable multi-project deployments

### Prerequisites

Before implementing:
- Python 3.11+
- PostgreSQL 15+
- Redis 7+
- Docker (for deployment)
- Existing AST pipeline (ctags + tree-sitter) ✅ Already in place

### Next Steps

1. Review all three specs
2. Set up PostgreSQL and Redis
3. Create database schemas (see Spec 1, Section 2)
4. Implement graph builder (see Spec 1, Section 3)
5. Build analysis engines (see Spec 1, Section 4)
6. Create Haikai skills (see Spec 1, Section 5)

## Questions?

These specs are comprehensive and self-contained. Each includes:
- Complete architecture diagrams
- Detailed database schemas
- Full Python implementations
- Testing strategies
- Deployment guides
- Migration paths

Start with Spec 1, Section 1 (Architecture Overview) to understand the big picture.

---

**Created:** 2026-04-24  
**Author:** Claude (Sonnet 4.5)  
**Context:** GitNexus capability analysis and Python/Haikai adaptation
