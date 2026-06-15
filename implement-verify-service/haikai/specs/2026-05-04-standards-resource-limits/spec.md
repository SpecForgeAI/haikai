# Standards-Endpoint Resource Limits

**Status:** deferred — surfaced as M3 in `debug/260504-1448-mega-standards-audit/findings.md`. Tracking spec only; no implementation yet.

## Problem

The standards-generation endpoints (`/api/v1/standards/{product,global}/generate` and the v2 variant) accept user-supplied `sources` and a default `recursive=True`, then walk the resulting filesystem trees with no caps. Result:

- A request with a single huge source (e.g. `https://github.com/elastic/kibana` — 6,652 files) ties up an `executor_pool` thread for the full duration of cloning + scanning + LLM-summarizing.
- N concurrent such requests exhaust the executor pool. Other API endpoints stall behind them.
- Memory grows with file count (each file's content is read for analysis).
- LLM cost balloons proportional to source size.

In a single-tenant deployment this is operator-self-DoS. In multi-tenant deployments or with adversarial API keys, it's a denial-of-service vector.

## Out of scope

- Per-tenant rate limiting (deferred to a separate auth/quotas spec).
- Output size caps (separate concern — generated standards are bounded by the LLM's response size).

## Proposed mitigations

Three layered caps, each independently configurable via env so operators can tune for their workloads:

| Limit | Default | Env var | Where to enforce |
|---|---|---|---|
| Max files per source | 5,000 | `STANDARDS_MAX_FILES_PER_SOURCE` | `_scan_local_directory` and `_scan_remote_repository` after enumeration; raise `ValueError` if exceeded |
| Max total bytes | 100 MB | `STANDARDS_MAX_TOTAL_BYTES` | After enumeration, sum file sizes; abort if over |
| Per-source timeout | 600 s | `STANDARDS_PER_SOURCE_TIMEOUT_SECONDS` | Wrap `_scan_remote_repository` (clone + scan) in an asyncio timeout |

Plus:
- Document the caps in the OpenAPI summaries for both endpoints.
- Surface clean 413/422 errors when caps are hit (not 500).
- Add `STANDARDS_MAX_SOURCES` (default 50) capping the `request.sources` list length to prevent the "1000 small sources" fanout.

## Test plan

- Unit: `_scan_local_directory` raises when file count > cap.
- Unit: `_scan_remote_repository` raises when post-clone scan > cap.
- Integration: API returns 413 with clear error when source exceeds limit.
- Anti-pattern guard: assert all three caps are referenced in the source — guards against future regressions removing them silently.

## Why this is deferred

- M1, M2, M4 were higher-impact security findings (token leak, scope-bypass, info disclosure) and got the available implementation slot.
- This is operationally important but not security-critical in the current single-tenant model.
- Picking sensible default caps requires a quick benchmark (how big is "normal" usage?) which the user hasn't asked for yet.

## When to revisit

- Before any multi-tenant deployment.
- If `executor_pool` saturation is observed in production.
- After landing the per-tenant rate-limiting spec (if/when that exists).

## Lineage

- Surfaced in `debug/260504-1448-mega-standards-audit/findings.md` finding M3.
- Companion fix commit (M1, M2, M4) does NOT close this finding — see commit message for explicit deferral.
