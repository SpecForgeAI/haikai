# Spec: Chat Assistant - Save OAS Spec (MCP + architecture-model-service)

## Overview

Add the final "save" capability so the LLM (via MCP) can persist an OpenAPI spec (YAML/JSON string) to disk on the backend, link it to the correct Interface in the architecture model, and return a summary including the saved file path.

## Problem Statement

### Current State
- MCP server has `list_interfaces`, `get_interface_oas_context`, and `compute_oas_gaps` tools
- Chat assistants can retrieve interface metadata and analyze gaps but cannot persist generated OpenAPI specs
- Generated OAS documents exist only in chat context and are lost when sessions end

### Desired State
- Chat assistants can call `save_oas_spec` to persist a generated OpenAPI spec to disk
- Saved specs are organized by architecture filename and interface name
- The Interface entity in Postgres has its `spec_link` field updated with the saved file path
- A summary response confirms the save operation with the file path and updated interface info

## Solution

Add a new save endpoint on architecture-model-service and a corresponding MCP tool:
1. Java backend receives the OAS content, validates it, writes it to disk atomically, and updates the Interface's `spec_link`
2. MCP server provides a `save_oas_spec` tool that proxies to the Java endpoint

## Requirements

### Functional Requirements

#### A. Architecture-Model-Service (Java/Spring Boot)

##### 1. Configuration Properties

Add configuration in `application.yml`:

```yaml
architectureModel:
  oas:
    parentFolder: "./oas-specs"
    maxBytes: 2097152  # 2MB default
```

Bind via `@Value` or `@ConfigurationProperties`:
- `architectureModel.oas.parentFolder` - Base directory for all OAS specs (default: `./oas-specs`)
- `architectureModel.oas.maxBytes` - Maximum allowed content size in bytes (default: 2MB)

##### 2. New REST Endpoint

**PUT /api/model/interfaces/{id}/oas**

| Aspect | Specification |
|--------|---------------|
| Path Parameter | `id` - Interface ID (globally unique) |
| Query Parameter | `filename` - Architecture filename (required; used as child folder name) |
| Request Body | `SaveOasSpecRequestDto` (see Data Types) |
| Response | `SaveOasSpecSummaryDto` (see Data Types) |
| Content-Type | `application/json` |

**Request Body (SaveOasSpecRequestDto):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| format | string | Yes | `"yaml"` or `"json"` |
| contents | string | Yes | Full OAS document content |
| title | string | No | Optional title (informational, not used in save) |
| version | string | No | Optional version (informational, not used in save) |

**Response Body (SaveOasSpecSummaryDto):**

| Field | Type | Description |
|-------|------|-------------|
| interfaceId | string | The interface ID |
| interfaceName | string | The interface name |
| architectureFilename | string | The architecture filename used |
| format | string | `"yaml"` or `"json"` |
| savedPath | string | Absolute file path where spec was saved |
| specLink | string | Same as savedPath (stored in interface.specLink) |
| updatedAt | string | ISO-8601 timestamp of the update |
| created | boolean | `true` if file was newly created, `false` if overwritten |

**Status Codes:**

| Code | Condition |
|------|-----------|
| 201 Created | File did not exist before; new file created |
| 200 OK | File existed and was overwritten |
| 400 Bad Request | Missing/blank filename, format, or contents; invalid format value; contents exceeds maxBytes; contents fails YAML/JSON parse validation; sanitized interface name is empty |
| 404 Not Found | Interface ID not found OR filename not found in model_files table |
| 500 Internal Server Error | IO errors or unexpected issues during file operations |

##### 3. Filesystem Save Behavior

**File Extension:**
- If format == `"yaml"`: use `.yml` extension
- If format == `"json"`: use `.json` extension

**Path Construction:**
```
fullPath = parentFolder / sanitize(architectureFilename) / sanitize(interfaceName) + extension
```

Example:
```
C:\data\oas-specs\my-architecture\Order-API.yml
```

**Filename Sanitization Rules:**

Replace these characters with `-`:
- `/` `\` `:` `*` `?` `"` `<` `>` `|`

Additional rules:
- Trim leading/trailing whitespace
- Collapse multiple consecutive `-` into single `-`
- Trim leading/trailing `-`
- If result is empty after sanitization → return 400 Bad Request with message: "Interface name cannot be sanitized to a valid filename"

**Path Traversal Prevention:**
- After sanitization, verify the resulting path does not contain `..` segments
- Use `Path.resolve()` and `normalize()`
- Verify final path starts with the parentFolder path
- Reject with 400 if path traversal is detected

**Atomic Write Process:**
1. Create parent directories if they don't exist: `Files.createDirectories(dir)`
2. Check if target file exists (for determining 200 vs 201 response)
3. Write to a temporary file in the same directory (e.g., `interfaceName.yml.tmp`)
4. Move/replace atomically using `Files.move()` with `StandardCopyOption.REPLACE_EXISTING` and `ATOMIC_MOVE` (fall back to REPLACE_EXISTING if ATOMIC_MOVE not supported)
5. Return absolute path as `savedPath`

##### 4. Content Validation

**Size Check:**
- If `contents.getBytes(StandardCharsets.UTF_8).length > maxBytes` → 400 with message: "Content exceeds maximum allowed size of {maxBytes} bytes"

**Syntax Validation:**
- If format == `"yaml"`: Parse with SnakeYAML; on failure → 400 with message: "Invalid YAML syntax: {parseError}"
- If format == `"json"`: Parse with Jackson ObjectMapper; on failure → 400 with message: "Invalid JSON syntax: {parseError}"

##### 5. Database Updates

**On successful save:**
1. Update `interfaces.spec_link` = savedPath (absolute path)
2. Optionally update `model_files.updated_at` = NOW() for the associated model file

**Validation:**
- Verify `filename` exists in `model_files` table before proceeding
- If not found → 404 with message: "Model file not found: {filename}"
- This ensures we only save specs under legitimate architecture file folders

#### B. MCP Server (Node/TypeScript)

##### 1. New MCP Tool Endpoint

**POST /mcp/tools/save_oas_spec**

| Aspect | Specification |
|--------|---------------|
| Request Body | `SaveOasSpecRequest` (see Data Types) |
| Response | `SaveOasSpecSummaryDto` (pass-through from backend) |
| Session Effect | Stores `filename` and `lastSelectedInterfaceId` in session |

**Request Body (SaveOasSpecRequest):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| sessionId | string | Yes | MCP session ID |
| filename | string | Yes | Architecture filename |
| interfaceId | string | Yes | Interface ID to save spec for |
| format | string | Yes | `"yaml"` or `"json"` |
| oasContents | string | Yes | Full OAS document content |

##### 2. Tool Handler Implementation

**Validation:**
- sessionId: non-empty string
- filename: non-empty string
- interfaceId: non-empty string
- format: must be `"yaml"` or `"json"` (case-insensitive, normalize to lowercase)
- oasContents: non-empty string

**Backend Call:**
```
PUT {ARCH_MODEL_SERVICE_BASE_URL}/api/model/interfaces/{interfaceId}/oas?filename={filename}
Body: { format, contents: oasContents }
```

**Session Update:**
```typescript
updateSession(sessionId, {
  filename,
  lastSelectedInterfaceId: interfaceId,
});
```

**Error Mapping:**
| Backend Response | MCP Response |
|------------------|--------------|
| 200 OK | 200 with SaveOasSpecSummaryDto |
| 201 Created | 201 with SaveOasSpecSummaryDto |
| 400 Bad Request | 400 with error message |
| 404 Not Found | 404 with error message |
| 5xx / Network Error | 502 Bad Gateway with safe error payload |

### Non-Functional Requirements

1. **Atomicity**: File writes must be atomic to prevent partial/corrupt files
2. **Security**: Path traversal attacks must be prevented via sanitization and validation
3. **Idempotency**: Repeated saves with same content should succeed (overwrite)
4. **Logging**: Log successful saves and errors at appropriate levels

## Technical Design

### Data Types

#### Java DTOs

**SaveOasSpecRequestDto.java:**
```java
public record SaveOasSpecRequestDto(
    String format,
    String contents,
    String title,
    String version
) {}
```

**SaveOasSpecSummaryDto.java:**
```java
public record SaveOasSpecSummaryDto(
    String interfaceId,
    String interfaceName,
    String architectureFilename,
    String format,
    String savedPath,
    String specLink,
    Instant updatedAt,
    boolean created
) {}
```

#### TypeScript Types

```typescript
export interface SaveOasSpecRequest {
  sessionId: string;
  filename: string;
  interfaceId: string;
  format: 'yaml' | 'json';
  oasContents: string;
}

export interface SaveOasSpecSummaryDto {
  interfaceId: string;
  interfaceName: string;
  architectureFilename: string;
  format: string;
  savedPath: string;
  specLink: string;
  updatedAt: string;
  created: boolean;
}
```

### Files to Create

| File | Description |
|------|-------------|
| `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/oas/SaveOasSpecRequestDto.java` | Request DTO |
| `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/oas/SaveOasSpecSummaryDto.java` | Response DTO |
| `architecture-model-service/src/main/java/com/example/architecturemodel/service/OasSpecService.java` | Service layer for save logic |
| `architecture-model-service/src/main/java/com/example/architecturemodel/controller/OasSpecController.java` | REST controller |
| `architecture-model-service/src/main/java/com/example/architecturemodel/util/FilenameSanitizer.java` | Filename sanitization utility |
| `architecture-model-service/src/test/java/com/example/architecturemodel/service/OasSpecServiceTest.java` | Service unit tests |
| `architecture-model-service/src/test/java/com/example/architecturemodel/controller/OasSpecControllerTest.java` | Controller integration tests |
| `architecture-model-service/src/test/java/com/example/architecturemodel/util/FilenameSanitizerTest.java` | Sanitizer unit tests |
| `mcp-server/src/types/saveOasSpec.ts` | TypeScript type definitions |
| `mcp-server/src/routes/saveOasSpecRoute.ts` | MCP route handler |
| `mcp-server/src/__tests__/saveOasSpecRoute.test.ts` | Route handler tests |

### Files to Modify

| File | Changes |
|------|---------|
| `architecture-model-service/src/main/resources/application.yml` | Add `architectureModel.oas.*` config properties |
| `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/InterfaceRepository.java` | Add method to find by ID with model file validation |
| `mcp-server/src/routes/tools.ts` | Import and mount saveOasSpecRoute |
| `mcp-server/src/services/archModelClient.ts` | Add `saveOasSpec()` method |
| `mcp-server/src/types/index.ts` | Re-export saveOasSpec types |

### Module Structure

```
architecture-model-service/src/main/java/com/example/architecturemodel/
├── controller/
│   └── OasSpecController.java          # (new) REST endpoint
├── service/
│   └── OasSpecService.java             # (new) Save logic
├── util/
│   └── FilenameSanitizer.java          # (new) Sanitization
└── model/dto/oas/
    ├── SaveOasSpecRequestDto.java      # (new) Request
    └── SaveOasSpecSummaryDto.java      # (new) Response

mcp-server/src/
├── types/
│   ├── index.ts                        # (modify) Re-export
│   └── saveOasSpec.ts                  # (new) Types
├── services/
│   └── archModelClient.ts              # (modify) Add method
└── routes/
    ├── tools.ts                        # (modify) Mount route
    └── saveOasSpecRoute.ts             # (new) Handler
```

### Request Flow

```
POST /mcp/tools/save_oas_spec
        │
        ▼
┌─────────────────────────┐
│  Validate Request       │
│  - sessionId required   │
│  - filename required    │
│  - interfaceId required │
│  - format yaml/json     │
│  - oasContents required │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  Get/Create Session     │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────────────────────┐
│  PUT /api/model/interfaces/{id}/oas     │
│       ?filename={filename}              │
│  Body: { format, contents }             │
└───────────┬─────────────────────────────┘
            │
            ▼
┌─────────────────────────┐
│  Java Backend:          │
│  1. Validate filename   │
│  2. Find interface      │
│  3. Validate content    │
│  4. Sanitize paths      │
│  5. Write file atomically│
│  6. Update spec_link    │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  Update Session         │
│  - filename             │
│  - lastSelectedInterface│
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  Return Summary         │
│  - savedPath            │
│  - specLink             │
│  - created flag         │
└─────────────────────────┘
```

## Out of Scope

- Gateway / OpenAI integration
- Full OpenAPI schema validation (only YAML/JSON syntax validation)
- Multiple version history of specs (single latest per interface)
- Frontend UI for viewing/managing saved specs
- Spec deletion endpoint
- Bulk save operations

## Acceptance Criteria

1. **Configuration:**
   - Parent folder is configurable via `architectureModel.oas.parentFolder`
   - Max content size is configurable via `architectureModel.oas.maxBytes`
   - Defaults work for local development

2. **File Save:**
   - File is saved to: `<parentFolder>/<sanitizedFilename>/<sanitizedInterfaceName>.yml` (or `.json`)
   - Directories are created if they don't exist
   - Write is atomic (temp file + move)
   - Existing files are overwritten

3. **Database Update:**
   - `interfaces.spec_link` is updated with the absolute saved path
   - Response includes `specLink` matching `savedPath`

4. **Response Codes:**
   - 201 Created when file is new
   - 200 OK when file is overwritten
   - 400 for validation errors (missing fields, invalid format, parse errors, content too large, empty sanitized name)
   - 404 when interface or filename not found
   - 500 for IO errors

5. **MCP Tool:**
   - `save_oas_spec` tool calls Java endpoint correctly
   - Session is updated with filename and interfaceId
   - Error responses are properly mapped

6. **Security:**
   - Path traversal attempts are rejected
   - Filenames are properly sanitized

## Verification Steps

### Unit Tests

1. **FilenameSanitizerTest.java:**
   - Test sanitization of normal names
   - Test replacement of invalid characters
   - Test empty result after sanitization → throws exception
   - Test path traversal detection

2. **OasSpecServiceTest.java:**
   - Test successful YAML save (new file → created=true)
   - Test successful JSON save
   - Test overwrite (existing file → created=false)
   - Test invalid YAML content → 400
   - Test invalid JSON content → 400
   - Test content exceeds max size → 400
   - Test interface not found → 404
   - Test filename not found → 404
   - Test spec_link is updated in interface entity

3. **OasSpecControllerTest.java:**
   - Test endpoint with valid request
   - Test missing filename query param → 400
   - Test missing format → 400
   - Test missing contents → 400
   - Test invalid format value → 400

4. **saveOasSpecRoute.test.ts:**
   - Test successful save request
   - Test missing sessionId → 400
   - Test missing filename → 400
   - Test missing interfaceId → 400
   - Test invalid format → 400
   - Test backend 404 → 404
   - Test backend 500 → 502
   - Test session is updated

### Manual Verification (Postman)

1. Call `list_interfaces` to get an interface ID and filename
2. Call `get_interface_oas_context` to confirm interface name
3. Call `save_oas_spec` with:
   ```json
   {
     "sessionId": "test-session",
     "filename": "existing-model-filename",
     "interfaceId": "selected-interface-id",
     "format": "yaml",
     "oasContents": "openapi: 3.0.3\ninfo:\n  title: Test API\n  version: 1.0.0\npaths: {}"
   }
   ```
4. Verify:
   - Response contains `savedPath` and `specLink`
   - File exists on disk at the specified path
   - Database shows `interfaces.spec_link` updated
   - Calling again returns `created: false` (overwrite)

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Path traversal vulnerability | Low | High | Comprehensive sanitization + path validation |
| Disk full during write | Low | Medium | Atomic write ensures no partial files; error returned |
| Concurrent writes to same file | Low | Low | Atomic move handles this safely |
| Large content causing memory issues | Low | Medium | Max size check before processing |
| Invalid YAML/JSON accepted | Low | Low | Parse validation before save |
