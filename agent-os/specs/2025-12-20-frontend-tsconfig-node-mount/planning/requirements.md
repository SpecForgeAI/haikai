# Requirements: Frontend (Vite/React) – Fix Missing tsconfig.node.json in Dev Container

## Project
frontend

## Goal
Fix the Vite startup error in the frontend Docker dev container caused by the missing
`tsconfig.node.json` file inside the container, by mounting it explicitly via
docker-compose (Option A).

## Scope
- docker-compose.yml only
- Frontend service only
- No changes to Dockerfile.dev
- No changes to Vite config or TypeScript configs themselves

## Out of Scope
- Option B (copying files in Dockerfile)
- Any backend or Node service changes
- Disabling Vite HMR overlay

---

## 1) Problem Summary (for traceability)

- Vite always attempts to read BOTH:
  - tsconfig.json
  - tsconfig.node.json
- In the current docker-compose.yml, only tsconfig.json is mounted.
- As a result, inside the container `/app/tsconfig.node.json` does not exist,
  causing Vite to fail at dependency scanning time.

---

## 2) Required Change (Option A – Volume Mount)

### 2.1 Update the `frontend` service in `docker-compose.yml`

Add the missing volume mount so that `tsconfig.node.json` exists inside the container.

Current (simplified):
```yaml
frontend:
  volumes:
    - ./frontend/src:/app/src:delegated
    - ./frontend/public:/app/public:delegated
    - ./frontend/index.html:/app/index.html:delegated
    - ./frontend/vite.config.ts:/app/vite.config.ts:delegated
    - ./frontend/tsconfig.json:/app/tsconfig.json:delegated
```

Required addition:
```yaml
    - ./frontend/tsconfig.node.json:/app/tsconfig.node.json:delegated
```

---

## 3) Acceptance Criteria

- `docker compose up --build frontend` starts without:
  - "Cannot find tsconfig.node.json" errors
  - Vite dependency scanning failures related to missing config
- Vite dev server starts successfully and HMR is functional
- No changes required to any other services

---

## 4) Non-goals

- Modifying Dockerfile.dev to copy tsconfig files
- Changing Vite or TypeScript configuration
- Fixing any backend services
