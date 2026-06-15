Confidence Tier and Runtime Badges

We need to implement Spec 7 of a 7-spec roadmap for discovery candidate evidence explainability and runtime log enrichment.

Context:
Spec 1 added expandable candidate details in the Discovery Candidate Review table.
Spec 2 added curated Code Detection detail mappers.
Spec 3 added a normalized frontend evidence data contract.
Spec 4 added optional runtime log file upload at discovery run start.
Spec 5 added backend/discovery-service runtime endpoint evidence from uploaded logs.
Spec 6 displayed Log Scans evidence in the expanded candidate details UI for:
- endpoints
- interfaces
- logical_data_entities
- interface_logical_entities

This spec should add table-level runtime indicators and define how log evidence affects displayed Tier and Confidence for candidate review.

Roadmap context:
1. Candidate Details Expansion UI — done/shaped
2. Code Detection Detail Mappers — done/shaped
3. Candidate Evidence Data Contract — done/shaped
4. Runtime Log Input at Discovery Run Start — done/shaped
5. Web Access Log Runtime Endpoint Evidence — done/shaped
6. Log Evidence in Candidate Details UI — done/shaped
7. Confidence, Tier, and Runtime Badges — this spec

Goal:
Make log-enriched candidates visible at the table level without requiring the user to expand every row.

This spec should:
- Add concise runtime badges/indicators to the candidate table.
- Update displayed Tier/source labels to reflect log involvement where appropriate.
- Adjust displayed confidence where log evidence corroborates a candidate.
- Keep all changes explainable through the expanded details panel.

Supported candidate types:
Only apply runtime badge/tier/confidence effects to the four expandable candidate types:
- endpoints
- interfaces
- logical_data_entities
- interface_logical_entities

Unsupported candidate types should not receive runtime badges, log tier changes, or log-based confidence changes in this spec.

Core product rule:
Logs enhance candidate rows that exist. Logs do not create visible candidate rows by themselves.

Cases:
1. Code Detection found candidate + Logs match it
   - Show runtime badge.
   - Display Tier/source as Adapter + Logs or equivalent.
   - Increase displayed confidence according to rules below.

2. Code Detection found candidate + no associated log evidence
   - Do not reduce confidence solely because no log evidence was found.
   - Optionally show a neutral "No log evidence" badge only if the table already has a compact place for it; otherwise leave this to the expanded details panel.

3. LLM-created candidate + Logs support it
   - Show runtime badge.
   - Display Tier/source as LLM + Logs or equivalent.
   - Use log evidence as confidence support according to rules below.

4. Code Detection + LLM + Logs all support candidate
   - Display Tier/source as Adapter + LLM + Logs or equivalent, if all three sources are known.
   - Show runtime badge.
   - Increase displayed confidence according to rules below.

5. Log-only observation with no persisted candidate
   - Do not show in the candidate review UI.
   - Remains run diagnostic/debug information only.

Tier/source display:
The existing Tier column should be enhanced to reflect evidence sources.

If current implementation has a strict "tier" concept, avoid breaking persisted tier values. Prefer a display-only computed label in the frontend, or a separate display field if backend already provides one.

Suggested display labels:
- ADAPTER
- ADAPTER + LOGS
- ADAPTER + LLM
- ADAPTER + LLM + LOGS
- LLM
- LLM + LOGS

If existing casing/style uses "Adapter" instead of "ADAPTER", follow current UI conventions.

Tier/source label rules:
- If candidate has deterministic adapter/code detection evidence and no log evidence: show existing adapter/tier label unchanged.
- If candidate has deterministic adapter/code detection evidence and associated log evidence: append "+ LOGS".
- If candidate has LLM source/review evidence and associated log evidence: append "+ LOGS".
- If both adapter and LLM contributed and logs exist: show all known sources.
- Do not append "+ LOGS" when the row has only the fallback text "Log scan evidence was not found for this run."
- Do not append "+ LOGS" for unsupported candidate types.

Confidence display:
Log evidence may increase displayed confidence, but should not overwrite the underlying persisted confidence unless the existing product architecture already treats confidence as mutable candidate data.

Preferred approach:
- Compute a displayConfidence in the frontend or candidate presentation layer.
- Leave persisted base confidence unchanged unless existing APIs already support updating candidate confidence as part of discovery processing.
- Make the confidence change explainable in the expanded details evidence model.

Confidence rules:
- Logs can increase confidence when they corroborate an existing persisted candidate.
- Logs should not decrease confidence in this spec.
- No log evidence should not reduce confidence.
- 4xx/5xx evidence alone should not increase confidence unless there are also 2xx/3xx observed usage counts.
- Pure 404 evidence should not increase confidence.
- Confidence should be capped at 99%, not 100%, because scanned code and runtime logs can still differ from deployed reality.
- Do not apply log-based confidence changes to unsupported candidate types.

Recommended confidence uplift rules:

For endpoints:
- If observedUsageCount >= 1 and candidate has deterministic adapter/code evidence:
  base confidence + 3 percentage points, capped at 99.
- If observedUsageCount >= 100 and candidate has deterministic adapter/code evidence:
  base confidence + 4 percentage points, capped at 99.
- If observedUsageCount >= 1000 and candidate has deterministic adapter/code evidence:
  base confidence + 5 percentage points, capped at 99.
- If candidate is LLM-created but has supporting log evidence:
  base confidence + 5 percentage points, capped at 95 unless there is also code evidence.
- If only 4xx/5xx evidence exists and no 2xx/3xx usage:
  no confidence uplift.

For interfaces:
- Derive confidence uplift from related endpoint evidence.
- If at least one related endpoint has observed usage:
  base confidence + 2 percentage points, capped at 99.
- If 50% or more related endpoints have observed usage:
  base confidence + 3 percentage points, capped at 99.
- If 75% or more related endpoints have observed usage and total observed usage is high:
  base confidence + 4 percentage points, capped at 99.

For logical_data_entities:
- Derive confidence uplift from related endpoint/interface-logical-entity evidence.
- If related endpoints observed usage:
  base confidence + 1 or +2 percentage points, capped at 99.
- Keep this lower than endpoint/interface uplift because the log evidence is indirect.

For interface_logical_entities:
- Derive confidence uplift from endpoint runtime evidence where the logical data entity role is known or reasonably linked.
- If request/response role evidence is known and observed usage exists:
  base confidence + 2 or +3 percentage points, capped at 99.
- If role is unknown but related endpoint usage exists:
  base confidence + 1 or +2 percentage points, capped at 99.

The exact thresholds can be centralized as constants so they can be tuned later.

Runtime badges:
Add compact badges/indicators to the candidate table so reviewers can scan runtime relevance.

Suggested badges:
- Runtime observed
- High usage
- No log evidence
- Elevated errors
- LLM + Logs
- Adapter + Logs

Do not overcrowd the table. Prefer one compact Runtime column or small badges near the Tier/Confidence area.

Recommended table-level runtime display:
Add a compact "Runtime" column if the table has enough width.

Possible values:
- Observed 1.8k
- Observed 42
- High usage
- Elevated errors
- No log evidence
- —

If adding a new column is too disruptive, show a small badge next to the candidate name or Tier label.

Runtime badge rules:
- "Observed N" when associated log evidence has observedUsageCount > 0.
- "High usage" when observedUsageCount exceeds a configurable threshold, default 1000 for endpoints.
- "Elevated errors" when 5xx count or 5xx rate exceeds thresholds.
- "No log evidence" only for supported candidate types where logs were processed but no associated evidence was found, if the UI has space.
- Do not show "Unused."
- Do not show "Dead."
- Use "No log evidence" or leave blank instead of making decommissioning claims.

Error badge rules:
- 5xx evidence can show "Elevated errors" or warning styling.
- 4xx evidence should be shown cautiously and not treated as server risk by default.
- Error badges do not reduce confidence in this spec.
- Error badges should not imply the candidate is invalid.

Suggested default thresholds:
- High usage endpoint: observedUsageCount >= 1000
- Medium observed endpoint: observedUsageCount >= 100
- Low observed endpoint: observedUsageCount >= 1
- Elevated 5xx count: status5xxCount >= 10
- Elevated 5xx rate: status5xxCount / totalLogRequests >= 0.01
- High usage thresholds for interface/logical data/interface-logical relationship can derive from aggregate related endpoint counts.

These thresholds should be frontend constants or shared config if a config system already exists. Do not introduce complex user-configurable settings in this spec unless straightforward.

Evidence detail integration:
When confidence or tier display changes due to logs, the expanded details panel should explain why.

Update the normalized evidence model from Spec 3 to populate:
- confidenceImpactLabel
- confidenceImpactReason

For Log Scans sections with evidence, examples:
- confidenceImpactLabel: "Confidence increased"
- confidenceImpactReason: "Runtime logs observed successful/redirect calls matching this candidate."

For Code Detection sections, if useful:
- confidenceImpactLabel: "Base confidence"
- confidenceImpactReason: "Deterministic code adapter evidence."

The actual confidence score display should align with these explanations.

Important wording:
Use:
- "Observed in supplied logs"
- "Runtime observed"
- "No log evidence"
- "No log evidence found for this run"
- "High usage"

Avoid:
- "Unused"
- "Dead code"
- "Definitely exists"
- "Guaranteed"
- "Production usage" unless the log source is explicitly known to be production

Data source:
Use runtime evidence produced in Spec 5 and displayed in Spec 6.

Do not parse logs in the frontend.
Do not fetch raw log files.
Do not introduce new log processing.

API/backend behavior:
Prefer display-only computation in frontend if all required evidence is already available in candidate/run payloads.

If the backend already persists candidate.logEnrichment from Spec 5, use that as the primary source for runtime badge/confidence/tier display.

Avoid new backend endpoints in this spec unless the data from Spec 5 is not otherwise available.

Acceptance criteria:
1. Supported candidate types with associated log evidence show a table-level runtime indication.
2. Endpoint candidates with observed usage show compact runtime count, such as "Observed 1.8k."
3. Interface candidates with derived related endpoint usage show compact runtime evidence.
4. Logical data entity candidates with derived related endpoint usage show compact runtime evidence.
5. Interface-logical-entity candidates with derived contract usage show compact runtime evidence.
6. Candidates with associated log evidence display a tier/source label that includes "+ LOGS" or equivalent.
7. Candidates without associated log evidence do not display "+ LOGS."
8. Unsupported candidate types do not receive log-based tier/source labels.
9. Log evidence can increase displayed confidence according to centralized rules.
10. Displayed confidence is capped at 99%.
11. No log evidence does not reduce confidence.
12. 404-only or 4xx/5xx-only evidence does not increase confidence.
13. Error evidence can show a warning/elevated error badge without reducing confidence.
14. The expanded details panel explains confidence impact where log evidence changes displayed confidence.
15. The persisted base confidence is not changed unless existing architecture already supports that cleanly.
16. Existing Approve, Reject, and Defer behavior remains unchanged.
17. Existing Show Details / Close Details behavior remains unchanged.
18. Existing Log Scans detail content from Spec 6 remains visible.
19. No unmatched log-only observations appear in the candidate review UI unless associated with a persisted candidate.
20. No raw log files are fetched or parsed by the frontend.
21. Tests are added or updated for tier labels, runtime badges, confidence display, and confidence cap behavior.

Out of scope:
- Log upload UI
- Backend log parsing
- Runtime evidence extraction/matching
- Raw log viewing
- Static resource classification
- Health/metrics classification
- User-agent/referrer/IP display
- Data movements
- Service dependency extraction
- Database query extraction
- Business logic execution extraction
- Promoting log-only observations to visible candidates
- Decommissioning recommendations
- User-configurable threshold UI

Implementation notes:
Inspect the frontend candidate review table and details panel created/modified in Specs 1–6.

Suggested implementation shape:
- Add runtime evidence presentation helpers:
  - getRuntimeBadge(candidate)
  - getRuntimeDisplayText(candidate)
  - hasAssociatedLogEvidence(candidate)
  - getCandidateEvidenceSources(candidate)
- Add confidence calculation helper:
  - getDisplayConfidence(candidate)
  - getLogConfidenceUplift(candidate)
- Add tier/source display helper:
  - getDisplayTier(candidate)
  - getEvidenceSourceLabel(candidate)
- Keep confidence/tier display logic separate from rendering.
- Keep thresholds centralized in one constants file.

Suggested constants:
- HIGH_USAGE_ENDPOINT_THRESHOLD = 1000
- MEDIUM_USAGE_ENDPOINT_THRESHOLD = 100
- ELEVATED_5XX_COUNT_THRESHOLD = 10
- ELEVATED_5XX_RATE_THRESHOLD = 0.01
- MAX_LOG_CORROBORATED_CONFIDENCE = 99
- MAX_LLM_LOG_ONLY_CONFIDENCE = 95

Use existing project naming/style conventions.

Testing guidance:
Add or update tests for:
- Endpoint with observed usage shows runtime badge/text.
- Endpoint with high usage shows high-usage indicator.
- Endpoint with elevated 5xx evidence shows warning badge.
- Candidate with log evidence appends "+ LOGS" to tier/source display.
- Candidate without log evidence does not append "+ LOGS."
- Unsupported candidate type does not get runtime badge or +LOGS label.
- Adapter endpoint confidence increases with observed log usage.
- Confidence increase is capped at 99%.
- No log evidence does not reduce confidence.
- 404-only evidence does not increase confidence.
- 4xx/5xx-only evidence does not increase confidence.
- LLM-created candidate with log evidence can show LLM + LOGS source label.
- Expanded details panel shows confidence impact explanation when applicable.
- Existing review actions and expansion behavior still work.
