# Requirements: Docker Dev – Fix Node/TypeScript runtime for Gateway + MCP Server

## Project
gateway, mcp-server

## Goal
Ensure the Gateway and MCP server dev containers can run TypeScript entrypoints reliably.
Fix the current error:
  "TypeError: Unknown file extension '.ts' ..."
by using a TypeScript runtime in dev (tsx) and updating Dockerfile.dev to run the correct
dev command.

## Scope
- gateway (Node/TS) Dockerfile.dev + package.json dev script
- mcp-server (Node/TS) Dockerfile.dev + package.json dev script
- No changes to frontend or Java services in this spec

---

## 1) MCP Server: use tsx for dev + ensure Dockerfile.dev runs it

### 1.1 Add tsx dev dependency
- In `mcp-server/package.json` add:
  ```json
  "devDependencies": {
    ...
    "tsx": "^4.0.0"
  }
  ```

### 1.2 Update dev script to run TS entrypoint via tsx
- In `mcp-server/package.json` set:
  ```json
  "scripts": {
    ...
    "dev": "tsx watch src/index.ts"
  }
  ```

Notes:
- This replaces any existing nodemon-based TS execution that runs `node src/index.ts`.
- If you still want nodemon semantics, do NOT use nodemon; tsx watch already handles restart.

### 1.3 Update MCP Dockerfile.dev
- Update `mcp-server/Dockerfile.dev` to:
  - Install dependencies
  - Copy package manifests first for caching
  - Expose port 8090
  - Run `npm run dev`

Required content (template):

```dockerfile
FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 8090
CMD ["npm", "run", "dev"]
```

Notes:
- Do not run `node src/index.ts` anywhere in the Dockerfile.
- `npm ci` is preferred for deterministic installs; use `npm install` only if no lockfile exists.

---

## 2) Gateway: use tsx for dev + ensure Dockerfile.dev runs it

### 2.1 Add tsx dev dependency
- In `gateway/package.json` add:
  ```json
  "devDependencies": {
    ...
    "tsx": "^4.0.0"
  }
  ```

### 2.2 Update dev script to run TS entrypoint via tsx
- In `gateway/package.json` set:
  ```json
  "scripts": {
    ...
    "dev": "tsx watch src/server.ts"
  }
  ```

### 2.3 Update Gateway Dockerfile.dev
- Update `gateway/Dockerfile.dev` to match the MCP pattern:

```dockerfile
FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 8081
CMD ["npm", "run", "dev"]
```

Notes:
- Do not run `node src/server.ts` anywhere in the Dockerfile.

---

## 3) Docker Compose compatibility

- No changes required to docker-compose.yml for this spec.
- Existing volumes mapping `./gateway/src:/app/src` and `./mcp-server/src:/app/src` will work
  with tsx watch.
- The container will restart the process automatically on TS file changes.

---

## 4) Acceptance Criteria

- `docker compose up --build` starts:
  - mcp-server without ERR_UNKNOWN_FILE_EXTENSION
  - gateway without ERR_UNKNOWN_FILE_EXTENSION
- `docker compose logs -f arch-mcp-server` shows tsx watch running.
- `docker compose logs -f arch-gateway` shows tsx watch running.
- Editing a .ts file under gateway/src or mcp-server/src triggers a restart and reload.

---

## 5) Non-goals

- No frontend fixes (tsconfig.node.json) in this spec
- No TypeScript build/compile step for production images
- No changes to Java services
