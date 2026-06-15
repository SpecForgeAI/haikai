# Specification: Backend v0.1 - Confluence Draw.io Diagram API

## Goal

Create a Java 21 / Spring Boot 3.x / Maven backend service that provides a REST API to:
1. Connect to Confluence Cloud using its REST API
2. Scan specified pages (and optionally descendant pages) for draw.io diagram attachments
3. Parse draw.io XML into a neutral graph representation (nodes, edges, geometry, styles)
4. Return the parsed diagrams as JSON

This is v0.1 with intentionally limited scope - no SDD meta-model mapping, no database persistence.

## User Stories

- As a developer, I want to fetch draw.io diagrams from Confluence pages via a REST API so I can process architecture diagrams programmatically.
- As a user, I want to retrieve all diagrams from a page hierarchy so I can analyze an entire documentation space.
- As a consumer of the API, I want diagrams returned as structured JSON with nodes, edges, and geometry so I can render or transform them.

## Design Principles

**Stateless request-response architecture.**

- No database or persistent state
- Configuration-driven Confluence connectivity
- Graceful degradation (individual diagram failures don't abort the request)
- Neutral graph representation (no domain-specific mapping in v0.1)

## Scope

### In Scope (v0.1)
- REST API endpoint for fetching diagrams from Confluence pages
- Confluence Cloud authentication (username + API token)
- Attachment-based draw.io diagram discovery
- Multi-tab draw.io file support (each tab returned as separate diagram)
- Recursive child page traversal with configurable depth limit
- Draw.io XML parsing to neutral graph model
- JSON response with nodes, edges, geometry, and styles

### Out of Scope (v0.1)
- Mapping from draw.io objects to SDD meta-model (Applications, Processes, etc.)
- Database persistence
- Frontend integration
- Confluence Server/Data Center authentication
- Inline/embedded draw.io XML inside macros (only attachment-based diagrams)
- Credential management UI (read from configuration only)

## Project Structure

### Location
`architecture-store-and-diagrams/backend/`

### Maven Project
```
backend/
  pom.xml
  src/
    main/
      java/
        com/example/archtool/
          ArchToolBackendApplication.java
          config/
            ConfluenceProperties.java
            RestClientConfig.java
          controller/
            ConfluenceDiagramController.java
          service/
            ConfluenceDiagramService.java
            ConfluenceClient.java
            DrawioScanner.java
            DrawioParser.java
          model/
            dto/
              ConfluenceDiagramRequest.java
              ConfluenceDiagramResponse.java
              ConfluencePageDiagramsDto.java
              DiagramGraphDto.java
              DiagramNodeDto.java
              DiagramEdgeDto.java
              DiagramPointDto.java
              DiagramStyleDto.java
              DiagramSourceDto.java
            confluence/
              ConfluencePage.java
              ConfluenceAttachment.java
          exception/
            ConfluenceApiException.java
            DiagramParsingException.java
          util/
            XmlUtils.java
      resources/
        application.yml
        application-local.yml
    test/
      java/
        com/example/archtool/
          service/
            DrawioParserTest.java
            DrawioScannerTest.java
            ConfluenceDiagramServiceTest.java
          controller/
            ConfluenceDiagramControllerTest.java
      resources/
        test-diagrams/
          simple.drawio
          multi-tab.drawio
```

### Maven Configuration (pom.xml)
```xml
<project>
  <groupId>com.example</groupId>
  <artifactId>arch-tool-backend</artifactId>
  <version>0.1.0-SNAPSHOT</version>
  <packaging>jar</packaging>

  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.2.0</version>
  </parent>

  <properties>
    <java.version>21</java.version>
  </properties>

  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-validation</artifactId>
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-configuration-processor</artifactId>
      <optional>true</optional>
    </dependency>
    <!-- XML parsing -->
    <dependency>
      <groupId>org.jsoup</groupId>
      <artifactId>jsoup</artifactId>
      <version>1.17.2</version>
    </dependency>
    <!-- Testing -->
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-test</artifactId>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>com.squareup.okhttp3</groupId>
      <artifactId>mockwebserver</artifactId>
      <scope>test</scope>
    </dependency>
  </dependencies>
</project>
```

## Configuration

### Application Configuration (application.yml)

```yaml
server:
  port: 8080

archtool:
  confluence:
    base-url: ${CONFLUENCE_BASE_URL:https://your-domain.atlassian.net/wiki}
    username: ${CONFLUENCE_USERNAME:}
    api-token: ${CONFLUENCE_API_TOKEN:}
    connect-timeout-ms: ${CONFLUENCE_CONNECT_TIMEOUT:5000}
    read-timeout-ms: ${CONFLUENCE_READ_TIMEOUT:30000}
    max-page-depth: ${CONFLUENCE_MAX_PAGE_DEPTH:10}

logging:
  level:
    com.example.archtool: INFO
```

### Configuration Properties Class

```java
@ConfigurationProperties(prefix = "archtool.confluence")
public record ConfluenceProperties(
    String baseUrl,
    String username,
    String apiToken,
    int connectTimeoutMs,
    int readTimeoutMs,
    int maxPageDepth
) {
    public ConfluenceProperties {
        Objects.requireNonNull(baseUrl, "baseUrl must not be null");
        if (connectTimeoutMs <= 0) connectTimeoutMs = 5000;
        if (readTimeoutMs <= 0) readTimeoutMs = 30000;
        if (maxPageDepth <= 0) maxPageDepth = 10;
    }
}
```

## REST API

### Endpoint

**Method:** GET
**Path:** `/api/confluence/diagrams`

### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `pageId` | string | Yes | - | Confluence page ID to scan |
| `includeAllChildPages` | boolean | No | false | Whether to recursively scan descendant pages |
| `maxDepth` | integer | No | 10 | Maximum depth for child page traversal (only applies when includeAllChildPages=true) |

### Success Response (200 OK)

```json
{
  "rootPageId": "123456",
  "rootPageTitle": "FI Rates Trader Workflow",
  "includeAllChildPages": true,
  "maxDepth": 10,
  "pages": [
    {
      "pageId": "123456",
      "pageTitle": "FI Rates Trader Workflow",
      "diagrams": [
        {
          "diagramId": "diag_123456_att789_0",
          "diagramName": "FI Rates Trader Workflow",
          "tabIndex": 0,
          "tabName": "Overview",
          "source": {
            "type": "CONFLUENCE_DRAWIO_ATTACHMENT",
            "pageId": "123456",
            "attachmentId": "att-789",
            "attachmentFileName": "fi-rates-workflow.drawio"
          },
          "nodes": [
            {
              "id": "n1",
              "label": "Flow Pricing",
              "geometry": {
                "x": 100.0,
                "y": 200.0,
                "width": 120.0,
                "height": 60.0
              },
              "style": {
                "rawStyle": "rounded=1;fillColor=#aaffaa;strokeColor=#000000;",
                "fillColor": "#aaffaa",
                "strokeColor": "#000000",
                "shape": "rectangle",
                "rounded": true
              },
              "parentId": null
            }
          ],
          "edges": [
            {
              "id": "e1",
              "sourceId": "n1",
              "targetId": "n2",
              "label": "Enquiry",
              "points": [
                { "x": 160.0, "y": 230.0 },
                { "x": 300.0, "y": 230.0 }
              ],
              "style": {
                "rawStyle": "endArrow=classic;dashed=1;strokeColor=#666666;",
                "strokeColor": "#666666",
                "dashed": true,
                "startArrow": null,
                "endArrow": "classic"
              }
            }
          ]
        }
      ]
    }
  ],
  "summary": {
    "totalPages": 5,
    "totalDiagrams": 12,
    "totalNodes": 156,
    "totalEdges": 203,
    "warnings": [
      "Page 123457: Attachment 'missing.drawio' referenced in macro but not found",
      "Page 123458: Failed to parse 'corrupt.drawio': Invalid XML structure"
    ]
  }
}
```

### Error Responses

| Status | Condition | Response Body |
|--------|-----------|---------------|
| 400 | Missing pageId, invalid maxDepth | `{"error": "BAD_REQUEST", "message": "pageId is required"}` |
| 401 | Invalid credentials | `{"error": "UNAUTHORIZED", "message": "Confluence authentication failed"}` |
| 403 | No access to page | `{"error": "FORBIDDEN", "message": "Access denied to page 123456"}` |
| 404 | Page not found | `{"error": "NOT_FOUND", "message": "Page 123456 not found"}` |
| 500 | Unexpected error | `{"error": "INTERNAL_ERROR", "message": "Unexpected error processing request"}` |

## Data Transfer Objects

### DiagramGraphDto

```java
public record DiagramGraphDto(
    String diagramId,
    String diagramName,
    int tabIndex,
    String tabName,
    DiagramSourceDto source,
    List<DiagramNodeDto> nodes,
    List<DiagramEdgeDto> edges
) {}
```

### DiagramNodeDto

```java
public record DiagramNodeDto(
    String id,
    String label,
    DiagramGeometryDto geometry,
    DiagramStyleDto style,
    String parentId
) {}

public record DiagramGeometryDto(
    Double x,
    Double y,
    Double width,
    Double height
) {}
```

### DiagramEdgeDto

```java
public record DiagramEdgeDto(
    String id,
    String sourceId,
    String targetId,
    String label,
    List<DiagramPointDto> points,
    DiagramStyleDto style
) {}

public record DiagramPointDto(
    double x,
    double y
) {}
```

### DiagramStyleDto

```java
public record DiagramStyleDto(
    String rawStyle,
    String fillColor,
    String strokeColor,
    String fontColor,
    String shape,
    Boolean rounded,
    Boolean dashed,
    String startArrow,
    String endArrow,
    Integer fontSize,
    String fontFamily
) {}
```

### DiagramSourceDto

```java
public record DiagramSourceDto(
    String type,  // "CONFLUENCE_DRAWIO_ATTACHMENT"
    String pageId,
    String attachmentId,
    String attachmentFileName
) {}
```

## Service Components

### ConfluenceClient

Handles all HTTP communication with Confluence REST API.

```java
@Service
public class ConfluenceClient {

    /**
     * Fetch page metadata including body.storage
     * GET /rest/api/content/{id}?expand=body.storage,version
     */
    public ConfluencePage getPage(String pageId);

    /**
     * Fetch child pages recursively up to maxDepth
     * GET /rest/api/content/{id}/child/page
     */
    public List<ConfluencePage> getChildPages(String pageId, int maxDepth);

    /**
     * Fetch all attachments for a page (handles pagination)
     * GET /rest/api/content/{pageId}/child/attachment
     */
    public List<ConfluenceAttachment> getAttachments(String pageId);

    /**
     * Download attachment content as byte array
     * GET {attachment.downloadUrl}
     */
    public byte[] downloadAttachment(ConfluenceAttachment attachment);
}
```

### DrawioScanner

Discovers draw.io diagram references on Confluence pages.

```java
@Service
public class DrawioScanner {

    /**
     * Scan page body.storage for draw.io macro references
     * Match referenced filenames with attachments
     * Return list of diagram sources to process
     */
    public List<DrawioDiagramSource> scanPage(ConfluencePage page);
}
```

**Scanning Rules:**
1. Parse `body.storage` as HTML/XML
2. Find `<ac:structured-macro ac:name="drawio">` or `ac:name="diagrams.net"` elements
3. Extract filename from `<ac:parameter ac:name="diagramName">` or similar
4. Match filename with attachments having `.drawio` or `.xml` extension
5. For attachments not referenced by macros but having `.drawio` extension, include them as well
6. Return `DrawioDiagramSource` for each match

### DrawioParser

Parses draw.io XML into neutral graph model.

```java
@Service
public class DrawioParser {

    /**
     * Parse draw.io XML content into diagram graphs
     * Handles multi-tab files (returns one DiagramGraphDto per tab)
     */
    public List<DiagramGraphDto> parse(byte[] xmlContent, DiagramSourceDto source);
}
```

**Parsing Rules:**

1. **Root Structure:**
   - Parse `<mxfile>` root element
   - Each `<diagram>` child represents a tab/page
   - Extract tab name from `<diagram name="...">` attribute

2. **Node Extraction:**
   - Find `<mxCell>` elements with `vertex="1"` attribute
   - Extract `id` from `@id` attribute
   - Extract `label` from `@value` attribute (unescape HTML entities)
   - Extract geometry from child `<mxGeometry>`: `@x`, `@y`, `@width`, `@height`
   - Extract `parentId` from `@parent` attribute (for grouped elements)
   - Parse `@style` attribute into `DiagramStyleDto`

3. **Edge Extraction:**
   - Find `<mxCell>` elements with `edge="1"` attribute
   - Extract `id`, `sourceId` (`@source`), `targetId` (`@target`)
   - Extract `label` from `@value` attribute
   - Extract points from `<mxGeometry>`:
     - `<mxPoint as="sourcePoint">` → first point
     - `<mxPoint as="targetPoint">` → last point
     - `<Array as="points"><mxPoint>` → intermediate points
   - Parse `@style` attribute into `DiagramStyleDto`

4. **Style Parsing:**
   - Style format: `key1=value1;key2=value2;...`
   - Extract known properties:
     - `fillColor`, `strokeColor`, `fontColor`
     - `shape` (or infer from style keys like `ellipse`, `rhombus`)
     - `rounded` (boolean)
     - `dashed` (boolean)
     - `startArrow`, `endArrow`
     - `fontSize`, `fontFamily`
   - Always preserve `rawStyle` for unrecognized properties

5. **Error Handling:**
   - Invalid XML → throw `DiagramParsingException`
   - Missing geometry → set to null, include node/edge
   - Missing source/target on edge → log warning, include edge with null IDs

### ConfluenceDiagramService

Orchestrates the entire flow.

```java
@Service
public class ConfluenceDiagramService {

    /**
     * Main orchestration method
     */
    public ConfluenceDiagramResponse fetchDiagrams(
        String pageId,
        boolean includeAllChildPages,
        int maxDepth
    );
}
```

**Orchestration Flow:**

1. Fetch root page via `ConfluenceClient.getPage()`
2. If `includeAllChildPages=true`: Fetch child pages via `ConfluenceClient.getChildPages()` up to `maxDepth`
3. For each page:
   a. Fetch attachments via `ConfluenceClient.getAttachments()`
   b. Scan for draw.io references via `DrawioScanner.scanPage()`
   c. For each diagram source:
      - Download attachment content
      - Parse via `DrawioParser.parse()`
      - Collect results or warnings
4. Build response with all pages, diagrams, and summary

## Controller

```java
@RestController
@RequestMapping("/api/confluence")
public class ConfluenceDiagramController {

    @GetMapping("/diagrams")
    public ResponseEntity<ConfluenceDiagramResponse> getDiagrams(
        @RequestParam String pageId,
        @RequestParam(defaultValue = "false") boolean includeAllChildPages,
        @RequestParam(required = false) Integer maxDepth
    ) {
        // Validate parameters
        // Call service
        // Return response
    }
}
```

## Error Handling

### Exception Classes

```java
public class ConfluenceApiException extends RuntimeException {
    private final int statusCode;
    private final String confluenceError;
    // ...
}

public class DiagramParsingException extends RuntimeException {
    private final String diagramSource;
    private final String parseError;
    // ...
}
```

### Global Exception Handler

```java
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(ConfluenceApiException.class)
    public ResponseEntity<ErrorResponse> handleConfluenceError(ConfluenceApiException e);

    @ExceptionHandler(DiagramParsingException.class)
    public ResponseEntity<ErrorResponse> handleParsingError(DiagramParsingException e);

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> handleValidationError(MethodArgumentNotValidException e);
}
```

## Non-Functional Requirements

### Performance
- Paginate all Confluence API calls (default limit: 25, max: 100)
- Log processing metrics: pages scanned, diagrams found, nodes/edges parsed
- Consider parallel attachment downloads for pages with many diagrams (future enhancement)

### Logging
- INFO: Request start/end, page count, diagram count
- WARN: Missing attachments, parsing failures, skipped diagrams
- DEBUG: Confluence API calls, XML parsing details
- ERROR: Unexpected exceptions

### Security
- Never log credentials (username, API token)
- Use HTTPS for all Confluence communication
- Validate and sanitize pageId parameter

### Testing

**Unit Tests:**
- `DrawioParserTest`: Parse various draw.io XML structures
- `DrawioScannerTest`: Extract diagram references from HTML body
- Style parsing edge cases

**Integration Tests:**
- `ConfluenceDiagramServiceTest`: Mock HTTP responses, verify orchestration
- `ConfluenceDiagramControllerTest`: API contract, error responses

**Test Resources:**
- Sample `.drawio` files with various structures
- Sample Confluence page HTML with macros
- Multi-tab draw.io files

## Acceptance Criteria

### Functional
- [ ] GET `/api/confluence/diagrams?pageId=X` returns root page with diagrams
- [ ] `includeAllChildPages=true` returns additional child pages and their diagrams
- [ ] `maxDepth` parameter limits child page traversal depth
- [ ] Multi-tab draw.io files return separate diagram entries per tab
- [ ] Each diagram includes nodes with geometry (x, y, width, height)
- [ ] Each diagram includes edges with source/target IDs and points
- [ ] Style information (colors, shapes, arrows) is extracted
- [ ] Missing attachments produce warnings but don't fail the request
- [ ] Malformed draw.io XML produces warnings but doesn't fail the request
- [ ] JSON response structure matches specification

### Non-Functional
- [ ] Application starts with `mvn spring-boot:run`
- [ ] Unit tests pass with `mvn test`
- [ ] Configuration via environment variables works
- [ ] Appropriate logging at each level
- [ ] No credentials in logs

## Out of Scope (Future Versions)

- Confluence Server/Data Center support (different authentication)
- Inline/embedded draw.io XML (stored in macro body, not attachment)
- Mapping to SDD meta-model entities
- Database persistence
- Caching of Confluence responses
- Webhook/polling for diagram changes
- Support for other diagram formats (Lucidchart, Miro, etc.)

## Implementation Notes

### Draw.io XML Structure Reference

```xml
<mxfile>
  <diagram id="tab1" name="Overview">
    <mxGraphModel>
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <!-- Node -->
        <mxCell id="n1" value="Flow Pricing" style="rounded=1;fillColor=#aaffaa;"
                vertex="1" parent="1">
          <mxGeometry x="100" y="200" width="120" height="60" as="geometry"/>
        </mxCell>
        <!-- Edge -->
        <mxCell id="e1" value="Enquiry" style="endArrow=classic;"
                edge="1" source="n1" target="n2" parent="1">
          <mxGeometry relative="1" as="geometry">
            <mxPoint x="160" y="230" as="sourcePoint"/>
            <mxPoint x="300" y="230" as="targetPoint"/>
          </mxGeometry>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
  <diagram id="tab2" name="Detail View">
    <!-- ... -->
  </diagram>
</mxfile>
```

### Confluence Macro Reference

```xml
<ac:structured-macro ac:name="drawio">
  <ac:parameter ac:name="diagramName">fi-rates-workflow.drawio</ac:parameter>
  <ac:parameter ac:name="width">800</ac:parameter>
  <!-- other parameters -->
</ac:structured-macro>
```

### Diagram ID Generation

For multi-tab files, generate unique diagram IDs:
```
Format: diag_{pageId}_{attachmentId}_{tabIndex}
Example: diag_123456_att789_0, diag_123456_att789_1
```

This ensures globally unique IDs while preserving traceability to source.
