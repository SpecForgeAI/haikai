Log Evidence in Candidate Details UI

We need to implement Spec 6 of a 7-spec roadmap for discovery candidate evidence explainability and runtime log enrichment.

Context:
Spec 1 added expandable candidate details in the Discovery Candidate Review table.
Spec 2 added curated Code Detection detail mappers.
Spec 3 added a normalized frontend evidence data contract with three sections:
- codeDetection
- logScans
- llmReview
Spec 4 added optional runtime log file upload at discovery run start.
Spec 5 added backend/discovery-service processing for uploaded logs, producing structured runtime endpoint evidence after deterministic code analysis and before LLM gap-fill/review.

This spec should wire the runtime log evidence from Spec 5 into the frontend candidate details UI from Specs 1–3.

Roadmap context:
1. Candidate Details Expansion UI — done/shaped
2. Code Detection Detail Mappers — done/shaped
3. Candidate Evidence Data Contract — done/shaped
4. Runtime Log Input at Discovery Run Start — done/shaped
5. Web Access Log Runtime Endpoint Evidence — done/shaped
6. Log Evidence in Candidate Details UI — this spec
7. Confidence, Tier, and Runtime Badges

Goal:
Populate the "Log Scans" section in the expanded candidate details UI for the four supported candidate types:
- endpoints
- interfaces
- logical_data_entities
- interface_logical_entities

Log evidence should enhance candidates discovered by code review and/or added by the LLM. It should not create a separate UI list of unmatched log-only routes in this spec.

Core product rule:
Logs enhance candidate rows that exist.

If code review found a candidate and logs match it:
- Show log evidence on that candidate row.

If code review found a candidate, the LLM reviewed/enhanced it, and logs match it:
- Show Code Detection, Log Scans, and LLM Review evidence where available.

If code review did not find a candidate but the LLM adds it using log context:
- A normal candidate row exists, likely with a source/tier such as "LLM + Logs" in a later spec.
- Show supporting Log Scans evidence on that row if associated runtime evidence exists.

If code review did not find a candidate and the LLM does not add it:
- Do not show it in the candidate review UI.
- Keep unmatched log-only observations only in backend/run diagnostic summaries or logs for informational/debug purposes.

Do not add a separate "unmatched runtime routes" table in this spec.

Data source:
Use the structured runtime evidence produced by Spec 5.

The frontend should retrieve or receive runtime evidence associated with persisted candidates. Prefer the API/shape established by Spec 5. Do not parse raw log files in the frontend.

Supported candidate types:
Only these candidate types should display Log Scans evidence:
- endpoints
- interfaces
- logical_data_entities
- interface_logical_entities

Unsupported candidate types remain non-expandable as established in Spec 1.

Evidence behavior by candidate type:

1. endpoints

Endpoint candidates should display direct runtime endpoint evidence.

Show when available:
- Observed usage count, based on 2xx/3xx responses only
- Total log requests if available
- Compact status-code breakdown
- First seen
- Last seen
- Source log file count if available
- Match reason or match confidence if available

Required wording examples:
- "Observed 1,842 successful/redirect calls in supplied logs."
- "Status codes: 2xx: 1,801 · 3xx: 41 · 4xx: 31 · 5xx: 10"
- "First seen: 2026-04-01"
- "Last seen: 2026-04-29"

If there is no associated log evidence for the endpoint row, show:
"Log scan evidence was not found for this run."

2. interfaces

Interface candidates should display log evidence derived from related endpoint runtime evidence.

Derived evidence may use child/related endpoint candidates or backend-provided rollups from Spec 5.

Show when available:
- Total observed calls across related endpoints
- Number of related endpoints with observed runtime evidence
- Number of related endpoints with no associated log evidence, if available
- Top related endpoints by observed usage, if available
- Compact aggregate status-code breakdown
- First seen across related endpoints
- Last seen across related endpoints

Required wording examples:
- "Related endpoints observed 12,430 successful/redirect calls."
- "Observed endpoints: 4 of 6 related endpoints."
- "Top endpoint: GET /owners/{ownerId} — 8,200 calls"
- "Status codes: 2xx: 12,110 · 3xx: 320 · 4xx: 74 · 5xx: 5"

If there is no associated log evidence for the interface row, show:
"Log scan evidence was not found for this run."

3. logical_data_entities

Logical data entity candidates should display runtime relevance derived from endpoint/interface-logical-entity evidence.

The wording should be careful. Do not say the data entity itself was "called." Instead, describe related endpoint traffic.

Show when available:
- Total observed calls across related endpoints
- Number of related endpoints
- Read-like count if available, derived from GET/HEAD/OPTIONS
- Write/change-like count if available, derived from POST/PUT/PATCH/DELETE
- First seen across related endpoints
- Last seen across related endpoints

Required wording examples:
- "Related endpoints observed 12,430 successful/redirect calls."
- "Read-like traffic: 10,900"
- "Write/change-like traffic: 1,530"
- "First seen: 2026-04-01"
- "Last seen: 2026-04-29"

If there is no associated log evidence for the logical data entity row, show:
"Log scan evidence was not found for this run."

4. interface_logical_entities

Interface-logical-entity candidates should display relationship/contract usage derived from endpoint runtime evidence.

Usage means how many times the logical data entity was used as a request or response body across observed endpoint calls, where that request/response role is known.

Show when available:
- Total observed calls across endpoints supporting this interface/logical-data relationship
- Request body usage count, where known
- Response body usage count, where known
- Request/response combined or unknown-role count, where role is not known
- Number of supporting observed endpoints
- Compact status-code breakdown if available
- First seen
- Last seen

Required wording examples:
- "This interface/data relationship is supported by 3 observed endpoints."
- "Request body usage: 1,530 calls"
- "Response body usage: 10,900 calls"
- "Unknown role usage: 240 calls"
- "Total observed contract usage: 12,430 successful/redirect calls"

If there is no associated log evidence for the interface-logical-entity row, show:
"Log scan evidence was not found for this run."

Placeholder behavior:
Replace the old placeholder:
"Log scan evidence is not available for this run."

With the new row-level fallback:
"Log scan evidence was not found for this run."

Use this fallback whenever the run has no associated log evidence for that row, regardless of whether:
- no logs were supplied,
- logs were supplied but no evidence matched this row,
- evidence exists for other rows but not this row.

Do not show different explanations for these cases in this spec.

Status code display:
Show compact status-code breakdown where available.

Format:
"Status codes: 2xx: N · 3xx: N · 4xx: N · 5xx: N"

Only include status classes that are available in the evidence payload. Avoid undefined/null values.

Date display:
Show first seen and last seen when available.

Use existing project date formatting conventions. If no convention exists, use a concise readable format.

LLM-created candidates with log evidence:
If a persisted candidate has associated log evidence but no Code Detection details, the details panel should still show the log evidence in the Log Scans column.

Do not require Code Detection evidence for Log Scans evidence to render.

Unmatched log-only observations:
Do not display unmatched log-only observations in candidate details unless they are associated with a persisted candidate.

Unmatched log-only observations that are not associated with a candidate may remain in backend/run diagnostics or logs for informational/debug purposes.

UI requirements:
The expanded details layout remains three columns:
- Code Detection
- Log Scans
- LLM Review

This spec only changes the Log Scans content.

Do not change:
- Show Details / Close Details button behavior
- Approve / Reject / Defer behavior
- Supported expandable candidate types
- Code Detection content except where needed to keep evidence contract integration working
- LLM Review placeholder/content
- Confidence score display
- Tier label display
- Runtime badges

Normalized evidence contract integration:
Use the CandidateEvidenceDetails / CandidateEvidenceSection model from Spec 3.

The Log Scans section should be built as a CandidateEvidenceSection.

When evidence exists:
- title: "Log Scans"
- status: "available" or "partial" depending on data completeness
- summary/reason: concise human-readable runtime evidence summary
- fields: structured log evidence fields
- notes: optional notes/warnings where useful

When no evidence exists:
- title: "Log Scans"
- status: "not_available"
- summary or reason: "Log scan evidence was not found for this run."
- fields: []

Suggested frontend builder shape:
- buildLogScansEvidenceSection(candidate, runtimeEvidenceContext)
- buildEndpointLogEvidenceSection(candidate, runtimeEvidenceContext)
- buildInterfaceLogEvidenceSection(candidate, runtimeEvidenceContext)
- buildLogicalDataEntityLogEvidenceSection(candidate, runtimeEvidenceContext)
- buildInterfaceLogicalEntityLogEvidenceSection(candidate, runtimeEvidenceContext)

The exact shape should follow existing project conventions.

Data fetching:
Use the existing candidate/run data fetching path if Spec 5 embedded runtime evidence in candidate or run payloads.

If Spec 5 exposes a separate runtime evidence endpoint, fetch it in the discovery candidate review screen and pass it to the evidence builder.

Avoid inefficient per-row network requests. Fetch runtime evidence once per run/candidate list where possible.

Performance:
Candidate details should remain responsive.
Do not perform heavy aggregation in the render loop if it can be precomputed.
Memoize or pre-index runtime evidence by candidate ID where useful.

Acceptance criteria:
1. The Log Scans column no longer always shows the old placeholder.
2. For endpoint candidates with associated runtime evidence, Log Scans shows observed usage count.
3. Endpoint Log Scans shows compact status-code breakdown when available.
4. Endpoint Log Scans shows first seen and last seen when available.
5. For interface candidates, Log Scans shows derived related endpoint usage when available.
6. For logical_data_entities candidates, Log Scans shows related endpoint observed calls when available, using wording like "Related endpoints observed N calls."
7. For interface_logical_entities candidates, Log Scans shows contract usage derived from request/response body endpoint calls where available.
8. For rows with no associated log evidence, Log Scans shows exactly:
   "Log scan evidence was not found for this run."
9. Log evidence can render on a persisted LLM-created candidate if that candidate has associated runtime evidence.
10. Unmatched log-only observations that are not associated with a persisted candidate are not shown in the candidate review UI.
11. The UI still uses the three section headings:
   - Code Detection
   - Log Scans
   - LLM Review
12. The details panel still does not repeat row-level summary fields such as name, tier, type, confidence, review status, or synthesized timestamp.
13. Existing Show Details / Close Details behavior remains unchanged.
14. Existing Approve / Reject / Defer behavior remains unchanged.
15. Existing supported expandable candidate types remain:
   - endpoints
   - interfaces
   - logical_data_entities
   - interface_logical_entities
16. Unsupported candidate types remain non-expandable.
17. Confidence scores are not changed in this spec.
18. Tier labels are not changed in this spec.
19. Runtime badges are not added in this spec.
20. LLM Review behavior is not changed in this spec.
21. No raw log files are fetched or parsed by the frontend.
22. Tests are added or updated for endpoint, interface, logical_data_entity, and interface_logical_entity Log Scans rendering.

Out of scope:
- Log upload UI
- Backend log parsing
- Runtime evidence extraction/matching
- Confidence score changes
- Tier label changes
- Runtime badges
- Static resource classification
- Health/metrics classification
- User-agent/referrer/IP display
- Separate unmatched runtime route UI
- Raw log viewing
- Data movements
- Broad support for candidate types outside:
  - endpoints
  - interfaces
  - logical_data_entities
  - interface_logical_entities

Testing guidance:
Add or update tests for:
- Endpoint candidate with runtime evidence renders observed call count.
- Endpoint candidate renders compact status-code breakdown.
- Endpoint candidate renders first/last seen.
- Endpoint candidate without associated evidence renders fallback text.
- Interface candidate renders derived related endpoint usage.
- Logical data entity candidate renders "Related endpoints observed N calls."
- Interface-logical-entity candidate renders request/response contract usage where role is known.
- LLM-created candidate with associated runtime evidence can render Log Scans evidence.
- Unmatched log-only observations are not rendered in candidate details unless associated with a persisted candidate.
- Old placeholder text is replaced by:
  "Log scan evidence was not found for this run."
- Existing Show Details / Close Details and review actions still work.
