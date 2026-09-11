# Haikai

Haikai is a spec-driven architecture and migration platform. It discovers the
current state of a codebase, models the target architecture, captures decisions,
and drives implementation + verification — orchestrated through chat and
Claude Code workflows.

This repository is a monorepo that merges two formerly separate codebases:

- **architecture-store-and-diagrams** — the architecture model, diagram, and
  chat-orchestration services plus the React frontend.
- **standards-extractor** — the AI-powered standards-extraction and
  spec-driven implement/verify service (now `implement-verify-service/`).

## Services

| Folder | Stack | Port | Role |
|---|---|---|---|
| `architecture-model-service` | Java 21 / Spring Boot / PostgreSQL | 8080 | Central data model & API (snake_case wire format) |
| `architecture-read-service` | Java 21 / Spring Boot | 8079 | Reads draw.io diagrams from Confluence |
| `jira-service` | Java 21 / Spring Boot | 8078 | Stateless Jira Cloud proxy |
| `db-discovery-sidecar` | Java 17 / Spring Boot | 8093 | JDBC sidecar for source-database introspection (Sybase ASE, SQL Server) |
| `gateway` | Node 20 / TypeScript / Express | 8081 | Chat orchestration, LLM calls, MCP tools |
| `mcp-server` | Node 20 / TypeScript / Express | 8090 | MCP tool gateway to the model service |
| `discovery-service` | Node 20 / TypeScript / tree-sitter | 8091 | Clones repos, extracts architecture candidates |
| `api-migration-validation-service` | Node 20 / TypeScript / Express | 8092 | Captures current-state API behaviour baselines |
| `frontend` | React 18 / Vite / TypeScript | 5173 | Web UI |
| `implement-verify-service` | Python 3.11 / FastAPI | 8000 (+ 8780 haibox) | Standards extraction + spec-driven implement/verify |

Supporting top-level folders:

- `agent-os/` — repo-wide Claude Code spec material for the architecture side.
- `implement-verify-service/haikai/` & `haikai-profiles/` — spec store and
  Claude Code agents/commands for the implement/verify side.

> Note: some internal names (e.g. the `standards-extractor-*` compose service
> names and network) are carried over from the original repos and will be
> rebranded in a follow-up pass.

## Quick start (Docker)

The root `docker-compose.yml` brings up the whole product on a single network.

```bash
# 1. Configure environment
cp .env.docker .env                                   # architecture-side services
cp implement-verify-service/.env.docker implement-verify-service/.env
# Edit both .env files and set your API keys (OPENAI_API_KEY, ANTHROPIC_API_KEY, ...)

# 2. Build and start
docker compose up --build
```

Key endpoints once running:

- Frontend: http://localhost:5173
- Architecture Model Service: http://localhost:8080
- Gateway: http://localhost:8081
- Implement-Verify API: http://localhost:8000

## Local development (without Docker)

Each service can be run on its own — see the per-service README / docs:

- Architecture + Node/Java services: run from each service folder
  (`mvn spring-boot:run` for Java, `npm install && npm run dev` for Node).
  A PostgreSQL instance is required for `architecture-model-service`.
- `implement-verify-service`: see `implement-verify-service/README.md`
  (Python venv + `run-local.ps1` / `run-local.sh`).

## Repository conventions

- Root `CLAUDE.md` holds repo-wide guidance for AI coding agents; service-level
  `CLAUDE.md` files (e.g. `implement-verify-service/CLAUDE.md`) hold
  service-specific conventions and are read contextually.
- `.gitignore` is layered: the root file covers repo-wide and Node/Java
  patterns; `implement-verify-service/.gitignore` covers Python/Haikai patterns.
