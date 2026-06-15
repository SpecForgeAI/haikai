# Documentation Update TODO

Branch: `feature/docs-update`
Started: 2026-02-20
Cron: `docs-update-tracker` (every 15min) — disable when complete

## Root Docs
- [x] README.md — Updated endpoint list (27 endpoints), fixed model names
- [x] CLAUDE.md — Reviewed, current (Windows dev instructions only)
- [x] DOCKER.md — Fixed LLM_PROVIDER/LLM_MODEL defaults, expanded env vars table with ANTHROPIC_API_KEY, CHAT_MODEL, JOBS_DB_PATH, LOG_DIR, etc.
- [x] LOCAL_DEBUG_SETUP.md — Fixed src/queue/ -> src/job_queue/ paths throughout
- [x] LOCAL_ENVIRONMENT.md — Reviewed, current (model examples are reasonable)
- [x] QUICKSTART_LOCAL.md — Reviewed, current

## docs/ — Core
- [x] docs/README.md — Rewritten as full index with all sections
- [x] docs/ARCHITECTURE.md — Rewritten with all components, workspace structure, auth
- [x] docs/API.md — Rewritten with all 27 endpoints, JSON body format (was query params)
- [x] docs/AUTHENTICATION.md — Already current (created same day)
- [x] docs/API_DESIGN.md — Added deprecation notice pointing to current API.md, noted differences from implementation
- [x] docs/DESIGN_DECISIONS.md — Reviewed, current (auto-prefix decision well documented)
- [x] docs/QUICKSTART.md — Reviewed, current (model names already fixed)
- [x] docs/TEST_ORDER.md — Verified curl examples match current endpoints
- [x] docs/CHANGELOG.md — Added missing Chat API v3.3, async job queue, and /ask-questions entries

## docs/ — Feature Specs
- [x] docs/API_SHAPE_SPEC.md — Fixed feature_descriptions→spec_intents
- [x] docs/CHAT_API.md — Updated to v3.3, added plan-product and story-component-anchor endpoint docs
- [x] docs/ASYNC_QUEUE_API.md — Verified endpoints match code
- [x] docs/ASYNC_QUEUE_README.md — Fixed src/queue/ -> src/job_queue/ path
- [x] docs/SHAPE_SPEC_INTEGRATION.md — Reviewed, current (correctly documents shape-spec as separate from orchestration)
- [x] docs/FEATURE_SPEC_CHAT_API_EXTENSION.md — Reviewed, current (feature spec for questions/folder events)

## docs/ — Haikai
- [x] docs/HAIKAI_CHANGELOG.md — Reviewed, current
- [x] docs/HAIKAI_CONFIGURATION.md — Reviewed, current (use_claude_code_subagents documented)
- [x] docs/HAIKAI_CRUD_API.md — Verified, uses correct company/project paths and write-spec endpoint
- [x] docs/TODO_HAIKAI_FEATURES.md — Reviewed, status markers current
- [x] docs/CLAUDE_CODE_VERIFICATION.md — Reviewed, current (verification guide for Docker env)
- [x] docs/SPEC_DRIVEN_DEVELOPMENT_ARCHITECTURE.md — Reviewed, current (architecture overview)

## docs/ — Skill Injections
- [x] docs/haikai-ask-questions-injection.md — Reviewed, paths match actual profile files
- [x] docs/haikai-create-tasks-injection.md — Reviewed, paths match actual profile files
- [x] docs/haikai-implement-tasks-injection.md — Reviewed, paths match actual profile files
- [x] docs/haikai-plan-product-injection.md — Reviewed, paths match actual profile files
- [x] docs/haikai-shape-spec-injection.md — Reviewed, paths match actual profile files
- [x] docs/haikai-skill-injections.md — Reviewed, comprehensive index of all skills
- [x] docs/haikai-write-spec-injection.md — Reviewed, paths match actual profile files

## Status Legend
- [ ] Not reviewed
- [~] Reviewed, partial updates done
- [x] Updated and committed
