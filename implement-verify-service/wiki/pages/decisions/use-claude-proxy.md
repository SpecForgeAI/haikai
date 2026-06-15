# Decision: LLM is Claude via local proxy — explicit config only, no defaults

For any LLM-powered command, test, or benchmark in this project, traffic goes through the **local proxy at `http://localhost:3456/v1`** (an OpenAI-compatible HTTP API that wraps Claude). Configure explicitly every time. **No defaults. No fallbacks.**

## The required configuration

| Variable | Value |
|---|---|
| `LLM_PROVIDER` | `custom` |
| `LLM_BASE_URL` | `http://localhost:3456/v1` |
| `LLM_MODEL` | caller picks (e.g. `claude-sonnet-4-6`) — **never hardcoded in this project** |

If any of these are missing, the call should error out clearly. **It must not silently fill in a "reasonable" default.**

The proxy itself lives at `/d/work/Gary/claude-max-api-proxy-tiny`. Health-check: `curl http://localhost:3456/v1/models`.

## Why each rule exists

### 1. No code-level fallbacks

If LLM config is missing, that's a misconfiguration the user must see and fix. Silent fallbacks (substituting `gpt-4o`, defaulting to a bundled key, picking a "sensible" base URL) hide misconfiguration and produce surprise billing or surprise model selection. The rule: **validate inputs, raise on missing, never substitute a default value.** Stated 2026-05-02.

### 2. No model pinning

Don't hardcode a specific model identifier in code, examples, or docs. The chosen model evolves; pinning makes that brittle. In docs, use a placeholder like `<your-claude-model>`. Stated 2026-05-02.

### 3. Proxy, not OpenAI

OpenAI is currently out of quota on the project owner's account (`gpt-5.4-mini` returned 429 `insufficient_quota` on 2026-05-02). The proxy uses an existing Claude Max subscription — no per-call billing. **Do not propose OpenAI as a fallback when the proxy fails — investigate the proxy issue.**

## How this applies to code

- New code accepting LLM config: validate inputs, raise on missing, never substitute. See `src/standards_orchestrator.py:74` for the pattern.
- Test invocations: pass the env vars or flags explicitly in the command — don't rely on shell-inherited values that may differ between environments.
- Existing scripts that already have OpenAI fallbacks (e.g. `scripts/run_v2_50_repos.py`) — leave them, but explicitly override at invocation time.
- Docs and example commands use placeholders, not specific model names.
- The [[../concepts/strategies]] layer is the heaviest LLM consumer; all 9 strategies inherit this rule via [[../concepts/llm-client]].

## Where this rule lives

The rule is enforced in:

- `src/llm_client.py` and `src/llm_client_factory.py` — provider/model/key validation; `LLM_PROVIDER` is required, no fallback.
- `src/standards_orchestrator.py:74-` — `ValueError` if `llm_provider` missing.
- Test/benchmark harnesses — should pass full env explicitly per invocation.

## Cross-references

- [[../concepts/llm-client]] — the wrapper that consumes this configuration
- [[../concepts/chat-executors]] — chat executors *don't* go through this proxy by default; they have their own auth model (Claude CLI, OAuth SDK). The proxy rule applies to non-chat LLM calls.
- Memory entry: "Use Claude proxy, not OpenAI"

## Sources

- Memory entry `feedback_llm_proxy.md` (load-bearing)
- `src/llm_client.py`, `src/standards_orchestrator.py`
- [[../../raw/2026-05-04_codebase-walk]]
