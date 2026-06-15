# Task Breakdown: OAS-YAML + WADL/XSD Contract Support (API Behaviour capture)

## Overview

Extend the API Behaviour capture harness's contract PARSING + acceptance to
accept, at wizard step-1, BOTH:
  - OAS in JSON **and** YAML, and
  - REST-via-WADL with its XSD grammar file(s).

The confirmed driver is the "HiFi" service (REST: WADL = the ~45 REST
endpoints; XSD = the request/response body types; calls are HTTP GET/POST +
custom headers + JSON -- NOT SOAP). REST execution is already built; this is
the PARSING + acceptance extension only. No schema / Liquibase change.

Spans `api-migration-validation-service` (Node/TS/jest), the gateway proxy, and
the frontend wizard (React/vitest). TDD; scoped tests green; `tsc` clean on
touched files.

## Task List

### Task Group 1: OAS YAML uploads (api-migration-validation-service)
**Dependencies:** None

- [x] 1.1 Export `parseSpecText(content, specLinkPath)` from
      `services/oasParser.ts` (the JSON->YAML-fallback parser already used by
      the spec-link path; previously private).
- [x] 1.2 Replace the JSON-only upload parse in `routes/captureSessionActions.ts`
      with `parseSpecText(...)` -> `parseOasFromObject(...)`, keeping a clear
      400 on genuinely-invalid JSON/YAML (`OAS_PARSE_FAILED` /
      `OAS_VALIDATION_FAILED`).

### Task Group 2: WADL + XSD -> typed REST operations (pure parsing + adapter)
**Dependencies:** Group 1 (shared route helper)

- [x] 2.1 `fast-xml-parser` (^5.8.0) present in
      `api-migration-validation-service/package.json` deps (already declared +
      installed in this repo; see report -- no `npm install` needed here).
- [x] 2.2 COPY the pure `parseWadl` + its self-contained types verbatim into
      `services/wadlParser.ts` (header attributes the canonical discovery
      source; depends only on `fast-xml-parser`; no cross-service import).
- [x] 2.3 COPY + adapt the XSD field-walk into `services/xsdSchemaModel.ts`
      (`parseWadl`'s representation typing is element-ref-level ONLY, so the
      field-walk WAS required) -> projects an XSD element into an
      `OpenAPIV3.SchemaObject` (object `properties`/`required`, arrays via
      `items`, built-ins -> JSON primitives, restriction facets ->
      `enum`/`pattern`/bounds).
- [x] 2.4 Adapter `wadlToInventory(result, xsdSources): ParsedOasInventory`
      mapping each `WadlOperation` -> `ParsedOasOperation` (method lowercased,
      path, operationId = methodId else synthesised, summary/description from
      doc, request/response schema = XSD-derived JSON Schema, minimal
      synthesised `oasOperation` embedding the schemas, title/version from the
      WADL interface metadata).

### Task Group 3: Acceptance wiring + guards (route, upload + spec-link)
**Dependencies:** Groups 1-2

- [x] 3.1 `services/contractFormatDetector.ts`: classify an uploaded/fetched
      file (`oas` | `wadl` | `xsd` | `wsdl` | `unknown`) by extension then
      content sniff; `classifyUploadedFiles` identifies the contract + its XSD
      grammar siblings among a multi-file upload.
- [x] 3.2 Multi-file upload: `multer().array('file')` (cap raised 1 -> 12);
      route helper `parseUploadedContract` dispatches on the detected format.
- [x] 3.3 WSDL/SOAP guard: clear 400 ONLY for a true SOAP/WSDL definition
      (`SOAP_NOT_SUPPORTED`). Lone-`.xsd` (no WADL) -> friendly 400
      (`XSD_WITHOUT_WADL`). An `.xsd` accompanying a `.wadl` is NEVER rejected.
- [x] 3.4 WADL missing-grammars: 400 (`WADL_MISSING_GRAMMARS`) naming the exact
      XSD(s) to add when the WADL declares grammars not uploaded.
- [x] 3.5 Spec-link WADL path: an Interface `spec_link` ending `.wadl` is
      fetched from the discovery cached clone together with its sibling XSD
      grammars (relative `<grammars><include href>` resolved against the WADL's
      repo dir), parsed, and adapted; unresolved grammars surface the same
      `WADL_MISSING_GRAMMARS` 400.

### Task Group 4: Tests (TDD) -- jest
**Dependencies:** Groups 1-3

- [x] 4.1 `__tests__/parseOasUploadFormats.test.ts`: (a) YAML OAS upload ->
      operations; (b) WADL + inline XSD -> REST operations with method+path AND
      request/response schemas from the XSD; (c) WADL with unresolved grammar
      -> missing-grammars 400; (d) `.wsdl`/SOAP -> "not supported yet" 400;
      (e) lone `.xsd` -> "upload the WADL too" 400; (f)/(f2) spec-link WADL
      happy-path + missing-grammar.
- [x] 4.2 `__tests__/wadlToInventory.test.ts`: pure-adapter coverage of the XSD
      field-walk richness (nested complex types, unbounded -> array, built-ins,
      restriction facets, unresolved element ref -> null schema).

### Task Group 5: Frontend wizard (React/vitest)
**Dependencies:** Groups 1-3

- [x] 5.1 `StartCaptureSessionWizard.tsx` step-1: file input `multiple`; widen
      `accept` to `.json,.yaml,.yml,.wadl,.xsd,application/json`; relabel
      "Upload an OAS (.json/.yaml) or a WADL + its XSD grammar file(s)". The
      backend `WADL_MISSING_GRAMMARS` message (naming the XSD) surfaces via the
      existing `describeError` error banner.
- [x] 5.2 `apiBehaviourClient.parseOas` accepts `{ files: File[] }`, appending
      every part under the `file` field (OAS doc alone, OR WADL + its XSD
      grammars together).
- [x] 5.3 `StartCaptureSessionWizard.uploadFormats.test.tsx`: step-1 `accept`
      includes `.yaml/.yml/.wadl/.xsd` (and NOT `.wsdl`); input is `multiple`.

### Task Group 6: Gateway multipart proxy (gateway)
**Dependencies:** Groups 1-3

- [x] 6.1 `routes/apiMigrationValidation.ts`: `parse-oas` proxy uses
      `multer().array('file')` (cap 1 -> 12) and rebuilds the forwarded
      multipart body with EVERY uploaded part (so a WADL's XSD grammar is not
      dropped in transit).
- [x] 6.2 `__tests__/apiMigrationValidation-action-proxy.test.ts`: a WADL + XSD
      multipart parse-oas forwards both parts under the `file` field.

## Sybase sampling (confirmed -- no code change)

The scenario generator (the LLM capture loop) reads each operation's
`requestSchema` purely as an `OpenAPIV3.SchemaObject` via the
`get_oas_operation_detail` tool, and separately pulls Sybase rows via
`sample_db_values(table, column)` (schema-agnostic). `wadlToInventory` populates
`requestSchema`/`responseSchema` in EXACTLY that JSON-Schema shape (and
`persistInventory` writes them to `request_schema_json`/`response_schema_json`),
so a WADL+XSD operation gets the same realistic Sybase-sourced inputs an OAS
operation does -- with no sampler change.
