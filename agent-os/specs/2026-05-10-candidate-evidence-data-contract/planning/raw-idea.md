Candidate Evidence Data Contract

We need to implement Spec 3 of a 7-spec roadmap for discovery candidate evidence explainability.

Context:
Spec 1 added an expandable details UI to the Discovery Candidate Review table. Eligible candidate rows expand into three columns:
- Code Detection
- Log Scans
- LLM Review

Spec 2 added curated Code Detection mappers for these four supported candidate types:
- endpoints
- interfaces
- logical_data_entities
- interface_logical_entities

This spec should introduce a normalized frontend evidence data contract so the details UI renders from one stable evidence model instead of directly from candidate-specific mapper output.

This is a frontend-first contract. Do not change backend APIs, backend DTOs, database persistence, confidence score calculations, tier labels, or discovery-service behavior in this spec.

Roadmap context:
1. Candidate Details Expansion UI — done/shaped
2. Code Detection Detail Mappers — done/shaped
3. Candidate Evidence Data Contract — this spec
4. Runtime Log Input at Discovery Run Start
5. Web Access Log Runtime Endpoint Evidence
6. Log Evidence in Candidate Details UI
7. Confidence, Tier, and Runtime Badges

Goal:
Create a normalized frontend evidence model for discovery candidate details, aligned to the three-column UI:
- codeDetection
- logScans
- llmReview

Then refactor the Candidate Details Panel to render from this normalized model.

Target candidate types:
Only support the existing four expandable candidate types:
- endpoints
- interfaces
- logical_data_entities
- interface_logical_entities

Unsupported candidate types remain non-expandable as established in Spec 1.

Required normalized evidence shape:
Create frontend types/interfaces for a candidate evidence model with these top-level sections:

- codeDetection
- logScans
- llmReview

Each evidence section should support:
- title
- status
- summary or reason text
- fields
- notes or warnings
- optional confidence impact fields

Suggested TypeScript shape:

type CandidateEvidenceStatus =
  | "available"
  | "not_available"
  | "partial"
  | "warning";

type CandidateEvidenceField = {
  label: string;
  value: string | string[];
};

type CandidateEvidenceNote = {
  level: "info" | "warning" | "success";
  text: string;
};

type CandidateEvidenceSection = {
  title: string;
  status: CandidateEvidenceStatus;
  summary?: string;
  reason?: string;
  fields: CandidateEvidenceField[];
  notes?: CandidateEvidenceNote[];
  confidenceImpactLabel?: string;
  confidenceImpactReason?: string;
};

type CandidateEvidenceDetails = {
  candidateId: string;
  candidateType: string;
  codeDetection: CandidateEvidenceSection;
  logScans: CandidateEvidenceSection;
  llmReview: CandidateEvidenceSection;
};

These exact names can be adjusted to match project conventions, but the contract should preserve the same conceptual structure.

Code Detection section:
The existing curated Code Detection mapper output from Spec 2 should be adapted to produce a CandidateEvidenceSection.

The Code Detection section should usually have:
- title: "Code Detection"
- status: "available" when useful code detection details exist
- reason or summary explaining why the candidate was detected
- curated fields from Spec 2
- optional confidenceImpactLabel / confidenceImpactReason, but do not change the actual confidence score

For example:
{
  title: "Code Detection",
  status: "available",
  reason: "Detected as a controller method exposed through framework route annotations.",
  fields: [
    { label: "Detected by", value: "Spring Boot Adapter" },
    { label: "HTTP method", value: "GET" },
    { label: "Path", value: "/owners/{ownerId}/pets/{petId}/edit" },
    { label: "Controller", value: "PetController" },
    { label: "Source file", value: "src/main/java/.../PetController.java" }
  ],
  confidenceImpactLabel: "High",
  confidenceImpactReason: "Deterministic adapter evidence from source code."
}

Log Scans section:
Logs are not implemented yet. This section must always render as a placeholder for now.

Required placeholder:
- title: "Log Scans"
- status: "not_available"
- summary or reason:
  "Log scan evidence is not available for this run."
- fields: []

Do not attempt to derive log evidence in this spec.

LLM Review section:
Candidate-specific LLM review details are not implemented yet. This section must render as a placeholder for now.

Required placeholder:
- title: "LLM Review"
- status: "not_available"
- summary or reason:
  "No candidate-specific LLM review details are available yet."
- fields: []

Do not generate or infer LLM reasoning in this spec.

UI refactor:
Refactor the Candidate Details Panel so it renders from CandidateEvidenceDetails rather than directly from raw candidate data or candidate-type-specific mapper output.

The rendering component should be generic:
- It receives a CandidateEvidenceDetails object.
- It renders three evidence section cards/columns.
- It does not need to know candidate-type-specific details.
- It should gracefully render sections with no fields.
- It should support optional notes and optional confidence impact text, even if only Code Detection uses them for now.

Suggested structure:
- buildCandidateEvidenceDetails(candidate)
  - returns CandidateEvidenceDetails
- buildCodeDetectionEvidenceSection(candidate)
  - wraps Spec 2 mappers
- buildLogScansEvidenceSection(candidate)
  - returns not_available placeholder
- buildLlmReviewEvidenceSection(candidate)
  - returns not_available placeholder
- CandidateDetailsPanel
  - renders CandidateEvidenceDetails

Display rules:
- Preserve the three headings exactly:
  - Code Detection
  - Log Scans
  - LLM Review
- Do not repeat row-level candidate summary fields such as name, tier, type, confidence, review status, or synthesized timestamp.
- Do not display raw JSON.
- Do not display undefined/null/empty values.
- Do not show all raw candidate.data fields.
- Keep curated Code Detection content from Spec 2.
- Log Scans and LLM Review must show the required placeholders.
- Notes and warnings should be readable but compact.
- Confidence impact fields, when present, should be displayed as explanatory text only. They must not alter the row confidence value.

Acceptance criteria:
- Frontend has a normalized evidence data contract/type aligned to:
  - codeDetection
  - logScans
  - llmReview
- The details UI renders from the normalized evidence model.
- Candidate-type-specific Code Detection mappers feed into the normalized evidence model.
- The details panel rendering component is generic and not tightly coupled to raw candidate.data.
- The four supported candidate types still have enabled details:
  - endpoints
  - interfaces
  - logical_data_entities
  - interface_logical_entities
- Unsupported candidate types remain non-expandable.
- Code Detection content remains curated and readable as defined in Spec 2.
- Log Scans always shows:
  "Log scan evidence is not available for this run."
- LLM Review always shows:
  "No candidate-specific LLM review details are available yet."
- Optional confidence impact fields may be displayed but must not change the actual confidence score.
- Existing Approve, Reject, and Defer behavior remains unchanged.
- Existing table filtering, sorting, paging, and review status behavior remains unchanged.
- No backend API changes are introduced in this spec.
- No discovery-service changes are introduced in this spec.
- No log processing behavior is introduced in this spec.
- No tier label changes are introduced in this spec.
- Tests are updated or added for the normalized evidence contract and the refactored details panel.

Out of scope:
- Backend DTOs or API response changes
- Database schema changes
- Log upload or log parsing
- Runtime endpoint evidence
- Confidence score recalculation
- Tier label changes
- Runtime badges
- Candidate-specific LLM review generation
- Raw source code snippets
- Broad support for candidate types outside the four supported types

Implementation notes:
Inspect the existing frontend code modified by Specs 1 and 2 before implementation.

Suggested file organization, adjusted to match existing conventions:
- candidateEvidenceTypes.ts
- candidateEvidenceBuilder.ts
- codeDetectionEvidenceBuilder.ts
- CandidateDetailsPanel.tsx
- CandidateEvidenceSectionCard.tsx

Keep mapper logic separate from rendering logic.

Testing guidance:
Add or update tests to cover:
- buildCandidateEvidenceDetails returns all three sections.
- Log Scans placeholder is present.
- LLM Review placeholder is present.
- Code Detection section is available for supported candidate types when data exists.
- Details panel renders all three columns from CandidateEvidenceDetails.
- Unsupported candidate types remain non-expandable.
- Missing optional fields do not break rendering.
