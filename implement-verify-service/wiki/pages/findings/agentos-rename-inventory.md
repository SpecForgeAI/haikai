# Agent-OS reference inventory (rename blast-radius)

> Catalog of every `agent-os` / `agent_os` / `agentos` / `AgentOS` reference, built
> to scope a proposed **agent-os → haikai** rename. **Verdict up front: this is not a
> safe mechanical rename — it's a rebrand of a third-party framework name + public
> API + on-disk data contract.** See [[#The decision]]. Generated 2026-06-14.

## Scale

- **280 tracked files** reference `agent[-_]os` (excluding session transcripts).
- `.py` token hits: ~**335** `agent-os`, ~**142** `agent_os`, ~**80** `AgentOS`/`agentos`.
- **166 `.md`** files reference it.

## Reference classes (by rename risk)

### 🔴 HIGH RISK — external / data contracts (renaming BREAKS consumers)

| Class | Where | Why it's load-bearing |
|---|---|---|
| **API route paths** | `/api/v1/agent-os/shape-specs`, `/api/v1/agent-os/shape-specs/{company}/{project}`, `/api/v2/agent-os/shape-specs` (`src/api/routes/agent_os.py:46,216,295`) | Public HTTP contract — any client calling these breaks. Needs API versioning, not find-replace. |
| **On-disk SDD layout** | `agent-os/specs/{spec}/spec.md\|tasks.md\|planning/*` (`src/api/packages.py:92-95,157-160`, `recovery.py:129`, `mock_server.py:463`, the orchestrator) | This path is the per-project workspace layout (`workspace/<company>/<project>/agent-os/specs/...`) AND the framework dir. Renaming requires **migrating every existing workspace** + the read/write paths. |
| **`agent-os/`** dir (257 files) | repo root | The Agent-OS framework + all spec docs/sessions. |
| **`agent-os-profiles/`** dir (96 files) | repo root | Runtime workflow profiles loaded via `_agent_os_profiles_path()` + `--add-dir` + `CLAUDE_PROFILES_PATH` env (`src/chat/claude_chat_executor.py`). Renaming breaks executor wiring + the profiles contract. |
| **Framework identity** | everywhere | "Agent-OS" is a real external SDD methodology, **not** the `haikai` iteration suite. Renaming conflates two distinct things. |

### 🟡 MEDIUM — internal Python surface (renamable, wide, import + test churn)

- **Modules (8):** `src/agent_os_crud_models.py`, `agent_os_models.py`, `agent_os_orchestrator.py`, `agent_os_service.py`, `agent_os_shape_spec_models.py`, `agent_os_status_models.py`, `src/api/routes/agent_os.py`, `tests/test_agent_os_orchestrator.py`
- **Classes:** `AgentOSService`, `AgentOSOrchestrator`
- **Functions:** `get_agent_os_service` (`src/api/__init__.py:332`), `_agent_os_profiles_path` (`claude_chat_executor.py:289`)
- ~142 `agent_os` + ~80 `AgentOS` identifier hits across `src/`.

### 🟢 LOW — cosmetic (docs/comments/strings, no contract)

- Docs: `docs/AGENT_OS_{CHANGELOG,CONFIGURATION,CRUD_API}.md`, `docs/TODO_AGENT_OS_FEATURES.md`, `docs/agentos-*-injection.md` (7), + 166 `.md` total.
- Comments / non-contract string literals.

## The decision

A blanket `agent-os → haikai` rename is **NOT recommended**. It would simultaneously:
1. break the public API (`/api/*/agent-os/shape-specs`),
2. break the on-disk SDD layout (`agent-os/specs/`) — orphaning every existing workspace,
3. break the `agent-os-profiles/` + `CLAUDE_PROFILES_PATH` executor wiring,
4. conflate a third-party framework's name with the `haikai` skill suite.

If a rebrand is genuinely intended, it is a **product decision** requiring API versioning + a workspace data-migration, executed in staged units — not a mechanical sweep. A narrower **internal-identifier-only** rename (the 🟡 class, leaving paths/dirs/API untouched) is *possible* but low-value for the churn. Confirm intent before any `haikai:plan` rename campaign is scoped.

Related: [[never-add-framework-patterns-to-ast]] · [[haikai-sdd]]
