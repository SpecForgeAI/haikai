# Specification: RAG / Embeddings Skill

## Summary

Add semantic retrieval to the standards extraction pipeline and chat API. Code chunks are embedded into a local ChromaDB vector store per project workspace. The extraction pipeline uses semantic search to find cross-file patterns, and the chat API uses it to pull relevant context instead of loading entire files. This reduces token usage, improves pattern discovery across large codebases, and makes the chat experience significantly more context-aware.

---

## Current Flow

```
1. file_scanner.py → discovers all files
2. chunking pipeline → splits files by line count / language rules
3. file_analyzer.py → sends ALL chunks to LLM sequentially
4. strategies → each strategy processes chunks independently
5. chat API → loads full files into context when user asks questions
```

### Current flow issues

- Every extraction run processes every chunk — no way to focus on relevant code
- Chat API context is file-based, not query-based — loads too much irrelevant code
- Cross-file pattern discovery relies entirely on LLM memory within a single prompt
- Large repos hit context window limits, requiring aggressive truncation
- No way to find "similar patterns" across the codebase without reading everything

---

## Proposed Flow

```
1. file_scanner.py → discovers files
2. chunking pipeline → splits files into chunks (existing + AST-aware)
3. embedder.py → embeds chunks via configured provider
   ├─ Caches by content hash — skips unchanged chunks
   └─ Stores in ChromaDB collection per project
4. file_analyzer.py → for each chunk, semantic search for related patterns
   ├─ "Find similar error handling across the codebase"
   ├─ Injects top-k related chunks as cross-file context
   └─ LLM sees focused, relevant code instead of everything
5. chat API → tool_executor calls search_codebase for relevant context
6. strategies → receive both current chunk + semantically related chunks
```

---

## Key Differences

| Aspect | Current | Proposed |
|--------|---------|----------|
| **Context selection** | All chunks sequentially | Semantically relevant chunks |
| **Cross-file patterns** | LLM infers from memory | Explicit retrieval of similar code |
| **Chat context** | Full file loading | Query-targeted retrieval |
| **Token efficiency** | O(all files) per strategy | O(relevant files) per query |
| **Incremental runs** | Re-process everything | Only re-embed changed files |
| **Pattern dedup** | LLM-based in synthesis | Embedding clustering pre-synthesis |

---

## Code Changes

### 1. New: `src/embeddings/embedder.py`

Core embedding module.

- `Embedder` class with `embed_chunks(chunks: list[CodeChunk]) -> list[EmbeddingResult]`
- Provider abstraction: `OpenAIEmbedder`, `VoyageEmbedder`, `LocalEmbedder`
- Batch API calls with configurable batch size and rate limiting
- Content hash check before embedding — skip unchanged chunks
- Async interface with `asyncio.to_thread` for blocking providers

### 2. New: `src/embeddings/vector_store.py`

ChromaDB wrapper.

- `VectorStore` class with `add`, `search`, `delete`, `status` methods
- Collection naming: `{company}__{project}` (ChromaDB collection per workspace)
- Metadata stored per chunk: file_path, language, category, line_start, line_end, content_hash
- Search with metadata filters: `search(query, top_k, language=, category=, path_pattern=)`
- Persistence directory: `{project_dir}/.vectorstore/`

### 3. New: `src/embeddings/models.py`

Pydantic models.

- `CodeChunk`: text, file_path, language, category, line_range, content_hash
- `EmbeddingResult`: chunk_id, vector, metadata
- `SearchResult`: chunk, score, file_path, line_range
- `IndexStatus`: total_chunks, last_indexed, stale_count, provider, dimension

### 4. New: `src/embeddings/indexer.py`

Index lifecycle management.

- `Indexer` class orchestrating scan → chunk → embed → store
- `full_index(project_dir)`: rebuild from scratch
- `incremental_index(project_dir)`: compare file hashes, re-embed only changes
- Progress callback for SSE streaming during indexing
- Integrates with existing `file_scanner` and chunking pipeline

### 5. Modified: `src/file_analyzer.py`

- Before LLM analysis of a chunk, search vector store for top-k related chunks
- Inject related chunks as "cross-file context" section in LLM prompt
- Configurable `SEMANTIC_CONTEXT_TOP_K` (default: 5)
- Skip semantic search if vector store not yet built (graceful degradation)

### 6. Modified: `src/chat/tool_executor.py`

- New tool: `search_codebase(query: str, top_k: int, filters: dict) -> list[SearchResult]`
- Registered in chat tool definitions for Claude/OpenAI function calling
- Chat LLM can invoke semantic search mid-conversation
- Results formatted as code blocks with file paths and line numbers

### 7. Modified: `src/standards_synthesizer.py`

- Use embedding similarity to cluster related patterns before synthesis
- Deduplicate near-identical patterns using cosine similarity threshold
- Cluster-based synthesis: group similar patterns, synthesize per cluster

### 8. Modified: `src/api.py`

- `POST /api/v1/projects/{company}/{project}/index` — trigger full/incremental indexing
- `GET /api/v1/projects/{company}/{project}/index/status` — index health
- `POST /api/v1/projects/{company}/{project}/search` — semantic search endpoint

### 9. Config & Docker

- New env vars: `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_BATCH_SIZE`, `SEMANTIC_CONTEXT_TOP_K`
- Add `chromadb`, `sentence-transformers` (optional local fallback) to `requirements.txt`
- `.vectorstore/` added to `.dockerignore` (rebuilt per environment)

---

## Indexing Strategy

- **On project init**: automatic full index after clone/scaffold
- **Before extraction**: incremental index (only changed files since last index)
- **Manual**: `POST .../index?mode=full` or `?mode=incremental`
- **Chat sessions**: index must exist, no auto-index during chat (too slow)
- **Stale detection**: compare file system hashes against stored hashes, report stale count in status

---

## Error Handling

- Embedding API unavailable → skip semantic enrichment, fall back to current pipeline, log warning
- ChromaDB corruption → delete and rebuild `.vectorstore/`, log error
- Rate limit hit → exponential backoff with jitter, configurable max retries
- Unsupported file type → skip embedding, index as metadata-only
- Empty project → return empty index status, no error
