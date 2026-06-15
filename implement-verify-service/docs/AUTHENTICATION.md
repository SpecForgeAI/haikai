# Authentication & Authorization

This document describes all authentication mechanisms used in the Standards Extractor application.

## Overview

The application uses **two separate authentication layers**:

| Layer | Purpose | Mechanism | Config |
|-------|---------|-----------|--------|
| **API Authentication** | Protects REST endpoints from unauthorized clients | Bearer token (API key) | `STANDARDS_API_KEY` |
| **LLM Provider Authentication** | Authenticates with AI model providers (Anthropic, OpenAI, etc.) | OAuth token or API key | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` |

```
Client ──Bearer token──▶ [API Layer] ──OAuth/API key──▶ [LLM Provider]
                         (STANDARDS_API_KEY)             (ANTHROPIC_API_KEY)
```

---

## 1. API Authentication (Client → Application)

All `/api/v1/*` endpoints require a Bearer token in the `Authorization` header.

### Configuration

```bash
# .env
STANDARDS_API_KEY=your-secret-api-key
```

### Usage

```bash
curl -H "Authorization: Bearer your-secret-api-key" \
     http://localhost:8000/api/v1/standards/global/generate
```

### Implementation

- **File:** `src/api.py` → `verify_api_key()`
- **Mechanism:** FastAPI `HTTPBearer` security dependency
- **Exempt endpoints:** `/health` (no auth required)

### Behavior

| Scenario | Result |
|----------|--------|
| `STANDARDS_API_KEY` not set | 500: "API key not configured on server" |
| Invalid/missing token | 401: "Invalid API key" |
| Valid token | Request proceeds |

---

## 2. LLM Provider Authentication (Application → AI Providers)

The application authenticates with LLM providers to make AI model calls. Two distinct auth flows exist depending on the type of Anthropic key.

### 2a. Anthropic OAuth Token (`sk-ant-oat...`)

OAuth tokens come from Claude Max/Pro subscriptions and require **Bearer authentication**.

```
Authorization: Bearer sk-ant-oat01-...
```

**Where it's used:**
- Chat/streaming endpoints (`shape-spec/stream`, `plan-product/stream`, `story-component-anchor/stream`) via `OAuthChatExecutor`
- LLM strategy calls via `_AnthropicOAuthWrapper` in `llm_client.py`

**How it works:**
1. Application detects `sk-ant-oat` prefix in `ANTHROPIC_API_KEY`
2. Uses Anthropic SDK's `auth_token` parameter (sends `Authorization: Bearer` header)
3. Requires `anthropic-beta` header with `oauth-2025-04-20` feature flag
4. **Critical:** Must temporarily remove `ANTHROPIC_API_KEY` from `os.environ` during SDK initialization to prevent dual-header auth failure (SDK auto-reads env var and sends both `X-Api-Key` + `Authorization: Bearer`, which causes 401)

**Required headers for OAuth:**
```
Authorization: Bearer sk-ant-oat01-...
anthropic-beta: claude-code-20250219,oauth-2025-04-20,...
user-agent: claude-cli/<version> (external, cli)
x-app: cli
```

**Files:**
- `src/chat/oauth_chat_executor.py` — OAuth streaming chat executor
- `src/llm_client.py` → `_AnthropicOAuthWrapper` — OAuth wrapper for strategy calls

### 2b. Anthropic API Key (`sk-ant-api...`)

Standard API keys use the `X-Api-Key` header via LangChain's `ChatAnthropic`.

```
X-Api-Key: sk-ant-api03-...
```

**Where it's used:**
- Standards generation strategies (via `LLMClient` → LangChain `ChatAnthropic`)
- Chat executors when Claude CLI is available (`ClaudeChatExecutor`)
- Haikai orchestration (`HaikaiOrchestrator`)

**Files:**
- `src/llm_client.py` → `LLMClient` — LangChain-based client
- `src/chat/claude_chat_executor.py` — Claude CLI-based executor

### 2c. OpenAI API Key

Fallback provider when Anthropic is unavailable or `LLM_PROVIDER=openai`.

**Files:**
- `src/llm_client.py` → `LLMClient` (provider=`openai`)
- `src/chat/openai_chat_executor.py` — OpenAI chat executor

---

## 3. Chat Executor Selection Logic

The `create_chat_executor()` factory in `src/api/__init__.py` selects the executor:

```
Is ANTHROPIC_API_KEY an OAuth token (sk-ant-oat...)?
  ├── YES → ClaudeChatExecutor (OAuth requires Claude CLI)
  └── NO
       ├── Is Claude CLI available? → ClaudeChatExecutor
       ├── Is OPENAI_API_KEY set?   → OpenAIChatExecutor (fallback)
       └── Neither                  → ClaudeChatExecutor (last resort)
```

**Note:** OAuth tokens (`sk-ant-oat...`) can ONLY work through the Claude CLI or the `OAuthChatExecutor` — they are incompatible with LangChain's `ChatAnthropic` which only supports `X-Api-Key` auth.

---

## 4. Repository Access Tokens

For fetching source code from external repositories:

| Provider | Config Variable | Auth Type |
|----------|----------------|-----------|
| GitHub | `GITHUB_TOKEN` | Bearer token |
| GitLab | `GITLAB_TOKEN` | Bearer token |
| Bitbucket | `BITBUCKET_USERNAME` + `BITBUCKET_APP_PASSWORD` | Basic auth |

---

## 5. Environment Variables Reference

```bash
# === API Authentication ===
STANDARDS_API_KEY=changeit              # Required. Protects all /api/v1/* endpoints.

# === LLM Provider Authentication ===
ANTHROPIC_API_KEY=sk-ant-...            # Anthropic API key OR OAuth token (sk-ant-oat...)
OPENAI_API_KEY=sk-...                   # OpenAI API key (fallback provider)
AZURE_OPENAI_API_KEY=...               # Azure OpenAI (if using Azure provider)
AZURE_API_BASE=https://...             # Azure endpoint URL
AZURE_API_VERSION=2024-02-15-preview   # Azure API version

# === Repository Access ===
GITHUB_TOKEN=ghp_...                   # GitHub personal access token
GITLAB_TOKEN=glpat-...                 # GitLab personal access token
BITBUCKET_USERNAME=...                 # Bitbucket username
BITBUCKET_APP_PASSWORD=...             # Bitbucket app password

# === Model Configuration ===
LLM_PROVIDER=anthropic                 # Provider: openai, anthropic, azure, custom
LLM_MODEL=claude-haiku-4-5-20251001    # Model for strategy calls
CHAT_MODEL=claude-sonnet-4-5-20250929  # Model for chat/streaming endpoints
```

---

## 6. Known Limitations & Caveats

1. **Thread safety of OAuth env juggling:** The `OAuthChatExecutor` and `_AnthropicOAuthWrapper` temporarily remove `ANTHROPIC_API_KEY` from `os.environ` during SDK initialization. This is not thread-safe — concurrent requests could race. Consider using a dedicated `ANTHROPIC_OAUTH_TOKEN` env var in the future.

2. **No rate limiting:** API endpoints have no rate limiting. Consider adding middleware for production.

3. **CORS restricted to localhost:** Currently allows `http://localhost:5173` and `http://127.0.0.1:5173` only. Update `src/api.py` CORS origins for production deployment.

4. **API key is a single shared secret:** All clients use the same `STANDARDS_API_KEY`. No per-user auth, scopes, or key rotation mechanism exists.
