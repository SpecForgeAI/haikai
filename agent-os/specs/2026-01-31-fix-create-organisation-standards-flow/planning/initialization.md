# Spec Initialization

## Title
Fix Create Organisation standards flow (chips commit-on-blur, persist lists, correct external request body)

## Raw Idea/Intent

intent:
  Fix three regressions in the Create Organisation flow:
  1) Typed (non-pasted) values must be committed into chips when focus leaves the field or when Create is clicked.
  2) Organisation list fields (docsAppliedTo*) must be persisted to the Architecture Model Service DB on create.
  3) The external standards generation call must send the required request body schema (company/sources/technical_documents),
     and techStandardsGenerated must be set true only when the external call returns HTTP 200/201.

scope:
  in_scope:
    - Frontend: MultiValueChipsInput commits pending token on blur and on submit
    - Frontend: Create Organisation modal submits correct docsAppliedTo* arrays (including last typed token)
    - Architecture Model Service: Create Organisation endpoint accepts and persists docsAppliedTo* arrays
    - Gateway: standards/global/generate proxy accepts the external schema and forwards it unchanged to the external service
    - Gateway: on external success (200/201), update Organisation.techStandardsGenerated=true in AMS; otherwise leave false
    - Tests covering the three fixes
  out_of_scope:
    - Re-run standards generation UI, retries, background jobs, polling
    - Editing organisations beyond techStandardsGenerated update after create
    - Changes to external service implementation

CHANGE 1: Frontend chip commit on blur + submit (Issue #1)
components:
  - frontend/src/components/common/MultiValueChipsInput.tsx
requirements:
  - If the user has typed a non-empty token and then:
      a) the input loses focus (blur), OR
      b) the user clicks Create (form submit), OR
      c) the user presses Enter
    then the current token MUST be committed as a chip and included in the backing array.
  - Existing commit triggers remain:
      - paste creates chip
      - typing delimiters "|", "," or ";" commits chip
  - Ignore empty/whitespace-only tokens; trim token before commit.
  - De-duplicate case-insensitively within the same field (keep first occurrence).
  - Backspace on empty input removes last chip; chips removable with "x".

implementation_notes:
  - Add an onBlur handler to the input element that calls the same commit routine used by delimiter/enter.
  - Expose a lightweight "flushPendingToken" capability so a parent can force-commit before submit:
      - acceptable patterns: forwarded ref with flush() OR an optional prop callback that parent can invoke.
  - Ensure clicking the modal's Create button flushes all six chip inputs before collecting values for API calls.

tests:
  - Typing "abc" then tab/click away commits "abc" into chips[].
  - Typing "abc" then clicking Create commits "abc" into chips[] used in the request payload.

CHANGE 2: Persist docsAppliedTo* lists on Organisation create (Issue #2)
services:
  - Architecture Model Service
files/areas:
  - OrganisationController create request DTO
  - OrganisationService create logic
  - DTO/entity mapping (if separate)
requirements:
  - POST /api/v1/organisations (create) must accept and persist:
      - docsAppliedToAllSources: List<String>
      - docsAppliedToTechStack: List<String>
      - docsAppliedToCodingStyles: List<String>
      - docsAppliedToConventions: List<String>
      - docsAppliedToErrorHandling: List<String>
      - docsAppliedToValidation: List<String>
    along with name + description.
  - Null lists are normalized to empty lists before save.
  - Organisation row created must store the lists so DB columns are populated (not left null/default).
  - techStandardsGenerated must remain false on create unless explicitly set (default false).

api_contract:
  - Update the create request DTO (e.g., CreateOrganisationRequest) to include the six list fields.
  - Keep response DTO including these fields (so UI can read back if needed).
  - Preserve existing uniqueness semantics for Organisation.name (case-insensitive conflict returns 409 per existing error pattern).

tests:
  - Create organisation with non-empty docsAppliedTo* arrays → fetch/verify persisted arrays match.
  - Ensure null/missing arrays persist as [] (or are returned as []).

CHANGE 3: Correct external standards request body + flag update on 200/201 (Issue #3)
goal:
  Ensure the request sent FROM Gateway TO external standards service matches the required schema:
    {
      "company": "<org name>",
      "sources": [...],
      "technical_documents": {
        "tech_stack": [...],
        "coding_style": [...],
        "conventions": [...],
        "error_handling": [...],
        "validation": [...]
      }
    }
  and update Organisation.techStandardsGenerated only on HTTP 200/201.

gateway_changes:
  - Update (or add) Gateway route for global standards generation to accept the external schema as its request body
    (i.e., frontend sends company/sources/technical_documents; do NOT accept Organisation-shaped payload).
  - Gateway forwards this request body unchanged to the external standards service base URL + path:
      POST /api/v1/standards/global/generate
    including required auth headers configured server-side (do not expose secrets to frontend).
  - Response handling:
      - If external responds with HTTP 200 or 201:
          - Gateway must set Organisation.techStandardsGenerated=true in AMS
      - Else:
          - Do not modify Organisation.techStandardsGenerated (keep false)
          - Return error to frontend (propagate status or map to gateway standard error)

ams_update_mechanism:
  - Gateway must be able to update the organisation flag after success.
  - Use an existing PATCH/PUT organisation update endpoint if available; otherwise add a minimal endpoint:
      PATCH /api/v1/organisations/{organisationId}
        body: { "techStandardsGenerated": true }
  - Because the external request schema does not include organisationId, Gateway must resolve it:
      - Preferred: add/reuse AMS lookup endpoint:
          GET /api/v1/organisations/by-name/{name}
        returning organisation id (and other fields)
      - Then PATCH by id to set the flag.

frontend_changes:
  - When Create Organisation succeeds (DB save), call Gateway standards route using required external schema:
      company = created organisation name
      sources = docsAppliedToAllSources
      technical_documents mappings:
        tech_stack      = docsAppliedToTechStack
        coding_style    = docsAppliedToCodingStyles
        conventions     = docsAppliedToConventions
        error_handling  = docsAppliedToErrorHandling
        validation      = docsAppliedToValidation
  - Standards generation failure must NOT rollback org creation.
  - UI shows success toast on 200/201; error toast on other statuses; modal close behavior unchanged from current iteration policy.

tests:
  - Gateway unit/integration test: given external-schema request, gateway forwards exact body to external endpoint.
  - Gateway test: external returns 200/201 → AMS techStandardsGenerated updated true.
  - Gateway test: external returns non-200/201 → AMS techStandardsGenerated remains false.
  - Frontend test: payload sent to gateway matches required schema (no organisationId/docsAppliedTo* at this layer).

acceptance_criteria:
  - Typed values become chips on blur and are included in saved lists and standards call.
  - Creating an organisation persists docsAppliedTo* arrays into DB columns (visible via DB inspection and via GET API).
  - Gateway forwards required request body schema to external /standards/global/generate.
  - On external HTTP 200/201, Organisation.techStandardsGenerated becomes true; otherwise it remains false.
  - Organisation remains created even if standards generation fails.

## Created
2026-01-31
