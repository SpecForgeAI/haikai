Web Access Log Runtime Endpoint Evidence

We need to implement Spec 5 of a 7-spec roadmap for discovery candidate evidence explainability and runtime log enrichment.

Context:
Spec 1 added expandable candidate details in the Discovery Candidate Review table.
Spec 2 added curated Code Detection detail mappers.
Spec 3 added a normalized frontend evidence data contract.
Spec 4 added optional runtime log file upload at discovery run start and stores uploaded logs as run input artifacts.

This spec should process uploaded log files and derive runtime endpoint evidence that can later be displayed in the Log Scans column and used by the LLM. This spec focuses on backend/discovery-service log processing and matching logic, not final UI presentation.

Roadmap context:
1. Candidate Details Expansion UI — done/shaped
2. Code Detection Detail Mappers — done/shaped
3. Candidate Evidence Data Contract — done/shaped
4. Runtime Log Input at Discovery Run Start — done/shaped
5. Web Access Log Runtime Endpoint Evidence — this spec
6. Log Evidence in Candidate Details UI
7. Confidence, Tier, and Runtime Badges

Goal:
When a discovery run includes uploaded log files, process those logs after deterministic code analysis and before the LLM gap-fill/review step. Extract HTTP runtime observations, aggregate them by method/path, match them to code-discovered endpoint candidates, and persist structured runtime evidence for later UI display and LLM use.

Primary target candidate type:
- endpoints

Derived/secondary target candidate types for later consumption:
- interfaces
- logical_data_entities
- interface_logical_entities

This spec should produce endpoint-level runtime evidence first. Rollups to the other three types may be computed now if straightforward, but final UI display belongs to Spec 6.

High-level pipeline requirement:
The log processing step should run after deterministic language/framework pack analysis and before the LLM non-deterministic gap-fill/review step.

Desired pipeline shape:
1. Run language/framework deterministic code analysis.
2. Produce deterministic candidates, especially endpoint/interface/logical entity/interface-logical entity candidates.
3. Load uploaded log artifacts from run input metadata.
4. Parse and aggregate HTTP runtime observations from logs.
5. Match observations to deterministic endpoint candidates.
6. Attach/persist runtime evidence to the run/candidates in a structured form.
7. Provide structured runtime evidence summary to the LLM gap-fill/review stage.
8. Continue existing discovery run flow.

Supported log input:
Use the log artifacts uploaded in Spec 4 and referenced from:
config_snapshot.inputArtifacts.logFiles[]

Do not introduce server-side path input in this spec.

Supported log formats:
Support common logs that can provide runtime evidence for endpoints and the related four candidate types.

At minimum, support:
- Apache/Nginx combined access log
- Apache/Nginx common access log
- JSON Lines / NDJSON access-style logs
- Syslog lines that contain HTTP request/status details
- Framework/application log lines that contain HTTP request/status details
- Plaintext fallback where HTTP method/path/status can be regex-extracted

Existing log parsing code may already support:
- json_lines
- syslog
- framework_pattern
- plaintext fallback

Reuse and extend existing log parsing/extractor code where appropriate rather than duplicating the whole log pipeline.

Required extracted HTTP observation fields:
For each parsed HTTP request observation, extract when available:
- HTTP method
- request path
- HTTP status code
- timestamp
- source log artifact reference
- line number or approximate line number
- raw line sample or safe snippet if already consistent with existing evidence practices

Ignore for now:
- query strings for route matching
- IP addresses
- user agents
- referrers
- static resource classification
- health/metrics/operational endpoint classification

Query string handling:
Ignore query strings for matching. For example:
- /api/orders/123?includeItems=true
should match as:
- /api/orders/123

Do not store or display query parameter summaries in this spec.

Status code semantics:
A 404 must not count as "endpoint observed."

Observed usage counts should include only:
- 2xx successful responses
- 3xx redirects

4xx and 5xx should be retained as error evidence where available, but:
- 4xx/5xx alone must not cause a route to count as observed usage
- pure 404 log-only routes should not become endpoint evidence
- if the same method/path has 2xx/3xx hits, it is observed, and 4xx/5xx counts can be included as additional status distribution evidence

Endpoint matching:
Match log observations to deterministic code-discovered endpoint candidates.

Matching should use:
- HTTP method
- normalized path template

Path normalization:
Normalize dynamic-looking path segments for matching:
- numeric IDs -> {id}
- UUIDs -> {id}
- long hashes/tokens -> {id}

Examples:
- /api/orders/123 -> /api/orders/{id}
- /api/orders/550e8400-e29b-41d4-a716-446655440000 -> /api/orders/{id}
- /api/files/a1b2c3d4e5f6g7h8 -> /api/files/{id}

When matched to a code-discovered endpoint, preserve the code endpoint's path template for display and evidence identity.

Do not require the normalized placeholder name to match exactly. For example:
- log normalized path: /owners/{id}/pets/{id}/edit
can match:
- /owners/{ownerId}/pets/{petId}/edit

Matching rules:
- Prefer exact method + exact normalized path match.
- Then allow method + equivalent placeholder path match.
- Do not match across different HTTP methods unless the code candidate method is missing/unknown.
- Avoid fuzzy matches that may attach logs to the wrong endpoint.
- If multiple endpoint candidates match the same observation, choose the most specific path if deterministic, otherwise mark ambiguous and do not attach automatically.

Unmatched route hints:
This spec may produce unmatched runtime route hints, but they must not become normal endpoint candidates.

Unmatched route hint threshold:
Only produce unmatched route hints when the method/path has at least 5 successful/redirect responses, meaning 2xx/3xx count >= 5.

Pure 404 routes should not become unmatched route hints.

Unmatched route hints should be stored separately from normal candidates/evidence so the UI can later show them as runtime review hints rather than code-backed candidates.

No static resource classification:
Do not classify static resources specially in this spec.

If code review/discovery has produced an endpoint candidate that corresponds to a static-looking path, and logs match it, attach log evidence to that endpoint like any other endpoint.

Do not change language/framework packs to classify static, health, metrics, or operational endpoints in this spec.

Aggregation:
Aggregate observations by method + normalized path, with status distribution.

For each matched endpoint candidate, produce runtime evidence with:
- totalLogRequests
- observedUsageCount, counting only 2xx/3xx
- status2xxCount
- status3xxCount
- status4xxCount
- status5xxCount
- topStatusCodes, if straightforward
- firstSeen
- lastSeen
- sourceLogFileCount
- sourceLogFiles or artifact references
- sampleLineRefs or safe snippets, if consistent with existing evidence model
- matchConfidence, such as high/medium/low or equivalent
- matchReason

Example matched endpoint evidence:
{
  "candidateId": "...",
  "candidateType": "endpoints",
  "method": "GET",
  "codePathTemplate": "/owners/{ownerId}/pets/{petId}/edit",
  "normalizedLogPath": "/owners/{id}/pets/{id}/edit",
  "observedUsageCount": 1842,
  "totalLogRequests": 1883,
  "status2xxCount": 1801,
  "status3xxCount": 41,
  "status4xxCount": 31,
  "status5xxCount": 10,
  "firstSeen": "2026-04-01T00:00:00Z",
  "lastSeen": "2026-04-29T23:59:59Z",
  "sourceLogFileCount": 3,
  "matchConfidence": "high",
  "matchReason": "Matched by HTTP method and equivalent normalized route template."
}

No-usage evidence:
For deterministic endpoint candidates that have no 2xx/3xx matching log observations, mark them as:
- no observed usage in supplied logs

Do not call them unused.

No-usage evidence should include:
- log files processed
- log time window if available
- note that absence of observed usage is not proof of unused functionality

Example no-usage evidence:
{
  "candidateId": "...",
  "candidateType": "endpoints",
  "observedUsageCount": 0,
  "status2xxCount": 0,
  "status3xxCount": 0,
  "status4xxCount": 0,
  "status5xxCount": 0,
  "noUsageObserved": true,
  "note": "No usage observed in supplied logs. This does not prove the endpoint is unused."
}

Persistence:
Persist structured runtime evidence in a way that later specs can use.

Prefer existing discovery run storage mechanisms if available:
- evidence atoms
- config_snapshot
- steps_payload
- candidate metadata
- existing log enrichment metadata structures

Do not store raw full log files in the database.

Do not alter core Architecture Model database schema unless absolutely necessary. Prefer JSON metadata on existing run/candidate structures.

The runtime evidence should be retrievable for:
- endpoint candidate display in Spec 6
- interface rollups in Spec 6
- logical_data_entities runtime relevance in Spec 6
- interface_logical_entities runtime usage in Spec 6
- LLM gap-fill/review context in this spec or later

LLM context:
Provide a compact structured runtime evidence summary to the LLM gap-fill/review stage.

Do not pass raw log files or long raw log excerpts to the LLM.

The LLM summary should include:
- matched endpoint runtime evidence
- endpoint candidates with no observed usage
- unmatched runtime route hints above threshold
- log processing summary

Example LLM context:
{
  "runtimeEvidenceSummary": {
    "logFilesProcessed": 3,
    "logWindow": {
      "firstSeen": "2026-04-01T00:00:00Z",
      "lastSeen": "2026-04-29T23:59:59Z"
    },
    "matchedEndpoints": [
      {
        "candidateId": "...",
        "method": "GET",
        "pathTemplate": "/owners/{ownerId}/pets/{petId}/edit",
        "observedUsageCount": 1842,
        "status2xxCount": 1801,
        "status3xxCount": 41,
        "status4xxCount": 31,
        "status5xxCount": 10
      }
    ],
    "codeEndpointsWithNoObservedUsage": [
      {
        "candidateId": "...",
        "method": "DELETE",
        "pathTemplate": "/owners/{ownerId}/pets/{petId}"
      }
    ],
    "unmatchedRuntimeRouteHints": [
      {
        "method": "GET",
        "pathTemplate": "/owners/search",
        "observedUsageCount": 12
      }
    ]
  }
}

LLM instruction:
When runtime evidence is provided, the LLM should use it to enrich its reasoning about endpoint/interface/logical entity candidates. It must not create normal candidates solely from unmatched log route hints in this spec.

Discovery behavior when no logs:
If a discovery run has no uploaded log artifacts, existing behavior must be unchanged.

Discovery behavior when logs cannot be read or parsed:
The discovery run should continue if log processing fails.
Record a warning in run metadata/steps payload.
Do not fail the whole discovery run solely because log processing failed.

Processing limits:
Respect file size limits established in Spec 4:
- 50 MB per file
- 200 MB total
These limits should be environment-configurable.

If logs exceed safe processing limits, skip or truncate safely and record warnings.

Performance:
Log parsing should stream or process line-by-line where practical. Avoid loading very large log bundles into memory unnecessarily.

Security/privacy:
Do not store raw IP addresses, user agents, or referrers in candidate evidence in this spec.
Do not pass raw full log content to the LLM.
Avoid persisting long raw log snippets. If snippets are stored, keep them short and safe.

Acceptance criteria:
1. Discovery runs with no uploaded logs behave exactly as before.
2. Discovery runs with uploaded logs process those logs after deterministic code analysis and before LLM gap-fill/review.
3. Uploaded log artifacts are loaded from config_snapshot.inputArtifacts.logFiles[] or the chosen Spec 4 metadata location.
4. Apache/Nginx common and combined access logs can be parsed for method/path/status/timestamp.
5. JSONL/NDJSON access-style logs can be parsed when they contain method/path/status fields or recognizable equivalents.
6. Syslog/framework/plaintext lines containing method/path/status can be parsed using safe fallback extraction.
7. Query strings are ignored for matching.
8. 2xx and 3xx responses count toward observed usage.
9. 404 responses do not count toward observed usage.
10. 4xx/5xx counts are retained as status distribution evidence where a route is otherwise matched/observed.
11. Pure 404 routes do not become endpoint evidence.
12. Log observations are matched to deterministic endpoint candidates using method and normalized path.
13. Numeric/UUID/hash path segments normalize to {id} for matching.
14. Matched endpoint candidates receive structured runtime evidence including call counts, status distribution, firstSeen/lastSeen where available, and match reason.
15. Deterministic endpoint candidates with no successful/redirect log matches are marked as "no usage observed in supplied logs", not "unused".
16. Unmatched route hints are produced only when 2xx/3xx count is at least 5.
17. Unmatched route hints are not promoted to normal endpoint candidates.
18. Static resources are not specially classified in this spec.
19. Health/metrics/operational endpoint classification is not added in this spec.
20. Raw full log files are not stored in the database.
21. Raw full log contents are not passed to the LLM.
22. Log processing warnings are recorded without failing the whole discovery run.
23. A compact structured runtime evidence summary is available to the LLM gap-fill/review stage.
24. Tests cover parsing, aggregation, matching, 404 behavior, no-usage behavior, unmatched hint threshold, and no-log behavior.

Out of scope:
- Browser log upload UI
- Artifact storage implementation from Spec 4
- Final Log Scans column display in the candidate details UI
- Runtime badges
- Tier label changes
- Confidence score changes
- Static resource classification
- Health/metrics classification
- User-agent/referrer/IP analysis
- Data movements
- Service dependency extraction
- Database query extraction
- Business logic execution extraction
- UI screen/component log enrichment
- Promoting log-only routes to normal candidates
- Raw log viewing in the UI

Implementation notes:
Inspect existing Discovery Service log enrichment code before implementing:
- discovery-service/src/routes/logEnrichment.ts
- discovery-service/src/services/logParsing/
- discovery-service/src/services/logExtractors/
- discovery-service/src/services/logEnrichmentMetadata.ts

Inspect the V3 discovery pipeline and run manager to insert the new step after deterministic pack output and before LLM gap-fill/review:
- discovery-service/src/services/discoveryV3Pipeline.ts
- discovery-service/src/services/runManager.ts
- discovery-service/src/routes/runs.ts

Inspect candidate types and candidate persistence:
- discovery-service/src/types/candidate.ts
- discovery-service/src/constants/candidateTypes.ts
- architecture-model-service discovery candidate/evidence controllers if needed

Suggested internal modules:
- accessLogParser.ts
- httpRuntimeObservation.ts
- endpointRuntimeAggregator.ts
- endpointPathNormalizer.ts
- endpointRuntimeMatcher.ts
- runtimeEvidencePersistence.ts
- runtimeEvidenceLlmContextBuilder.ts

Testing guidance:
Add tests for:
- Apache/Nginx combined log parsing
- Apache/Nginx common log parsing
- JSONL/NDJSON access log parsing
- Plaintext/framework fallback HTTP extraction
- Query string removal
- Path normalization for numeric IDs, UUIDs, and hashes
- Method/path matching to code endpoint candidates
- Placeholder-name-insensitive matching
- 404 not counting as observed usage
- 2xx/3xx counting as observed usage
- 4xx/5xx retained as error evidence for otherwise matched routes
- No-usage evidence for code endpoints with no successful/redirect hits
- Unmatched hints threshold of 5 successful/redirect hits
- Pure 404 routes ignored as unmatched hints
- Ambiguous match handling
- No uploaded logs preserving existing discovery behavior
- Log processing failure producing warning but not failing discovery run
