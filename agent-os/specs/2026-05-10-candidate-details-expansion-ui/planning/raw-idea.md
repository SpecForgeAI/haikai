Candidate Details Expansion UI

We need to implement Spec 1 of a 7-spec roadmap for discovery candidate evidence explainability.

Context:
The current Discovery Candidate Review table shows discovery candidates in rows with columns like:
- Name
- Tier
- Type
- Confidence
- Review Status
- Synthesized At
- Actions

Current row actions are:
- Approve
- Reject
- Defer

We want to add a foundational details expansion UI before doing any log enrichment work.

This spec should be frontend-only. Do not change backend APIs or persistence in this spec. Details should be derived from the existing candidate payload only. Later specs will add normalized evidence contracts and log scan evidence.

Roadmap context:
1. Candidate Details Expansion UI — this spec
2. Code Detection Detail Mappers
3. Candidate Evidence Data Contract
4. Runtime Log Input at Discovery Run Start
5. Web Access Log Runtime Endpoint Evidence
6. Log Evidence in Candidate Details UI
7. Confidence, Tier, and Runtime Badges

Goal:
Add an expandable details area to eligible discovery candidate rows so users can understand candidate evidence in a three-column layout.

Target candidate types for this first version:
- endpoints
- interfaces
- logical_data_entities
- interface_logical_entities

Only these four candidate types should have an enabled details button. For all other candidate types, the details button should be disabled and rows should not be expandable.

Required action button order:
When collapsed:
- Show Details
- Approve
- Reject
- Defer

When expanded:
- Close Details
- Approve
- Reject
- Defer

Expansion behavior:
Only one candidate row may be expanded at a time. Opening details for one row should close any previously expanded row.

Expanded area:
When a supported row is expanded, render a full-width details area directly below that candidate row. Do not repeat the candidate summary information already visible in the row. The expanded area should be visually connected to the row and span the table width.

The expanded details area should be split into three equal-width columns:
1. Code Detection
2. Log Scans
3. LLM Review

Column behavior for this spec:

Code Detection:
For now, populate this column using currently available candidate data. This spec does not need rich candidate-type-specific mappers yet; that comes in Spec 2. However, it should show a useful first version from generic candidate fields where available.

Suggested fields to display if present:
- Detected by / source adapter, from candidate.data._addedBy or equivalent
- Source file/path, from source_cluster_ids or any existing source/path field
- Candidate-specific useful fields from candidate.data where straightforward to render
- A short generic reason such as:
  - "Detected from deterministic code analysis."
  - For adapter-sourced rows, "Detected by a framework/language adapter during code analysis."

The Code Detection column should handle missing data gracefully with simple fallback text.

Log Scans:
Log enrichment has not been implemented yet. Always show placeholder text:
"Log scan evidence is not available for this run."

LLM Review:
For now, show placeholder text:
"No candidate-specific LLM review details are available yet."

This spec should not attempt to infer or generate LLM reasoning.

Visual design:
Use the existing UI design system and table styling conventions. The details card should be readable and compact. Prefer a card-like area with three internal panels/columns. On narrower screens, the layout may stack vertically if needed, but desktop/tablet width should use three columns.

Desired expanded layout concept:

+--------------------------------------------------------------------------------------------------+
| Name                         Tier     Type       Confidence   Review Status   Actions            |
+--------------------------------------------------------------------------------------------------+
| GET /owners/{ownerId}/pets   ADAPTER  endpoints  95%          pending_review  [Close Details]    |
|                                                                              [Approve]          |
|                                                                              [Reject]           |
|                                                                              [Defer]            |
+--------------------------------------------------------------------------------------------------+
|                                                                                                  |
|  +--------------------------+  +--------------------------+  +--------------------------+          |
|  | Code Detection           |  | Log Scans                |  | LLM Review               |          |
|  +--------------------------+  +--------------------------+  +--------------------------+          |
|  | Detected by: ...         |  | Log scan evidence is     |  | No candidate-specific    |          |
|  | Source file: ...         |  | not available for this   |  | LLM review details are   |          |
|  | Reason: ...              |  | run.                     |  | available yet.           |          |
|  +--------------------------+  +--------------------------+  +--------------------------+          |
|                                                                                                  |
+--------------------------------------------------------------------------------------------------+

Acceptance criteria:
- A "Show Details" button appears before Approve/Reject/Defer for every row.
- For candidate types endpoints, interfaces, logical_data_entities, and interface_logical_entities, "Show Details" is enabled.
- For all other candidate types, "Show Details" is disabled.
- Clicking "Show Details" expands a details area below that row and changes the button label to "Close Details".
- Clicking "Close Details" collapses the details area.
- Opening another supported row closes the previously expanded row.
- The details area has exactly three section headings:
  - Code Detection
  - Log Scans
  - LLM Review
- The expanded area does not repeat the row-level candidate summary fields such as name, tier, type, confidence, review status, or synthesized timestamp.
- The Log Scans column always shows:
  "Log scan evidence is not available for this run."
- The LLM Review column always shows:
  "No candidate-specific LLM review details are available yet."
- The Code Detection column renders available existing candidate data without requiring backend changes.
- Missing candidate data does not break rendering.
- Existing Approve, Reject, and Defer behavior remains unchanged.
- Existing table filtering, sorting, paging, and review status behavior remains unchanged.
- No backend API changes are introduced in this spec.
- No log processing behavior is introduced in this spec.

Out of scope:
- Parsing or uploading logs
- Matching logs to candidates
- Changing confidence scores
- Changing tier labels
- Adding runtime badges
- Creating a normalized backend evidence/explainability contract
- Implementing rich type-specific code detection mappers beyond a basic generic display
- Showing raw source code snippets
- Showing line numbers unless they already exist in the candidate payload
- Generating or inferring LLM reasoning

Implementation notes:
Look for the existing Discovery Candidate Review table/component in the frontend discovery UI. The likely area is under frontend-src/src/components/Discovery and the candidate API shape is likely related to frontend-src/src/api/discoveryApi.ts.

Keep the implementation small and focused:
- Add expanded row state, probably expandedCandidateId.
- Add a helper to determine whether a candidate type supports details.
- Add a reusable CandidateDetailsPanel component if that fits the existing frontend structure.
- Add a lightweight CodeDetectionPanel that renders existing candidate data safely.
- Ensure disabled "Show Details" buttons are visibly disabled and have an accessible disabled state.

Please inspect the existing frontend code before implementing and follow the existing component/style conventions.
