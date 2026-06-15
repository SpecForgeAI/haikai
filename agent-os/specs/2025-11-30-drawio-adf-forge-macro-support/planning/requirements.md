# Spec Requirements: Backend Confluence draw.io Scanner - ADF/Forge Macro Support

## Initial Description

Extend the `DrawioScanner` backend service to support the new ADF (Atlassian Document Format) based draw.io macros used in Confluence Cloud with the Forge-based draw.io Board/Diagram macro. The current implementation only parses `<ac:structured-macro>` elements, but newer Confluence Cloud pages use `<ac:adf-extension>` / `<ac:adf-node type="extension">` elements with a different parameter structure.

## Requirements Discussion

### Source Context

This is a backend-only change (Java 21 / Spring Boot) that extends the existing `DrawioScanner` service. The raw idea document is highly detailed and technically complete, so no clarifying questions were needed. Instead, this requirements document captures the existing codebase patterns and the extension points for implementation.

### Existing Code to Reference

**Similar Features Identified:**

- **DrawioScanner** - Path: `backend/src/main/java/com/example/archtool/service/DrawioScanner.java`
  - The main service to be extended
  - Contains the structured-macro parsing logic to preserve
  - Has the `scanPage()` orchestration method to extend
  - Uses Jsoup with XML parser for parsing Confluence storage format

- **DrawioDiagramSource** - Path: `backend/src/main/java/com/example/archtool/model/internal/DrawioDiagramSource.java`
  - Internal record for representing discovered diagram sources
  - Has factory methods: `fromMacroReference()` and `fromOrphanAttachment()`
  - May need extension for ADF-specific metadata

- **ConfluenceAttachment** - Path: `backend/src/main/java/com/example/archtool/model/confluence/ConfluenceAttachment.java`
  - Record with fields: `id`, `title`, `downloadUrl`, `mediaType`
  - The `mediaType` field is key for the new `application/vnd.jgraph.mxfile` detection

- **ConfluencePage** - Path: `backend/src/main/java/com/example/archtool/model/confluence/ConfluencePage.java`
  - Record with fields: `id`, `title`, `bodyStorage`, `version`
  - The `bodyStorage` field contains the XHTML content to parse

- **DrawioScannerTest** - Path: `backend/src/test/java/com/example/archtool/service/DrawioScannerTest.java`
  - Test patterns using JUnit 5
  - Uses HTML fixture files from `test-confluence-html/` resources
  - Helper method `loadTestResource()` for loading fixtures

- **Test Fixtures** - Path: `backend/src/test/resources/test-confluence-html/`
  - `page-with-drawio-macro.html` - Single structured-macro example
  - `page-with-multiple-macros.html` - Multiple macros (drawio and diagrams.net)
  - `page-without-diagrams.html` - No diagram content

## Visual Assets

### Files Provided:
No visual assets provided.

## Requirements Summary

### Functional Requirements

Based on the detailed raw idea, the following capabilities must be implemented:

**1. New ADF Parsing Path**
- Add method `extractAdfDiagramRefs(String bodyStorage)` returning `List<AdfDiagramRef>`
- New record: `record AdfDiagramRef(String attachmentId, String diagramName) {}`
- Parse bodyStorage with `Jsoup.parse(bodyStorage, "", Parser.xmlParser())`
- Select ADF extension nodes via:
  - `doc.select("ac|adf-extension ac|adf-node[type=extension], adf-extension adf-node[type=extension]")`
- Identify draw.io macros by:
  - `ac:adf-parameter key="migration-key"` with value `com.mxgraph.confluence.plugins.diagramly`
  - OR `extension-key`, `extension-title` containing "drawio" / "draw.io" / "drawio-sketch"
- Extract from `guest-params`:
  - `diagramName` from `diagram-name` parameter
  - `attachmentId` from `cust-content-id` parameter (string)
- Trim values, ignore entries with missing/blank `cust-content-id`
- Log debug info for skipped ADF macros

**2. Matching ADF Macros to Attachments**
- In `scanPage()`:
  - Keep existing structured-macro path unchanged
  - Build `Map<String, ConfluenceAttachment> attachmentsById` from attachments
  - Keep existing `attachmentsByName` map
  - Call `extractAdfDiagramRefs()` and for each ref:
    - Lookup attachment by `ref.attachmentId()`
    - If found: create `DrawioDiagramSource`, add to `matchedAttachmentNames`
    - If not found: log warning with page id, diagram name, and attachment id

**3. Legacy Structured-Macro Support**
- Preserve existing `extractMacroFilenames()` implementation
- Continue supporting `<ac:structured-macro ac:name="drawio">` and `<ac:structured-macro ac:name="diagrams.net">`
- Match against attachments by name (existing behavior)

**4. MXFile Attachment Orphan Support**
- Update `findOrphanDrawioAttachments()`:
  - Current: only `title.toLowerCase().endsWith(".drawio")`
  - New: also check `mediaType` equals `"application/vnd.jgraph.mxfile"` (case-insensitive)
- Exclude attachments already in `matchedAttachmentNames`
- Continue using `DrawioDiagramSource.fromOrphanAttachment()`

**5. Logging and Diagnostics**
- When parsing ADF macros: log count of candidate macros found and successful matches
- When no macros (structured or ADF) found but mxfile attachments exist: log fallback to orphan detection

**6. Unit Tests**
Required test cases:
- ADF macro with `migration-key = com.mxgraph.confluence.plugins.diagramly` and `guest-params` with `diagram-name` and `cust-content-id`
- Attachments including PNG preview and mxfile attachment with matching id
- Assert `scanPage()` returns correct `DrawioDiagramSource`
- Test with no macros but `application/vnd.jgraph.mxfile` attachment (orphan detection)
- Regression tests for legacy `<ac:structured-macro>` behavior

### Existing Codebase Patterns to Follow

**Jsoup XML Parsing Pattern:**
```java
Document doc = Jsoup.parse(bodyStorage, "", Parser.xmlParser());
Elements macros = doc.select("ac|structured-macro, structured-macro");
```

**Attribute Extraction Pattern:**
```java
String name = macro.attr("ac:name");
if (name.isEmpty()) {
    name = macro.attr("name");
}
```

**Logging Pattern:**
```java
private static final Logger log = LoggerFactory.getLogger(DrawioScanner.class);
log.debug("Found {} draw.io macro references in page {}", macroFilenames.size(), page.id());
log.warn("Page {}: Macro references '{}' but no matching attachment found", page.id(), macroFilename);
log.info("Page {}: Found {} diagram sources ({} from macros, {} orphan attachments)", ...);
```

**Attachment Map Building Pattern:**
```java
Map<String, ConfluenceAttachment> attachmentsByName = attachments.stream()
    .collect(Collectors.toMap(
        att -> att.title().toLowerCase(),
        Function.identity(),
        (existing, replacement) -> existing
    ));
```

**Test Resource Loading Pattern:**
```java
private String loadTestResource(String resourcePath) throws IOException {
    try (var inputStream = getClass().getClassLoader().getResourceAsStream(resourcePath)) {
        if (inputStream == null) {
            throw new IOException("Resource not found: " + resourcePath);
        }
        return new String(inputStream.readAllBytes(), StandardCharsets.UTF_8);
    }
}
```

**Test Fixture Format:**
```html
<ac:structured-macro ac:name="drawio" ac:schema-version="1" ac:macro-id="12345">
    <ac:parameter ac:name="diagramName">system-architecture.drawio</ac:parameter>
    <ac:parameter ac:name="width">800</ac:parameter>
</ac:structured-macro>
```

### Reusability Opportunities

- Existing `DrawioDiagramSource.fromMacroReference()` factory can be reused for ADF-matched diagrams
- Existing Jsoup XML parsing setup can be extended
- Same `matchedAttachmentNames` tracking mechanism for both macro types
- Test fixture approach can be extended with new ADF HTML fixtures

### Scope Boundaries

**In Scope:**
- New `extractAdfDiagramRefs()` method in DrawioScanner
- New `AdfDiagramRef` record (can be private/package-private)
- Extension of `scanPage()` to call ADF extraction
- Extension of `findOrphanDrawioAttachments()` for mxfile mediaType
- New test fixtures for ADF macro HTML content
- Unit tests for all new functionality
- Regression tests for existing structured-macro behavior

**Out of Scope:**
- Changes to REST API contract
- Changes to diagram parsing/conversion logic
- Changes to ConfluenceClient
- Changes to ConfluenceDiagramService (orchestration layer)
- Multi-user or authentication changes
- Database persistence

### Technical Considerations

**Dependencies (already present):**
- Jsoup 1.17.2 for HTML/XML parsing
- SLF4J for logging
- JUnit 5 for testing
- Spring Boot 3.2.0

**ADF Structure to Parse:**
The raw idea specifies the following ADF structure in `body.storage`:
- `<ac:adf-extension>` or `<ac:adf-node type="extension">`
- `<ac:adf-attribute key="extension-key">...drawio-sketch</ac:adf-attribute>`
- Under `extension-properties`:
  - `migration-key = "com.mxgraph.confluence.plugins.diagramly"`
- Under `guest-params`:
  - `diagram-name` - the display name
  - `cust-content-id` - the Confluence attachment id

**New Media Type:**
- `application/vnd.jgraph.mxfile` - indicates a draw.io mxfile attachment

**Matching Strategy:**
- Structured macros: match by filename (existing)
- ADF macros: match by attachment ID (new)
- Both approaches populate `matchedAttachmentNames` to prevent duplicates

### Files to Modify

1. `backend/src/main/java/com/example/archtool/service/DrawioScanner.java`
   - Add `AdfDiagramRef` record
   - Add `extractAdfDiagramRefs()` method
   - Extend `scanPage()` with ADF extraction
   - Extend `findOrphanDrawioAttachments()` for mxfile mediaType
   - Add new constants for ADF detection

2. `backend/src/test/java/com/example/archtool/service/DrawioScannerTest.java`
   - Add test cases for ADF macro detection
   - Add test cases for mxfile orphan detection
   - Ensure regression coverage for structured-macro

3. `backend/src/test/resources/test-confluence-html/`
   - Add `page-with-adf-drawio-macro.html` fixture
   - Add `page-with-mxfile-attachment-only.html` fixture (if needed)
