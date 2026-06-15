# Task Breakdown: Save All Diagrams as PDF

## Overview
Total Tasks: 30 sub-tasks across 5 task groups

This feature adds a "Save All as PDF" button to the JourneyReviewBanner that generates a multi-page PDF document from all saved User Journey diagrams (USER_JOURNEY and USER_JOURNEY_OVERVIEW types), entirely client-side, using html2canvas and jsPDF. The PDF includes a title page, clickable table of contents with PDF bookmarks, and diagrams grouped alphabetically by business user.

## Task List

### Foundations

#### Task Group 1: Dependencies and Shared Utility Extraction
**Dependencies:** None

This group installs the required npm packages and extracts diagram helper functions from Canvas.tsx into a shared utility so that both Canvas.tsx and the new PDF export module can use them.

- [x] 1.0 Complete dependency installation and shared utility extraction
  - [x] 1.1 Write 4 focused tests for the shared diagram extraction utility
    - Test file: `frontend/src/components/DiagramsView/__tests__/diagramExtractionUtils.test.ts`
    - Test 1: `extractUserJourneyDiagram` returns typed DTO when `typedContent.content` contains valid journey data (has `lanes`, `steps`, `edges`, `journey` fields)
    - Test 2: `extractUserJourneyDiagram` returns `null` when diagram is `null` or content is malformed
    - Test 3: `extractUserJourneyOverviewDiagram` returns typed DTO when `typedContent.content` contains valid overview data (has `lanes`, `nodes`, `edges`, `overview` fields)
    - Test 4: `isUserJourneyDiagramDto` and `isUserJourneyOverviewDiagramDto` type guards correctly distinguish journey vs overview shapes
    - Use Vitest with `describe`/`it`/`expect` pattern (matching `JourneyReviewBanner.test.tsx` style)
  - [x] 1.2 Install `jspdf` and `html2canvas` as production dependencies
    - Run `npm install jspdf html2canvas` in `frontend/`
    - Verify both appear in `frontend/package.json` under `dependencies`
    - Verify `npm run build` still succeeds after installation
  - [x] 1.3 Create shared utility file `frontend/src/components/DiagramsView/diagramExtractionUtils.ts`
    - Extract these 4 functions from `Canvas.tsx` (lines 646-717):
      - `extractUserJourneyDiagram(diagram: Diagram | null | undefined): UserJourneyDiagramDto | null`
      - `isUserJourneyDiagramDto(value: unknown): value is UserJourneyDiagramDto`
      - `extractUserJourneyOverviewDiagram(diagram: Diagram | null | undefined): UserJourneyOverviewDiagramDto | null`
      - `isUserJourneyOverviewDiagramDto(value: unknown): value is UserJourneyOverviewDiagramDto`
    - Export all 4 functions
    - Import types: `Diagram` from `../../types/model`, `UserJourneyDiagramDto` from `../../types/userJourneyDiagram`, `UserJourneyOverviewDiagramDto` from `../../types/userJourneyOverviewDiagram`
  - [x] 1.4 Update `Canvas.tsx` to import from the shared utility
    - Remove the 4 local function definitions (lines 646-717 in `Canvas.tsx`)
    - Add import: `import { extractUserJourneyDiagram, extractUserJourneyOverviewDiagram } from './diagramExtractionUtils';`
    - Verify Canvas.tsx still references these functions at lines ~3641 and ~3673 correctly
  - [x] 1.5 Ensure extraction utility tests pass
    - Run ONLY `frontend/src/components/DiagramsView/__tests__/diagramExtractionUtils.test.ts`
    - Verify all 4 tests pass
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- `jspdf` and `html2canvas` are in `frontend/package.json` dependencies
- `frontend/npm run build` succeeds
- `diagramExtractionUtils.ts` exports all 4 functions
- `Canvas.tsx` imports from `diagramExtractionUtils.ts` and no longer has local copies
- All 4 extraction utility tests pass

---

### PDF Generation Core

#### Task Group 2: PDF Export Utility Module
**Dependencies:** Task Group 1

This group creates the core PDF generation utility module that handles off-screen rendering, html2canvas capture, and jsPDF document assembly.

- [x] 2.0 Complete PDF export utility module
  - [x] 2.1 Write 6 focused tests for the PDF export utility
    - Test file: `frontend/src/components/DiagramsView/__tests__/pdfExport.test.ts`
    - Test 1: `groupDiagramsByBusinessUser` groups USER_JOURNEY diagrams by `journey.user_role_name` and USER_JOURNEY_OVERVIEW diagrams by `overview.business_user_name`, sorted alphabetically by business user name
    - Test 2: Within each business user group, USER_JOURNEY_OVERVIEW diagrams appear first, then USER_JOURNEY diagrams sorted alphabetically by diagram name
    - Test 3: `determinePageOrientation` returns `'landscape'` when content width > 1.3x content height, `'portrait'` otherwise
    - Test 4: `buildPdfFilename` uses `state.loadedFileName` (stripped of extension) + ` - User Journey Diagrams.pdf`; falls back to `User Journey Diagrams.pdf` when loadedFileName is null/empty
    - Test 5: `formatTitleDate` returns date in "DD Month YYYY" format (e.g., "13 April 2026")
    - Test 6: `buildTocEntries` produces correct structure with business user section headers and diagram sub-entries, with page numbers starting at 3 (after title + TOC pages)
    - Mock `jspdf` and `html2canvas` modules using `vi.mock()` -- tests focus on grouping/sorting/orientation logic, not actual PDF rendering
  - [x] 2.2 Create `frontend/src/components/DiagramsView/pdfExport.ts` with types and helper functions
    - Define `PdfGenerationProgress` type: `{ generating: boolean; current: number; total: number }`
    - Define `BusinessUserDiagramGroup` type: `{ businessUserName: string; diagrams: Array<{ diagram: Diagram; type: 'USER_JOURNEY' | 'USER_JOURNEY_OVERVIEW'; name: string }> }`
    - Define `TocEntry` type: `{ text: string; pageNumber: number; isSection: boolean; targetPageIndex: number }`
    - Implement `groupDiagramsByBusinessUser(diagrams: Diagram[]): BusinessUserDiagramGroup[]`
      - Filter diagrams to `diagram_type === 'USER_JOURNEY'` or `'USER_JOURNEY_OVERVIEW'`
      - Use `extractUserJourneyDiagram` / `extractUserJourneyOverviewDiagram` from `diagramExtractionUtils.ts` to extract typed content
      - For USER_JOURNEY: group key = `journey.user_role_name`; diagram name = diagram.name
      - For USER_JOURNEY_OVERVIEW: group key = `overview.business_user_name`; diagram name = diagram.name
      - Sort groups alphabetically by `businessUserName`
      - Within each group: overview diagrams first, then journey diagrams sorted alphabetically by name
    - Implement `determinePageOrientation(width: number, height: number): 'portrait' | 'landscape'`
      - Return `'landscape'` if `width > height * 1.3`, otherwise `'portrait'`
    - Implement `buildPdfFilename(loadedFileName: string | null): string`
      - Strip file extension from `loadedFileName` if present (remove last `.xxx`)
      - Return `"{name} - User Journey Diagrams.pdf"` or fallback `"User Journey Diagrams.pdf"`
    - Implement `formatTitleDate(date: Date): string`
      - Format as "DD Month YYYY" (e.g., "13 April 2026")
    - Implement `buildTocEntries(groups: BusinessUserDiagramGroup[]): TocEntry[]`
      - Start page numbering at 3 (page 1 = title, page 2 = TOC)
      - For each group: one section header entry + one entry per diagram
      - Each entry includes `targetPageIndex` for internal link targets
  - [x] 2.3 Implement `renderDiagramOffScreen` async function
    - Signature: `async function renderDiagramOffScreen(diagramData: UserJourneyDiagramDto | UserJourneyOverviewDiagramDto, diagramType: 'USER_JOURNEY' | 'USER_JOURNEY_OVERVIEW', metaModel: any): Promise<{ canvas: HTMLCanvasElement; width: number; height: number }>`
    - Create temporary off-screen container: `div` with `position: absolute; left: -9999px; top: 0`, append to `document.body`
    - For USER_JOURNEY diagrams:
      - Enrich with `enrichJourneySteps(rawData, metaModel.entities.process_activities ?? [], metaModel.entities.activity_steps ?? [], metaModel.entities.business_users ?? [])` (import from `./journeyEnrichment`)
    - For USER_JOURNEY_OVERVIEW diagrams:
      - Build `OverviewEnrichmentMetaData` from `metaModel.entities` and `metaModel.relationships` (same slices as Canvas.tsx lines 3683-3689)
      - Enrich with `enrichOverviewFull(rawData, enrichMeta)` (import from `./overviewEnrichment`)
    - Use `ReactDOM.createRoot` (from `react-dom/client`) to render into the off-screen container:
      - Wrap in an `<svg>` element with explicit `width` and `height` attributes (from `onContentBounds` callback)
      - Render `<UserJourneyDiagramRenderer>` or `<UserJourneyOverviewDiagramRenderer>` inside the SVG `<g>` wrapper
      - Wait for `onContentBounds` callback to fire (use a Promise with resolve in the callback)
      - Set SVG `width` and `height` to the reported content bounds
    - Capture with `html2canvas(container, { scale: 2, useCORS: true, backgroundColor: '#FFFFFF' })`
    - Unmount React root (`root.unmount()`) and remove container from DOM (`document.body.removeChild(container)`)
    - Return `{ canvas, width: bounds.width, height: bounds.height }`
  - [x] 2.4 Implement `addTitlePage` function
    - Signature: `function addTitlePage(doc: jsPDF, projectName: string, groups: BusinessUserDiagramGroup[]): void`
    - Page is Portrait A4 (already the first page in a new jsPDF doc)
    - Content centered horizontally on page (A4 = 210mm width):
      - Project name: `doc.setFontSize(24)`, centered, ~80mm from top
      - Generation date: `doc.setFontSize(14)`, gray color (`#666666`), centered, ~100mm from top, formatted via `formatTitleDate(new Date())`
      - Summary line: `doc.setFontSize(12)`, centered, ~115mm from top
      - Summary format: `"{X} Business Users, {Y} User Journey Diagrams, {Z} Overview Diagrams"`
      - Compute X = `groups.length`, Y = count of USER_JOURNEY entries across all groups, Z = count of USER_JOURNEY_OVERVIEW entries
  - [x] 2.5 Implement `addTableOfContents` function
    - Signature: `function addTableOfContents(doc: jsPDF, tocEntries: TocEntry[]): void`
    - Add new page: `doc.addPage('a4', 'portrait')`
    - Title: "Table of Contents" at top, font size 18, bold (`doc.setFont(undefined, 'bold')`)
    - Track `yPosition` starting below title (~35mm)
    - For each `TocEntry`:
      - If `isSection` (business user header): font size 14, bold, left-aligned at 20mm margin
      - Else (diagram name): font size 12, normal weight, indented at 30mm, page number right-aligned at 190mm
    - Each entry is a clickable internal link using `doc.link(x, y, width, height, { pageNumber: entry.targetPageIndex })`
    - Add PDF outline bookmarks: `doc.outline.add(null, entry.text, { pageNumber: entry.targetPageIndex })` for section headers (top-level); `doc.outline.add(parentBookmark, entry.text, { pageNumber: entry.targetPageIndex })` for diagram entries (nested under parent)
    - Track remaining vertical space; if `yPosition > 270mm` (approaching A4 bottom with 20mm margin), call `doc.addPage('a4', 'portrait')` and reset `yPosition` to 20mm
    - Return the number of TOC pages added (to adjust page numbering if TOC exceeds 1 page -- update `targetPageIndex` on all entries accordingly)
  - [x] 2.6 Implement `addDiagramPage` function
    - Signature: `function addDiagramPage(doc: jsPDF, canvasDataUrl: string, diagramName: string, contentWidth: number, contentHeight: number): void`
    - Determine orientation via `determinePageOrientation(contentWidth, contentHeight)`
    - Add new page: `doc.addPage('a4', orientation)`
    - Diagram title at top: font size 12, left-aligned at 20mm, 15mm from top
    - Calculate printable area:
      - Portrait: `(210 - 40)mm x (297 - 55)mm` = `170mm x 242mm` (20mm margins, 15mm top for title + 20mm bottom)
      - Landscape: `(297 - 40)mm x (210 - 55)mm` = `257mm x 155mm`
    - Scale image to fit within printable area while maintaining aspect ratio:
      - `scaleFactor = Math.min(printableWidth / contentWidth, printableHeight / contentHeight)`
      - `scaledWidth = contentWidth * scaleFactor`
      - `scaledHeight = contentHeight * scaleFactor`
    - Center image horizontally within printable area
    - Insert image: `doc.addImage(canvasDataUrl, 'PNG', x, y, scaledWidth, scaledHeight)`
  - [x] 2.7 Implement main `generatePdf` orchestrator function
    - Signature: `export async function generatePdf(diagrams: Diagram[], metaModel: any, loadedFileName: string | null, onProgress: (progress: PdfGenerationProgress) => void): Promise<void>`
    - Step 1: Group diagrams via `groupDiagramsByBusinessUser(diagrams)`
    - Step 2: If no groups/diagrams found, return early (nothing to export)
    - Step 3: Flatten all diagram entries to get total count; set progress `{ generating: true, current: 0, total }`
    - Step 4: Create jsPDF doc: `new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })`
    - Step 5: Add title page via `addTitlePage(doc, loadedFileName, groups)`
    - Step 6: Build TOC entries via `buildTocEntries(groups)`; add TOC via `addTableOfContents(doc, tocEntries)`
    - Step 7: Process diagrams sequentially (one at a time to manage memory):
      - For each group, for each diagram entry:
        - Extract typed content using `extractUserJourneyDiagram` or `extractUserJourneyOverviewDiagram`
        - Call `renderDiagramOffScreen(data, type, metaModel)` to get canvas
        - Convert to data URL: `canvas.toDataURL('image/png')`
        - Call `addDiagramPage(doc, dataUrl, name, width, height)`
        - Update progress: `onProgress({ generating: true, current: currentIndex + 1, total })`
    - Step 8: Save PDF: `doc.save(buildPdfFilename(loadedFileName))`
    - Step 9: Reset progress: `onProgress({ generating: false, current: 0, total: 0 })`
    - Wrap in try/catch; on error, log to console and reset progress
  - [x] 2.8 Ensure PDF export utility tests pass
    - Run ONLY `frontend/src/components/DiagramsView/__tests__/pdfExport.test.ts`
    - Verify all 6 tests pass
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- `pdfExport.ts` exports `generatePdf`, `groupDiagramsByBusinessUser`, `determinePageOrientation`, `buildPdfFilename`, `formatTitleDate`, `buildTocEntries`, and `PdfGenerationProgress` type
- Grouping logic correctly sorts by business user alphabetically, with overviews before journeys
- Orientation detection uses the 1.3x width-to-height threshold
- Off-screen rendering creates and cleans up temporary DOM containers
- Title page, TOC, and diagram pages are assembled in correct order
- All 6 PDF export utility tests pass

---

### UI Layer

#### Task Group 3: JourneyReviewBanner "Save All as PDF" Button
**Dependencies:** Task Group 2

This group adds the "Save All as PDF" button to the JourneyReviewBanner component with progress indication.

- [x] 3.0 Complete JourneyReviewBanner PDF button
  - [x] 3.1 Write 5 focused tests for the new PDF button on JourneyReviewBanner
    - Test file: `frontend/src/components/DiagramsView/__tests__/JourneyReviewBannerPdf.test.tsx`
    - Follow the exact test helper pattern from `JourneyReviewBanner.test.tsx` (use `createTestJourney()` helper, `render`/`fireEvent` from `@testing-library/react`)
    - Test 1: "Save All as PDF" button is NOT rendered when `onSaveAllAsPdf` prop is not provided
    - Test 2: "Save All as PDF" button IS rendered when `onSaveAllAsPdf` prop is provided
    - Test 3: Clicking "Save All as PDF" button calls the `onSaveAllAsPdf` callback
    - Test 4: Button is disabled and progress text is shown when `pdfProgress` prop has `generating: true` (e.g., "Generating PDF... 3 of 12")
    - Test 5: Button is re-enabled and progress text is hidden when `pdfProgress` prop has `generating: false`
  - [x] 3.2 Add new props to `JourneyReviewBannerProps` in `JourneyReviewBanner.tsx`
    - Add `onSaveAllAsPdf?: () => void` -- optional callback; button only renders when provided
    - Add `pdfProgress?: { generating: boolean; current: number; total: number }` -- optional progress state for inline progress text
    - Import `PdfGenerationProgress` type from `./pdfExport` or define the shape inline
  - [x] 3.3 Add "Save All as PDF" button to JourneyReviewBanner JSX
    - Position: After the "Save All as Diagrams" button block (after line ~229, before the "Close Review" button)
    - Render conditionally: `{onSaveAllAsPdf && ( ... )}`
    - Button element with `data-testid="journey-review-save-all-pdf"`
    - Style matching "Save All as Diagrams" outlined pattern: `padding: '6px 12px'`, `border: '1px solid #1565C0'`, `background: 'white'`, `color: '#1565C0'`, `borderRadius: '4px'`, `fontSize: '12px'`, `cursor: 'pointer'`, `marginLeft: '4px'`, `fontWeight: 500`
    - `onClick={onSaveAllAsPdf}`
    - `disabled={pdfProgress?.generating}` -- disable while generating
    - When disabled, adjust style: `opacity: 0.6`, `cursor: 'default'`
    - Label text: "Save All as PDF"
  - [x] 3.4 Add inline progress text next to the button
    - Render conditionally: `{pdfProgress?.generating && ( ... )}`
    - `<span>` element with `data-testid="pdf-progress-text"`
    - Style: `fontSize: '12px'`, `color: '#666'`, `marginLeft: '8px'`
    - Text content: `Generating PDF... {pdfProgress.current} of {pdfProgress.total}`
  - [x] 3.5 Ensure JourneyReviewBanner PDF button tests pass
    - Run ONLY `frontend/src/components/DiagramsView/__tests__/JourneyReviewBannerPdf.test.tsx`
    - Verify all 5 tests pass
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- "Save All as PDF" button appears on JourneyReviewBanner only when `onSaveAllAsPdf` prop is provided
- Button follows the outlined style matching "Save All as Diagrams"
- Button is disabled during PDF generation with `pdfProgress.generating === true`
- Progress text "Generating PDF... X of Y" displays inline next to the button during generation
- All 5 JourneyReviewBanner PDF button tests pass

---

### Wiring Layer

#### Task Group 4: Wire PDF Generation into DiagramsView
**Dependencies:** Task Groups 2 and 3

This group wires the PDF generation utility to the JourneyReviewBanner button via DiagramsView.tsx, connecting state, progress tracking, and the generation callback.

- [x] 4.0 Complete wiring of PDF generation in DiagramsView
  - [x] 4.1 Write 3 focused tests for the PDF wiring in DiagramsView
    - Test file: `frontend/src/components/DiagramsView/__tests__/DiagramsViewPdfExport.test.tsx`
    - These tests verify the integration wiring, not the PDF generation itself (which is tested in Task Group 2)
    - Test 1: When `state.model.diagrams` contains USER_JOURNEY and USER_JOURNEY_OVERVIEW diagrams, the `onSaveAllAsPdf` prop is passed to JourneyReviewBanner (not undefined)
    - Test 2: The `pdfProgress` prop is passed to JourneyReviewBanner and initially has `generating: false`
    - Test 3: When `state.model.diagrams` has no USER_JOURNEY or USER_JOURNEY_OVERVIEW diagrams, the `onSaveAllAsPdf` prop can still be provided (it reads from state.model.diagrams, which may be populated later; the button always appears during review)
    - Mock `ArchitectureContext` to provide `state.model.diagrams`, `state.model.metaModel`, and `state.loadedFileName`
    - Mock `UserJourneyReviewContext` to provide an active journey review session
    - Note: These tests may require significant mocking; keep them minimal and focused on prop-passing verification
  - [x] 4.2 Add PDF progress state to DiagramsView component
    - In `DiagramsView.tsx`, add state: `const [pdfProgress, setPdfProgress] = useState<PdfGenerationProgress>({ generating: false, current: 0, total: 0 });`
    - Import `PdfGenerationProgress` and `generatePdf` from `./pdfExport`
    - Place near other state declarations (around line ~500 area where other useState calls are)
  - [x] 4.3 Define `handleSaveAllAsPdf` callback in DiagramsView
    - Create async callback with `useCallback`:
    ```
    const handleSaveAllAsPdf = useCallback(async () => {
      await generatePdf(
        state.model.diagrams,
        state.model.metaModel,
        state.loadedFileName,
        setPdfProgress
      );
    }, [state.model.diagrams, state.model.metaModel, state.loadedFileName]);
    ```
    - This callback needs access to `state.model.diagrams`, `state.model.metaModel`, and `state.loadedFileName` from the ArchitectureContext
  - [x] 4.4 Pass new props to JourneyReviewBanner in DiagramsView JSX
    - Locate the `<JourneyReviewBanner>` usage at approximately line ~3640 in DiagramsView.tsx
    - Add prop: `onSaveAllAsPdf={handleSaveAllAsPdf}`
    - Add prop: `pdfProgress={pdfProgress}`
    - These are added alongside the existing props like `onSaveAllAsDiagrams`, `isSaved`, `allSaved`, etc.
  - [x] 4.5 Ensure wiring tests pass
    - Run ONLY `frontend/src/components/DiagramsView/__tests__/DiagramsViewPdfExport.test.tsx`
    - Verify all 3 tests pass
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- `DiagramsView.tsx` imports and uses `generatePdf` and `PdfGenerationProgress` from `pdfExport.ts`
- PDF progress state is tracked with `useState` and passed to JourneyReviewBanner as `pdfProgress`
- `handleSaveAllAsPdf` callback invokes `generatePdf` with correct state values
- JourneyReviewBanner receives `onSaveAllAsPdf` and `pdfProgress` props
- All 3 wiring tests pass

---

### Testing

#### Task Group 5: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 4 tests written in Task 1.1 (diagramExtractionUtils)
    - Review the 6 tests written in Task 2.1 (pdfExport utility)
    - Review the 5 tests written in Task 3.1 (JourneyReviewBanner PDF button)
    - Review the 3 tests written in Task 4.1 (DiagramsView PDF wiring)
    - Total existing tests: 18 tests
  - [x] 5.2 Analyze test coverage gaps for this feature only
    - Check: Is the `groupDiagramsByBusinessUser` function tested with edge cases (empty diagrams array, mixed types, single business user)?
    - Check: Is `addTitlePage` tested for correct summary counts?
    - Check: Is TOC multi-page overflow handling tested?
    - Check: Is the off-screen rendering cleanup (unmount + DOM removal) verified?
    - Check: Is error handling in `generatePdf` (e.g., html2canvas failure) tested?
    - Focus ONLY on gaps related to this spec's feature requirements
    - Do NOT assess entire application test coverage
  - [x] 5.3 Write up to 8 additional strategic tests to fill critical gaps
    - Test file: `frontend/src/components/DiagramsView/__tests__/pdfExportGapFill.test.ts`
    - Gap Test 1: `groupDiagramsByBusinessUser` with empty `diagrams` array returns empty groups
    - Gap Test 2: `groupDiagramsByBusinessUser` with only USER_JOURNEY diagrams (no overviews) still groups correctly
    - Gap Test 3: `groupDiagramsByBusinessUser` correctly handles a diagram where extraction returns null (malformed content) -- skips it
    - Gap Test 4: `buildTocEntries` generates correct page numbers when multiple groups exist (sequential page counting)
    - Gap Test 5: `determinePageOrientation` returns `'portrait'` at exactly 1.3x ratio (boundary test: `width === height * 1.3` is NOT landscape, must exceed)
    - Gap Test 6: `buildPdfFilename` handles filenames with multiple dots (e.g., "my.project.v2.json" becomes "my.project.v2 - User Journey Diagrams.pdf")
    - Gap Test 7: `formatTitleDate` correctly formats single-digit days (e.g., "3 January 2026", no leading zero)
    - Gap Test 8: `generatePdf` calls `onProgress` with `generating: false` even when an error occurs (error recovery)
    - Maximum of 8 additional tests; skip if earlier groups already cover these scenarios
  - [x] 5.4 Run all feature-specific tests
    - Run all 5 test files together:
      - `frontend/src/components/DiagramsView/__tests__/diagramExtractionUtils.test.ts`
      - `frontend/src/components/DiagramsView/__tests__/pdfExport.test.ts`
      - `frontend/src/components/DiagramsView/__tests__/JourneyReviewBannerPdf.test.tsx`
      - `frontend/src/components/DiagramsView/__tests__/DiagramsViewPdfExport.test.tsx`
      - `frontend/src/components/DiagramsView/__tests__/pdfExportGapFill.test.ts`
    - Expected total: approximately 18-26 tests
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass
  - [x] 5.5 Run existing JourneyReviewBanner tests to verify no regressions
    - Run: `frontend/src/components/DiagramsView/__tests__/JourneyReviewBanner.test.tsx`
    - Run: `frontend/src/components/DiagramsView/__tests__/JourneyReviewBannerSaveButton.test.tsx`
    - Confirm all pre-existing tests still pass after adding the new prop and button

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 18-26 tests total)
- No regressions in existing JourneyReviewBanner tests
- Critical user workflows for this feature are covered (grouping, sorting, orientation, progress, filename, error recovery)
- No more than 8 additional gap-fill tests added
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Dependencies and Shared Utility Extraction** -- No dependencies; installs npm packages and creates the shared extraction utility that all subsequent groups depend on
2. **Task Group 2: PDF Export Utility Module** -- Depends on Task Group 1 (uses `diagramExtractionUtils.ts`); builds the core PDF generation engine
3. **Task Group 3: JourneyReviewBanner PDF Button** -- Depends on Task Group 2 (uses `PdfGenerationProgress` type); adds the UI button and progress display
4. **Task Group 4: Wire PDF Generation into DiagramsView** -- Depends on Task Groups 2 and 3; connects the button to the generation utility via state and callbacks
5. **Task Group 5: Test Review and Gap Analysis** -- Depends on Task Groups 1-4; reviews all tests and fills critical coverage gaps

## Key File Inventory

| File | Status | Purpose |
|------|--------|---------|
| `frontend/package.json` | Modified | Add `jspdf` and `html2canvas` dependencies |
| `frontend/src/components/DiagramsView/diagramExtractionUtils.ts` | **New** | Shared extraction utilities (moved from Canvas.tsx) |
| `frontend/src/components/DiagramsView/pdfExport.ts` | **New** | Core PDF generation utility module |
| `frontend/src/components/DiagramsView/Canvas.tsx` | Modified | Remove local extraction functions, import from shared utility |
| `frontend/src/components/DiagramsView/JourneyReviewBanner.tsx` | Modified | Add `onSaveAllAsPdf` prop, PDF button, progress text |
| `frontend/src/components/DiagramsView/DiagramsView.tsx` | Modified | Add `pdfProgress` state, `handleSaveAllAsPdf` callback, pass props to banner |
| `frontend/src/components/DiagramsView/__tests__/diagramExtractionUtils.test.ts` | **New** | Tests for shared extraction utility |
| `frontend/src/components/DiagramsView/__tests__/pdfExport.test.ts` | **New** | Tests for PDF export utility |
| `frontend/src/components/DiagramsView/__tests__/JourneyReviewBannerPdf.test.tsx` | **New** | Tests for PDF button on JourneyReviewBanner |
| `frontend/src/components/DiagramsView/__tests__/DiagramsViewPdfExport.test.tsx` | **New** | Tests for DiagramsView PDF wiring |
| `frontend/src/components/DiagramsView/__tests__/pdfExportGapFill.test.ts` | **New** | Gap-fill tests for edge cases |
