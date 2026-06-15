# Specification: Backend Confluence draw.io Scanner - ADF/Forge Macro Support

## Goal

Extend the `DrawioScanner` backend service to recognize and parse ADF (Atlassian Document Format) based draw.io macros used in Confluence Cloud with the Forge-based draw.io Board/Diagram macro, while maintaining full backward compatibility with the existing structured-macro parsing.

## User Stories

- As a system integrator, I want the scanner to detect draw.io diagrams on Confluence Cloud pages using the new Forge-based draw.io macros so that diagrams are not missed during scanning.
- As a developer, I want orphan `application/vnd.jgraph.mxfile` attachments to be treated as diagrams so that all draw.io content is discovered regardless of macro presence.

## Specific Requirements

**1. New AdfDiagramRef Record**
- Create a new private record `AdfDiagramRef(String attachmentId, String diagramName)` inside `DrawioScanner`
- This record holds the extracted data from ADF macro nodes before matching with attachments
- The `attachmentId` corresponds to the `cust-content-id` parameter from the ADF structure
- The `diagramName` corresponds to the `diagram-name` parameter (may be null if not present)

**2. New extractAdfDiagramRefs Method**
- Add method signature: `List<AdfDiagramRef> extractAdfDiagramRefs(String bodyStorage)`
- Parse bodyStorage using `Jsoup.parse(bodyStorage, "", Parser.xmlParser())`
- Select ADF extension nodes using selector: `ac|adf-extension, adf-extension`
- Within each extension, find nested `ac|adf-node[type=extension], adf-node[type=extension]` elements
- Check for draw.io identification via migration-key or extension-key patterns
- Extract `cust-content-id` and `diagram-name` from the nested parameter structure
- Return empty list on parsing errors (log warning, do not throw)

**3. ADF Draw.io Macro Identification**
- A macro is identified as draw.io if ANY of these conditions is true:
  - Has `ac:adf-attribute key="extension-key"` containing "drawio", "draw.io", or "drawio-sketch" (case-insensitive)
  - Has `ac:adf-attribute key="extension-title"` containing "drawio" or "draw.io" (case-insensitive)
  - Has nested parameter with `key="migration-key"` and value `com.mxgraph.confluence.plugins.diagramly`
- Use Jsoup CSS selectors with fallback: check both `ac:adf-attribute` and `adf-attribute` tag names
- Check attribute `key` with both `ac:key` and `key` patterns for namespace robustness

**4. ADF Parameter Extraction Logic**
- Navigate the nested ADF structure: extension -> extension-properties -> guest-params
- Within guest-params, find parameters by key name: `diagram-name`, `cust-content-id`
- For each parameter element, try `ac:adf-parameter[ac:key=X]`, then `adf-parameter[key=X]`
- Extract text content and trim whitespace
- Skip entries where `cust-content-id` is missing or blank (log debug message for skipped entries)

**5. Extension of scanPage Method**
- Keep ALL existing structured-macro detection logic unchanged
- Build a new `Map<String, ConfluenceAttachment> attachmentsById` from attachments using `Collectors.toMap(ConfluenceAttachment::id, ...)`
- After structured-macro processing, call `extractAdfDiagramRefs(page.bodyStorage())`
- For each `AdfDiagramRef`, lookup attachment by ID in the new map
- If found: create `DrawioDiagramSource.fromMacroReference()`, add attachment title to `matchedAttachmentNames`
- If not found: log warning with page ID, diagram name, and missing attachment ID

**6. Extension of findOrphanDrawioAttachments Method**
- Current logic only checks: `title.toLowerCase().endsWith(".drawio")`
- Add additional check: `mediaType` equals `"application/vnd.jgraph.mxfile"` (case-insensitive comparison)
- An attachment is a candidate diagram if EITHER condition is true
- Continue to exclude attachments already in `matchedAttachmentNames`
- Use existing `DrawioDiagramSource.fromOrphanAttachment()` factory method

**7. New Constants**
- Add constant: `MXFILE_MEDIA_TYPE = "application/vnd.jgraph.mxfile"`
- Add constant: `MIGRATION_KEY_VALUE = "com.mxgraph.confluence.plugins.diagramly"`
- Add constant pattern for draw.io extension key detection (regex or contains check)

**8. Logging Improvements**
- Log at DEBUG level: count of ADF draw.io macros found and count successfully matched to attachments
- Log at DEBUG level: each successful ADF macro-to-attachment match (page ID, diagram name, attachment ID, attachment title)
- Log at WARN level: ADF macro references attachment ID not found in attachments list
- Log at INFO level: when falling back to orphan detection because no macros (structured or ADF) were found but mxfile attachments exist
- Log at DEBUG level: each orphan mxfile attachment discovered (attachment ID and title)

## Visual Design

No visual assets provided - this is a backend-only change with no UI components.

## Existing Code to Leverage

**DrawioScanner.java - Jsoup XML Parsing Pattern**
- Reuse the existing `Jsoup.parse(bodyStorage, "", Parser.xmlParser())` approach
- Follow the established pattern of using dual selectors for namespace handling: `ac|element, element`
- Apply the same attribute extraction pattern: try `ac:attrName` first, then `attrName` as fallback

**DrawioScanner.java - Attachment Map Building**
- Extend the existing `attachmentsByName` map pattern to create an `attachmentsById` map
- Use the same `Collectors.toMap()` approach with duplicate handling: `(existing, replacement) -> existing`

**DrawioScanner.java - Logging Pattern**
- Follow established logging conventions using `LoggerFactory.getLogger(DrawioScanner.class)`
- Use consistent log message format: "Page {}: ..." with page ID as first parameter
- Match existing verbosity levels (DEBUG for details, WARN for issues, INFO for summaries)

**DrawioDiagramSource.java - Factory Methods**
- Reuse `DrawioDiagramSource.fromMacroReference()` for ADF-matched diagrams (they ARE referenced by macro)
- Reuse `DrawioDiagramSource.fromOrphanAttachment()` for mxfile orphans
- No changes needed to DrawioDiagramSource record itself

**DrawioScannerTest.java - Test Fixture Pattern**
- Follow existing `loadTestResource()` helper method pattern
- Place new HTML fixtures in `test-confluence-html/` directory
- Use `@DisplayName` annotations for clear test documentation
- Structure tests with Given/When/Then comments

## Out of Scope

- No changes to the REST API contract for Confluence scanning endpoints
- No changes to `ConfluenceClient` or API response parsing
- No changes to `ConfluenceDiagramService` orchestration layer
- No changes to diagram content parsing or conversion logic (`DrawioParser`)
- No changes to `DrawioDiagramSource` record structure
- No changes to `ConfluenceAttachment` record structure
- No database persistence or caching changes
- No authentication or multi-tenant changes
- No frontend changes
- No support for other diagram types beyond draw.io/diagrams.net
- No support for ADF macros from other vendors
