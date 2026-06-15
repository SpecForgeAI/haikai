# Task Breakdown: Backend Confluence draw.io Scanner - ADF/Forge Macro Support

## Overview
Total Tasks: 8 Task Groups with 36 Sub-tasks

This feature extends the `DrawioScanner` service to support the new ADF (Atlassian Document Format) based draw.io macros used in Confluence Cloud with the Forge-based draw.io Board/Diagram macro.

## Task List

---

### Task Group 1: Test Fixtures First
**Dependencies:** None

Create sample ADF XML body storage fixtures before writing any code. This ensures we have realistic test data based on actual Confluence Cloud ADF structure.

- [x] 1.0 Complete test fixture creation
  - [x] 1.1 Create ADF draw.io macro fixture file
    - File to create: `backend/src/test/resources/test-confluence-html/page-with-adf-drawio-macro.html`
    - Must include `<ac:adf-extension>` wrapper element
    - Must include `<ac:adf-node type="extension">` element
    - Must include `<ac:adf-attribute key="extension-key">` with value containing `drawio-sketch`
    - Must include `migration-key` parameter with value `com.mxgraph.confluence.plugins.diagramly`
    - Must include `guest-params` section with:
      - `diagram-name` = "My Architecture Diagram"
      - `cust-content-id` = "131287" (sample attachment ID)
    - Follow existing fixture pattern from `page-with-drawio-macro.html`
  - [x] 1.2 Create ADF fixture with multiple diagrams
    - File to create: `backend/src/test/resources/test-confluence-html/page-with-multiple-adf-macros.html`
    - Include 2-3 ADF draw.io macros with different `cust-content-id` values
    - Include mix of Board and Diagram macro types
    - Useful for testing multiple diagram extraction
  - [x] 1.3 Create mixed legacy + ADF fixture
    - File to create: `backend/src/test/resources/test-confluence-html/page-with-mixed-macros.html`
    - Include both `<ac:structured-macro ac:name="drawio">` (legacy)
    - AND `<ac:adf-extension>` based macro (new)
    - Tests backward compatibility when both formats exist on same page
  - [x] 1.4 Create mxfile orphan attachment test fixture
    - File to create: `backend/src/test/resources/test-confluence-html/page-with-no-macros-mxfile-attachment.html`
    - Page body with no draw.io macros at all (neither structured nor ADF)
    - Will be used with attachments list containing `application/vnd.jgraph.mxfile` attachment
  - [x] 1.5 Verify fixture files are loadable
    - Run a simple test that loads each new fixture with `loadTestResource()`
    - Ensure no encoding or path issues

**Acceptance Criteria:**
- All 4 fixture files created and placed in `test-confluence-html/` directory
- Fixtures follow XML/XHTML format matching Confluence storage format
- Each fixture is well-documented with comments explaining its purpose

---

### Task Group 2: Data Model
**Dependencies:** Task Group 1 (for understanding ADF structure)

Add the `AdfDiagramRef` record and any new constants needed for ADF parsing.

- [x] 2.0 Complete data model additions
  - [x] 2.1 Add AdfDiagramRef record to DrawioScanner
    - File to modify: `backend/src/main/java/com/example/archtool/service/DrawioScanner.java`
    - Add package-private record: `record AdfDiagramRef(String attachmentId, String diagramName) {}`
    - Place after existing constants, before `scanPage()` method
    - Add Javadoc explaining this holds ADF-extracted diagram references
  - [x] 2.2 Add ADF-related constants
    - File to modify: `backend/src/main/java/com/example/archtool/service/DrawioScanner.java`
    - Add constant: `private static final String MXGRAPH_MIGRATION_KEY = "com.mxgraph.confluence.plugins.diagramly";`
    - Add constant: `private static final String MXFILE_MEDIA_TYPE = "application/vnd.jgraph.mxfile";`
    - Add constant: `private static final String ADF_PARAM_DIAGRAM_NAME = "diagram-name";`
    - Add constant: `private static final String ADF_PARAM_CONTENT_ID = "cust-content-id";`
    - Add constant: `private static final String ADF_EXTENSION_KEY_DRAWIO = "drawio";`
  - [x] 2.3 Verify constants compile
    - Ensure no typos or duplicate constant names
    - Constants follow existing naming convention (SCREAMING_SNAKE_CASE)

**Acceptance Criteria:**
- `AdfDiagramRef` record is defined and compiles
- All new constants are defined and follow existing naming patterns
- Code compiles without errors

---

### Task Group 3: ADF Extraction
**Dependencies:** Task Group 2

Implement the `extractAdfDiagramRefs()` method to parse ADF-based draw.io macros from page body storage.

- [x] 3.0 Complete ADF extraction implementation
  - [x] 3.1 Write 4-6 focused unit tests for `extractAdfDiagramRefs()`
    - File to modify: `backend/src/test/java/com/example/archtool/service/DrawioScannerTest.java`
    - Test 1: Valid ADF macro with migration-key returns correct `AdfDiagramRef`
    - Test 2: ADF macro with extension-key containing "drawio" is detected
    - Test 3: ADF macro missing `cust-content-id` returns empty list
    - Test 4: Multiple ADF macros returns correct count of refs
    - Test 5: Mixed content (text + ADF macros) extracts only macros
    - Test 6: Empty/null bodyStorage returns empty list
    - Use fixtures created in Task Group 1
  - [x] 3.2 Implement `extractAdfDiagramRefs()` method
    - File to modify: `backend/src/main/java/com/example/archtool/service/DrawioScanner.java`
    - Method signature: `List<AdfDiagramRef> extractAdfDiagramRefs(String bodyStorage)`
    - Make method package-private (like `extractMacroFilenames`)
    - Parse using: `Jsoup.parse(bodyStorage, "", Parser.xmlParser())`
    - Select ADF nodes: `doc.select("ac|adf-extension ac|adf-node[type=extension], adf-extension adf-node[type=extension]")`
  - [x] 3.3 Implement draw.io macro identification logic
    - For each ADF node, check if it's a draw.io macro by:
      - Having `ac:adf-parameter key="migration-key"` with value matching `MXGRAPH_MIGRATION_KEY`
      - OR having `extension-key`, `extension-title` containing "drawio", "draw.io", or "drawio-sketch"
    - Extract helper method: `private boolean isAdfDrawioMacro(Element adfNode)`
  - [x] 3.4 Implement guest-params extraction
    - Navigate to `guest-params` section within the ADF node
    - Extract `diagram-name` parameter value (trim whitespace)
    - Extract `cust-content-id` parameter value (trim whitespace)
    - Skip entries where `cust-content-id` is missing or blank
    - Log debug info: `log.debug("Found ADF draw.io macro: diagramName='{}', attachmentId='{}'", ...)`
  - [x] 3.5 Add error handling and logging for skipped macros
    - Wrap parsing in try-catch, log warning on parse errors
    - Log debug when skipping ADF macros (missing cust-content-id, not a drawio macro)
    - Log summary: `log.debug("Extracted {} ADF diagram references from body storage", refs.size())`
  - [x] 3.6 Run ADF extraction tests
    - Run ONLY the 4-6 tests written in 3.1
    - Verify all tests pass
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- `extractAdfDiagramRefs()` correctly parses ADF draw.io macros
- Returns empty list for non-draw.io ADF macros
- Handles malformed input gracefully with logging
- All 4-6 unit tests pass

---

### Task Group 4: Scanner Integration
**Dependencies:** Task Group 3

Modify `scanPage()` to call ADF extraction and match ADF macros to attachments by ID.

- [x] 4.0 Complete scanner integration
  - [x] 4.1 Write 4-6 focused tests for ADF integration in scanPage
    - File to modify: `backend/src/test/java/com/example/archtool/service/DrawioScannerTest.java`
    - Test 1: `scanPage()` with ADF macro returns `DrawioDiagramSource` matched by attachment ID
    - Test 2: ADF macro with non-existent attachment ID logs warning, returns empty
    - Test 3: Mixed page (legacy + ADF macros) returns sources for both
    - Test 4: ADF-matched attachment is excluded from orphan detection
    - Test 5: Page with only ADF macros (no structured macros) works correctly
    - Use fixtures from Task Group 1
  - [x] 4.2 Build attachmentsById map in scanPage
    - File to modify: `backend/src/main/java/com/example/archtool/service/DrawioScanner.java`
    - Add after existing `attachmentsByName` map:
    ```java
    Map<String, ConfluenceAttachment> attachmentsById = attachments.stream()
        .collect(Collectors.toMap(
            ConfluenceAttachment::id,
            Function.identity(),
            (existing, replacement) -> existing
        ));
    ```
  - [x] 4.3 Call extractAdfDiagramRefs and process results
    - After existing structured-macro processing block in `scanPage()`
    - Call: `List<AdfDiagramRef> adfRefs = extractAdfDiagramRefs(page.bodyStorage())`
    - For each `AdfDiagramRef ref`:
      - Lookup: `ConfluenceAttachment att = attachmentsById.get(ref.attachmentId())`
      - If found: create `DrawioDiagramSource.fromMacroReference()`, add to sources
      - If found: add `att.title().toLowerCase()` to `matchedAttachmentNames`
      - If not found: log warning with page ID, diagram name, attachment ID
  - [x] 4.4 Add ADF-specific debug logging
    - Log: `log.debug("Page {}: Found {} ADF draw.io macro references", page.id(), adfRefs.size())`
    - Log for each match: `log.debug("Matched ADF macro '{}' (id={}) with attachment '{}'", ref.diagramName(), ref.attachmentId(), att.title())`
  - [x] 4.5 Run scanner integration tests
    - Run ONLY the 4-6 tests written in 4.1
    - Verify all tests pass

**Acceptance Criteria:**
- `scanPage()` processes both structured macros and ADF macros
- ADF macros are matched by attachment ID (not filename)
- Matched ADF attachments are excluded from orphan detection
- Warning logged when ADF references non-existent attachment

---

### Task Group 5: Orphan Enhancement
**Dependencies:** Task Group 4

Update `findOrphanDrawioAttachments()` to also detect `application/vnd.jgraph.mxfile` attachments.

- [x] 5.0 Complete orphan detection enhancement
  - [x] 5.1 Write 3-4 focused tests for mxfile orphan detection
    - File to modify: `backend/src/test/java/com/example/archtool/service/DrawioScannerTest.java`
    - Test 1: Attachment with mediaType `application/vnd.jgraph.mxfile` is detected as orphan
    - Test 2: mxfile attachment already matched by ADF macro is NOT included as orphan
    - Test 3: Both `.drawio` title and mxfile mediaType attachments detected as orphans
    - Test 4: Case-insensitive mediaType check (`Application/vnd.jgraph.mxfile`)
  - [x] 5.2 Modify findOrphanDrawioAttachments method
    - File to modify: `backend/src/main/java/com/example/archtool/service/DrawioScanner.java`
    - Update the condition from:
    ```java
    if (lowerTitle.endsWith(DRAWIO_EXTENSION) && !matchedAttachmentNames.contains(lowerTitle))
    ```
    - To:
    ```java
    boolean isDrawioFile = lowerTitle.endsWith(DRAWIO_EXTENSION);
    boolean isMxfileType = MXFILE_MEDIA_TYPE.equalsIgnoreCase(attachment.mediaType());
    if ((isDrawioFile || isMxfileType) && !matchedAttachmentNames.contains(lowerTitle))
    ```
  - [x] 5.3 Update debug logging for orphan detection
    - Differentiate between `.drawio` orphans and `mxfile` orphans in log messages
    - Log: `log.debug("Found orphan {} attachment: {}", isDrawioFile ? ".drawio" : "mxfile", attachment.title())`
  - [x] 5.4 Run orphan enhancement tests
    - Run ONLY the 3-4 tests written in 5.1
    - Verify all tests pass

**Acceptance Criteria:**
- mxfile attachments are detected as orphan diagrams
- Already-matched attachments (by name or ID) are excluded
- Case-insensitive mediaType comparison works correctly
- All 3-4 unit tests pass

---

### Task Group 6: Logging
**Dependencies:** Task Group 5

Add comprehensive diagnostic logging throughout the scanner for debugging Confluence format changes.

- [x] 6.0 Complete logging enhancements
  - [x] 6.1 Add summary logging for ADF vs structured macro detection
    - File to modify: `backend/src/main/java/com/example/archtool/service/DrawioScanner.java`
    - After processing both macro types, log:
    ```java
    log.debug("Page {}: Macro detection summary - {} structured macros, {} ADF macros",
        page.id(), macroFilenames.size(), adfRefs.size());
    ```
  - [x] 6.2 Add fallback detection logging
    - When no macros found but mxfile attachments exist, log:
    ```java
    if (macroFilenames.isEmpty() && adfRefs.isEmpty()) {
        long mxfileCount = attachments.stream()
            .filter(a -> MXFILE_MEDIA_TYPE.equalsIgnoreCase(a.mediaType()))
            .count();
        if (mxfileCount > 0) {
            log.info("Page {}: No macros found, falling back to orphan detection ({} mxfile attachments)",
                page.id(), mxfileCount);
        }
    }
    ```
  - [x] 6.3 Enhance final summary log
    - Update existing info log to include ADF vs structured breakdown:
    ```java
    log.info("Page {}: Found {} diagram sources ({} from structured macros, {} from ADF macros, {} orphan)",
        page.id(), sources.size(), structuredMacroCount, adfMatchCount, orphanSources.size());
    ```
  - [x] 6.4 Verify logging does not break tests
    - Run existing tests to ensure logging changes don't affect behavior
    - Check log output format is consistent with existing patterns

**Acceptance Criteria:**
- Diagnostic logging provides clear breakdown of macro types found
- Fallback to orphan detection is logged when no macros present
- Log messages follow existing format and use appropriate log levels
- All existing tests still pass

---

### Task Group 7: Unit Tests
**Dependencies:** Task Groups 3-6

Write comprehensive unit tests for each new code path. This group focuses on additional test coverage beyond the tests written during implementation.

- [x] 7.0 Complete unit test coverage
  - [x] 7.1 Add regression tests for legacy structured-macro behavior
    - File to modify: `backend/src/test/java/com/example/archtool/service/DrawioScannerTest.java`
    - Ensure all existing tests still pass (run full test class)
    - Add test: Legacy macro on new page format still works
    - Add test: diagrams.net macro name still detected
  - [x] 7.2 Add edge case tests for ADF parsing
    - Test: ADF macro with extra whitespace in cust-content-id
    - Test: ADF macro with numeric vs string attachment ID
    - Test: Deeply nested ADF structure (extension within layout cells)
    - Test: ADF macro with extension-key but no migration-key
  - [x] 7.3 Add integration-style tests combining multiple features
    - Test: Page with structured macro, ADF macro, and orphan mxfile attachment
    - Test: Same attachment referenced by both structured and ADF macro (no duplicates)
    - Test: Page with ADF macro referencing attachment by ID, plus unrelated .drawio orphan
  - [x] 7.4 Run all DrawioScanner tests
    - Run the full `DrawioScannerTest` class
    - Verify all tests pass (existing + new)
    - Target: 15-20 total tests in the test class

**Acceptance Criteria:**
- All existing tests continue to pass (regression coverage)
- Edge cases for ADF parsing are covered
- Combined scenarios work correctly
- No duplicate diagram sources returned

---

### Task Group 8: Integration Testing
**Dependencies:** Task Group 7

Ensure legacy and new paths work together correctly in realistic scenarios.

- [x] 8.0 Complete integration testing
  - [x] 8.1 Create end-to-end test scenarios
    - File to modify: `backend/src/test/java/com/example/archtool/service/DrawioScannerTest.java`
    - Test: Realistic Confluence Cloud page with ADF draw.io Board macro
    - Test: Realistic Confluence Server page with structured-macro
    - Use realistic attachment lists with PNG previews, mxfile, and other file types
  - [x] 8.2 Verify attachment matching priority
    - Test: When same diagram name exists in both structured and ADF macro, both are found
    - Test: Attachment ID matching (ADF) takes precedence over filename guessing
    - Test: Orphan detection runs after both macro types are processed
  - [x] 8.3 Test error recovery scenarios
    - Test: Malformed ADF XML doesn't break structured-macro detection
    - Test: Parse exception in one macro doesn't prevent processing others
    - Test: Null/empty fields handled gracefully throughout
  - [x] 8.4 Run full test suite and verify
    - Run: `mvn test -Dtest=DrawioScannerTest`
    - Ensure all tests pass
    - Check test coverage meets expectations
  - [x] 8.5 Manual verification checklist
    - Verify Javadoc on all new public/package methods
    - Verify constants are documented
    - Verify log messages are helpful for debugging

**Acceptance Criteria:**
- All tests pass consistently
- Legacy structured-macro pages work exactly as before
- New ADF pages are correctly processed
- Mixed pages (legacy + ADF) work correctly
- Error scenarios are handled gracefully
- Code is well-documented

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Test Fixtures** - Create ADF sample data first
2. **Task Group 2: Data Model** - Add record and constants
3. **Task Group 3: ADF Extraction** - Core parsing logic with tests
4. **Task Group 4: Scanner Integration** - Wire ADF into scanPage
5. **Task Group 5: Orphan Enhancement** - mxfile detection
6. **Task Group 6: Logging** - Diagnostic improvements
7. **Task Group 7: Unit Tests** - Comprehensive test coverage
8. **Task Group 8: Integration Testing** - Final validation

## Files Summary

### Files to Create:
- `backend/src/test/resources/test-confluence-html/page-with-adf-drawio-macro.html`
- `backend/src/test/resources/test-confluence-html/page-with-multiple-adf-macros.html`
- `backend/src/test/resources/test-confluence-html/page-with-mixed-macros.html`
- `backend/src/test/resources/test-confluence-html/page-with-no-macros-mxfile-attachment.html`

### Files to Modify:
- `backend/src/main/java/com/example/archtool/service/DrawioScanner.java`
  - Add `AdfDiagramRef` record
  - Add ADF-related constants
  - Add `extractAdfDiagramRefs()` method
  - Modify `scanPage()` to call ADF extraction
  - Modify `findOrphanDrawioAttachments()` for mxfile support
  - Add enhanced logging throughout

- `backend/src/test/java/com/example/archtool/service/DrawioScannerTest.java`
  - Add tests for `extractAdfDiagramRefs()`
  - Add tests for ADF integration in `scanPage()`
  - Add tests for mxfile orphan detection
  - Add regression tests for legacy behavior
  - Add integration-style combined tests

## Key Implementation References

### ADF Structure to Parse (from requirements):
```xml
<ac:adf-extension>
  <ac:adf-node type="extension">
    <ac:adf-attribute key="extension-key">com.mxgraph.confluence.plugins.diagramly:drawio-sketch</ac:adf-attribute>
    <ac:adf-node type="extension-properties">
      <ac:adf-parameter key="migration-key">com.mxgraph.confluence.plugins.diagramly</ac:adf-parameter>
    </ac:adf-node>
    <ac:adf-node type="guest-params">
      <ac:adf-parameter key="diagram-name">My Architecture Diagram</ac:adf-parameter>
      <ac:adf-parameter key="cust-content-id">131287</ac:adf-parameter>
    </ac:adf-node>
  </ac:adf-node>
</ac:adf-extension>
```

### Existing Patterns to Follow:

**Jsoup XML Parsing:**
```java
Document doc = Jsoup.parse(bodyStorage, "", Parser.xmlParser());
Elements macros = doc.select("ac|structured-macro, structured-macro");
```

**Attachment Map Building:**
```java
Map<String, ConfluenceAttachment> attachmentsByName = attachments.stream()
    .collect(Collectors.toMap(
        att -> att.title().toLowerCase(),
        Function.identity(),
        (existing, replacement) -> existing
    ));
```

**Logging Pattern:**
```java
log.debug("Found {} draw.io macro references in page {}", macroFilenames.size(), page.id());
log.warn("Page {}: Macro references '{}' but no matching attachment found", page.id(), macroFilename);
```
