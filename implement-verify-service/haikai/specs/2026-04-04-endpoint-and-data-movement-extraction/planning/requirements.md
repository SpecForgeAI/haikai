# Requirements: Endpoint & Data Movement Extraction

## Context

The architecture modelling tool (`architecture-store-and-diagrams`) provides a structured metamodel with 5 domains: Business, Application, Data, Behavioural, UI. The Application domain includes:

```
Application → Component → Service → Interface → Endpoint
```

**Interfaces** are business-oriented groupings (user-defined in the architecture tool).
**Endpoints** are concrete technical entry/exit points (REST, sockets, gRPC, MQ topics).
**Data Movements** describe data flowing between application points.

The standards-extractor already produces structural data from code repos (ctags + tree-sitter):
- `_index.txt` — all symbols (classes, methods, variables) with scope and flags
- `_calls.txt` — call graph (who calls what, with confidence scores)
- `_imports.txt` — import/dependency graph
- `_inheritance.txt` — type hierarchies

**Gap:** We have raw structural data but no extraction logic that identifies endpoints, their types, or data movement patterns from it.

---

## Goal

Extract three categories of data from code repositories:

1. **Endpoints** — every addressable entry/exit point in the application
2. **Endpoint metadata** — enough context to later group endpoints into Interfaces (user-defined)
3. **Data Movements** — data flowing between application points (outbound calls, MQ, DB access)

This is **data extraction only**. The mapping to the architecture metamodel's entities (Interface, Endpoint, Data Movement) is a subsequent step.

---

## Functional Requirements

### FR-1: Endpoint Detection

**FR-1.1** Detect REST/HTTP endpoints from framework annotations and decorators:
- Spring: `@GetMapping`, `@PostMapping`, `@PutMapping`, `@DeleteMapping`, `@PatchMapping`, `@RequestMapping`
- FastAPI: `@app.get()`, `@router.post()`, `@app.put()`, etc.
- Express: `router.get()`, `app.post()`, `app.use()`
- Go net/http: `http.HandleFunc()`, `mux.Handle()`, `gin.GET()`
- ASP.NET: `[HttpGet]`, `[HttpPost]`, `[Route]`, `MapGet()`, `MapPost()`

**FR-1.2** Detect WebSocket endpoints:
- Spring: `@ServerEndpoint`, `WebSocketHandler` implementations
- Socket.IO: `io.on('connection')`, namespace registrations
- Native: `WebSocketServer`, `ws.Server`

**FR-1.3** Detect message queue endpoints:
- Kafka: `@KafkaListener`, `KafkaTemplate.send()` (consumer = inbound endpoint, producer = outbound)
- RabbitMQ: `@RabbitListener`, `RabbitTemplate.convertAndSend()`
- SQS/SNS: `@SqsListener`, `SnsTemplate`
- Generic: JMS `@JmsListener`, `JmsTemplate`

**FR-1.4** Detect gRPC service endpoints:
- `.proto` file service/rpc definitions
- Generated stub classes and server implementations

**FR-1.5** Detect scheduled/cron endpoints:
- Spring: `@Scheduled`
- Celery: `@app.task`
- Node: cron job registrations

**FR-1.6** For each detected endpoint, extract:
- **Type**: REST, WebSocket, MQ_CONSUMER, MQ_PRODUCER, gRPC, SCHEDULED, FILE_TRANSFER
- **Path or address**: URL path, topic name, queue name, cron expression
- **Operation verb**: GET, POST, PUT, DELETE, PATCH, SUBSCRIBE, PUBLISH, RPC
- **Handler**: class + method that handles this endpoint
- **File + line**: source location
- **Direction**: INBOUND (receives requests) or OUTBOUND (sends requests)
- **Protocol**: HTTP, HTTPS, WS, WSS, AMQP, KAFKA, gRPC, CRON

### FR-2: Data Movement Detection

**FR-2.1** Detect outbound HTTP calls (app calling another app):
- Spring: `RestTemplate.getForObject()`, `WebClient.get()`, `HttpClient`
- Python: `requests.get()`, `httpx.post()`, `aiohttp.ClientSession`
- JS/TS: `fetch()`, `axios.get()`, `got.post()`
- Go: `http.Get()`, `http.Post()`, `http.NewRequest()`

**FR-2.2** Detect database access patterns:
- JPA/Hibernate: `@Repository`, `CrudRepository`, `JpaRepository` method calls
- SQLAlchemy: `session.query()`, `session.add()`, `session.execute()`
- Prisma: `prisma.user.findMany()`, `prisma.order.create()`
- Raw SQL: `jdbcTemplate.query()`, `connection.execute()`

**FR-2.3** Detect message queue publish/subscribe:
- Same patterns as FR-1.3 but focused on the data being moved
- Extract topic/queue name + direction (publish/consume)

**FR-2.4** Detect file I/O patterns:
- File read/write: `FileInputStream`, `open()`, `fs.readFile()`
- S3/cloud storage: `s3Client.putObject()`, `BlobServiceClient`
- FTP: `FTPClient`, `sftp` operations

**FR-2.5** For each detected data movement, extract:
- **Source**: the caller (class.method + file)
- **Target**: what's being called (URL, DB table/repo, topic, file path)
- **Target type**: HTTP_SERVICE, DATABASE, MESSAGE_QUEUE, FILE_SYSTEM, CACHE, EXTERNAL_API
- **Direction**: READ, WRITE, PUBLISH, SUBSCRIBE, REQUEST_RESPONSE
- **Mechanism**: the library/framework used (RestTemplate, JPA, KafkaTemplate, etc.)
- **Data hint**: any type information about what data is being moved (entity class, DTO name, message type)

### FR-3: Extraction from Existing Structural Data

**FR-3.1** Primary extraction source is the existing structural store:
- `_index.txt` for symbol discovery (annotations, class names, method signatures)
- `_calls.txt` for call graph patterns (who calls what HTTP client, DB repo, MQ template)
- `_imports.txt` for framework detection (what libraries are imported)
- `_inheritance.txt` for interface implementations (Repository extends, Handler implements)

**FR-3.2** Where structural data is insufficient (e.g., annotation parameters like URL paths), use targeted source file reads to extract specific metadata.

**FR-3.3** Detection rules must be config-driven (YAML) so new frameworks can be added without code changes.

---

## Non-Functional Requirements

### NFR-1: Performance
- Endpoint extraction must complete in < 5 seconds for a 500-file repo
- Should not require re-running ctags/tree-sitter — work from existing store files

### NFR-2: Accuracy
- Must detect ≥ 90% of endpoints in Spring, FastAPI, and Express repos
- False positive rate < 10%

### NFR-3: Extensibility
- New framework detection rules added via YAML config, not code changes
- Detection logic follows a provider pattern (one provider per framework family)

### NFR-4: Output Format
- Output must be structured (JSON or TSV) and machine-readable
- Must include enough metadata to later map to the architecture metamodel (Interface, Endpoint, Data Movement entities)

### NFR-5: Compatibility
- Must work with the existing structural store format (`_index.txt`, `_calls.txt`, etc.)
- Must not require changes to the ctags/tree-sitter extraction pipeline
