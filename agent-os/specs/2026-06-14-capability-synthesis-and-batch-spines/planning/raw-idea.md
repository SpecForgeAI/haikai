# D2 — Capability synthesis + batch spines

This is Spec 2 (of 6) in a discovery-completeness + net_new program that makes the migration tool discover NON-API / internal functionality (the first real migration is a Sybase/Spring-Classic/Java risk-hierarchy system whose batch tier is CA Autosys JIL + shell scripts + plain-Java main() classes + Geneos monitoring XML + Argon/TIBCO FTP). D1 (the prior spec) added an always-on pass that LLM-summarises unknown-but-relevant files into per-file `operational_artifact` findings. D2 turns those scattered per-file findings (plus discovered entities + DB objects) into COHERENT, durable, migrate-able CAPABILITIES, and adds the structured batch "spines" that make the grouping accurate.

## Why D2 exists (the gap D1 leaves)
D1 emits one finding PER FILE. But operational functionality is a GRAPH: an Autosys JIL box → triggers shell scripts → which invoke plain-Java `main()` batch classes → which read/write Sybase tables → and publish a downstream message. Thirty disconnected "here's a shell script" findings are nearly useless for migration; "here's the Daily Risk Hierarchy Load Pipeline capability, composed of these parts, on this schedule, honouring these data/message contracts" is what becomes ONE migration story. The current model has NO home for that grouping (verified: discovery clusters are internal Phase-1c-only; findings can't link to other findings; candidate types are a closed whitelist). D2 adds the grouping concept + the structured extractors that give it good members.

## Four components

### 1. The `discovery_capability` grouping entity (Option A — findings-side, graduate-able to B)
A NEW standalone AMS entity/table — its OWN id, its OWN review status, its OWN membership links — parented conceptually in the reality/findings domain (NOT the architecture meta-model), that aggregates member findings (the D1 operational_artifact findings + DB hidden_logic findings, etc.) AND can link out to architecture entities (the web service, data entities) involved. A capability is a cross-cutting CURRENT-STATE aggregation, distinct from a book-of-work feature (= planned work). It is DELIBERATELY shaped so it can graduate into a first-class "Discovered Capabilities" output (Option B) later as UI + consumption wiring, with NO data re-model. This is the ONE new model concept in the whole 6-spec program and the ONLY new Liquibase changeset (~184, after 183). Boxed PATCH-mutable types; snake_case wire (new entity, no camelCase consumer yet).

### 2. Autosys JIL parser (the orchestration spine)
A bespoke parser for `.jil` files (Autosys Job Information Language — a simple key:value DSL, e.g. `insert_job`, `job_type: c|b|f`, `box_name`, `command`, `condition: success(job)`, `start_times`, `days_of_week`, `alarm_if_fail`). Extracts the job topology: boxes, jobs, schedules, the dependency/trigger DAG (success/done/notrunning conditions), file-watcher jobs (job_type f), the command each job runs, machine. This is "what runs, when, in what order, triggered by what" — the single most important missing dimension. Likely hand-rolled (JIL is simple) rather than a tree-sitter grammar.

### 3. Plain-Java main() batch-entrypoint recognition
Today, classes with `public static void main(String[])` invoked from shell (e.g. `com.example.samplesvc.batch.SQLExecutorImpl` run as `-o UPDATE`) are PARSED into the Java IR but NEVER emitted (emission is Spring-gated; they have no @annotation and don't match the Service|Provider|...|Engine name heuristic). D2 adds a non-Spring recognition rule that emits these as candidates (of an EXISTING allowed candidate type — e.g. class/method/business_logics/app_component) marked as batch entrypoints, capturing the operation-flag pattern (`-o UPDATE`/`-o ARCHIVE`). The Java tree-sitter IR already parses main(); the gap is the emission rule.

### 4. Invocation linkage (JIL → shell → Java → DB)
Capture the invocation/trigger edges that stitch the chain: JIL job → its command/script; shell script → the Java FQCN it invokes (e.g. DeleteAndLoadIntoLoadDB.sh → com.example.samplesvc.batch.BatchedDBLoaderImpl); Java entrypoint → the DB objects it touches. Reuse the existing relationship/`calls` machinery where it fits; cross-language linkage is by FQCN/string match against discovered Java candidates and D1's captured `detailJson.invokes` strings.

### 5. Capability synthesis (the clustering)
Cluster the related D1 findings + the batch entrypoint candidates + DB objects + the JIL topology into NAMED capability units (e.g. "Daily Risk Hierarchy Load Pipeline", "Monitoring", "Deployment/ARM", "FTP Ingestion", "Maintenance/Housekeeping"). Likely an LLM synthesis step seeded by the invocation graph + the JIL topology, producing `discovery_capability` records with their members. This is what makes the batch tier migrate-able as coherent wholes.

## Dependencies & forward pointers
- Consumes D1's `operational_artifact` findings as raw material.
- FEEDS the keystone spec (capabilities → ONE implementation-ready, modernised spec each via the 7th context type) and the completeness gate spec (the capability is the unit of coverage the human signs off).
- The keystone/book-of-work consumption is NOT built here — D2 just PRODUCES capabilities + their members + the batch spines.

## Owners
- discovery-service: the JIL parser, the plain-Java main() batch-entrypoint emission rule, the invocation linkage, the capability synthesis step.
- AMS: the new `discovery_capability` entity + membership + persistence + endpoints + the new Liquibase changeset (~184). Possibly extend the finding link target types (currently `discovery_finding` is NOT an allowed link target) OR give the capability its own membership table.
- Frontend: minimal for D2 — surface capabilities through/near the existing Findings review (the first-class "Discovered Capabilities" tab is the Option-B graduation, deferred). Exact frontend scope is a shaping question.

## Repo conventions
discovery-service is TypeScript; tree-sitter jest isolation rules apply (the Java main() recognition reuses the EXISTING Java tree-sitter IR — do NOT add a bare top-level require('tree-sitter'); the JIL parser is hand-rolled, not tree-sitter). Only edit discovery-service/src when no discovery run is active. AMS: new Liquibase changeset ONLY (never edit applied; latest applied is 183 from the just-built reconciliation spec — D2 is ~184, confirm/coordinate); boxed types for PATCH-mutable fields; snake_case wire default. Findings persist via FindingEmitter → AMS DiscoveryFinding.
