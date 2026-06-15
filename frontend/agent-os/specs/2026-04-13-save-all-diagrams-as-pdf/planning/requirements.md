# Spec Requirements: Save All Diagrams as PDF

## Initial Description
Feature: "Save All Diagrams as PDF" for User Journey diagrams. After the "Define User Journeys" conversation produces and approves multiple User Journey Overview and User Journey diagrams, the user should be able to click a "Save All as PDF" button that generates a multi-page PDF document.

PDF structure:
1. Title page (project name, date, summary)
2. Table of contents page
3. Diagrams grouped by business user:
   - User 1's User Journey Overview diagram page(s)
   - User 1's User Journey diagram pages
   - User 2's User Journey Overview diagram page(s)
   - User 2's User Journey diagram pages
   - ...and so on for all users

Technical approach:
- Client-side only (no backend changes)
- Use html2canvas to capture each diagram as a high-resolution image (2x-3x scale) from the existing SVG+foreignObject renderers (UserJourneyDiagramRenderer, UserJourneyOverviewDiagramRenderer)
- Use jsPDF to compose the multi-page PDF
- Reuse 100% of existing rendering code -- same SVG, same foreignObject, same CSS, same enrichment (enrichJourneySteps, enrichOverviewFull)
- Group and sort diagrams by business user using journey.user_role_name from diagram typedContent
- The button should be accessible from the diagram review UI or top bar area
- Diagrams should be landscape-oriented and scaled to fit the page while maintaining aspect ratio

## Requirements Discussion

### First Round Questions

**Q1:** Button placement: The journey review UI has two modes where a button could live: (a) the JourneyReviewBanner (shown when viewing an individual diagram, alongside "Save as Diagram", "Save All as Diagrams", "Close Review"), or (b) the Journey Chooser mode header (shown when on the card selection screen, alongside "Close Review"). I assume the "Save All as PDF" button belongs on the JourneyReviewBanner alongside the existing "Save All as Diagrams" button, since the user would typically want to export after reviewing. Should it also appear on the Journey Chooser screen, or only in the banner?
**Answer:** Correct -- on the JourneyReviewBanner alongside "Save All as Diagrams".

**Q2:** Data source: The raw idea mentions both the journey review context (unsaved/preview diagrams from a conversation) and saved diagrams. I assume the PDF export should work from the journey review context (journeyReview.journeys and journeyReview.overviews), exporting whatever diagrams the current review session contains -- not from state.model.diagrams (saved diagrams). Is that correct, or should there also be a way to export previously-saved USER_JOURNEY and USER_JOURNEY_OVERVIEW diagrams from the normal diagrams view?
**Answer:** Render from saved diagrams (state.model.diagrams), not the review context. The saved diagrams have the full rendering including navigation links etc.

**Q3:** Title page content: The raw idea mentions "project name, date, summary." The project name is available as state.loadedFileName. For "summary," I assume we would show a brief line like "User Journey Diagrams -- X business users, Y journey diagrams, Z overview diagrams" rather than requiring any user input. Is that sufficient, or do you want additional content (e.g., product summary text from the meta-model)?
**Answer:** The basics for now -- project name, date, auto-generated summary line.

**Q4:** Table of contents format: I assume the TOC would list business user names as section headers with their diagram names indented underneath, with page numbers. Each entry would be plain text (not clickable PDF links). Is that correct?
**Answer:** Everything including clickable PDF bookmarks/links.

**Q5:** Diagram grouping: For grouping by business user, journey diagrams have journey.user_role_name, and overview diagrams have overview.business_user_name. I assume the sort order should be alphabetical by business user name, with the overview diagram appearing first within each user's section (before the individual journey diagrams). Is that correct?
**Answer:** Correct -- alphabetical by business user, overview first then journeys.

**Q6:** Page layout and scaling: I assume landscape A4 orientation with each diagram scaled to fit the page while maintaining aspect ratio (no cropping). For very wide diagrams (many lanes), should we allow the diagram to span multiple pages, or always scale down to fit on a single page?
**Answer:** Default to Portrait A4. Most diagrams are taller than wide. If a diagram is significantly wider than it is taller, swap that single diagram onto a Landscape A4 page. Always one diagram per page.

**Q7:** Progress indication: Generating a multi-page PDF with html2canvas rendering could take several seconds (especially with 10+ diagrams at 2-3x scale). I assume we should show a progress indicator (e.g., "Generating PDF... 3 of 12 diagrams") and disable the button during generation. Is a simple inline progress text sufficient, or should there be a modal/overlay?
**Answer:** Simple inline progress text is fine.

**Q8:** Is there anything that should be explicitly excluded from this feature? For example: watermarks, password protection, custom header/footer on each page, ability to select which diagrams to include (vs. always exporting all), or any post-generation editing of the PDF?
**Answer:** No special exclusions -- just implement what was discussed (title page, TOC with clickable links, diagrams grouped by user, portrait/landscape auto-detection).

### Existing Code to Reference

No similar existing features identified by the user for reference.

**Known Relevant Code Paths (from research):**
- Renderers: `frontend/src/components/DiagramsView/UserJourneyDiagramRenderer.tsx`, `UserJourneyOverviewDiagramRenderer.tsx`
- Enrichment: `frontend/src/components/DiagramsView/journeyEnrichment.ts` (enrichJourneySteps), `overviewEnrichment.ts` (enrichOverviewFull)
- Review UI: `frontend/src/components/DiagramsView/JourneyReviewBanner.tsx` (banner with Save All button)
- Saved diagrams: `state.model.diagrams` (the data source for PDF export, filtered to USER_JOURNEY and USER_JOURNEY_OVERVIEW types)
- Canvas rendering: `DiagramsView.tsx` (SVG wrappers for diagram canvases)
- Diagram types: `frontend/src/types/userJourneyDiagram.ts`, `userJourneyOverviewDiagram.ts`
- Content bounds: `computeContentBounds`, `computeOverviewContentBounds` (for determining diagram dimensions and portrait/landscape detection)
- Existing SVG export: `frontend/src/api/modelApi.ts` (exportDiagramAsSvg, exportAllDiagramsAsZip -- server-side SVG export, different approach but shows export patterns)

### Follow-up Questions
No follow-up questions needed. All answers are clear and comprehensive.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
N/A

## Requirements Summary

### Functional Requirements
- Generate a multi-page PDF from saved User Journey diagrams (state.model.diagrams, types USER_JOURNEY and USER_JOURNEY_OVERVIEW)
- Title page with project name, date, and auto-generated summary line (e.g., counts of users, journeys, overviews)
- Table of contents page with business user names as section headers, diagram names indented underneath, page numbers, and clickable PDF bookmarks/links to each diagram
- Diagrams grouped by business user (alphabetical), overview diagram first within each user's section, then individual journey diagrams
- Default to Portrait A4 page orientation; auto-detect and swap to Landscape A4 for diagrams that are significantly wider than tall
- Always one diagram per page, scaled to fit while maintaining aspect ratio
- "Save All as PDF" button on the JourneyReviewBanner alongside "Save All as Diagrams"
- Simple inline progress text during generation (e.g., "Generating PDF... 3 of 12 diagrams"), button disabled while generating
- Client-side only generation using html2canvas + jsPDF (no backend changes)
- Reuse existing SVG renderers and enrichment pipeline (same rendering as on-screen diagrams, including navigation links)

### Reusability Opportunities
- UserJourneyDiagramRenderer and UserJourneyOverviewDiagramRenderer can be rendered off-screen into temporary DOM containers for html2canvas capture
- enrichJourneySteps and enrichOverviewFull provide the same enrichment pipeline used in the diagram view
- JourneyReviewBanner already has the "Save All as Diagrams" button pattern that can be extended with "Save All as PDF"
- computeContentBounds and computeOverviewContentBounds provide exact diagram dimensions for proper scaling and portrait/landscape auto-detection

### Scope Boundaries
**In Scope:**
- PDF generation from saved diagrams (state.model.diagrams)
- Title page with project name, date, auto-generated summary
- Table of contents with clickable PDF bookmarks/links
- Diagrams grouped by business user (overview first, then journeys, alphabetical by user)
- Portrait A4 default with per-diagram landscape auto-detection
- One diagram per page, scaled to fit
- Inline progress indication during generation
- New npm dependencies (html2canvas, jsPDF)

**Out of Scope:**
- Backend changes (confirmed client-side only)
- Watermarks, password protection, custom headers/footers
- Selective diagram export (always exports all saved User Journey diagrams)
- Post-generation PDF editing
- Exporting from review context (only saved diagrams)
- Multi-page diagram spanning (always fit to single page)

### Technical Considerations
- html2canvas and jsPDF are NOT currently in package.json -- they need to be added as new dependencies
- The SVG renderers use foreignObject with HTML content (div elements with inline styles) -- html2canvas is specifically needed because native SVG-to-canvas APIs cannot render foreignObject content
- Diagrams are rendered inside SVG elements with viewBox-based scaling; the off-screen rendering container will need to replicate this SVG wrapper structure
- The enrichment functions (enrichJourneySteps, enrichOverviewFull) require meta-model data from state.model.metaModel -- this data must be accessible in the PDF generation context
- Content bounds are computed by each renderer (computeContentBounds, computeOverviewContentBounds) and can be used to determine the actual diagram size for portrait/landscape auto-detection
- Data source is state.model.diagrams filtered to USER_JOURNEY and USER_JOURNEY_OVERVIEW types, with typedContent providing user_role_name and business_user_name for grouping
- Portrait/landscape auto-detection: compare diagram width vs height from content bounds; if width significantly exceeds height, use landscape for that page
- PDF bookmarks/links in TOC require jsPDF's outline/bookmark API or internal link annotations
