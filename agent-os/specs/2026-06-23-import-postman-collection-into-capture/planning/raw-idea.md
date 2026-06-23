Feature: Import a Postman Collection into the API Behaviour Baseline capture flow — the inverse of the existing baseline→Postman EXPORT (frontend/src/utils/postmanExport.ts).

Two modes:
- Mode 1 (pre-capture seed): supply a Postman collection before starting a capture run. A 3-way RUN MODE selector:
  (a) LLM only (today's behaviour, no Postman);
  (b) Postman + LLM delta — Postman items executed as concrete captures (the deterministic "given"), then the LLM tops up ONLY the scenarios not already covered. Delta = the code planner's candidate scenarios (defaultScenarioSet) MINUS the Postman-covered ones. Dedup = LLM-judged WITH a code pre-filter (heuristic removes obvious matches by archetype/method/path/param/expected-status; LLM then judges remaining candidates redundant-or-not against the captured Postman requests; bounded subtraction). Respects MAX_SCENARIOS_PER_OP cap.
  (c) Postman only — fire the Postman requests, record responses, NO LLM.
- Mode 2 (post-hoc append): append a Postman collection to an EXISTING capture run by looping its items through the existing manual-capture execute→persist primitive (lands `manual` scenarios + un-reviewed captures into the normal review/baseline flow).

Architecture-match handling: per imported item, if the endpoint doesn't match a committed architecture endpoint, warn the user and offer (1) Add to architecture or (2) Delete the item. Reuse the existing operations_without_model_endpoint coverage signal.

Existing seams to reuse: parse-oas inventory ingestion + oasInventoryStore, defaultScenarioSet planner + execute_http_request, the manual-capture concrete-request→capture primitive, AMS reconcile-inventory coverage, and the Postman v2.1 type surface from postmanExport.ts (a new IMPORT parser is needed).
