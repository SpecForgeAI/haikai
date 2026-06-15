# Specification: Project-level Standards Generation

## Goal
Add a "Generate Standards" menu item under the Project menu that opens a modal to collect source URLs/paths, then calls the external standards service to generate project-level standards using the active project's organisation and project names.

## User Stories
- As a user with an active project, I want to generate project-specific technical standards from documentation sources, so that my project has customized standards that override company defaults where applicable.
- As a user, I want clear feedback about whether standards generation succeeded or failed, so that I understand the result of my action.

## Specific Requirements

**FileMenu - Add Generate Standards Menu Item**
- Add "Generate Standards" menu item between "Open" and "Save" in the Project menu
- Add `onGenerateStandards` callback prop and `generateStandardsDisabled` prop to FileMenu component
- Follow existing menu item pattern with disabled styling via `menuItemDisabled` class
- Only render when `includeDatabase` is true (same gating as other DB-dependent menu items)
- Final menu item order: Create, Open, Generate Standards, Save, Save As, Delete, (separator), Import/Export items
- Click handler calls `onGenerateStandards()` then `onClose()` following existing pattern

**TopBar - Modal State and Handler Integration**
- Add state: `const [isGenerateProjectStandardsModalOpen, setGenerateProjectStandardsModalOpen] = useState(false)`
- Add handler: `handleGenerateProjectStandards` that sets modal open to true
- Compute disabled state: `generateStandardsDisabled = !activeProject`
- Pass `onGenerateStandards` and `generateStandardsDisabled` props to FileMenu
- Mount GenerateProjectStandardsModal component with isOpen, onClose, and activeProject props

**GenerateProjectStandardsModal Component**
- Create new file: `frontend/src/components/Project/GenerateProjectStandardsModal.tsx`
- Props: `isOpen: boolean`, `onClose: () => void`, `activeProject: ProjectDto | null`
- Modal structure follows CreateOrganisationModal pattern (overlay, container, header, content, footer)
- Modal header: "Generate Project Standards"
- Body text: "Choose the input documents (local files, external URLs) that will generate the project standards."
- Note text (smaller, grey #666): "Note - project standards override your company standards if the same topic, otherwise company standards remain."
- Single field using MultiValueChipsInput with label "Sources" and placeholder "Enter URLs or file paths..."

**GenerateProjectStandardsModal Submit Logic**
- On "Generate Standards" click: flush MultiValueChipsInput ref, set isGenerating=true, clear previous error
- Look up organisation name via `getOrganisationById(activeProject.organisationId)`
- If lookup fails: set error "Failed to resolve organisation", set isGenerating=false, return
- Build payload: `{ company: organisation.name, project: activeProject.name, sources }`
- Call `generateProjectStandards(payload)` and handle success/failure with toast messages
- Loading state: button text "Generating...", all inputs disabled, Cancel disabled, overlay/escape disabled

**GenerateProjectStandardsModal.module.css**
- Create new file: `frontend/src/components/Project/GenerateProjectStandardsModal.module.css`
- Copy base styles from CreateOrganisationModal.module.css (overlay, modal, header, footer, buttons)
- Add `.bodyText` for primary instruction text
- Add `.noteText` for smaller font (0.9em), grey color (#666), margin-top for spacing
- Add `.sourcesField` container for label + MultiValueChipsInput

**Frontend API Function - generateProjectStandards**
- Add to `frontend/src/api/organisationsApi.ts`
- Interface: `ProjectStandardsPayload { company: string; project: string; sources: string[]; }`
- Function: `generateProjectStandards(payload: ProjectStandardsPayload): Promise<void>`
- POST to `/api/v1/standards/product/generate`
- Follow existing generateGlobalStandards pattern for error handling

**Gateway Route - projectStandardsGenerate.ts**
- Create new file: `gateway/src/routes/projectStandardsGenerate.ts`
- Create `projectStandardsGenerateRouter` using Express Router
- Endpoint: `POST /generate` with validation for company (required), project (required), sources (optional array)
- Reuse `standardsServiceFetch` from standardsServiceClient.ts (same service, same auth)
- Forward to external service: `POST /api/v1/standards/product/generate`
- Error handling: 502 for auth failures, 503 for network errors, 500 for config errors

**Gateway Server - Mount New Route**
- In `gateway/src/routes/index.ts`: export `projectStandardsGenerateRouter`
- In `gateway/src/server.ts`: mount at `/api/v1/standards/product`

**Toast Integration**
- Use existing Toast component from `frontend/src/components/common/Toast.tsx`
- Success toast: type="success", message="Project standards generated successfully", auto-dismiss 5s
- Error toast: type="error", message="Project standards generation failed. You can retry or cancel.", auto-dismiss 30s
- Manage toast state in modal using pattern from CreateOrganisationModal

## Visual Design
No visual mockups provided. The modal follows existing CreateOrganisationModal styling:
- Same overlay opacity (rgba(0,0,0,0.5)) and click-to-close behavior
- Same modal container: white background, 8px border-radius, max-width 600px
- Same header styling with title and close button (X)
- Primary body text in normal weight, standard color (#333)
- Note text smaller (0.9em) and grey (#666)
- Same footer layout with Cancel (secondary grey) and Generate Standards (primary blue #1976D2) buttons
- MultiValueChipsInput styled consistently with organisation modal

## Existing Code to Leverage

**FileMenu.tsx (frontend/src/components/TopBar/)**
- Existing menu item pattern with `styles.menuItem` and conditional `styles.menuItemDisabled` class
- Click handler pattern: call action handler then onClose
- `includeDatabase` conditional rendering for DB-dependent items via useIncludeDatabase hook

**CreateOrganisationModal.tsx (frontend/src/components/Organisation/)**
- Modal structure with overlay, container, header, content, footer
- MultiValueChipsInput integration with `useRef<MultiValueChipsInputHandle>` and flush() pattern
- Loading state (isSubmitting) disabling inputs and buttons
- Toast state management pattern with showToast/hideToast callbacks

**standardsGenerate.ts (gateway/src/routes/)**
- Route structure with POST endpoint and request body validation
- `standardsServiceFetch` usage for authenticated upstream requests
- Error handling patterns: 502 for auth, 503 for network, 500 for config

**organisationsApi.ts (frontend/src/api/)**
- `generateGlobalStandards` function pattern for POST to gateway standards endpoint
- `getOrganisationById` for organisation name lookup by ID
- Error message extraction from JSON response body

## Out of Scope
- Persisting project standards sources to database (external service handles persistence)
- Editing or viewing previously generated project standards
- Async job queue, polling, or retry logic for long-running generation
- Any changes to company/organisation standards generation flows
- Backend AMS changes (no new AMS endpoints needed)
- Project flag updates (unlike org standards, no techStandardsGenerated flag)
- Standards generation without an active project loaded
- Displaying the generated standards content (service persists internally)
- Validation of source URLs or file path formats
- Progress indication during generation (simple spinner only)
