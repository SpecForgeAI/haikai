# Specification: Enterprise Architecture Metamodel

## Summary

Extend the structural analysis pipeline from single-repo to multi-repo enterprise architecture. Stitch per-repo structural stores (`_calls.txt`, `_imports.txt`, `_inheritance.txt`) into a unified metamodel that maps inter-application data flows, service dependencies, API contracts, and system interactions across an entire organisation's codebase.

---

## Problem

Today the standards-extractor analyses repositories in isolation. Each repo gets its own structural store:

```
.specforge/structural/repo-a/nocommi/
  _index.txt      # symbols
  _calls.txt      # call graph
  _imports.txt    # dependencies
  _inheritance.txt # type hierarchies
```

But enterprise architecture questions span repos:

- "How does data flow from the order service to the billing system?"
- "Which services depend on the user-auth API?"
- "What happens if we change the payment gateway contract?"
- "Show me all consumers of the Kafka `order.created` topic"
- "What is the blast radius if the pricing database goes down?"

These require stitching structural data across repository boundaries — something no single-repo analysis can answer.

---

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│                    Enterprise Metamodel                      │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │  Repo A   │  │  Repo B   │  │  Repo C   │  │  Repo D   │  │
│  │ (Spring)  │  │ (FastAPI) │  │ (Express) │  │ (Go)      │  │
│  └─────┬────┘  └─────┬────┘  └─────┬────┘  └─────┬────┘   │
│        │              │              │              │         │
│  ┌─────▼──────────────▼──────────────▼──────────────▼────┐   │
│  │              Structural Store (per repo)                │   │
│  │  _index.txt  _calls.txt  _imports.txt  _inheritance.txt │   │
│  └─────────────────────┬──────────────────────────────────┘   │
│                        │                                       │
│  ┌─────────────────────▼──────────────────────────────────┐   │
│  │              Cross-Repo Extractors                       │   │
│  │                                                          │   │
│  │  ┌─────────────┐  ┌───────────┐  ┌──────────────────┐  │   │
│  │  │ API Surface  │  │ Data Flow │  │ Contract Matcher  │  │   │
│  │  │ Extractor    │  │ Tracer    │  │ (OpenAPI/Proto)   │  │   │
│  │  └─────────────┘  └───────────┘  └──────────────────┘  │   │
│  │  ┌─────────────┐  ┌───────────┐  ┌──────────────────┐  │   │
│  │  │ Infra Parser │  │ Schema    │  │ Event/Queue      │  │   │
│  │  │ (Docker/K8s) │  │ Analyzer  │  │ Detector         │  │   │
│  │  └─────────────┘  └───────────┘  └──────────────────┘  │   │
│  └─────────────────────┬──────────────────────────────────┘   │
│                        │                                       │
│  ┌─────────────────────▼──────────────────────────────────┐   │
│  │              Enterprise Metamodel Store                   │   │
│  │                                                          │   │
│  │  _services.txt      # service registry                   │   │
│  │  _api_surface.txt   # endpoints per service              │   │
│  │  _data_flows.txt    # cross-service data movement        │   │
│  │  _dependencies.txt  # service → service edges            │   │
│  │  _contracts.txt     # API contracts (OpenAPI/Proto refs) │   │
│  │  _events.txt        # event bus topics/queues            │   │
│  │  _infra.txt         # infrastructure topology            │   │
│  │  _meta.yaml         # enterprise-level metadata          │   │
│  └────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────┘
```

---

## Core Concepts

### 1. Service Registry (`_services.txt`)

Each repository maps to one or more **services**. A service is an independently deployable unit.

```
# service	repo	framework	language	type	endpoints
order-service	repo-a	Spring	Java	backend	14
user-api	repo-b	FastAPI	Python	backend	8
web-frontend	repo-c	Express	JavaScript	bff	22
pricing-engine	repo-d	Go	Go	backend	5
```

Detection heuristics:
- One repo = one service (default)
- Monorepo: detect by `docker-compose.yml` service definitions, K8s deployment manifests, or directory structure (`apps/`, `services/`, `packages/`)
- Framework entry points: `@SpringBootApplication`, `FastAPI()`, `express()`, `func main()`

### 2. API Surface Extraction (`_api_surface.txt`)

Extract HTTP endpoints, gRPC services, GraphQL resolvers from structural data.

```
# service	method	path	handler	file	line
order-service	GET	/orders/{id}	OrderController.getOrder	OrderController.java	45
order-service	POST	/orders	OrderController.createOrder	OrderController.java	62
user-api	GET	/users/{id}	get_user	routes/users.py	15
user-api	POST	/users	create_user	routes/users.py	28
```

Detection by framework:
- **Spring**: `@GetMapping`, `@PostMapping`, `@RequestMapping` → extract from annotations in `_index.txt` + `_calls.txt`
- **FastAPI**: `@app.get()`, `@router.post()` → extract from decorator calls in `_calls.txt`
- **Express**: `router.get()`, `app.post()` → extract from call graph
- **Go (net/http)**: `http.HandleFunc()`, `mux.Handle()` → call targets
- **gRPC**: `.proto` file parsing → service + rpc definitions
- **GraphQL**: schema parsing → Query/Mutation/Subscription resolvers

### 3. Cross-Service Dependencies (`_dependencies.txt`)

Link services when one calls another's API.

```
# source_service	target_service	method	path	evidence	confidence
order-service	user-api	GET	/users/{id}	HttpClient.get("user-api/users")	0.9
order-service	pricing-engine	POST	/calculate	FeignClient("pricing")	0.95
web-frontend	order-service	GET	/orders	fetch("/api/orders")	0.7
web-frontend	user-api	POST	/auth/login	axios.post("/auth/login")	0.8
```

Detection methods:
- **HTTP client calls**: `RestTemplate`, `WebClient`, `HttpClient`, `requests`, `fetch`, `axios` → extract target URLs from `_calls.txt`
- **Feign/Retrofit clients**: interface annotations map directly to services
- **OpenAPI client generation**: generated client class names match API specs
- **Service discovery**: Eureka, Consul, K8s DNS patterns in config
- **Import patterns**: shared client libraries (e.g., `@company/user-api-client`)

### 4. Data Flow Tracing (`_data_flows.txt`)

Trace data movement across service boundaries.

```
# flow_id	source	source_type	target	target_type	data	mechanism	direction
df-001	postgres:orders	store	order-service	process	Order	JPA/Hibernate	read
df-002	order-service	process	kafka:order.created	event	OrderCreatedEvent	KafkaTemplate	publish
df-003	kafka:order.created	event	billing-service	process	OrderCreatedEvent	@KafkaListener	consume
df-004	billing-service	process	stripe-api	external	PaymentIntent	StripeClient	write
df-005	order-service	process	user-api	process	UserProfile	REST GET	read
```

Detection:
- **Database access**: JPA repositories, SQLAlchemy models, Prisma client → `_calls.txt` targets matching ORM patterns
- **Message queues**: `KafkaTemplate.send()`, `channel.basicPublish()`, `producer.send()` → call graph
- **Event listeners**: `@KafkaListener`, `@RabbitListener`, `@EventHandler` → annotation extraction
- **Cache access**: Redis, Memcached calls in `_calls.txt`
- **File I/O**: `FileOutputStream`, `open()`, `fs.writeFile()` → call targets
- **External APIs**: HTTP client calls to non-internal URLs

### 5. Contract Matching (`_contracts.txt`)

Link API producers to consumers via contract specifications.

```
# contract_type	path	producer_service	consumer_services	schema_ref
openapi	/orders/{id}	order-service	web-frontend,billing-service	specs/order-api.yaml#/paths/~1orders~1{id}
protobuf	UserService.GetUser	user-api	order-service,web-frontend	proto/user.proto:12
event_schema	order.created	order-service	billing-service,notification-service	schemas/order-created.avsc
```

Sources:
- **OpenAPI/Swagger**: `openapi.yaml`, `swagger.json` files in repos
- **Protobuf**: `.proto` files → service + message definitions
- **Avro/JSON Schema**: event schema files in `schemas/` directories
- **GraphQL**: `.graphql` schema files
- **AsyncAPI**: async API specifications for event-driven architectures

### 6. Infrastructure Topology (`_infra.txt`)

Parse deployment configurations to understand service topology.

```
# service	infra_type	resource	config_source	network
order-service	container	docker	docker-compose.yml	backend-net
postgres	database	postgres:15	docker-compose.yml	backend-net
kafka	messaging	confluentinc/cp-kafka	docker-compose.yml	backend-net
redis	cache	redis:7	docker-compose.yml	backend-net
```

Sources:
- **Docker Compose**: `docker-compose.yml` → services, networks, volumes, depends_on
- **Kubernetes**: `deployment.yaml`, `service.yaml`, `ingress.yaml` → pods, services, networking
- **Terraform**: `.tf` files → cloud resources, networking, IAM
- **Helm charts**: `values.yaml`, `templates/` → parameterised K8s resources
- **CI/CD**: `.github/workflows/`, `Jenkinsfile`, `.gitlab-ci.yml` → build dependencies, deployment order

### 7. Event/Queue Detection (`_events.txt`)

Map event-driven communication patterns.

```
# topic	producer_service	consumer_services	event_type	schema
order.created	order-service	billing-service,notification-service	domain	OrderCreatedEvent
user.updated	user-api	order-service,web-frontend	domain	UserUpdatedEvent
payment.completed	billing-service	order-service	domain	PaymentCompletedEvent
dlq.order.created	system	monitoring-service	error	DeadLetterEvent
```

Detection:
- **Kafka**: `KafkaTemplate`, `@KafkaListener`, topic configuration in properties/YAML
- **RabbitMQ**: `RabbitTemplate`, `@RabbitListener`, exchange/queue bindings
- **AWS SQS/SNS**: SDK calls, CDK/CloudFormation resource definitions
- **Redis Pub/Sub**: `publish()`, `subscribe()` calls in `_calls.txt`
- **Domain events**: `ApplicationEventPublisher`, `@EventListener` (Spring), custom event bus patterns

---

## Implementation Phases

### Phase 1: Multi-Repo Structural Analysis

Run existing ctags + tree-sitter pipeline across multiple repos, storing results in a unified directory structure.

```
.specforge/enterprise/{enterprise-name}/
  repos/
    repo-a/  → symlink or copy of .specforge/structural/repo-a/
    repo-b/
    repo-c/
  _services.txt
  _meta.yaml
```

### Phase 2: API Surface Extraction

New extractor module: `src/ast/extractors/api_surface.py`

Detect HTTP endpoints from structural data (annotations, decorator calls, router registrations). Framework-specific detection rules driven by `config/api_patterns.yaml`.

### Phase 3: Cross-Service Dependency Detection

New module: `src/ast/extractors/service_dependencies.py`

Parse HTTP client calls from `_calls.txt`, match target URLs to known API surfaces, resolve service names from config/discovery patterns.

### Phase 4: Contract Parsing

New module: `src/ast/extractors/contract_parser.py`

Parse OpenAPI, Protobuf, GraphQL, AsyncAPI, Avro schemas. Link producers to consumers. Store in `_contracts.txt`.

### Phase 5: Infrastructure Topology

New module: `src/ast/extractors/infra_parser.py`

Parse Docker Compose, K8s manifests, Terraform configs. Extract service topology, networking, resource dependencies.

### Phase 6: Data Flow Tracing

New module: `src/ast/extractors/data_flow_tracer.py`

Combine API surfaces + service dependencies + event detection + DB access patterns into end-to-end data flow traces.

### Phase 7: Enterprise Metamodel Assembly

New module: `src/ast/enterprise_metamodel.py`

Assemble all per-repo structural stores + cross-repo extractors into the unified enterprise metamodel. Generate diagrams (Mermaid, PlantUML, Graphviz) at the enterprise level.

### Phase 8: Enterprise Diagram Generation

Extend existing diagram builders for enterprise-level views:
- **System context diagram** (C4 Level 1) — services as boxes, dependencies as arrows
- **Container diagram** (C4 Level 2) — services + databases + queues + caches
- **Data flow diagram** — end-to-end data movement across services
- **Dependency graph** — service dependency matrix with criticality scoring
- **Event flow diagram** — event bus topology with producers/consumers
- **Blast radius diagram** — given a service/DB failure, what's affected?

---

## Configuration

```yaml
# config/enterprise.yaml
enterprise:
  name: "acme-platform"
  repos:
    - name: order-service
      url: https://github.com/acme/order-service
      path: /path/to/local/clone  # or URL for remote
      type: backend
    - name: user-api
      url: https://github.com/acme/user-api
      type: backend
    - name: web-frontend
      url: https://github.com/acme/web-frontend
      type: bff
  
  service_discovery:
    method: config  # config | eureka | consul | k8s-dns
    base_urls:
      order-service: http://order-service:8080
      user-api: http://user-api:8000
  
  contracts:
    openapi_paths:
      - "specs/*.yaml"
      - "openapi.json"
    proto_paths:
      - "proto/**/*.proto"
    schema_paths:
      - "schemas/**/*.avsc"
  
  infrastructure:
    docker_compose: docker-compose.yml
    k8s_manifests: k8s/
    terraform: infra/
```

---

## Store Format

All enterprise-level store files follow existing conventions:
- Tab-separated text
- `#` comment headers with column names
- One row per entity
- Confidence scores where applicable (0.0–1.0)

---

## API Endpoints

```
POST /api/v1/enterprise/analyze
  body: { repos: [...], config: {...} }
  → Runs multi-repo structural analysis + cross-repo extraction

GET /api/v1/enterprise/{name}/services
  → Service registry

GET /api/v1/enterprise/{name}/dependencies
  → Cross-service dependency graph

GET /api/v1/enterprise/{name}/data-flows
  → End-to-end data flow traces

GET /api/v1/enterprise/{name}/diagrams/{type}
  → Generated diagram (system-context, container, data-flow, dependency, event-flow, blast-radius)

POST /api/v1/enterprise/{name}/impact?service={name}
  → Blast radius analysis for a given service
```

---

## Dependencies

- Existing: ctags provider, tree-sitter provider, structural store, framework detector, diagram builders
- New: OpenAPI parser, Protobuf parser, Docker Compose parser, K8s manifest parser
- Optional: Terraform HCL parser, GraphQL schema parser, Avro schema parser

---

## Success Criteria

1. Analyse 5+ repos and produce a unified service registry
2. Detect ≥80% of HTTP API endpoints across Spring, FastAPI, Express, Go
3. Resolve ≥70% of cross-service dependencies from source code alone
4. Generate system context and data flow diagrams for a multi-repo project
5. End-to-end analysis of 10 repos completes in <60 seconds (structural) or <5 minutes (with LLM)
6. Enterprise metamodel store is queryable via API endpoints
