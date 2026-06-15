# Specification: LLM-Powered Interaction Classification

## Summary

Replace human-maintained YAML pattern configs with LLM-powered classification of external interactions. The AST pipeline finds all call sites. An LLM agent classifies which are external interactions and enriches them with direction, target, and data entity information. YAML patterns remain as an optional cost-saving cache.

## Relationship to Existing Work

```
Stage 1: Extract (AST)              — DONE (this repo)
  └─ _calls.txt, _imports.txt, _endpoints.txt

Stage 2: Classify (LLM agent)       — THIS SPEC
  └─ _interactions.txt (enriched)

Stage 3: Map (metamodel)             — Future spec
  └─ architecture.json entities
```

## Architecture

See [classification-flow.dot](planning/visuals/classification-flow.dot) for the Graphviz diagram of the full procedure including iteration loops.

Render with: `dot -Tpng planning/visuals/classification-flow.dot -o planning/visuals/classification-flow.png`

## Agent Skill: `classify-interactions`

This is an Haikai skill. The agent has a goal, tools, and a procedure. It uses judgement within each step — including deciding iteration depth.

**Goal:** Produce `_interactions.txt` — every external interaction in the repo, classified and enriched.

**Tools available:**
- Read `_calls.txt` (all call sites from AST)
- Read `_imports.txt` (all imports)
- Query `framework_detector` (identified frameworks)
- Read source files (for enrichment)
- Read/write YAML cache (`interaction_patterns.yaml`, `auto_discovered_patterns.yaml`)

## Classification Flow

### Step 1: Load known patterns (fast path)

Load `interaction_patterns.yaml` (manual) + `auto_discovered_patterns.yaml` (cached LLM results). For each call in `_calls.txt`, attempt to match against known patterns. Matched calls are classified immediately.

### Step 2: Batch unmatched calls by framework

Group remaining unclassified calls by the framework they belong to (using `_imports.txt` + `framework_detector` results). Calls from unknown frameworks are grouped as "unknown."

### Step 3: LLM classification

For each framework batch, the agent classifies call sites:

1. Is this an **external interaction** (crosses a system boundary) or **internal** (application logic)?
2. If external: type, direction, mechanism

The agent receives call sites as AST data (receiver, method, file, line). For obvious patterns (e.g., `requests.get`) it classifies immediately.

### Step 4: Source enrichment (iterative)

For ambiguous calls, the agent reads the source code around the call site. It uses this to:
- Resolve string arguments (URLs, topic names, table names)
- Determine direction (read vs write)
- Identify data entities (DTO classes, message types)
- Follow variable references to config

The agent decides when it has enough information. It may make multiple passes — following a variable from a call site to its definition to a config file. Typical: 1 pass for obvious calls, 2-3 for ambiguous ones.

### Step 5: Output + cache

- Write `_interactions.txt` — all classified interactions (YAML-matched + LLM-classified)
- Write new patterns to `auto_discovered_patterns.yaml` for future runs
- Write `_classification_meta.yaml` — stats, LLM cost, cache hit rate

## Output Format

### `_interactions.txt`

```tsv
# type	target	direction	mechanism	data_entity	source_class	source_method	file	line	confidence	classified_by
HTTP_SERVICE	http://user-service/users/	REQUEST_RESPONSE	RestTemplate	UserDTO	OrderService	getUser	OrderService.java	55	0.90	yaml
DATABASE	orders	WRITE	JPA	Order	OrderService	createOrder	OrderService.java	60	0.90	yaml
MESSAGE_QUEUE	order.created	PUBLISH	KafkaStreams	OrderEvent	OrderProcessor	process	OrderProcessor.java	88	0.85	llm
CACHE	session:user:123	READ	Lettuce	Session	AuthService	getSession	AuthService.java	34	0.80	llm
```

The `classified_by` column indicates whether the classification came from YAML (deterministic) or LLM.

### `auto_discovered_patterns.yaml`

```yaml
# Auto-discovered by LLM — do not edit manually.
# Review and promote to interaction_patterns.yaml if correct.
# Generated: 2026-04-04T14:30:00Z

patterns:
  - receiver: "kafkaStreams"
    methods: ["stream", "to", "through"]
    target_type: MESSAGE_QUEUE
    direction: PUBLISH
    language: java
    mechanism: KafkaStreams
    discovered_at: "2026-04-04T14:30:00Z"
    source_repo: "my-org/order-service"
```

## Key Design Decisions

1. **AST is the index, LLM is the reader.** The AST deterministically finds all call sites. The LLM classifies which matter. The LLM never misses a call (AST guarantees completeness). The AST never misclassifies (LLM handles semantics).

2. **YAML is a cache, not the source of truth.** YAML patterns avoid LLM cost for known frameworks. If all YAML was deleted, the LLM would re-discover everything. The system degrades gracefully.

3. **LLM is an agent, not a function.** It decides how many passes it needs. Some calls are obvious in one pass. Others require source reading, variable tracing, or config lookup. The procedure (Graphviz diagram) shows where iteration happens — the agent decides the depth.

4. **Batch by framework for cost control.** Sending 50 Kafka calls in one request is cheaper and more accurate than 50 individual requests.

5. **Classified_by provenance.** Every interaction records whether it was classified by YAML or LLM, enabling accuracy comparison and cache improvement over time.

## Limitations

- LLM classification adds latency (5-30 seconds) and cost (< $0.10 per repo)
- LLM may hallucinate classifications — validation via re-extraction mitigates this
- Source enrichment requires file access — won't work on pre-computed store files without the original repo
- Multi-pass depth needs a cap (default: 3) to prevent runaway cost
