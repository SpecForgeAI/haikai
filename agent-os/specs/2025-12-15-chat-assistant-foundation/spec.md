# Spec: Chat Assistant Foundation

## Overview

Introduce two new read-only API endpoints on the existing `architecture-model-service` and a new MCP Server implemented as a Node/TypeScript service that exposes two initial MCP tools calling those endpoints. This establishes the foundation for a chat assistant workflow that can discover and retrieve interface metadata for OAS generation.

## Problem Statement

### Current State
- The `architecture-model-service` stores ArchitectureModel files in Postgres with full CRUD capabilities
- No API exists for discovering interfaces within a stored model
- No API exists for retrieving OAS-ready context (interface + endpoints + linked logical entities) for a specific interface
- No MCP server exists for exposing these capabilities to chat assistant workflows

### Desired State
- Chat assistants can list all interfaces for a stored model file by filename
- Chat assistants can retrieve comprehensive OAS-ready context for any interface by ID
- An MCP server provides standardized tool endpoints for these operations with session management

## Solution

### Part A: Extend architecture-model-service with Interface Discovery Endpoints

Add two new read-only endpoints to the existing Spring Boot service:

1. **GET /api/model/interfaces?filename={name}** - List interfaces for a stored model file
2. **GET /api/model/interfaces/{id}** - Get OAS-ready context bundle for an interface by globally-unique ID

### Part B: Create MCP Server (Node/TypeScript)

Create a new Node.js/TypeScript service that:
1. Implements MCP-compatible HTTP endpoints for two tools
2. Proxies requests to `architecture-model-service` endpoints
3. Provides session management with configurable TTL

## Requirements

### Functional Requirements

#### architecture-model-service Endpoints

**GET /api/model/interfaces**

| Aspect | Specification |
|--------|---------------|
| Query Params | `filename` (required) - Name of the stored model file |
| Response (200) | `InterfaceSummaryDto[]` - Array of interface summaries |
| Error (400) | filename missing or blank |
| Error (404) | filename not found in database |

**GET /api/model/interfaces/{id}**

| Aspect | Specification |
|--------|---------------|
| Path Params | `id` (required) - Globally unique interface ID |
| Response (200) | `InterfaceOasContextDto` - Full OAS-ready context bundle |
| Error (400) | id missing or blank |
| Error (404) | interface ID not found across all stored model files |

#### MCP Server Tools

**list_interfaces**

| Aspect | Specification |
|--------|---------------|
| Request | `{ sessionId: string, filename: string }` |
| Response | `{ interfaces: InterfaceSummaryDto[] }` |
| Session Effect | Stores `filename` in session state |
| Error Mapping | 400/404 from backend passed through; 500 becomes 502 |

**get_interface_oas_context**

| Aspect | Specification |
|--------|---------------|
| Request | `{ sessionId: string, interfaceId: string }` |
| Response | `InterfaceOasContextDto` |
| Session Effect | Stores `lastSelectedInterfaceId` in session state |
| Error Mapping | 400/404 from backend passed through; 500 becomes 502 |

### Non-Functional Requirements

1. **Session Management**: Configurable TTL via `MCP_SESSION_TTL_MINUTES` env var (default: 30 minutes)
2. **Session Auto-Create**: Sessions are auto-created on first use - no explicit create endpoint needed
3. **Deterministic Ordering**: Responses must be sorted consistently:
   - Endpoints: by (operationVerb, pathOrAddress, name, id)
   - LogicalEntities: by (name, id)
   - Attributes: by (name, id)
4. **CORS**: architecture-model-service must maintain existing CORS configuration for frontend dev workflow
5. **Logging**: MCP server logs tool name, sessionId, and key identifiers (filename/interfaceId) - no full payloads

## Technical Design

### DTOs for architecture-model-service

#### InterfaceSummaryDto

```java
public record InterfaceSummaryDto(
    String interfaceId,
    String interfaceName,
    String interfaceType,
    String serviceId,         // nullable
    String serviceName,       // nullable
    String applicationId,     // nullable
    String applicationName,   // nullable
    int endpointCount
) {}
```

#### InterfaceEndpointDto

```java
public record InterfaceEndpointDto(
    String id,
    String name,
    String description,       // nullable
    String endpointType,      // nullable
    String pathOrAddress,     // nullable
    String protocol,          // nullable
    String operationVerb,     // nullable
    String direction,         // nullable
    String lifecycleStatus,   // nullable
    String version,           // nullable
    String tags,              // nullable
    String validFrom,         // nullable
    String validTo            // nullable
) {}
```

#### LogicalAttributeDto

```java
public record LogicalAttributeDto(
    String id,
    String name,
    String description,       // nullable
    String dataType,          // nullable
    Boolean isPrimaryKey,     // nullable
    Boolean isNullable,       // nullable
    String tags               // nullable
) {}
```

#### LogicalEntitySchemaDto

```java
public record LogicalEntitySchemaDto(
    String id,
    String name,
    String description,       // nullable
    String tags,              // nullable
    String validFrom,         // nullable
    String validTo,           // nullable
    List<LogicalAttributeDto> attributes
) {}
```

#### InterfaceOasContextDto

```java
public record InterfaceOasContextDto(
    InterfaceDetailDto interfaceInfo,     // "interface" field in JSON
    ServiceDetailDto service,              // nullable
    ApplicationDetailDto application,      // nullable
    List<InterfaceEndpointDto> endpoints,
    List<LogicalEntitySchemaDto> logicalEntities,
    OasNotesDto notes                      // nullable - null for v1
) {}

public record InterfaceDetailDto(
    String id,
    String name,
    String description,       // nullable
    String interfaceType,     // nullable
    String specLink,          // nullable
    String tags,              // nullable
    String validFrom,         // nullable
    String validTo            // nullable
) {}

public record ServiceDetailDto(
    String id,
    String name,
    String description,       // nullable
    String serviceType,       // nullable
    String tags               // nullable
) {}

public record ApplicationDetailDto(
    String id,
    String name,
    String description,       // nullable
    String appType,           // nullable
    String status,            // nullable
    String tags               // nullable
) {}

public record OasNotesDto(
    List<String> basePathCandidates,
    List<String> serverUrlCandidates
) {}
```

### Files to Create

#### architecture-model-service

| File | Description |
|------|-------------|
| `src/main/java/.../controller/ModelInterfacesController.java` | New controller for interface discovery endpoints |
| `src/main/java/.../service/InterfaceDiscoveryService.java` | Service layer for interface queries |
| `src/main/java/.../model/dto/interface_discovery/InterfaceSummaryDto.java` | Summary DTO for interface list |
| `src/main/java/.../model/dto/interface_discovery/InterfaceOasContextDto.java` | Full context DTO |
| `src/main/java/.../model/dto/interface_discovery/InterfaceDetailDto.java` | Interface detail DTO |
| `src/main/java/.../model/dto/interface_discovery/InterfaceEndpointDto.java` | Endpoint DTO |
| `src/main/java/.../model/dto/interface_discovery/ServiceDetailDto.java` | Service detail DTO |
| `src/main/java/.../model/dto/interface_discovery/ApplicationDetailDto.java` | Application detail DTO |
| `src/main/java/.../model/dto/interface_discovery/LogicalEntitySchemaDto.java` | Logical entity + attributes DTO |
| `src/main/java/.../model/dto/interface_discovery/LogicalAttributeDto.java` | Logical attribute DTO |

#### mcp-server (New Service)

| File | Description |
|------|-------------|
| `mcp-server/package.json` | Node.js project config |
| `mcp-server/tsconfig.json` | TypeScript configuration |
| `mcp-server/src/index.ts` | Express server entry point |
| `mcp-server/src/config.ts` | Environment configuration |
| `mcp-server/src/routes/tools.ts` | MCP tool route handlers |
| `mcp-server/src/services/archModelClient.ts` | HTTP client for architecture-model-service |
| `mcp-server/src/services/sessionManager.ts` | In-memory session management |
| `mcp-server/src/types/index.ts` | TypeScript type definitions |
| `mcp-server/src/middleware/errorHandler.ts` | Error mapping middleware |
| `mcp-server/src/middleware/requestLogger.ts` | Structured logging middleware |

### Files to Modify

#### architecture-model-service

| File | Changes |
|------|---------|
| Repository interfaces | Add query methods for interface lookup by ID (global) |

### Repository Query Methods Needed

```java
// InterfaceRepository - add:
Optional<InterfaceEntity> findById(String id);  // Already exists via JpaRepository

// EndpointRepository - add:
List<EndpointEntity> findByInterfaceId(String interfaceId);

// InterfaceLogicalEntityRepository - add:
List<InterfaceLogicalEntityEntity> findByInterfaceId(String interfaceId);

// LogicalDataAttributeRepository - add:
List<LogicalDataAttributeEntity> findByLogicalEntityId(String logicalEntityId);
```

### Data Flow

```
┌─────────────────┐      POST /mcp/tools/*      ┌─────────────────┐
│                 │ ─────────────────────────── │                 │
│   Chat Client   │                             │   MCP Server    │
│                 │ ◄────────────────────────── │   (port 8090)   │
└─────────────────┘      JSON Response          └────────┬────────┘
                                                         │
                                                         │ GET /api/model/interfaces*
                                                         ▼
                                                ┌─────────────────┐
                                                │  architecture-  │
                                                │  model-service  │
                                                │   (port 8080)   │
                                                └────────┬────────┘
                                                         │
                                                         ▼
                                                ┌─────────────────┐
                                                │    PostgreSQL   │
                                                └─────────────────┘
```

### Session State Structure

```typescript
interface Session {
  sessionId: string;
  filename?: string;
  lastListedInterfaces?: InterfaceSummaryDto[];
  lastSelectedInterfaceId?: string;
  lastActivity: Date;
}
```

## Out of Scope

- Gateway component / OpenAI API integration
- OAS generation itself
- Saving OAS artifacts
- Authn/Authz beyond local dev assumptions
- WebSocket/stdio MCP transport (using HTTP for now)

## Acceptance Criteria

1. **Interface List Endpoint:**
   - Returns all interfaces for a given filename with endpoint counts
   - Includes service and application names via FK joins
   - Returns 400 for missing/blank filename
   - Returns 404 for unknown filename

2. **Interface Context Endpoint:**
   - Returns full OAS-ready context for any interface ID (global lookup)
   - Includes interface, service (if any), application (if any), endpoints, and linked logical entities with attributes
   - Endpoints sorted by (operationVerb, pathOrAddress, name, id)
   - Logical entities sorted by (name, id); attributes sorted by (name, id)
   - Returns 400 for missing/blank ID
   - Returns 404 for unknown interface ID

3. **MCP Server list_interfaces:**
   - Validates sessionId and filename are non-empty
   - Proxies to GET /api/model/interfaces?filename=...
   - Stores filename in session state
   - Auto-creates session if not exists
   - Passes through 400/404; maps 500 to 502

4. **MCP Server get_interface_oas_context:**
   - Validates sessionId and interfaceId are non-empty
   - Proxies to GET /api/model/interfaces/{id}
   - Stores lastSelectedInterfaceId in session state
   - Auto-creates session if not exists
   - Passes through 400/404; maps 500 to 502

5. **Session Management:**
   - Sessions expire after MCP_SESSION_TTL_MINUTES (default 30)
   - Expired sessions cleaned up periodically
   - Session activity timestamp updated on each request

## Verification Steps

### Backend Verification

1. Start architecture-model-service with existing test data
2. Call `GET /api/model/interfaces?filename=test-model` - verify interface list
3. Call `GET /api/model/interfaces/{validId}` - verify full context returned
4. Call `GET /api/model/interfaces?filename=nonexistent` - verify 404
5. Call `GET /api/model/interfaces/nonexistent-id` - verify 404

### MCP Server Verification

1. Start MCP server with `ARCH_MODEL_SERVICE_BASE_URL=http://localhost:8080`
2. POST to `/mcp/tools/list_interfaces` with valid sessionId and filename
3. POST to `/mcp/tools/get_interface_oas_context` with valid sessionId and interfaceId
4. Verify error mapping for backend errors
5. Verify session state persistence across requests

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Interface IDs not globally unique | Low | High | Document assumption; add filename scope later if needed |
| Session memory growth | Medium | Low | TTL-based expiration with periodic cleanup |
| Backend unavailable | Medium | Medium | Return 502 with clear error message |
| Large response payloads | Low | Medium | Consider pagination in future iteration |
