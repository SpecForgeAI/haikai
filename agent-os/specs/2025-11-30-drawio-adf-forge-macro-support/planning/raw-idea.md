# Raw Idea: Backend Confluence draw.io Scanner - ADF/Forge Macro Support

## Feature Request

Feature: Backend Confluence draw.io Scanner - ADF/Forge Macro Support

## Context

- Service: Java 21 / Spring Boot backend, module `DrawioScanner`.
- Existing behaviour:
  - Uses `ConfluencePage.bodyStorage` (XHTML/XML) to find `<ac:structured-macro ac:name="drawio">` or `ac:name="diagrams.net"`.
  - Extracts a `diagramName` from `<ac:parameter ac:name="diagramName">`.
  - Matches this to attachments by filename (`.drawio` / `.xml`) to build `DrawioDiagramSource` instances.
  - Also treats orphan `.drawio` attachments as diagrams.
- Problem:
  - Confluence Cloud with the Forge-based draw.io **Board/Diagram** macro no longer uses `<ac:structured-macro>`.
  - Instead, it stores the macro as an ADF extension (`<ac:adf-extension>` / `<ac:adf-node type="extension">`) with a nested parameter tree.
  - The relevant snippet we actually see in `body.storage` looks like:
    - `<ac:adf-attribute key="extension-key">...drawio-sketch</ac:adf-attribute>`
    - Under `extension-properties` → `migration-key = "com.mxgraph.confluence.plugins.diagramly"`.
    - Under `guest-params`:
      - `diagram-name` – e.g. "My Architecture"
      - `cust-content-id` – e.g. "131287" (this is the Confluence attachment id for the diagram).
  - Attachments list from the REST API includes:
    - PNG preview(s)
    - An attachment with mediaType `application/vnd.jgraph.mxfile` that is the real diagram.
  - Result: our scanner sees the attachments but finds **no macros**, so it returns zero diagrams.

## Goal

Extend the scanner so that:
1) It can recognise and parse **ADF-based draw.io macros** (both Board and Diagram).
2) It links them to the correct attachment using `cust-content-id`.
3) It still supports old `<ac:structured-macro ac:name="drawio">` pages.
4) It treats `application/vnd.jgraph.mxfile` attachments as diagrams when orphaned.

## Technical Requirements

### 1) New ADF parsing path

- In `DrawioScanner`, add a new method (or equivalent) to extract ADF-based draw.io macro references from `bodyStorage`, e.g.:
  - `record AdfDiagramRef(String attachmentId, String diagramName) {}`
  - `List<AdfDiagramRef> extractAdfDiagramRefs(String bodyStorage)`
- Implementation details:
  - Parse `bodyStorage` with `Jsoup.parse(bodyStorage, "", Parser.xmlParser())`.
  - Select ADF extension nodes, e.g.:
    - `doc.select("ac|adf-extension ac|adf-node[type=extension], adf-extension adf-node[type=extension]")`
  - For each node, determine if it is a draw.io macro by one of:
    - Having an `ac:adf-parameter key="migration-key"` with value `com.mxgraph.confluence.plugins.diagramly`.
    - OR having an `extension-key`, `extension-title` or similar attribute that contains "drawio" / "draw.io" / "drawio-sketch".
  - Inside that node, find `guest-params` and extract:
    - `diagramName` ← value of `diagram-name` parameter.
    - `attachmentId` ← value of `cust-content-id` parameter (string).
  - For robustness:
    - Trim values and ignore entries where `cust-content-id` is missing or blank.
    - Log debug information about any ADF macro we skip.

### 2) Matching ADF macros to attachments

- In `scanPage(ConfluencePage page, List<ConfluenceAttachment> attachments)`:
  - Keep the existing structured-macro path *unchanged* (so old pages still work).
  - Build:
    - `Map<String, ConfluenceAttachment> attachmentsById = attachments.stream().collect(toMap(ConfluenceAttachment::id, ...))`
    - Existing `attachmentsByName` map remains in place.
  - Call `extractAdfDiagramRefs(page.bodyStorage())` and for each `AdfDiagramRef ref`:
    - Look up `ConfluenceAttachment att = attachmentsById.get(ref.attachmentId())`.
    - If found:
      - Add a `DrawioDiagramSource` via the existing factory.
      - Add `att.title().toLowerCase()` to `matchedAttachmentNames` so we don't treat it as orphan.
      - Log at debug level: page id, diagram name, attachment id, and attachment title.
    - If not found:
      - Log a warning: "ADF draw.io macro references attachment id X (diagram Y) but no matching attachment found".

### 3) Keep legacy structured-macro support

- The current `extractMacroFilenames` implementation should remain and continue to:
  - Look for `<ac:structured-macro ac:name="drawio">` and `<ac:structured-macro ac:name="diagrams.net">`.
  - Extract the existing `diagramName` parameter and treat it as a filename.
  - Match against attachments by name, as today.

### 4) Treat mxfile attachments as diagrams (orphan support)

- Update `findOrphanDrawioAttachments(...)` so it doesn't only look at `.drawio` titles.
- The new rules:
  - An attachment is considered a candidate diagram if:
    - `title.toLowerCase().endsWith(".drawio")` OR
    - `mediaType` (or equivalent field) equals `"application/vnd.jgraph.mxfile"` (case-insensitive).
  - Still ensure we exclude any attachments whose titles have already been added to `matchedAttachmentNames`.
- For each such attachment, continue to call:
  - `DrawioDiagramSource.fromOrphanAttachment(attachment.id(), attachment.title(), attachment.downloadUrl())`

### 5) Logging and diagnostics

- Improve logging slightly around scanning to help debug future Confluence format changes:
  - When parsing ADF macros, log how many candidate ADF draw.io macros were found and how many successfully matched attachments.
  - When no macros (structured or ADF) are found but there are mxfile attachments, log that we are falling back to orphan attachment detection.

### 6) Tests

- Add / update unit tests for `DrawioScanner`:
  - A sample `bodyStorage` containing at least one ADF draw.io macro with:
    - `migration-key = com.mxgraph.confluence.plugins.diagramly`
    - `guest-params` with `diagram-name` and `cust-content-id`.
  - A set of attachments including:
    - A PNG image.
    - A mxfile attachment with id equal to `cust-content-id`.
  - Assert that:
    - `scanPage(...)` returns a `DrawioDiagramSource` linked to the mxfile attachment.
    - The attachment id and title are correctly propagated.
  - A second test with:
    - No macros in `bodyStorage`.
    - One attachment with mediaType `application/vnd.jgraph.mxfile`.
    - Assert that this is returned as an orphan diagram source.
  - Regression tests to ensure legacy `<ac:structured-macro ac:name="drawio">` pages behave as before.

## Non-goals

- No changes to the REST API contract for the Confluence scanning endpoint.
- No changes yet to how diagrams are converted into our internal architecture meta-model – that remains a later phase.
