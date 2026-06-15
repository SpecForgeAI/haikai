# Specification: Docker Development Setup for Architecture Modelling Tool

## Goal
Provide a complete Docker-based local development environment with hot-reload capability for all 5 services plus PostgreSQL, enabling developers to run the entire stack with a single `docker-compose up` command.

## User Stories
- As a developer, I want to start all services with one command so that I can quickly begin development without manual service-by-service setup
- As a developer, I want code changes to hot-reload automatically so that I can iterate quickly without rebuilding containers

## Specific Requirements

**Directory Rename: backend to architecture-read-service**
- Rename the `backend/` directory to `architecture-read-service/` before creating Docker configuration
- Update any internal references if present (currently no cross-service references exist)
- This aligns naming with `architecture-model-service` for consistency

**Frontend Dockerfile (frontend/Dockerfile.dev)**
- Use `node:20-alpine` as base image for smaller footprint
- Set working directory to `/app`
- Copy only `package.json` and `package-lock.json` first for layer caching
- Run `npm install` to install dependencies
- Do NOT copy source files (they will be mounted as volumes)
- Expose port 5173
- Set command to `npm run dev -- --host 0.0.0.0` to allow external access
- Configure Vite environment variables: `VITE_MODEL_API_TARGET=http://architecture-model-service:8080` and `VITE_CHAT_API_TARGET=http://gateway:8081`

**Gateway Dockerfile (gateway/Dockerfile.dev)**
- Use `node:20-alpine` as base image
- Set working directory to `/app`
- Copy `package.json` and `package-lock.json` first for layer caching
- Run `npm install` including devDependencies for ts-node
- Expose port 8081
- Set command to `npm run dev` which runs `ts-node src/server.ts`
- Source files mounted via volume for hot-reload via nodemon or ts-node-dev

**MCP Server Dockerfile (mcp-server/Dockerfile.dev)**
- Use `node:20-alpine` as base image
- Set working directory to `/app`
- Copy `package.json` and `package-lock.json` first
- Run `npm install` including devDependencies for nodemon and ts-node
- Expose port 8090
- Set command to `npm run dev` which uses nodemon with ts-node
- Nodemon already configured to watch `src` folder with `.ts` extension

**Architecture Model Service Dockerfile (architecture-model-service/Dockerfile.dev)**
- Use `eclipse-temurin:21-jdk` as base image for Java 21 support
- Install Maven in the container for development builds
- Set working directory to `/app`
- Copy `pom.xml` first and run `mvn dependency:go-offline` for layer caching
- Expose port 8080
- Use Spring Boot DevTools for hot-reload: add `spring-boot-devtools` dependency awareness
- Set command to `mvn spring-boot:run -Dspring-boot.run.jvmArguments="-Dspring.devtools.restart.enabled=true"`
- Mount source files and enable polling for file changes on Windows

**Architecture Read Service Dockerfile (architecture-read-service/Dockerfile.dev)**
- Use `eclipse-temurin:21-jdk` as base image for Java 21 support
- Install Maven in the container
- Set working directory to `/app`
- Copy `pom.xml` first for dependency caching
- Expose port 8079
- Use Spring Boot DevTools for hot-reload capability
- Set command to `mvn spring-boot:run`

**PostgreSQL Configuration**
- Use official `postgres:16-alpine` image
- Expose port 5432
- Set environment variables: `POSTGRES_USER=postgres`, `POSTGRES_PASSWORD=p05tgre5`, `POSTGRES_DB=architecture_model`
- Create named volume `postgres_data` for data persistence
- Include healthcheck: `pg_isready -U postgres`

**Root docker-compose.yml**
- Place at repository root: `docker-compose.yml`
- Define all 6 services with proper naming: `frontend`, `gateway`, `mcp-server`, `architecture-model-service`, `architecture-read-service`, `postgres`
- Create custom bridge network `arch-tool-network` for inter-service communication
- Define dependency order: postgres starts first, then Java services, then Node services, then frontend
- Use `depends_on` with health checks where applicable

**Volume Mounts for Hot-Reload**
- Frontend: mount `./frontend/src` to `/app/src`, `./frontend/public` to `/app/public`
- Gateway: mount `./gateway/src` to `/app/src`
- MCP Server: mount `./mcp-server/src` to `/app/src`
- Architecture Model Service: mount `./architecture-model-service/src` to `/app/src`, mount `./oas-specs` to `/app/oas-specs`
- Architecture Read Service: mount `./architecture-read-service/src` to `/app/src`
- Use delegated consistency mode for better performance on macOS/Windows

**Environment Variables Configuration**
- Create `.env.docker` template file at repository root with all required variables
- Gateway requires: `OPENAI_API_KEY`, `MCP_BASE_URL=http://mcp-server:8090`, `PORT=8081`, `ALLOWED_ORIGINS=http://localhost:5173`
- MCP Server requires: `ARCH_MODEL_SERVICE_BASE_URL=http://architecture-model-service:8080`, `PORT=8090`
- Architecture Model Service requires: `SPRING_DATASOURCE_URL=jdbc:postgresql://postgres:5432/architecture_model`, `SPRING_DATASOURCE_USERNAME=postgres`, `SPRING_DATASOURCE_PASSWORD=p05tgre5`
- Document that `OPENAI_API_KEY` must be provided by developer

**Network Configuration**
- All services join `arch-tool-network` bridge network
- Services reference each other by container name (e.g., `http://postgres:5432`)
- Frontend proxies API calls to backend services using Docker service names
- No ports exposed to host except: 5173 (frontend), 8080-8081, 8090, 8079, 5432

**Health Checks**
- PostgreSQL: `pg_isready -U postgres` with 5s interval, 5s timeout, 5 retries
- Architecture Model Service: HTTP check on `/actuator/health` (requires actuator dependency)
- Architecture Read Service: HTTP check on `/actuator/health`
- Node services: TCP port checks or simple HTTP endpoint checks

## Existing Code to Leverage

**frontend/vite.config.ts - Proxy Configuration**
- Already configures `VITE_MODEL_API_TARGET` and `VITE_CHAT_API_TARGET` environment variables
- Proxy routes `/api/chat/*` to gateway and `/api/*` to architecture-model-service
- Reuse this pattern; just change target URLs to Docker service names

**gateway/src/config.ts - Environment Variable Pattern**
- Uses dotenv for loading `.env` files
- Defines `MCP_BASE_URL` defaulting to `http://localhost:8090`
- Defines `PORT` defaulting to 8081
- Pattern can be reused; Docker will override with container environment

**mcp-server/src/config.ts - Service URL Configuration**
- Defines `ARCH_MODEL_SERVICE_BASE_URL` defaulting to `http://localhost:8080`
- Defines `PORT` defaulting to 8090
- Environment variables already externalized for Docker override

**architecture-model-service/src/main/resources/application.yml - Database Config**
- PostgreSQL connection already configured with externalized properties
- Uses `localhost:5432` as default; Docker will override via Spring properties
- Database name `architecture_model` and credentials already defined

**mcp-server/package.json - Nodemon Configuration**
- Dev script already configured: `nodemon --watch src --ext ts --exec ts-node src/index.ts`
- This enables hot-reload out of the box when src is volume-mounted

## Out of Scope
- Production Dockerfiles with multi-stage builds and optimized images
- Kubernetes manifests or Helm charts
- CI/CD pipeline integration for Docker builds
- Docker image publishing to registries
- SSL/TLS configuration for local development
- Nginx or Traefik reverse proxy configuration
- Database migration automation (Flyway/Liquibase integration)
- Log aggregation or monitoring stack (ELK, Prometheus)
- Secret management solutions (Vault, Docker secrets)
- Windows-specific Docker Desktop configuration or WSL2 setup instructions
