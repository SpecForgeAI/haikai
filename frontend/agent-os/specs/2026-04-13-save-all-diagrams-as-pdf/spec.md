# Specification: Save All Diagrams as PDF

## Goal
Generate a multi-page PDF document from all saved User Journey diagrams (USER_JOURNEY and USER_JOURNEY_OVERVIEW types) in `state.model.diagrams`, entirely client-side, with a title page, clickable table of contents, and diagrams grouped alphabetically by business user.

## User Stories
- As an architect, I want to export all saved User Journey diagrams as a single PDF so that I can share a polished document with stakeholders who do not have access to the tool.
- As a reviewer, I want the PDF organized by business user with a clickable table of contents so that I can quickly navigate to the diagrams for a specific user.

## Specific Requirements

**New npm dependencies: html2canvas and jsPDF**
- Add `jspdf` and `html2canvas` as production dependencies in `frontend/package.json`
- jsPDF provides PDF page creation, image insertion, text rendering, internal links, and bookmarks/outlines
- html2canvas captures DOM elements (including SVG with foreignObject) as rasterized canvas images, which native SVG-to-canvas APIs cannot do

**"Save All as PDF" button on JourneyReviewBanner**
- Add a new button labeled "Save All as PDF" to the `JourneyReviewBanner` component, positioned after the existing "Save All as Diagrams" button
- Style as an outlined button (matching the "Save All as Diagrams" style: white background, blue border/text, 12px font)
- Add a new optional callback prop `onSaveAllAsPdf` to `JourneyReviewBannerProps`; only render the button when this prop is provided
- The button is always enabled (no dependency on save state) since it reads from saved diagrams, not the review context
- While PDF generation is in progress, disable the button and show inline progress text next to it (e.g., "Generating PDF... 3 of 12 diagrams")

**Progress indication state**
- Track generation state with a React state object: `{ generating: boolean; current: number; total: number }`
- Display progress text as a `<span>` next to the button when `generating` is true, formatted as "Generating PDF... {current} of {total}"
- Disable the "Save All as PDF" button while `generating` is true

**Data source: saved diagrams from state.model.diagrams**
- Filter `state.model.diagrams` to entries where `diagram_type` is `'USER_JOURNEY'` or `'USER_JOURNEY_OVERVIEW'`
- Extract typed content using the existing `extractUserJourneyDiagram()` and `extractUserJourneyOverviewDiagram()` helper functions from `Canvas.tsx` (these need to be exported or extracted to a shared utility)
- Group diagrams by business user name: for USER_JOURNEY use `journey.user_role_name`, for USER_JOURNEY_OVERVIEW use `overview.business_user_name`
- Sort groups alphabetically by business user name; within each group, place the USER_JOURNEY_OVERVIEW diagram first, then USER_JOURNEY diagrams sorted alphabetically by name

**Enrichment pipeline for off-screen rendering**
- Before rendering each diagram, apply the same enrichment used by Canvas.tsx for saved diagrams
- For USER_JOURNEY diagrams: call `enrichJourneySteps(rawData, processActivities, activitySteps, businessUsers)` with data from `state.model.metaModel.entities`
- For USER_JOURNEY_OVERVIEW diagrams: call `enrichOverviewFull(rawData, enrichMeta)` with the same `OverviewEnrichmentMetaData` slices from `state.model.metaModel` that Canvas.tsx uses
- This ensures the PDF diagrams include interaction levels, frequencies, co-worker links, app grids, summary counts, and related colleagues

**Off-screen rendering approach**
- Create a new utility module (e.g., `pdfExport.ts` or `pdfExportUtils.tsx`) that contains the PDF generation logic
- For each diagram, create a temporary off-screen DOM container (`div` with `position: absolute; left: -9999px; top: 0`) appended to `document.body`
- Use `ReactDOM.createRoot` (React 18) to render an SVG wrapper containing the appropriate renderer component (`UserJourneyDiagramRenderer` or `UserJourneyOverviewDiagramRenderer`) into the off-screen container
- The SVG wrapper must set explicit `width` and `height` attributes matching the content bounds (not viewBox-based scaling) so html2canvas captures at native pixel resolution
- Use the `onContentBounds` callback from each renderer to obtain the exact diagram dimensions before capture
- After rendering, use `html2canvas` on the off-screen container at 2x scale (`scale: 2` option) for crisp output; if file size becomes a concern, 3x should be avoided
- Pass `useCORS: true` and `backgroundColor: '#FFFFFF'` to html2canvas options
- After capturing, unmount the React root and remove the off-screen container from the DOM
- Process diagrams sequentially (one at a time) to avoid excessive DOM/memory pressure

**Content bounds for page orientation**
- Each renderer reports its content dimensions via the `onContentBounds` callback: `{ width: number; height: number }`
- These bounds are used for two purposes: (1) sizing the off-screen SVG container and (2) determining portrait vs. landscape orientation
- The `computeContentBounds` (journey) and `computeOverviewContentBounds` (overview) functions are already exported and can also be called directly if needed as a fallback

**PDF structure: Title page**
- Page 1 is the title page in Portrait A4 orientation
- Content: project name from `state.loadedFileName` (centered, large font ~24pt), generation date formatted as "DD Month YYYY" (centered, ~14pt, gray), and a summary line like "X Business Users, Y User Journey Diagrams, Z Overview Diagrams" (centered, ~12pt)
- Use jsPDF text methods (`doc.text()`) with appropriate font sizes and positioning; no html2canvas needed for the title page

**PDF structure: Table of contents with clickable links and bookmarks**
- Page 2 is the table of contents in Portrait A4 orientation
- Title "Table of Contents" at the top (~18pt, bold)
- For each business user group: render the business user name as a section header (~14pt, bold), then indent each diagram name underneath (~12pt) with a page number right-aligned
- Each entry (both section headers and diagram names) must be a clickable internal link using `doc.link()` or `doc.textWithLink()` that navigates to the corresponding diagram page
- Add PDF outline bookmarks using jsPDF's `doc.outline.add()` API: one top-level bookmark per business user, with child bookmarks for each diagram within that user's group
- If the TOC exceeds one page, continue on subsequent pages (rare but handle gracefully by checking remaining vertical space and adding a new page when needed)

**PDF structure: Diagram pages**
- After the TOC, render one diagram per page
- Each diagram page has a small title at the top (~12pt, the diagram name) followed by the captured diagram image
- The diagram image is scaled to fit the page's printable area (A4 with ~20mm margins on all sides) while maintaining aspect ratio
- Page orientation is determined per-diagram: default to Portrait A4; switch to Landscape A4 if the diagram's content width is more than 1.3x its content height (the "significantly wider" threshold)
- Use jsPDF's `doc.addPage('a4', 'portrait')` or `doc.addPage('a4', 'landscape')` for each diagram page
- Insert the captured image using `doc.addImage(canvasDataUrl, 'PNG', x, y, scaledWidth, scaledHeight)`

**PDF file output**
- Save the generated PDF using `doc.save(filename)` which triggers a browser download
- Filename format: `{projectName} - User Journey Diagrams.pdf` where projectName comes from `state.loadedFileName` (strip file extension if present)
- If `state.loadedFileName` is null/empty, use "User Journey Diagrams.pdf" as fallback

**Extract helpers to shared utility**
- The `extractUserJourneyDiagram()`, `isUserJourneyDiagramDto()`, `extractUserJourneyOverviewDiagram()`, and `isUserJourneyOverviewDiagramDto()` functions are currently defined as module-private functions inside `Canvas.tsx`
- These must be extracted to a shared utility file (e.g., `diagramExtractionUtils.ts`) so that both `Canvas.tsx` and the new PDF export module can import them
- Update `Canvas.tsx` to import from the new shared utility instead of using its local copies

**Wiring the button in DiagramsView.tsx**
- In `DiagramsView.tsx`, define an `onSaveAllAsPdf` callback that invokes the PDF generation utility
- Pass this callback as the `onSaveAllAsPdf` prop to `JourneyReviewBanner`
- The callback needs access to `state.model.diagrams`, `state.model.metaModel`, and `state.loadedFileName`
- Generation is async; use the progress state to update the inline progress text as each diagram is processed

## Visual Design
No visual assets provided.

## Existing Code to Leverage

**UserJourneyDiagramRenderer and UserJourneyOverviewDiagramRenderer**
- Both are pure React components that render SVG `<g>` elements with lanes, steps/nodes, edges, header blocks, and navigation boxes
- Both accept an `onContentBounds` callback prop that reports `{ width, height }` after layout computation
- Both use `foreignObject` with HTML div elements for text wrapping -- this is the specific reason html2canvas is required instead of native SVG rasterization
- These components must be rendered off-screen into a temporary SVG to capture each diagram

**enrichJourneySteps (journeyEnrichment.ts) and enrichOverviewFull (overviewEnrichment.ts)**
- `enrichJourneySteps` adds `user_interaction_level`, `frequency`, and `co_worker_abbreviations`/`co_worker_links` to journey steps from meta-model entities
- `enrichOverviewFull` adds application grids per node, summary counts, and related colleagues to overview diagrams
- Both take meta-model data slices as parameters; the exact same slices used in Canvas.tsx lines 3650-3690 must be passed when rendering for PDF capture

**extractUserJourneyDiagram and extractUserJourneyOverviewDiagram (Canvas.tsx)**
- Extract typed content from a `Diagram` object by checking `typedContent.content` first, then `settings.journeyDiagram`/`settings.overviewDiagram` as fallback
- Include type guard functions for shape validation
- Must be extracted to a shared utility for reuse by the PDF export module

**JourneyReviewBanner component**
- Already renders "Save as Diagram", "Save All as Diagrams", navigation controls, and "Close Review" in a flex row
- The "Save All as PDF" button should follow the same styling pattern as "Save All as Diagrams" (outlined style: white bg, `#1565C0` border/text, 12px font, 6px/12px padding)
- The component uses optional callback props to conditionally render action buttons

**state.model.diagrams and state.loadedFileName (ArchitectureContext)**
- `state.model.diagrams` is a `Diagram[]` array containing all saved diagrams; filter by `diagram_type === 'USER_JOURNEY'` or `'USER_JOURNEY_OVERVIEW'`
- `state.loadedFileName` is the project file name string used for the PDF title page and output filename
- `state.model.metaModel.entities` and `state.model.metaModel.relationships` provide the enrichment data slices

## Out of Scope
- Backend changes or server-side PDF generation -- this is entirely client-side
- Watermarks, password protection, or custom headers/footers on PDF pages
- Selective diagram export (user choosing which diagrams to include) -- always exports all saved User Journey diagrams
- Post-generation PDF editing or preview before download
- Exporting from the review context (unsaved/preview diagrams) -- only saved diagrams from state.model.diagrams
- Multi-page spanning for a single diagram -- always fit to one page with scaling
- Exporting non-User-Journey diagram types (General, ER, Sequence, Activity, State, UI_Workflow, UI_SCREEN)
- Adding the button to the Journey Chooser screen or OverviewReviewBanner -- only on JourneyReviewBanner
- Custom fonts or branding on the PDF beyond the auto-generated title page content
- Landscape orientation for the title page or table of contents -- these are always Portrait A4
