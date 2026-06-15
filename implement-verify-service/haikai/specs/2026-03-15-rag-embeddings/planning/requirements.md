# Requirements: RAG / Embeddings Skill

## Feature Description

Replace rule-based chunking with semantic retrieval for code analysis. Embed code chunks into a vector store so the chat API and extraction pipeline can retrieve contextually relevant code fragments instead of scanning entire codebases. This enables the conversational chat to pull precise context, reduces LLM token usage on large repos, and improves extraction quality by surfacing the most relevant patterns.

## Technology Stack

- Python 3.11+ (FastAPI backend)
- `chromadb` for local vector storage (zero-infrastructure, file-based)
- OpenAI `text-embedding-3-small` or Anthropic Voyage embeddings (configurable)
- Existing `src/chunking/` pipeline for chunk generation
- Existing `src/llm_client.py` for embedding API calls
- Existing `src/cache_manager.py` for embedding cache

## Requirements

### Embedding Module
- New module at `src/embeddings/embedder.py`
- Interface: `embed(chunks: list[CodeChunk]) -> list[EmbeddingVector]`
- Support providers: OpenAI (`text-embedding-3-small`), Anthropic Voyage, local (sentence-transformers fallback)
- Provider selection via `EMBEDDING_PROVIDER` env var
- Batch embedding with rate limiting (respect API limits)
- Cache embeddings by chunk content hash — never re-embed unchanged code

### Vector Store
- New module at `src/embeddings/vector_store.py`
- ChromaDB collection per `{company}/{project}` workspace
- Store: embedding vector, chunk text, file path, language, category, line range
- Metadata filters: language, category (backend/frontend/testing/global), file path pattern
- Persist to `{project_dir}/.vectorstore/` directory
- Incremental updates: only re-embed changed files (compare against stored hashes)

### Semantic Search API
- New endpoint: `POST /api/v1/projects/{company}/{project}/search`
- Request: `{ "query": "error handling patterns", "top_k": 10, "filters": { "language": "python", "category": "backend" } }`
- Response: ranked code chunks with similarity scores, file paths, line ranges
- Supports natural language queries ("how does auth work") and code queries ("try/except patterns")

### Integration with Chat API
- `src/chat/tool_executor.py` gains a `search_codebase` tool
- Chat sessions can semantically search the indexed codebase
- Retrieved chunks injected as context into chat LLM prompts
- Replaces current approach of loading entire files into context

### Integration with Extraction Pipeline
- `file_analyzer.py` uses semantic search to find related patterns across the codebase
- When analyzing error handling in file A, retrieve similar patterns from files B, C, D
- Strategy classes receive cross-file context via semantic retrieval
- `standards_synthesizer.py` uses embeddings to cluster similar patterns for deduplication

### Indexing Lifecycle
- Full index build: triggered on project init or manual `POST /api/v1/projects/{company}/{project}/index`
- Incremental update: triggered before each extraction run (only changed files)
- Index status endpoint: `GET /api/v1/projects/{company}/{project}/index/status`
- Returns: total chunks, last indexed timestamp, stale file count

## Constraints
- ChromaDB stores data locally — no external database infrastructure required
- Embedding API calls add cost (~$0.02 per 1M tokens for OpenAI small)
- Initial indexing of large repos (>10K files) may take several minutes
- Vector similarity is approximate — not a replacement for exact text search
- Embedding dimension must be consistent within a collection (no mixing providers)

## Out of Scope
- Distributed vector stores (Pinecone, Weaviate, Qdrant)
- Cross-project semantic search (search within one project only)
- Fine-tuned embedding models
- Hybrid search (BM25 + vector) — vector-only in phase 1
- Real-time file watching for auto-reindexing
- Embedding model training on codebase-specific vocabulary
