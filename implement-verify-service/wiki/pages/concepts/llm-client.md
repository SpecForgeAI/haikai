# LLMClient

Unified wrapper for LLM calls in non-chat code paths (the standards pipeline, strategies, V2 LLM fallback). Lives at `src/llm_client.py`.

Distinct from the [[chat-executors]] family — those are streaming, conversational, SSE-driven. `LLMClient` is request/response, used for one-shot strategy calls.

## What's underneath

LangChain `BaseChatModel`, with one custom path:

| Auth shape | Underlying client | Why |
|---|---|---|
| Standard API key (`sk-ant-api…`, OpenAI, Azure) | LangChain `ChatAnthropic` / `ChatOpenAI` / `AzureChatOpenAI` | Native LangChain support; X-Api-Key header. |
| **OAuth token (`sk-ant-oat…`)** | Custom `_AnthropicOAuthWrapper` (in this file) | LangChain's `ChatAnthropic` only supports `api_key`; OAuth needs `auth_token` (Bearer). Wrapper reuses LangChain's message-shape contract. |

The `_AnthropicOAuthWrapper` defensively pops `ANTHROPIC_API_KEY` from `os.environ` during init to prevent the SDK from auto-reading it and sending **both** `X-Api-Key` and `Authorization: Bearer`, which would 401. It restores the env var afterwards.

## Why a wrapper, not special-casing in callers

Memory feedback: **add capabilities to the wrapper class itself, not by special-casing callers.** When OAuth support was added, the wrapper grew an OAuth path; call sites stayed identical. Adding a new auth mode = wrapper change, not codebase-wide change.

## Required configuration — no fallbacks

Per [[../decisions/use-claude-proxy]] (and reinforced in `standards_orchestrator.py:74`):

| Variable | Purpose |
|---|---|
| `LLM_PROVIDER` | `anthropic` / `openai` / `azure` / `custom`. **Required.** No default. |
| `LLM_MODEL` | Model identifier. **Required.** No default. |
| `LLM_BASE_URL` | Base URL for `custom` provider (typically the local Claude proxy). |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / etc. | Provider credential. **Required** for the chosen provider. |

Missing config raises `ValueError` immediately, not silently substitutes a default. This is intentional — see [[../decisions/use-claude-proxy]] for the rationale.

## What `LLMClient` exposes

A small surface designed to look like LangChain `BaseChatModel.invoke(...)`:

- `invoke(messages)` — synchronous request/response
- `bind_tools(tools)` — native tool calling (Anthropic format conversion happens inside the OAuth wrapper)
- Streaming variants used by tech-stack synthesis and metamodel paths

## Where it's called from

- `src/standards_orchestrator.py` — the pipeline-level LLM ([[strategies]])
- `src/strategies/*.py` — each [[strategies|strategy]] uses `LLMClient.invoke` to extract a specific class of standard
- `src/ast/v2/llm_fallback.py` — V2's LLM fallback when no playbook matches
- `src/agent_prompts.py` — prompt templates that LLMClient renders against

## What it's *not*

- Not used by [[chat-executors]] — those go directly to the Anthropic SDK or shell out to the Claude CLI.
- Not used by [[agentic-discovery]] — discovery skills run inside the chat-executor session, using its tool surface.

The split: streaming/agentic work uses chat executors; one-shot strategy/extraction work uses `LLMClient`.

## Sources

- `src/llm_client.py`
- `src/llm_client_factory.py`
- Memory entry: OAuth wrapper design ("add capabilities to the wrapper, not the callers")
- [[../../raw/2026-05-04_codebase-walk]]
