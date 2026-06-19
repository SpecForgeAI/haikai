Topic: Code-evidence request contract — mine the current-state CODE SCAN for per-endpoint request-construction facts (request date FORMATS, request CONTENT-TYPE, required HEADERS, request-field VALIDATION), store them as separate non-reviewed facts, and ENRICH the capture-time OAS so the API-behaviour capture LLM builds correct requests on the FIRST attempt — instead of reverse-engineering them at runtime.

Motivating real failures (a "HiFi" API capture run, 34% success):
1. Date-format mismatch: API uses Joda `dd-MMM-yyyy` (e.g. `17-JUN-2026`); the LLM sends ISO (`2024-01-01`) → 400 "Invalid format ... malformed". Kills all `businessDate`-parameterized endpoints. The WADL/XSD contract is MISLEADING here (types it as `xsd:date` → ISO).
2. "No capture was recorded" on ~38 later `/views/*` scenarios — NOT token expiry (confirmed: that diagnostic = ZERO persisted HTTP attempts; `endpoint_skipped` is a reused label for an errored scenario). Root cause = #1 cascading: those endpoints are `businessDate`-parameterized, so the LLM burned its per-scenario round/wall-clock budget wrestling the date format and never persisted a request. Fixing #1 fixes #2.
3. 415 Unsupported Media Type on body-less PUTs (setFavourite/unsetFavourite/revertFilterPromotionRequest): the executor's Content-Type default is gated on `body !== undefined`, so body-less PUTs get no Content-Type → Jersey 415.

Decisions ALREADY made (fixed constraints):
1. PRECEDENCE: code-evidence > WADL/XSD (or uploaded) OAS contract > runtime levers. All THREE layered; none removed. Code-evidence OVERRIDES the contract where they conflict; the contract stands where the code is silent; runtime levers (error-driven format correction + reuse of accepted param values) remain the final safety net.
2. STORAGE: separate, NON-reviewed facts — a `requestContract` JSONB on the endpoint model (mirroring the EXISTING `responseContract` on `EndpointEntity`), code-scan provenance, NO UI accept/reject lifecycle. Explicitly NOT the discovery findings table (it carries a pending_review→accepted/rejected lifecycle we do NOT want) and NOT captured-decisions (architect-authored design intent — wrong semantic).
3. APPLICATION: enrich the capture-time OAS the loop uses — param `format`/`pattern`, request content-type, required headers — so the facts reach `get_oas_operation_detail`, `defaultScenarioSet.extractOasParams`, and the executor's Content-Type default, overriding the misleading WADL/XSD/uploaded-OAS values.
4. EXECUTOR fix (fixes #3): default Content-Type for mutating methods (PUT/POST/PATCH) regardless of body, from the contract/requestContract media type (fallback application/json).

Upstream reality (from analysis):
- discovery-service ALREADY extracts request content-type (`consumes`), required headers, and request params (name/type/required/default) into the discovery CANDIDATE `data` JSONB — but they DIE there (not promoted to `EndpointEntity`, which has only `responseContract` + `protocolMetadataJson`).
- Request date-format (`@JsonFormat`/`@DateTimeFormat`) and request-field validation are NOT extracted (the serialization scanner reads only the RESPONSE DTO; `@DateTimeFormat` is unrecognized). The universal IR DOES carry every annotation — only the adapter projection is missing.

Phasing:
- Phase 1: `requestContract` storage (new JSONB column on the endpoint + changeset) + save-back of the ALREADY-extracted content-type + required headers + the capture-time OAS enrichment + the executor Content-Type default. → fixes #3 from code evidence and builds the pipeline.
- Phase 2: extend the discovery scanner to project request-side date-format (`@JsonFormat`/`@DateTimeFormat`) + request validation into `requestContract`, through the same pipeline. → fixes #1 (date format) and hence #2.

Scope: cross-service — discovery-service (scanner extension + save-back), architecture-model-service (AMS: `requestContract` column/changeset + DTO/mapper + surfacing into the capture path), api-migration-validation-service (OAS enrichment at capture + executor Content-Type default). AMS wire is snake_case. Must not regress the A/B/C/D specs or the existing capture/reconcile. The per-scenario HTTP attempt cap was already raised 3→5 to give the runtime net more room.
