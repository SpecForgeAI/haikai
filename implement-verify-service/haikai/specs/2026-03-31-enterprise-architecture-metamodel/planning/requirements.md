# Requirements: Enterprise Architecture Metamodel

## Functional Requirements

### FR-1: Multi-Repo Structural Analysis
- FR-1.1: Accept a list of repository paths or URLs as input
- FR-1.2: Run ctags + tree-sitter extraction on each repo independently
- FR-1.3: Store per-repo structural results in unified directory structure
- FR-1.4: Detect service boundaries within monorepos (Docker/K8s/directory heuristics)
- FR-1.5: Build service registry from detected services

### FR-2: API Surface Extraction
- FR-2.1: Extract HTTP endpoints from Spring annotations (`@GetMapping`, `@PostMapping`, `@RequestMapping`)
- FR-2.2: Extract HTTP endpoints from FastAPI decorators (`@app.get`, `@router.post`)
- FR-2.3: Extract HTTP endpoints from Express route registrations (`router.get`, `app.post`)
- FR-2.4: Extract HTTP endpoints from Go HTTP handlers (`http.HandleFunc`, `mux.Handle`)
- FR-2.5: Extract gRPC service definitions from `.proto` files
- FR-2.6: Extract GraphQL resolvers from schema files
- FR-2.7: Store API surface in `_api_surface.txt` with service, method, path, handler, file, line

### FR-3: Cross-Service Dependency Detection
- FR-3.1: Detect HTTP client calls (`RestTemplate`, `WebClient`, `requests`, `fetch`, `axios`) from `_calls.txt`
- FR-3.2: Resolve target URLs to known services via configuration or pattern matching
- FR-3.3: Detect Feign/Retrofit client interfaces and map to target services
- FR-3.4: Detect service discovery patterns (Eureka, Consul, K8s DNS)
- FR-3.5: Detect shared client library imports as service dependencies
- FR-3.6: Assign confidence scores to each dependency edge
- FR-3.7: Store in `_dependencies.txt`

### FR-4: Contract Parsing
- FR-4.1: Parse OpenAPI/Swagger specifications (YAML and JSON)
- FR-4.2: Parse Protobuf `.proto` files for service and message definitions
- FR-4.3: Parse GraphQL schema files for type/query/mutation definitions
- FR-4.4: Parse AsyncAPI specifications for event-driven contracts
- FR-4.5: Parse Avro/JSON Schema for event payload definitions
- FR-4.6: Link contract producers to consumers
- FR-4.7: Store in `_contracts.txt`

### FR-5: Infrastructure Topology
- FR-5.1: Parse Docker Compose files for service definitions, networks, volumes, depends_on
- FR-5.2: Parse Kubernetes manifests (Deployment, Service, Ingress, ConfigMap)
- FR-5.3: Parse Terraform `.tf` files for cloud resources and networking
- FR-5.4: Parse Helm chart values and templates
- FR-5.5: Parse CI/CD configs for build/deployment dependencies
- FR-5.6: Store in `_infra.txt`

### FR-6: Data Flow Tracing
- FR-6.1: Trace database access patterns (JPA, SQLAlchemy, Prisma) from `_calls.txt`
- FR-6.2: Trace message queue interactions (Kafka, RabbitMQ, SQS) from call patterns
- FR-6.3: Trace cache access (Redis, Memcached) from call patterns
- FR-6.4: Trace file I/O operations from call patterns
- FR-6.5: Trace external API calls (non-internal HTTP client targets)
- FR-6.6: Combine into end-to-end data flow paths across services
- FR-6.7: Store in `_data_flows.txt`

### FR-7: Event/Queue Detection
- FR-7.1: Detect Kafka producers/consumers from call patterns and annotations
- FR-7.2: Detect RabbitMQ publishers/listeners from call patterns and annotations
- FR-7.3: Detect AWS SQS/SNS usage from SDK calls
- FR-7.4: Detect domain event patterns (Spring `ApplicationEventPublisher`, custom event buses)
- FR-7.5: Map topics to producer/consumer services
- FR-7.6: Store in `_events.txt`

### FR-8: Enterprise Metamodel Assembly
- FR-8.1: Merge per-repo structural stores into enterprise metamodel
- FR-8.2: Stitch cross-repo references (import of shared library → service dependency)
- FR-8.3: Generate enterprise-level `_meta.yaml` with stats and metadata
- FR-8.4: Support incremental updates (re-analyse changed repos without full rebuild)

### FR-9: Enterprise Diagram Generation
- FR-9.1: System context diagram (C4 Level 1) — services as boxes, dependencies as arrows
- FR-9.2: Container diagram (C4 Level 2) — services + databases + queues + caches
- FR-9.3: Data flow diagram — end-to-end data movement across services
- FR-9.4: Dependency graph — service dependency matrix
- FR-9.5: Event flow diagram — event bus topology
- FR-9.6: Blast radius diagram — impact analysis for service/DB failures
- FR-9.7: Support Mermaid, PlantUML, Graphviz, and metamodel JSON output formats

### FR-10: API Endpoints
- FR-10.1: `POST /api/v1/enterprise/analyze` — run multi-repo analysis
- FR-10.2: `GET /api/v1/enterprise/{name}/services` — service registry
- FR-10.3: `GET /api/v1/enterprise/{name}/dependencies` — dependency graph
- FR-10.4: `GET /api/v1/enterprise/{name}/data-flows` — data flow traces
- FR-10.5: `GET /api/v1/enterprise/{name}/diagrams/{type}` — generated diagrams
- FR-10.6: `POST /api/v1/enterprise/{name}/impact` — blast radius analysis

## Non-Functional Requirements

### NFR-1: Performance
- NFR-1.1: Structural analysis of 10 repos completes in <60 seconds
- NFR-1.2: Enterprise metamodel assembly completes in <10 seconds
- NFR-1.3: Diagram generation completes in <5 seconds
- NFR-1.4: Incremental re-analysis of 1 changed repo completes in <15 seconds

### NFR-2: Accuracy
- NFR-2.1: ≥80% of HTTP API endpoints detected across supported frameworks
- NFR-2.2: ≥70% of cross-service dependencies resolved from source code
- NFR-2.3: ≥90% of contract files (OpenAPI/Proto) correctly parsed
- NFR-2.4: All confidence scores calibrated (high confidence = high precision)

### NFR-3: Compatibility
- NFR-3.1: All store files follow existing TSV + comment header format
- NFR-3.2: Enterprise diagrams use existing serialiser infrastructure
- NFR-3.3: Configuration driven via YAML (no code changes for new repos)
- NFR-3.4: Works with existing ctags + tree-sitter providers without modification

### NFR-4: Extensibility
- NFR-4.1: New framework detectors addable via config (api_patterns.yaml)
- NFR-4.2: New contract parsers pluggable via extractor base class
- NFR-4.3: New infrastructure parsers pluggable via extractor base class
- NFR-4.4: Custom service discovery methods configurable
