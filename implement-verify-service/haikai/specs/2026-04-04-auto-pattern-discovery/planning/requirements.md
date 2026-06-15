# Requirements: LLM-Powered Interaction Classification

## Context

The structural analysis pipeline already extracts:
- `_calls.txt` — every call site in the repo (caller, receiver, method, file, line, confidence)
- `_imports.txt` — every import
- `framework_detector.py` — identifies 60+ frameworks from imports

We currently use YAML config files with 146 hand-authored receiver + method patterns to classify which calls are external interactions (HTTP, database, cache, MQ, etc.). This is brittle — every new framework requires manual YAML entries.

## Goal

Replace human-maintained pattern configs with LLM-powered classification. The AST finds all calls. The LLM decides which are external interactions and classifies them.

## Functional Requirements

### FR-1: Interaction Detection via LLM

**FR-1.1** Input to the LLM:
- `_calls.txt` — all call sites with receiver, method, file, line
- Framework detection results — what frameworks are in use
- Source file access — the LLM can read source files to resolve ambiguity

**FR-1.2** The LLM classifies each call as either:
- **Internal** — application logic, utility, framework plumbing (skip)
- **External interaction** — crosses a boundary (HTTP, database, MQ, cache, filesystem, gRPC, email, event bus, etc.)

**FR-1.3** For each external interaction, the LLM determines:
- **Type**: HTTP_SERVICE, DATABASE, MESSAGE_QUEUE, CACHE, FILE_SYSTEM, GRPC_SERVICE, EMAIL, EVENT_BUS, WEBSOCKET, GRAPHQL_SERVICE, ASYNC_JOB
- **Direction**: READ, WRITE, PUBLISH, SUBSCRIBE, REQUEST_RESPONSE
- **Mechanism**: the library/framework (e.g., RestTemplate, JPA, Celery, fetch)
- **Target**: what's being called (URL, table, topic, file path) — resolved from source if possible
- **Data entity**: what data is flowing (DTO, entity class, message type) — resolved from source if possible

**FR-1.4** The LLM works as an agent — it decides how many passes it needs. It may:
- Classify obvious calls in one pass (e.g., `requests.get` is clearly HTTP)
- Follow variable references to resolve targets (e.g., trace a URL from config)
- Read surrounding source code to determine direction (e.g., SELECT vs INSERT behind `session.execute`)

### FR-2: YAML as Optional Cache

**FR-2.1** The existing YAML patterns remain as an optional fast path. If a call matches a known YAML pattern, classify it without LLM cost.

**FR-2.2** Calls that don't match any YAML pattern are sent to the LLM for classification.

**FR-2.3** The LLM's classifications can be cached as new YAML entries in `auto_discovered_patterns.yaml` to avoid repeat LLM calls on subsequent runs.

**FR-2.4** Manual YAML patterns take precedence over auto-discovered ones.

### FR-3: Pipeline Integration

**FR-3.1** The LLM classification step runs after AST extraction, as stage 2 of the pipeline:
1. Extract (AST) — find all calls, endpoints → `_calls.txt`
2. Classify (LLM) — which calls are external interactions → `_interactions.txt`
3. Map (future) — populate architecture metamodel

**FR-3.2** Classification is gated — runs only when `classify_interactions: true` is set. Without it, the pipeline falls back to YAML-only detection (current behaviour).

**FR-3.3** Output is `_interactions.txt` — enriched version of the current `_endpoints.txt` + `_data_movements.txt`, with LLM-resolved targets and data entities.

### FR-4: Cost Control

**FR-4.1** Batch calls by framework — send all Kafka-related calls in one LLM request, not one per call site.

**FR-4.2** Skip calls the YAML already classifies (FR-2.1) — only send unknowns to the LLM.

**FR-4.3** Cache LLM results so repeat analysis of the same repo doesn't re-classify known interactions.

**FR-4.4** Target < $0.10 LLM cost per repo analysis for repos under 1,000 files.

## Non-Functional Requirements

### NFR-1: Accuracy
- LLM classification should match or exceed the YAML-based detection accuracy
- False positive rate < 5% (internal calls misclassified as external)

### NFR-2: Performance
- YAML fast-path classification: < 1 second
- LLM classification: async, does not block the AST pipeline
- Results available within 30 seconds for a typical repo

### NFR-3: LLM Backend
- Works with any configured LLM (Anthropic, OpenAI, Azure)
- Uses the existing LLMClient infrastructure in the standards-extractor

## Out of Scope

- Replacing the AST extraction pipeline (tree-sitter stays as the call site detector)
- Training a custom model for classification
- Real-time streaming classification during AST extraction
- Architecture metamodel mapping (stage 3 — separate spec)
