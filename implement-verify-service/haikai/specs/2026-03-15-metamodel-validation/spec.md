# Specification: Metamodel Validation Skill

## Summary

Add comprehensive validation to the metamodel generation pipeline. After the LLM generates architectural metamodels from codebase analysis, validate the output against JSON Schema contracts, check structural consistency (referential integrity, uniqueness, layer rules), detect hallucinated entities by cross-referencing against the actual codebase, and verify conformance to known architectural patterns. This catches errors before metamodels are consumed by downstream tools or presented to users.

---

## Current Flow

```
1. metamodel_parser.py → parses codebase structure
2. metamodel_llm_analyzer.py → LLM generates metamodel entities and relationships
3. metamodel_integration.py → assembles final metamodel
4. metamodel_gateway.py → serves metamodel via API
5. NO VALIDATION — output consumed as-is
```

### Current flow issues

- LLM can hallucinate components that don't exist in the codebase
- No schema enforcement — missing fields, wrong types silently accepted
- Connections can reference non-existent component IDs
- No check for architectural pattern consistency
- Duplicate IDs or orphaned components go undetected
- Consumers of the metamodel have no confidence signal

---

## Proposed Flow

```
1. metamodel_parser.py → parses codebase structure
2. metamodel_llm_analyzer.py → LLM generates metamodel
3. metamodel_integration.py → assembles metamodel
4. metamodel_validator.py → validates assembled metamodel
   ├─ Schema validation (required fields, types, enums)
   ├─ Structural consistency (refs, uniqueness, cycles)
   ├─ Hallucination detection (cross-ref against codebase)
   ├─ Pattern conformance (architectural rules)
   └─ Produces ValidationReport with errors/warnings/info
5. metamodel_gateway.py → serves metamodel + validation report
6. If errors > threshold → flag metamodel as "unvalidated"
```

---

## Code Changes

### 1. New: `src/metamodel_validator.py`

Core validation orchestrator.

- `MetamodelValidator` class coordinating all validation checks
- `validate(metamodel: Metamodel, codebase_context: CodebaseContext) -> ValidationReport`
- Runs all validators in sequence, aggregates results
- Configurable: which validators to run (schema always, others optional)
- Returns `ValidationReport` with severity-tagged findings

### 2. New: `src/metamodel_schema.py`

JSON Schema definitions and schema validation.

- Schema definitions for each metamodel entity type:
  - `ComponentSchema`: name (required), type (enum), layer (enum), description (required), file_paths (list), technologies (list)
  - `ConnectionSchema`: id (required), source_id (required), target_id (required), type (enum: depends_on, calls, extends, implements, uses), description
  - `LayerSchema`: name (required), components (list of IDs), description
  - `InterfaceSchema`: name, type (REST, gRPC, message_queue, etc.), endpoints
- `SchemaValidator` class:
  - `validate_component(component) -> list[ValidationFinding]`
  - `validate_connection(connection) -> list[ValidationFinding]`
  - `validate_metamodel(metamodel) -> list[ValidationFinding]`
- Uses `jsonschema` for validation, Pydantic for model enforcement

### 3. New: `src/metamodel_consistency_checker.py`

Structural consistency validation.

- `ConsistencyChecker` class with methods:
  - `check_referential_integrity(metamodel)` — all connection source/target IDs exist
  - `check_uniqueness(metamodel)` — no duplicate component/connection IDs
  - `check_orphans(metamodel)` — components with zero connections (warning)
  - `check_layer_rules(metamodel, rules)` — configurable layer dependency rules
  - `check_circular_dependencies(metamodel)` — detect and report cycles
  - `check_bidirectional_coherence(metamodel)` — symmetric relationship consistency
- Circular dependency detection via DFS with cycle path reporting
- Layer rules configurable per project (default: standard layered architecture)

### 4. New: `src/metamodel_hallucination_detector.py`

Cross-reference metamodel against codebase.

- `HallucinationDetector` class initialized with codebase file list and dependency manifest
- `detect(metamodel) -> list[ValidationFinding]`
- Checks:
  - **File existence**: component's `file_paths` must exist in the codebase
  - **Technology verification**: technologies listed must appear in dependency files (package.json, requirements.txt, pom.xml, etc.)
  - **Endpoint verification**: API endpoints must match route definitions in source code
  - **Module existence**: referenced modules/packages must exist as directories or files
- Confidence scoring per entity:
  - All references verified → high confidence (1.0)
  - Partial references verified → medium confidence (0.5-0.9)
  - No references verified → low confidence (<0.5) → hallucination warning
- Uses existing `file_scanner` output for codebase context

### 5. New: `src/metamodel_pattern_checker.py`

Architectural pattern conformance.

- `PatternChecker` class with configurable pattern rules
- Built-in patterns:
  - **Layered**: dependencies flow downward only (presentation → business → data)
  - **MVC/MVVM**: views don't access data layer, controllers don't contain business logic markers
  - **Microservices**: inter-service communication via defined interfaces only
  - **Repository**: data access behind abstraction layer
- `check_conformance(metamodel, expected_pattern) -> list[ValidationFinding]`
- Pattern auto-detection: if no pattern specified, suggest most likely pattern based on structure
- All findings are severity=warning (advisory, not blocking)

### 6. New: `src/metamodel_validation_models.py`

Pydantic models for validation output.

- `ValidationFinding`: severity (error/warning/info), category (schema/consistency/hallucination/pattern), message, entity_id, entity_type, details
- `ValidationReport`: findings (list), summary (ValidationSummary), confidence_score (0-1), is_valid (bool — no errors)
- `ValidationSummary`: total_entities, validated_count, error_count, warning_count, info_count, hallucination_count, confidence_score
- `ConfidenceScore`: entity_id, score (0-1), evidence (list of verified references)

### 7. Modified: `src/metamodel_integration.py`

- After metamodel assembly, call `MetamodelValidator.validate()`
- Attach `ValidationReport` to metamodel output
- If `METAMODEL_VALIDATION_STRICT` is true and errors > 0, mark metamodel as invalid
- Log validation summary at INFO level

### 8. Modified: `src/metamodel_gateway.py`

- Include `validation_report` in metamodel API response
- Add `?include_validation=true` query param (default: true)
- Add confidence score to metamodel metadata

### 9. Modified: `src/api.py`

- `POST /api/v1/projects/{company}/{project}/metamodel/validate`
  - Trigger validation on existing metamodel (re-validate without regenerating)
  - Returns full `ValidationReport`
- `GET /api/v1/projects/{company}/{project}/metamodel/schema`
  - Returns JSON Schema definitions for metamodel entity types
  - Useful for external tools consuming the metamodel

### 10. Config

- `METAMODEL_VALIDATION_ENABLED` (default: true)
- `METAMODEL_VALIDATION_STRICT` (default: false — warnings allowed, errors flagged)
- `METAMODEL_HALLUCINATION_CHECK` (default: true)
- `METAMODEL_PATTERN_CHECK` (default: true)
- `METAMODEL_EXPECTED_PATTERN` (default: auto-detect)
- `METAMODEL_CONFIDENCE_THRESHOLD` (default: 0.5 — below this = hallucination warning)

---

## Validation Flow Diagram

```
Metamodel Input
    │
    ├─► Schema Validator ──────► required fields, types, enums
    │
    ├─► Consistency Checker ───► refs, uniqueness, cycles, layers
    │
    ├─► Hallucination Detector ► cross-ref files, deps, endpoints
    │
    ├─► Pattern Checker ───────► architectural conformance
    │
    └─► Aggregate ─────────────► ValidationReport
         ├─ findings[]
         ├─ summary stats
         ├─ confidence_score
         └─ is_valid (no errors)
```

---

## Error Handling

- Metamodel not yet generated → 404 with message "generate metamodel first"
- Codebase not accessible (for hallucination check) → skip hallucination detection, note in report
- Schema definition mismatch (metamodel format changed) → validation error with details, suggest schema update
- Pattern rules contradiction → report all applicable violations, don't short-circuit
- Validation timeout (>30s for very large metamodels) → return partial report with timeout warning
