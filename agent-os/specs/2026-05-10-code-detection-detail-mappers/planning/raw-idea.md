Code Detection Detail Mappers

We need to implement Spec 2 of a 7-spec roadmap for discovery candidate evidence explainability.

Context:
Spec 1 added a foundational expandable details UI to the Discovery Candidate Review table. Eligible rows can be expanded with:
- Code Detection
- Log Scans
- LLM Review

Spec 1 used a basic generic Code Detection display derived from existing candidate data.

This spec should improve the Code Detection column by adding curated, candidate-type-specific mappers for the four supported candidate types.

Roadmap context:
1. Candidate Details Expansion UI — already shaped
2. Code Detection Detail Mappers — this spec
3. Candidate Evidence Data Contract
4. Runtime Log Input at Discovery Run Start
5. Web Access Log Runtime Endpoint Evidence
6. Log Evidence in Candidate Details UI
7. Confidence, Tier, and Runtime Badges

Goal:
Replace the generic Code Detection display with readable, curated Code Detection details for these four candidate types:
- endpoints
- interfaces
- logical_data_entities
- interface_logical_entities

This spec is frontend-only. Do not change backend APIs or persistence. Use only fields already available in the existing candidate payload.

Important product decision:
Do not display all raw candidate.data fields. Use a curated set of fields per candidate type. The UI should be readable and explain why the candidate was detected from code.

General Code Detection structure:
For all four supported candidate types, the Code Detection panel should try to show:

- Detected by
  Source adapter or detection source, usually from candidate.data._addedBy or equivalent.

- Detection reason
  A short human-readable explanation based on candidate type and available metadata.

- Source file(s)
  Source paths from source_cluster_ids or any existing source/path fields.

- Type-specific details
  A curated list of fields relevant to the candidate type.

- Missing data handling
  If a field is not present, omit it or show a graceful fallback. Do not render empty labels or raw undefined/null values.

Candidate type: endpoints

Purpose:
Explain how an endpoint candidate was detected from code.

Curated fields to show when available:
- HTTP method
- Full path / route path
- Controller / interface class
- Handler method name
- Request body type
- Response type / return type
- Path variables
- Request parameters
- Security/auth metadata, if already present
- Transactional metadata, if already present
- OpenAPI operation id or summary, if already present
- Source file(s)

Suggested detection reason:
"Detected as an HTTP endpoint from framework route metadata in code."

For Spring examples, this should read naturally as:
"Detected as a controller method exposed through framework route annotations."

Example Code Detection output:
Detected by: Spring Boot Adapter
Reason: Detected as a controller method exposed through framework route annotations.
HTTP method: GET
Path: /owners/{ownerId}/pets/{petId}/edit
Controller: PetController
Handler method: editPet
Response type: PetDto
Request body type: none
Source file: src/main/java/.../PetController.java

Candidate type: interfaces

Purpose:
Explain how an interface/API surface candidate was detected from code.

Curated fields to show when available:
- Interface/controller class name
- Interface type/subtype
- Base path
- Package/module
- Security/auth metadata, if already present
- OpenAPI tag, if already present
- Source file(s)

Suggested detection reason:
"Detected as an interface/API surface from framework controller or interface metadata."

For non-controller interfaces, adapt wording where possible:
"Detected as an interface surface from framework or adapter metadata."

Example Code Detection output:
Detected by: Spring Boot Adapter
Reason: Detected as an interface/API surface from framework controller metadata.
Class: OwnerController
Interface type: RestController
Base path: /owners
Package: org.springframework.samples.petclinic.owner
Source file: src/main/java/.../OwnerController.java

Candidate type: logical_data_entities

Purpose:
Explain how a logical data entity candidate was detected from code.

Curated fields to show when available:
- Class/interface/type name
- Package/module
- Entity shape/type, if available
- Whether it is an interface/type/class, if available
- Extends/inherits, if available
- Implemented interfaces, if available
- Related endpoint/interface reference, if already present
- Source file(s)

Suggested detection reason:
"Detected as a logical data shape used by the application or interface layer."

For DTO/request/response model patterns:
"Detected as a logical data shape referenced by interface or endpoint code."

For TypeScript/frontend patterns:
"Detected as a logical data shape from TypeScript or JavaScript model/type metadata."

Example Code Detection output:
Detected by: Spring Boot Adapter
Reason: Detected as a logical data shape referenced by interface or endpoint code.
Type: OwnerDto
Package: org.springframework.samples.petclinic.owner
Kind: class
Source file: src/main/java/.../OwnerDto.java

Candidate type: interface_logical_entities

Purpose:
Explain how a relationship between an interface and a logical data entity was detected from code.

Curated fields to show when available:
- Interface/controller name
- Logical data entity name
- Relationship role, if available
  For example request, response, request/response, referenced, unknown.
- Supporting endpoint or method, if already present
- Request body type, if already present
- Response type, if already present
- Source file(s)

Suggested detection reason:
"Detected because interface code references this logical data entity through request or response types."

If the exact request/response role is not available:
"Detected because interface code references this logical data entity."

Example Code Detection output:
Detected by: Spring Boot Adapter
Reason: Detected because interface code references this logical data entity through request or response types.
Interface: OwnerController
Logical data entity: OwnerDto
Relationship role: response
Supporting method: getOwner
Source file: src/main/java/.../OwnerController.java

Display rules:
- Use concise field labels.
- Do not display raw JSON.
- Do not display uncurated candidate.data dumps.
- Do not repeat row-level summary fields such as candidate name, type, tier, confidence, review status, or synthesized timestamp.
- Avoid empty fields.
- Prefer "Not available" only for whole sections where no useful data exists.
- Use readable formatting for arrays such as path variables, request params, and source files.
- If there are many source files, show a concise list and avoid overwhelming the panel.

Adapter/source label formatting:
If candidate.data._addedBy contains internal values like:
- spring-boot-adapter
- spring-classic-adapter
- angular-adapter
- angular-js-classic-adapter
- react-typescript-adapter
- react-javascript-adapter

Display them as readable labels, for example:
- Spring Boot Adapter
- Spring Classic Adapter
- Angular Adapter
- AngularJS Classic Adapter
- React TypeScript Adapter
- React JavaScript Adapter

If the adapter is unknown, display the raw value in a safe readable form.

Acceptance criteria:
- The Code Detection column uses candidate-type-specific mappers for:
  - endpoints
  - interfaces
  - logical_data_entities
  - interface_logical_entities
- The mapper output is curated, readable, and does not dump raw candidate.data.
- Endpoint candidates show endpoint-specific details when present, including method/path/controller/handler/request/response/source.
- Interface candidates show interface-specific details when present, including class/type/base path/package/source.
- Logical data entity candidates show data-shape-specific details when present, including type/class/package/kind/source.
- Interface-logical-entity candidates show relationship-specific details when present, including interface/logical entity/role/supporting method/source.
- Missing fields do not produce broken, empty, undefined, or null UI.
- Unsupported candidate types remain non-expandable as established in Spec 1.
- Log Scans column remains unchanged and still shows:
  "Log scan evidence is not available for this run."
- LLM Review column remains unchanged and still shows:
  "No candidate-specific LLM review details are available yet."
- Existing Approve, Reject, and Defer behavior remains unchanged.
- Existing table filtering, sorting, paging, and review status behavior remains unchanged.
- No backend API changes are introduced in this spec.
- No log processing behavior is introduced in this spec.
- No confidence or tier calculations are changed in this spec.

Out of scope:
- Backend evidence/explainability contract
- Log upload or log parsing
- Runtime evidence display
- Confidence changes
- Tier label changes
- Runtime badges
- LLM-generated reasoning
- Displaying raw source code snippets
- Displaying exact line numbers unless already present and easy to render
- Adding support for candidate types outside:
  - endpoints
  - interfaces
  - logical_data_entities
  - interface_logical_entities

Implementation notes:
Inspect the existing frontend Discovery Candidate Review components added or modified by Spec 1.

Suggested implementation shape:
- Add a small mapper layer, for example:
  - buildCodeDetectionDetails(candidate)
  - buildEndpointCodeDetails(candidate)
  - buildInterfaceCodeDetails(candidate)
  - buildLogicalDataEntityCodeDetails(candidate)
  - buildInterfaceLogicalEntityCodeDetails(candidate)
- Have each mapper return a simple display model, such as:
  - title
  - status
  - reason
  - fields: Array<{ label: string, value: string | string[] }>
- Keep rendering separate from mapping logic.
- Add adapter display-name helper for candidate.data._addedBy.
- Add safe formatting helpers for arrays, objects, booleans, and missing values.
- Follow existing TypeScript types and frontend style conventions.
