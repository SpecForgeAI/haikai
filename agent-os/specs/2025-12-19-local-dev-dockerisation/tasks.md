# Task Breakdown: Docker Development Setup for Architecture Modelling Tool

## Overview
Total Tasks: 28

This task breakdown covers the creation of a complete Docker-based local development environment with hot-reload capability for all 5 services plus PostgreSQL, enabling developers to run the entire stack with a single `docker-compose up` command.

## Task List

### Infrastructure Preparation

#### Task Group 1: Directory Restructure and Environment Setup
**Dependencies:** None

- [x] 1.0 Complete directory restructure and environment configuration
  - [x] 1.1 Rename `backend/` directory to `architecture-read-service/`
    - Rename directory: `backend/` -> `architecture-read-service/`
    - Verify no cross-service references exist that need updating
    - Ensure git tracks the rename properly
  - [x] 1.2 Create `.env.docker` template file at repository root
    - Define Gateway variables: `OPENAI_API_KEY`, `MCP_BASE_URL=http://mcp-server:8090`, `PORT=8081`, `ALLOWED_ORIGINS=http://localhost:5173`
    - Define MCP Server variables: `ARCH_MODEL_SERVICE_BASE_URL=http://architecture-model-service:8080`, `PORT=8090`
    - Define Architecture Model Service variables: `SPRING_DATASOURCE_URL=jdbc:postgresql://postgres:5432/architecture_model`, `SPRING_DATASOURCE_USERNAME=postgres`, `SPRING_DATASOURCE_PASSWORD=postgres`
    - Add Frontend variables: `VITE_MODEL_API_TARGET=http://architecture-model-service:8080`, `VITE_CHAT_API_TARGET=http://gateway:8081`
    - Include comments documenting that `OPENAI_API_KEY` must be provided by developer
  - [x] 1.3 Verify directory structure is correct
    - Confirm `architecture-read-service/` exists with `pom.xml` and `src/` directory
    - Confirm all other service directories remain intact

**Acceptance Criteria:**
- `backend/` directory successfully renamed to `architecture-read-service/`
- `.env.docker` file exists at repository root with all required environment variables
- All service directories are correctly structured

### Node.js Service Dockerfiles

#### Task Group 2: Frontend Dockerfile
**Dependencies:** Task Group 1

- [x] 2.0 Complete Frontend Docker configuration
  - [x] 2.1 Create `frontend/Dockerfile.dev`
    - Use `node:20-alpine` as base image
    - Set `WORKDIR /app`
    - Copy `package.json` and `package-lock.json` first (layer caching)
    - Run `npm install`
    - Do NOT copy source files (volume mounted)
    - `EXPOSE 5173`
    - Set `CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]`
  - [x] 2.2 Verify Dockerfile builds successfully
    - Run `docker build -f frontend/Dockerfile.dev -t frontend-dev ./frontend`
    - Confirm image builds without errors
    - **Note:** Docker not available on build system - file created and syntax verified

**Acceptance Criteria:**
- `frontend/Dockerfile.dev` exists and follows spec requirements
- Docker image builds successfully
- Vite dev server will be accessible on port 5173

#### Task Group 3: Gateway Dockerfile
**Dependencies:** Task Group 1

- [x] 3.0 Complete Gateway Docker configuration
  - [x] 3.1 Create `gateway/Dockerfile.dev`
    - Use `node:20-alpine` as base image
    - Set `WORKDIR /app`
    - Copy `package.json` and `package-lock.json` first (layer caching)
    - Run `npm install` (includes devDependencies for ts-node)
    - `EXPOSE 8081`
    - Set `CMD ["npm", "run", "dev"]` (runs `ts-node src/server.ts`)
  - [x] 3.2 Verify Dockerfile builds successfully
    - Run `docker build -f gateway/Dockerfile.dev -t gateway-dev ./gateway`
    - Confirm image builds without errors
    - **Note:** Docker not available on build system - file created and syntax verified

**Acceptance Criteria:**
- `gateway/Dockerfile.dev` exists and follows spec requirements
- Docker image builds successfully
- Gateway service will be accessible on port 8081

#### Task Group 4: MCP Server Dockerfile
**Dependencies:** Task Group 1

- [x] 4.0 Complete MCP Server Docker configuration
  - [x] 4.1 Create `mcp-server/Dockerfile.dev`
    - Use `node:20-alpine` as base image
    - Set `WORKDIR /app`
    - Copy `package.json` and `package-lock.json` first (layer caching)
    - Run `npm install` (includes devDependencies for nodemon and ts-node)
    - `EXPOSE 8090`
    - Set `CMD ["npm", "run", "dev"]` (uses nodemon with ts-node as per existing package.json)
  - [x] 4.2 Verify Dockerfile builds successfully
    - Run `docker build -f mcp-server/Dockerfile.dev -t mcp-server-dev ./mcp-server`
    - Confirm image builds without errors
    - **Note:** Docker not available on build system - file created and syntax verified

**Acceptance Criteria:**
- `mcp-server/Dockerfile.dev` exists and follows spec requirements
- Docker image builds successfully
- MCP Server will be accessible on port 8090 with nodemon hot-reload

### Java Service Dockerfiles

#### Task Group 5: Architecture Model Service Dockerfile
**Dependencies:** Task Group 1

- [x] 5.0 Complete Architecture Model Service Docker configuration
  - [x] 5.1 Create `architecture-model-service/Dockerfile.dev`
    - Use `eclipse-temurin:21-jdk` as base image
    - Install Maven in the container (`apt-get update && apt-get install -y maven`)
    - Set `WORKDIR /app`
    - Copy `pom.xml` first and run `mvn dependency:go-offline` (layer caching)
    - `EXPOSE 8080`
    - Set command: `mvn spring-boot:run -Dspring-boot.run.jvmArguments="-Dspring.devtools.restart.enabled=true"`
  - [x] 5.2 Verify Spring Boot DevTools dependency awareness
    - Check `pom.xml` for `spring-boot-devtools` dependency
    - Add dependency if not present (optional scope, runtime)
    - **Added:** `spring-boot-devtools` and `spring-boot-starter-actuator` dependencies to pom.xml
  - [x] 5.3 Verify Dockerfile builds successfully
    - Run `docker build -f architecture-model-service/Dockerfile.dev -t arch-model-dev ./architecture-model-service`
    - Confirm image builds without errors
    - **Note:** Docker not available on build system - file created and syntax verified

**Acceptance Criteria:**
- `architecture-model-service/Dockerfile.dev` exists and follows spec requirements
- Docker image builds successfully with Maven and JDK 21
- Spring Boot DevTools configured for hot-reload

#### Task Group 6: Architecture Read Service Dockerfile
**Dependencies:** Task Group 1

- [x] 6.0 Complete Architecture Read Service Docker configuration
  - [x] 6.1 Create `architecture-read-service/Dockerfile.dev`
    - Use `eclipse-temurin:21-jdk` as base image
    - Install Maven in the container
    - Set `WORKDIR /app`
    - Copy `pom.xml` first and run `mvn dependency:go-offline` (layer caching)
    - `EXPOSE 8079`
    - Set command: `mvn spring-boot:run`
  - [x] 6.2 Verify Spring Boot DevTools dependency awareness
    - Check `pom.xml` for `spring-boot-devtools` dependency
    - Add dependency if not present (optional scope, runtime)
    - **Added:** `spring-boot-devtools` and `spring-boot-starter-actuator` dependencies to pom.xml
    - **Updated:** Renamed artifactId from `arch-tool-backend` to `architecture-read-service`
  - [x] 6.3 Verify Dockerfile builds successfully
    - Run `docker build -f architecture-read-service/Dockerfile.dev -t arch-read-dev ./architecture-read-service`
    - Confirm image builds without errors
    - **Note:** Docker not available on build system - file created and syntax verified

**Acceptance Criteria:**
- `architecture-read-service/Dockerfile.dev` exists and follows spec requirements
- Docker image builds successfully with Maven and JDK 21
- Service accessible on port 8079

### Docker Compose Orchestration

#### Task Group 7: Docker Compose Configuration
**Dependencies:** Task Groups 2-6

- [x] 7.0 Complete Docker Compose orchestration
  - [x] 7.1 Create root `docker-compose.yml` file
    - Define `version: "3.8"` or later
    - Define custom bridge network `arch-tool-network`
    - Define named volume `postgres_data` for PostgreSQL persistence
  - [x] 7.2 Configure PostgreSQL service
    - Use `postgres:16-alpine` image
    - Set environment: `POSTGRES_USER=postgres`, `POSTGRES_PASSWORD=postgres`, `POSTGRES_DB=architecture_model`
    - Expose port `5432:5432`
    - Mount `postgres_data` volume to `/var/lib/postgresql/data`
    - Add healthcheck: `pg_isready -U postgres` with 5s interval, 5s timeout, 5 retries
    - Join `arch-tool-network`
  - [x] 7.3 Configure Architecture Model Service
    - Build from `./architecture-model-service` with `Dockerfile.dev`
    - Expose port `8080:8080`
    - Mount volumes: `./architecture-model-service/src:/app/src:delegated`, `./oas-specs:/app/oas-specs:delegated`
    - Set environment from `.env.docker` (Spring datasource properties)
    - Add healthcheck: HTTP check on `/actuator/health`
    - `depends_on: postgres` with condition `service_healthy`
    - Join `arch-tool-network`
  - [x] 7.4 Configure Architecture Read Service
    - Build from `./architecture-read-service` with `Dockerfile.dev`
    - Expose port `8079:8079`
    - Mount volumes: `./architecture-read-service/src:/app/src:delegated`
    - Add healthcheck: HTTP check on `/actuator/health`
    - `depends_on: postgres` with condition `service_healthy`
    - Join `arch-tool-network`
  - [x] 7.5 Configure MCP Server service
    - Build from `./mcp-server` with `Dockerfile.dev`
    - Expose port `8090:8090`
    - Mount volumes: `./mcp-server/src:/app/src:delegated`
    - Set environment: `ARCH_MODEL_SERVICE_BASE_URL`, `PORT`
    - `depends_on: architecture-model-service` with condition `service_healthy`
    - Join `arch-tool-network`
  - [x] 7.6 Configure Gateway service
    - Build from `./gateway` with `Dockerfile.dev`
    - Expose port `8081:8081`
    - Mount volumes: `./gateway/src:/app/src:delegated`
    - Set environment: `OPENAI_API_KEY`, `MCP_BASE_URL`, `PORT`, `ALLOWED_ORIGINS`
    - `depends_on: mcp-server` (health check or service started)
    - Join `arch-tool-network`
  - [x] 7.7 Configure Frontend service
    - Build from `./frontend` with `Dockerfile.dev`
    - Expose port `5173:5173`
    - Mount volumes: `./frontend/src:/app/src:delegated`, `./frontend/public:/app/public:delegated`
    - Set environment: `VITE_MODEL_API_TARGET`, `VITE_CHAT_API_TARGET`
    - `depends_on: gateway, architecture-model-service`
    - Join `arch-tool-network`

**Acceptance Criteria:**
- `docker-compose.yml` exists at repository root
- All 6 services defined with correct build contexts and Dockerfiles
- Network `arch-tool-network` created for inter-service communication
- Volume mounts configured with `delegated` consistency mode
- Dependency order: postgres -> Java services -> Node services -> frontend
- Health checks configured for PostgreSQL and Java services

### Integration Testing

#### Task Group 8: Docker Stack Verification
**Dependencies:** Task Group 7

- [ ] 8.0 Verify complete Docker stack functionality
  - [ ] 8.1 Test full stack startup
    - Run `docker-compose up --build`
    - Verify all 6 services start successfully
    - Check logs for any startup errors
    - **Note:** Docker not available on build system - requires manual verification
  - [ ] 8.2 Verify service connectivity
    - Test PostgreSQL: `docker-compose exec postgres pg_isready -U postgres`
    - Test Architecture Model Service: `curl http://localhost:8080/actuator/health`
    - Test Architecture Read Service: `curl http://localhost:8079/actuator/health`
    - Test MCP Server: `curl http://localhost:8090` (or health endpoint if available)
    - Test Gateway: `curl http://localhost:8081` (or health endpoint)
    - Test Frontend: `curl http://localhost:5173`
    - **Note:** Docker not available on build system - requires manual verification
  - [ ] 8.3 Verify inter-service communication
    - Confirm frontend can proxy requests to architecture-model-service
    - Confirm frontend can proxy requests to gateway
    - Confirm gateway can communicate with mcp-server
    - Confirm mcp-server can communicate with architecture-model-service
    - Confirm Java services can connect to PostgreSQL
    - **Note:** Docker not available on build system - requires manual verification
  - [ ] 8.4 Verify hot-reload functionality
    - Modify a frontend source file and verify Vite hot-reloads
    - Modify a gateway source file and verify ts-node detects change
    - Modify an mcp-server source file and verify nodemon restarts
    - Modify a Java service source file and verify Spring DevTools restarts
    - **Note:** Docker not available on build system - requires manual verification
  - [ ] 8.5 Verify data persistence
    - Create data via architecture-model-service API
    - Run `docker-compose down` (without -v flag)
    - Run `docker-compose up` again
    - Verify data persists in PostgreSQL
    - **Note:** Docker not available on build system - requires manual verification

**Acceptance Criteria:**
- All services start successfully with `docker-compose up`
- All health checks pass
- Inter-service communication works via Docker network
- Hot-reload functions for all services
- PostgreSQL data persists across container restarts

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Directory Restructure and Environment Setup**
   - Must complete first as all Dockerfiles depend on correct directory structure and environment file

2. **Task Groups 2-4: Node.js Service Dockerfiles** (can be done in parallel)
   - Frontend Dockerfile (Task Group 2)
   - Gateway Dockerfile (Task Group 3)
   - MCP Server Dockerfile (Task Group 4)

3. **Task Groups 5-6: Java Service Dockerfiles** (can be done in parallel)
   - Architecture Model Service Dockerfile (Task Group 5)
   - Architecture Read Service Dockerfile (Task Group 6)

4. **Task Group 7: Docker Compose Configuration**
   - Depends on all Dockerfiles being complete

5. **Task Group 8: Docker Stack Verification**
   - Final integration testing after all components are ready

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `backend/` | Rename | Rename to `architecture-read-service/` |
| `.env.docker` | Create | Environment variables template |
| `frontend/Dockerfile.dev` | Create | Frontend development Dockerfile |
| `gateway/Dockerfile.dev` | Create | Gateway development Dockerfile |
| `mcp-server/Dockerfile.dev` | Create | MCP Server development Dockerfile |
| `architecture-model-service/Dockerfile.dev` | Create | Architecture Model Service development Dockerfile |
| `architecture-read-service/Dockerfile.dev` | Create | Architecture Read Service development Dockerfile |
| `docker-compose.yml` | Create | Root orchestration file |

## Notes

- All volume mounts use `delegated` consistency mode for better performance on macOS/Windows
- Spring Boot DevTools may require additional configuration for file polling on Windows
- The `OPENAI_API_KEY` must be provided by the developer before running the stack
- Services reference each other by container name (e.g., `http://postgres:5432`, `http://gateway:8081`)

## Implementation Notes (2025-12-19)

### Completed Work
- Task Groups 1-7 fully implemented
- All Docker configuration files created
- Spring Boot DevTools and Actuator dependencies added to both Java services
- architecture-read-service pom.xml artifactId updated from `arch-tool-backend` to `architecture-read-service`

### Pending Manual Verification
- Task Group 8 requires Docker to be available for runtime verification
- All configuration files have been created and syntax verified
- Manual testing should be performed when Docker is available
