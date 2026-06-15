# Tasks: Enterprise Architecture Metamodel

## Phase 1: Multi-Repo Structural Analysis

- [ ] T1.1: Create `config/enterprise.yaml` schema — repo list, service discovery, contract paths, infra paths
- [ ] T1.2: Create `src/ast/enterprise_runner.py` — iterate repos, run ctags + tree-sitter on each, store results in unified directory
- [ ] T1.3: Implement service boundary detection — one repo = one service (default), monorepo detection via Docker/K8s/directory heuristics
- [ ] T1.4: Create `_services.txt` store file — service name, repo, framework, language, type, endpoint count
- [ ] T1.5: Create `_meta.yaml` enterprise metadata — repo count, service count, total symbols, analysis timestamp
- [ ] T1.6: Unit tests for enterprise runner with mock repos
- [ ] T1.7: Integration test — run on 3 test repos (Java/Python/JS petclinic/fastapi/express)

## Phase 2: API Surface Extraction

- [ ] T2.1: Create `src/ast/extractors/api_surface.py` with `ApiSurfaceExtractor` base class
- [ ] T2.2: Implement Spring endpoint detection — `@GetMapping`, `@PostMapping`, `@RequestMapping`, `@DeleteMapping`, `@PutMapping`, `@PatchMapping` from `_index.txt` annotations + `_calls.txt`
- [ ] T2.3: Implement FastAPI endpoint detection — `@app.get()`, `@router.post()` etc. from `_calls.txt` decorator patterns
- [ ] T2.4: Implement Express endpoint detection — `router.get()`, `app.post()`, `app.use()` from `_calls.txt`
- [ ] T2.5: Implement Go HTTP endpoint detection — `http.HandleFunc()`, `mux.Handle()`, `gin.GET()` from `_calls.txt`
- [ ] T2.6: Create `config/api_patterns.yaml` — framework-specific endpoint detection rules (extensible)
- [ ] T2.7: Create `_api_surface.txt` store file — service, method, path, handler, file, line
- [ ] T2.8: Unit tests per framework (Spring, FastAPI, Express, Go) with fixture files
- [ ] T2.9: Integration test — extract endpoints from Spring Petclinic, verify against known routes

## Phase 3: Cross-Service Dependency Detection

- [ ] T3.1: Create `src/ast/extractors/service_dependencies.py`
- [ ] T3.2: Implement HTTP client call detection — `RestTemplate`, `WebClient`, `HttpClient`, `requests.get`, `fetch`, `axios` from `_calls.txt`
- [ ] T3.3: Implement URL-to-service resolution — match target URLs against known service base URLs from config
- [ ] T3.4: Implement Feign/Retrofit client detection — interface annotations → target service mapping
- [ ] T3.5: Implement shared client library detection — import of `@company/user-api-client` → dependency on user-api
- [ ] T3.6: Confidence scoring for dependency edges (direct URL match = 0.95, pattern match = 0.7, heuristic = 0.5)
- [ ] T3.7: Create `_dependencies.txt` store file — source_service, target_service, method, path, evidence, confidence
- [ ] T3.8: Unit tests with mock call graphs containing cross-service calls
- [ ] T3.9: Integration test — detect dependencies across 2+ test repos

## Phase 4: Contract Parsing

- [ ] T4.1: Create `src/ast/extractors/contract_parser.py` with `ContractParser` base class
- [ ] T4.2: Implement OpenAPI/Swagger parser — extract paths, methods, request/response schemas from YAML/JSON
- [ ] T4.3: Implement Protobuf parser — extract service definitions, RPC methods, message types from `.proto` files
- [ ] T4.4: Implement GraphQL schema parser — extract types, queries, mutations, subscriptions
- [ ] T4.5: Implement AsyncAPI parser — extract channels, messages, servers for event-driven APIs
- [ ] T4.6: Implement producer-consumer linking — match contract endpoints to API surface + dependency graph
- [ ] T4.7: Create `_contracts.txt` store file — contract_type, path, producer_service, consumer_services, schema_ref
- [ ] T4.8: Unit tests per contract type with fixture specs
- [ ] T4.9: Integration test — parse real OpenAPI spec, link to service

## Phase 5: Infrastructure Topology

- [ ] T5.1: Create `src/ast/extractors/infra_parser.py` with `InfraParser` base class
- [ ] T5.2: Implement Docker Compose parser — services, networks, volumes, depends_on, environment variables
- [ ] T5.3: Implement Kubernetes manifest parser — Deployment, Service, Ingress, ConfigMap, Secret references
- [ ] T5.4: Implement Terraform HCL parser (basic) — resource types, networking, IAM references
- [ ] T5.5: Implement CI/CD config parser — GitHub Actions, GitLab CI, Jenkinsfile → build/deploy dependencies
- [ ] T5.6: Create `_infra.txt` store file — service, infra_type, resource, config_source, network
- [ ] T5.7: Unit tests per infrastructure type with fixture configs
- [ ] T5.8: Integration test — parse Docker Compose from Spring Petclinic

## Phase 6: Data Flow Tracing

- [ ] T6.1: Create `src/ast/extractors/data_flow_tracer.py`
- [ ] T6.2: Implement DB access pattern detection — JPA repositories, SQLAlchemy sessions, Prisma client calls from `_calls.txt`
- [ ] T6.3: Implement message queue pattern detection — KafkaTemplate, RabbitTemplate, SQS SDK calls from `_calls.txt`
- [ ] T6.4: Implement cache access pattern detection — Redis, Memcached calls from `_calls.txt`
- [ ] T6.5: Implement external API call detection — HTTP client calls to non-internal URLs
- [ ] T6.6: Implement end-to-end flow assembly — chain source → process → target across services using dependency graph + event graph
- [ ] T6.7: Create `_data_flows.txt` store file — flow_id, source, source_type, target, target_type, data, mechanism, direction
- [ ] T6.8: Unit tests with mock structural data containing DB/queue/cache patterns
- [ ] T6.9: Integration test — trace data flow through 2+ services

## Phase 7: Event/Queue Detection

- [ ] T7.1: Create `src/ast/extractors/event_detector.py`
- [ ] T7.2: Implement Kafka producer/consumer detection — `KafkaTemplate.send()`, `@KafkaListener` from `_calls.txt` + annotations
- [ ] T7.3: Implement RabbitMQ publisher/listener detection — `RabbitTemplate`, `@RabbitListener`
- [ ] T7.4: Implement Spring domain event detection — `ApplicationEventPublisher`, `@EventListener`
- [ ] T7.5: Implement topic-to-service mapping — link topics to producer/consumer services
- [ ] T7.6: Create `_events.txt` store file — topic, producer_service, consumer_services, event_type, schema
- [ ] T7.7: Unit tests per message broker type
- [ ] T7.8: Integration test — detect Kafka patterns from Spring Petclinic (if present) or fixture repo

## Phase 8: Enterprise Metamodel Assembly

- [ ] T8.1: Create `src/ast/enterprise_metamodel.py` — assemble all per-repo stores + cross-repo extractors
- [ ] T8.2: Implement cross-repo reference stitching — match imports of shared libraries to service dependencies
- [ ] T8.3: Implement incremental update — re-analyse single repo, update enterprise store without full rebuild
- [ ] T8.4: Generate enterprise `_meta.yaml` — total services, dependencies, data flows, events, contracts
- [ ] T8.5: Unit tests for metamodel assembly with mock per-repo stores
- [ ] T8.6: Integration test — assemble metamodel from 3 test repos, verify service count, dependency edges

## Phase 9: Enterprise Diagram Generation

- [ ] T9.1: Create `src/ast/enterprise_diagram_builders.py` — SystemContextBuilder, ContainerBuilder, DataFlowBuilder (enterprise), DependencyGraphBuilder, EventFlowBuilder, BlastRadiusBuilder
- [ ] T9.2: Implement SystemContextBuilder (C4 Level 1) — services as boxes, dependencies as arrows, external systems
- [ ] T9.3: Implement ContainerBuilder (C4 Level 2) — services + databases + queues + caches with connections
- [ ] T9.4: Implement enterprise DataFlowBuilder — end-to-end data paths across services with source/sink/process nodes
- [ ] T9.5: Implement DependencyGraphBuilder — service dependency matrix with weight/criticality
- [ ] T9.6: Implement EventFlowBuilder — event bus topology with producer → topic → consumer edges
- [ ] T9.7: Implement BlastRadiusBuilder — given a service/DB failure, highlight affected services (BFS/DFS on dependency graph)
- [ ] T9.8: Wire all builders to Mermaid, PlantUML, Graphviz, metamodel JSON serialisers
- [ ] T9.9: Unit tests per diagram builder
- [ ] T9.10: Integration test — generate all 6 diagram types from assembled metamodel

## Phase 10: API Endpoints

- [ ] T10.1: `POST /api/v1/enterprise/analyze` — accept repo list, run multi-repo analysis, return job ID
- [ ] T10.2: `GET /api/v1/enterprise/{name}/services` — return service registry
- [ ] T10.3: `GET /api/v1/enterprise/{name}/dependencies` — return dependency graph
- [ ] T10.4: `GET /api/v1/enterprise/{name}/data-flows` — return data flow traces
- [ ] T10.5: `GET /api/v1/enterprise/{name}/events` — return event/queue topology
- [ ] T10.6: `GET /api/v1/enterprise/{name}/diagrams/{type}` — return generated diagram (format param: mermaid/plantuml/graphviz/json)
- [ ] T10.7: `POST /api/v1/enterprise/{name}/impact` — blast radius analysis for given service
- [ ] T10.8: Integration tests for all API endpoints

## Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| 1 | 7 | Multi-repo structural analysis |
| 2 | 9 | API surface extraction |
| 3 | 9 | Cross-service dependencies |
| 4 | 9 | Contract parsing |
| 5 | 8 | Infrastructure topology |
| 6 | 9 | Data flow tracing |
| 7 | 8 | Event/queue detection |
| 8 | 6 | Enterprise metamodel assembly |
| 9 | 10 | Enterprise diagram generation |
| 10 | 8 | API endpoints |
| **Total** | **83** | |
