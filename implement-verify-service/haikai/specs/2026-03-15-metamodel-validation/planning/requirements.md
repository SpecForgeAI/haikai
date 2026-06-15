# Requirements: Metamodel Validation Skill

## Feature Description

Validate generated metamodels against schema contracts and known architectural patterns. The existing metamodel pipeline (`metamodel_parser`, `metamodel_gateway`, `metamodel_llm_analyzer`) generates architectural metamodels from codebases, but lacks validation of the output. This skill adds structural validation, consistency checking, and pattern conformance to catch LLM hallucinations, missing relationships, and schema violations before metamodels are consumed downstream.

## Technology Stack

- Python 3.11+ (FastAPI backend)
- `jsonschema` for JSON Schema validation
- `pydantic` for model-level validation (already a dependency)
- Existing `src/metamodel_parser.py` as input source
- Existing `src/metamodel_llm_analyzer.py` as validation target
- Existing `src/metamodel_integration.py` for pipeline integration

## Requirements

### Schema Validation
- New module at `src/metamodel_validator.py`
- Define JSON Schema contracts for each metamodel entity type (components, connections, layers, interfaces)
- Validate every generated metamodel entity against its schema
- Required fields enforcement: every component must have name, type, layer, description
- Type enumeration: component types must come from a defined vocabulary
- Relationship validation: connections must reference valid component IDs

### Structural Consistency Checks
- **Referential integrity**: all connection source/target IDs must exist in component list
- **No orphan components**: every component should have at least one connection (warning, not error)
- **No duplicate IDs**: component and connection IDs must be unique
- **Layer consistency**: components marked as "presentation" shouldn't directly connect to "data" layer (configurable rules)
- **Bidirectional coherence**: if A depends on B, B's dependents list should include A
- **Circular dependency detection**: identify and flag circular dependency chains

### Pattern Conformance
- Validate against known architectural patterns:
  - **MVC/MVVM**: presentation layer doesn't access data layer directly
  - **Microservices**: services communicate through defined interfaces, not direct calls
  - **Layered architecture**: dependencies flow downward only
  - **Repository pattern**: data access abstracted behind repository interfaces
- Pattern detection is advisory (warnings), not blocking (errors)
- Configurable: project can specify expected architecture pattern

### Hallucination Detection
- Cross-reference metamodel entities against actual codebase files
- Component references a file that doesn't exist → hallucination flag
- Technology listed in metamodel not found in dependencies → hallucination flag
- API endpoint in metamodel not matching actual routes → hallucination flag
- Confidence scoring: entities with no codebase evidence get low confidence scores

### Validation Report
- Structured validation report with severity levels: error, warning, info
- Errors: schema violations, referential integrity failures, hallucinations
- Warnings: orphan components, pattern violations, low-confidence entities
- Info: pattern conformance results, coverage statistics
- Summary: total entities, valid count, error count, warning count, confidence score

### API Surface
- `POST /api/v1/projects/{company}/{project}/metamodel/validate` — validate existing metamodel
- Response includes full validation report
- `GET /api/v1/projects/{company}/{project}/metamodel/schema` — return expected schema for metamodel entities
- Validation auto-runs after metamodel generation (configurable)

## Constraints
- Hallucination detection requires access to the analyzed codebase (not just the metamodel output)
- Pattern conformance rules are heuristic — may produce false positives
- Schema must be maintained as metamodel format evolves
- Validation adds ~2-5 seconds to metamodel generation pipeline

## Out of Scope
- Automatic metamodel repair/correction
- Visual validation (diagram rendering and visual inspection)
- Runtime architecture validation (comparing metamodel to live system)
- Machine learning-based hallucination detection
- Custom pattern definition language
- Metamodel versioning (handled by diff/delta skill if combined)
