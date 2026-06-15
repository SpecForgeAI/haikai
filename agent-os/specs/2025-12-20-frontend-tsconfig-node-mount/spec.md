# Specification: Fix Missing tsconfig.node.json in Frontend Docker Dev Container

## Goal
Add a volume mount for `tsconfig.node.json` in the frontend service of `docker-compose.yml` to fix Vite startup errors caused by the missing TypeScript configuration file inside the container.

## User Stories
- As a developer, I want the frontend dev container to start without errors so that I can develop and test the React application in Docker.

## Specific Requirements

**Add tsconfig.node.json volume mount to frontend service**
- Add a new volume entry in the `frontend` service `volumes` section at line 132 (after the existing `tsconfig.json` mount)
- The mount should follow the same pattern as existing mounts: `./frontend/tsconfig.node.json:/app/tsconfig.node.json:delegated`
- Use `:delegated` flag for consistency with other volume mounts in the frontend service
- The file `frontend/tsconfig.node.json` already exists in the codebase and contains Vite-specific TypeScript compiler options

**Preserve existing docker-compose.yml structure**
- No changes to any other services (postgres, architecture-model-service, architecture-read-service, mcp-server, gateway)
- No changes to networks or volumes sections
- No changes to frontend service configuration other than the new volume mount

## Visual Design
No visual mockups provided for this configuration change.

## Existing Code to Leverage

**docker-compose.yml frontend service (lines 118-139)**
- Current volume mounts at lines 126-131 show the pattern to follow
- Line 131 mounts `tsconfig.json` - the new mount should be added immediately after this line
- All frontend volume mounts use the `:delegated` flag for performance optimization

**frontend/tsconfig.node.json**
- This file exists at line 1-11 and is referenced by `tsconfig.json`
- Contains TypeScript config specifically for `vite.config.ts` with ESNext module resolution
- Vite requires this file to exist at `/app/tsconfig.node.json` inside the container

## Out of Scope
- Modifying `frontend/Dockerfile.dev` to copy tsconfig files
- Changes to Vite configuration (`vite.config.ts`)
- Changes to TypeScript configuration files (`tsconfig.json`, `tsconfig.node.json`)
- Changes to any backend services (architecture-model-service, architecture-read-service)
- Changes to Node.js services (gateway, mcp-server)
- Adding environment variables
- Modifying network or volume definitions
