# Specification: Endpoint & Data Movement Extraction

> **REVISED 2026-04-07:** Detection strategy changed from deterministic AST
> pattern matching to agentic LLM discovery. The AST layer no longer contains
> framework-specific endpoint/interaction detection. All framework
> interpretation is done by the LLM agent using structural store tools.

## Summary

Extract endpoints (REST, WebSocket, MQ, gRPC, scheduled jobs) and data movements (outbound HTTP calls, DB access, MQ publish/subscribe, file I/O) from code repositories using **agentic LLM discovery** over existing structural store data (`_index.txt`, `_calls.txt`, `_imports.txt`, `_inheritance.txt`). Output is structured data that provides the technical foundation for populating the architecture metamodel's Endpoint and Data Movement entities.

---

## Relationship to Architecture Metamodel

The architecture modelling tool defines:

```
Application → Component → Service → Interface → Endpoint
```

And separately:

```
Data Movements: source_app_point → target_app_point + data_entity
```

**This spec covers automated extraction of raw technical data (endpoints + data movements) from code. The mapping to metamodel entities (creating Interface groupings, linking to App Points) is a subsequent spec.**

Think of it as three stages:
1. **Extract** (this spec) — find all endpoints and data movements in code
2. **Contextualise** (future) — group/classify/enrich with LLM interpretation  
3. **Map** (future) — populate architecture metamodel entities

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│              Existing Structural Store                 │
│                                                        │
│  _index.txt   _calls.txt   _imports.txt   _inherit.txt│
└──────────┬───────────┬──────────┬──────────┬─────────┘
           │           │          │          │
           ▼           ▼          ▼          ▼
┌──────────────────────────────────────────────────────┐
│              Extraction Layer                          │
│                                                        │
│  ┌──────────────────┐  ┌───────────────────────────┐  │
│  │ EndpointExtractor │  │ DataMovementExtractor     │  │
│  │                    │  │                           │  │
│  │  FrameworkDetector │  │  OutboundCallDetector     │  │
│  │  AnnotationParser  │  │  DatabaseAccessDetector   │  │
│  │  CallPatternMatcher│  │  MQPatternDetector        │  │
│  │  SourceFilePeeker  │  │  FileIODetector           │  │
│  └──────────────────┘  └───────────────────────────┘  │
│                                                        │
│  Config: endpoint_patterns.yaml                        │
│  Config: data_movement_patterns.yaml                   │
└──────────────────────┬───────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────┐
│              Output Store                              │
│                                                        │
│  _endpoints.txt    — all detected endpoints            │
│  _data_movements.txt — all detected data movements     │
│  _extraction_meta.yaml — run metadata + stats          │
└──────────────────────────────────────────────────────┘
```

---

## Detection Strategy

### Phase 1: Framework Detection (from `_imports.txt`)

Before looking for endpoints, determine what frameworks are in use. This narrows which detection rules to apply.

```python
# From _imports.txt, count framework imports:
spring_web = count("org.springframework.web")
fastapi = count("fastapi")
express = count("express")
gin = count("github.com/gin-gonic/gin")
aspnet = count("Microsoft.AspNetCore")
kafka = count("org.springframework.kafka") or count("kafka-node") or count("confluent_kafka")
rabbitmq = count("org.springframework.amqp") or count("amqplib")
```

This gives a confidence-weighted list of active frameworks. Only apply detection rules for frameworks that are actually imported.

### Phase 2: Endpoint Detection (from `_index.txt` + `_calls.txt`)

**Strategy A — Annotation-based (Spring, ASP.NET):**

In `_index.txt`, look for classes/methods with framework annotations in the `flags` column:
- `extends:RestController` or class name ending in `Controller`
- Method-level: `@GetMapping`, `@PostMapping` etc.

**Problem:** Current `_index.txt` flags column only captures `extends:` relationships, not annotations.

**Solution:** For annotation-based endpoints, do a targeted source file read:
1. From `_index.txt`, identify controller classes (by name pattern or inheritance)
2. Read those specific source files (not all files — just controllers)
3. Parse annotations to extract: HTTP method, path, parameters

This is a small number of files (typically 5-20 controllers per app) so it's fast.

**Strategy B — Call-pattern-based (Express, FastAPI, Go):**

In `_calls.txt`, look for calls matching endpoint registration patterns:
```
# Express
*.get("/path", handler)     → callee matches router.get, app.get
*.post("/path", handler)    → callee matches router.post, app.post

# FastAPI
@app.get("/path")           → decorator pattern in _calls.txt
@router.post("/path")       → decorator pattern

# Go
http.HandleFunc("/path", handler)
mux.Handle("/path", handler)
```

**Strategy C — MQ endpoints (from `_calls.txt` + `_index.txt`):**

- Consumers: `@KafkaListener(topics="order.created")` → annotation parse
- Producers: `kafkaTemplate.send("order.created", ...)` → call pattern match
- RabbitMQ: `@RabbitListener(queues="...")`, `rabbitTemplate.convertAndSend(...)`

### Phase 3: Data Movement Detection (from `_calls.txt`)

Scan `_calls.txt` for known outbound patterns:

**HTTP clients:**
```
callee contains "RestTemplate.getForObject"    → OUTBOUND HTTP READ
callee contains "WebClient"                     → OUTBOUND HTTP (various)
callee contains "requests.get"                  → OUTBOUND HTTP READ
callee contains "fetch("                        → OUTBOUND HTTP
callee contains "axios."                        → OUTBOUND HTTP
```

**Database access:**
```
callee contains "Repository.find"               → DB READ
callee contains "Repository.save"               → DB WRITE
callee contains "session.query"                  → DB READ
callee contains "prisma.*.find"                  → DB READ
callee contains "prisma.*.create"                → DB WRITE
callee contains "jdbcTemplate"                   → DB (various)
```

**Cache:**
```
callee contains "RedisTemplate"                  → CACHE
callee contains "redis.get" / "redis.set"        → CACHE READ/WRITE
```

**File I/O:**
```
callee contains "s3Client"                       → FILE WRITE/READ (cloud)
callee contains "FileOutputStream"               → FILE WRITE
callee contains "fs.writeFile"                    → FILE WRITE
```

---

## Output Format

### `_endpoints.txt`

```tsv
# type	path_or_address	operation	handler_class	handler_method	file	line	direction	protocol	framework	confidence
REST	/api/orders/{id}	GET	OrderController	getOrder	OrderController.java	45	INBOUND	HTTP	spring	0.95
REST	/api/orders	POST	OrderController	createOrder	OrderController.java	62	INBOUND	HTTP	spring	0.95
MQ_CONSUMER	order.created	SUBSCRIBE	OrderListener	onOrderCreated	OrderListener.java	28	INBOUND	KAFKA	spring-kafka	0.90
MQ_PRODUCER	payment.processed	PUBLISH	PaymentService	processPayment	PaymentService.java	85	OUTBOUND	KAFKA	spring-kafka	0.85
WEBSOCKET	/ws/notifications	SUBSCRIBE	NotificationHandler	handle	NotificationHandler.java	15	INBOUND	WS	spring	0.80
SCHEDULED	*/5 * * * *	CRON	ReportJob	generateReport	ReportJob.java	12	INTERNAL	CRON	spring	0.90
```

### `_data_movements.txt`

```tsv
# source_class	source_method	target	target_type	direction	mechanism	data_hint	file	line	confidence
OrderService	createOrder	/api/users/{id}	HTTP_SERVICE	READ	RestTemplate	UserDTO	OrderService.java	55	0.80
OrderService	createOrder	orders	DATABASE	WRITE	JpaRepository	Order	OrderService.java	60	0.90
PaymentService	process	payment.completed	MESSAGE_QUEUE	PUBLISH	KafkaTemplate	PaymentEvent	PaymentService.java	88	0.85
ReportService	generate	s3://reports/	FILE_SYSTEM	WRITE	S3Client	ReportFile	ReportService.java	102	0.75
OrderService	getOrder	redis:orders	CACHE	READ	RedisTemplate	Order	OrderService.java	35	0.80
```

### `_extraction_meta.yaml`

```yaml
extraction:
  timestamp: "2026-04-04T13:40:00Z"
  repo: "spring-petclinic"
  frameworks_detected:
    - name: spring-web
      confidence: 0.95
      import_count: 42
    - name: spring-kafka
      confidence: 0.80
      import_count: 5
  stats:
    endpoints_found: 14
    data_movements_found: 23
    files_scanned: 8  # controller files peeked
    files_total: 90
  detection_gaps:
    - "Dynamic route registration not detected"
    - "Feign client interfaces not resolved"
```

---

## Configuration

### `config/endpoint_patterns.yaml`

```yaml
frameworks:
  spring:
    imports: ["org.springframework.web", "org.springframework.boot"]
    endpoint_annotations:
      - pattern: "@GetMapping"
        type: REST
        operation: GET
      - pattern: "@PostMapping"
        type: REST
        operation: POST
      - pattern: "@PutMapping"
        type: REST
        operation: PUT
      - pattern: "@DeleteMapping"
        type: REST
        operation: DELETE
      - pattern: "@PatchMapping"
        type: REST
        operation: PATCH
      - pattern: "@RequestMapping"
        type: REST
        operation: DYNAMIC  # verb from method= attribute
    controller_patterns:
      - class_suffix: "Controller"
      - annotation: "@RestController"
      - annotation: "@Controller"
    mq_patterns:
      - annotation: "@KafkaListener"
        type: MQ_CONSUMER
        direction: INBOUND
      - call: "KafkaTemplate.send"
        type: MQ_PRODUCER
        direction: OUTBOUND

  fastapi:
    imports: ["fastapi"]
    call_patterns:
      - pattern: "app.get"
        type: REST
        operation: GET
      - pattern: "router.get"
        type: REST
        operation: GET
      - pattern: "app.post"
        type: REST
        operation: POST
      - pattern: "router.post"
        type: REST
        operation: POST

  express:
    imports: ["express"]
    call_patterns:
      - pattern: "router.get"
        type: REST
        operation: GET
      - pattern: "app.get"
        type: REST
        operation: GET
      - pattern: "router.post"
        type: REST
        operation: POST
      - pattern: "app.post"
        type: REST
        operation: POST
```

### `config/data_movement_patterns.yaml`

```yaml
outbound_http:
  - pattern: "RestTemplate"
    target_type: HTTP_SERVICE
  - pattern: "WebClient"
    target_type: HTTP_SERVICE
  - pattern: "requests.get"
    target_type: HTTP_SERVICE
  - pattern: "fetch("
    target_type: HTTP_SERVICE
  - pattern: "axios"
    target_type: HTTP_SERVICE

database:
  - pattern: "Repository.find"
    target_type: DATABASE
    direction: READ
  - pattern: "Repository.save"
    target_type: DATABASE
    direction: WRITE
  - pattern: "session.query"
    target_type: DATABASE
    direction: READ
  - pattern: "prisma."
    target_type: DATABASE

cache:
  - pattern: "RedisTemplate"
    target_type: CACHE
  - pattern: "redis."
    target_type: CACHE

file_system:
  - pattern: "s3Client"
    target_type: FILE_SYSTEM
  - pattern: "FileOutputStream"
    target_type: FILE_SYSTEM
  - pattern: "fs.writeFile"
    target_type: FILE_SYSTEM
```

---

## Key Design Decisions

1. **Structural store as the LLM's workspace** — The LLM reads `_index.txt`, `_calls.txt`, `_imports.txt` and source files to discover endpoints and interactions. The structural store provides the mechanical foundation.

2. **LLM-driven, not config-driven** — Framework knowledge lives in the LLM, not in YAML files. No config maintenance. New framework = the LLM already knows it. YAML pattern files are deprecated reference only.

3. **Confidence scoring** — Every discovered endpoint/interaction gets a confidence score based on the LLM's assessment.

4. **Data first, mapping later** — This spec outputs raw extracted data. The contextualisation step (grouping endpoints into Interfaces) and mapping step (populating metamodel) are separate specs.

5. **AST stays mechanical** — The AST layer extracts symbols, calls, imports, inheritance — framework-agnostic. It NEVER does framework-specific interpretation. That's the LLM's job via `endpoint_discoverer.py` and `interaction_discoverer.py`.

---

## Limitations & Known Gaps

- **Dynamic routes** (e.g., `app.route(compute_path())`) — not detectable from static analysis
- **Generated clients** (Feign, Retrofit) — interface detection only, not resolved URLs
- **Environment-variable URLs** — outbound call targets may be config-driven, not hardcoded
- **Inherited endpoints** — controller inheritance chains need special handling
- **Framework version differences** — annotation names may vary across versions
