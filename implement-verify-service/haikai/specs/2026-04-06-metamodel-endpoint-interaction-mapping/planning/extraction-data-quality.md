# Spec: Extraction Data Quality — Fix Gaps Before Metamodel Mapping

## Problem

Real extraction data from 7 repos has significant gaps. The metamodel engine can't produce useful architecture models from incomplete data. These are extraction layer bugs, not metamodel concerns.

## Gaps Found (from real-extraction-data.json)

### 1. handler_class empty — Python/Go (159/231 endpoints)

**Cause:** FastAPI decorates module-level functions, not class methods. Go uses package-level handler functions. The extractor only populates `handler_class` when there's an enclosing class in the AST.

**Fix (AST):** Walk up AST — if no class found, use the module/file name. `src/api.py` → `handler_class: "api"`. `internal/product/delivery/http/v1/routes.go` → `handler_class: "routes"`.

### 2. path empty — Java/C#/Go (88/231 endpoints)

**Cause:** Java `@GetMapping("/{id}")` and C# `[HttpGet("{id}")]` annotation string arguments not extracted when:
- Annotation spans multiple lines
- Value uses `value=` named parameter syntax
- Annotation has no string argument (bare `@PostMapping`)

**Fix (AST):** Improve `_extract_annotation_string_arg()` in Java/C# extractors to handle multi-line annotations and named parameters. For bare annotations, use empty string (correct — no path override).

### 3. data_hint always empty (100% — 1392/1392 interactions)

**Cause:** Extractors never attempt to resolve the data type from call arguments. `repository.save(order)` — the argument `order` has a type that the AST can see but the extractor ignores.

**Fix (AST + LLM):**
- AST: For calls with arguments, extract the first argument's type annotation or variable name
- LLM: During stage 2 classification, the LLM reads source context and can identify data entities. Add `data_entity` to the LLM's output schema (already in the prompt but LLM returns empty).

### 4. source_class empty — Python module-level (856/1392 interactions)

**Cause:** Same as #1. Module-level functions have no enclosing class. `source_class` left empty.

**Fix (AST):** Use module name when no class scope. `saleor/webhook/payloads.py` → `source_class: "payloads"`.

### 5. target is receiver.method, not resolved target (100%)

**Cause:** `target: "repository.save"` is the call site, not what it targets. The actual target is the `orders` table — but that requires resolving the repository's entity type.

**Fix (LLM):** This is stage 2 work. The LLM reads source context and resolves `repository.save` → `orders table`, `kafkaTemplate.send("order.created")` → `order.created topic`. The prompt already asks for `target` but the LLM often returns the call site instead. Need to make the prompt explicit: "target means the external resource name (URL, table, topic, file path), not the method call."

### 6. elasticsearch-py false positives (87 in standards-extractor)

**Cause:** YAML pattern matches `es.*` methods including `.exists()` which is a generic Python method, not an Elasticsearch call. Any object with `.exists()` in a file that happens to import elasticsearch gets matched.

**Fix (YAML):** Remove generic method names from elasticsearch patterns. `.exists()` is too common. Keep only ES-specific methods: `search`, `index`, `bulk`, `get`, `mget`, `scroll`.

### 7. Django URL patterns not detected (saleor: 0 REST endpoints)

**Cause:** Saleor is GraphQL-first — REST endpoints are defined via Django `urlpatterns` in `urls.py`, not decorators. The Python extractor only looks for decorator-based routes.

**Fix (Agentic):** This is LLM work, not AST work. The agentic enrichment loop already has `read_source`, `read_calls`, `read_index`, `read_imports` tools. The LLM can read `urls.py`, see `urlpatterns = [path("products/", views.product_list)]`, and understand that's a route definition. Hard-coding Django `path()` detection into the AST layer is doing the LLM's job with brittle code — every new framework means new code, which is the opposite of agentic. Endpoint discovery for framework-specific patterns should go through the same hypothesis→probe→assess loop used for `target` and `data_hint` resolution.

### 8. NestJS decorators not detected (vendure: 2/hundreds of endpoints)

**Cause:** TypeScript extractor detects Express `router.get()` call patterns but not NestJS `@Get()` / `@Post()` decorators. vendure uses NestJS — almost all endpoints are decorator-based.

**Fix (Agentic):** Same principle as #7. The LLM can read `@Controller("users")` with `@Get(":id")` and know that's an endpoint. Hard-coding NestJS decorator walking into the AST layer is brittle and framework-specific. The agentic enrichment loop should handle framework interpretation — "these decorators in this context mean routes" — not pattern-matched AST code.

## Fix Strategy

Two passes:

### Pass 1: AST fixes (deterministic, no LLM)
- Fix empty `handler_class` → use module name (#1, #4)
- Fix empty `path` → improve annotation arg extraction (#2)
- Fix false positives → tighten YAML patterns (#6)

### Pass 2: Agentic enrichment (LLM with structural store tools)
- Fix empty `data_hint` → LLM reads source context, identifies data types (#3)
- Fix unresolved `target` → update prompt to be explicit about resource names (#5)
- Fix Django URLs → LLM reads `urls.py`, identifies `path()`/`re_path()` calls as endpoints (#7)
- Fix NestJS decorators → LLM reads decorator patterns, identifies `@Get()`/`@Post()` as endpoints (#8)
- All use the same hypothesis→probe→assess reasoning loop with structural store tools

## Expected Improvement

| Field | Before | After AST fixes | After LLM |
|-------|--------|-----------------|-----------|
| handler_class | 31% populated | ~95% | — |
| path | 62% populated | ~90% | — |
| data_hint | 0% populated | ~10% (from arg types) | ~60% |
| source_class | 38% populated | ~95% | — |
| target (resolved) | 0% resolved | — | ~50% |
| False positives | ~87 ES | ~0 | — |
| Django endpoints | 0 | — | 63+ |
| NestJS endpoints | 2 | — | hundreds |
