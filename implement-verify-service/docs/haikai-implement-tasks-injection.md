# Haikai: What Gets Injected Into Claude During `implement-tasks`

## Injection Mechanism

Haikai uses a **template resolution system** with `{{...}}` syntax. The entry point is:

```
haikai-profiles/default/commands/implement-tasks/single-agent/implement-tasks.md
```

The `_resolve_template()` method in `claude_chat_executor.py` (and `api_command_executor.py`) recursively resolves all template references up to 5 levels deep.

### Supported Template Patterns

| Pattern | Description |
|---------|-------------|
| `{{PHASE N: @haikai/commands/path/file.md}}` | Inline a file from the commands directory |
| `{{workflows/specification/file}}` | Inline from the workflows directory |
| `{{standards/global/*}}` | Inline ALL files matching the glob from the standards directory |
| `{{UNLESS flag}}...{{ENDUNLESS flag}}` | Conditional blocks (stripped during compilation) |

---

## What Gets Compiled Into the System Prompt

The final compiled prompt sent to Claude is structured in three phases:

### Phase 1 — `1-determine-tasks.md`

Instructions for determining which task group(s) to implement.

### Phase 2 — `2-implement-tasks.md`

The core implementation instructions. This phase further inlines:

- `{{workflows/implementation/implement-tasks.md}}` — the implementation workflow
- `{{standards/*}}` — **ALL standards files** glob-expanded and inlined

### Phase 3 — `3-verify-implementation.md`

Instructions for producing a final verification report, with its own workflow references.

---

## Standards Injection

The `{{standards/*}}` glob expands to inline **every `.md` file** from `haikai-profiles/default/standards/`, including:

| Category | Files |
|----------|-------|
| **global/** | `coding-style.md`, `conventions.md`, `commenting.md`, `error-handling.md`, `tech-stack.md`, `validation.md` |
| **backend/** | `api.md`, `migrations.md`, `models.md`, `queries.md` |
| **frontend/** | `accessibility.md`, `components.md`, `css.md`, `responsive.md` |
| **testing/** | `test-writing.md` |

This is controlled by an `{{UNLESS standards_as_claude_code_skills}}` block that gets stripped during compilation, meaning the standards are **always inlined**.

---

## Two Delivery Paths

### Claude CLI Path (`claude_chat_executor.py`)

The compiled template is passed via the `--add-dir` flag to the Claude CLI, which sends it as a system prompt.

### Direct API Path (`api_command_executor.py`)

The compiled template is sent directly as system content blocks with ephemeral caching:

```python
system_blocks = [
    {"type": "text", "text": "You are Claude Code...", "cache_control": {"type": "ephemeral"}},
    {"type": "text", "text": compiled_template,       "cache_control": {"type": "ephemeral"}}
]
```

---

## Key Takeaway

The entire multi-phase prompt plus all standards files get **flattened into a single large system prompt**. This means Claude sees the full implementation workflow instructions AND every coding standard in one shot when running `implement-tasks`.
