## Raw Idea

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
- Reuse 100% of existing rendering code — same SVG, same foreignObject, same CSS, same enrichment (enrichJourneySteps, enrichOverviewFull)
- Group and sort diagrams by business user using journey.user_role_name from diagram typedContent
- The button should be accessible from the diagram review UI or top bar area
- Diagrams should be landscape-oriented and scaled to fit the page while maintaining aspect ratio
