# Haikai: What Gets Injected Into Claude During `create-tasks`

## Injection Mechanism

The entry point is:

```
haikai-profiles/default/commands/create-tasks/single-agent/create-tasks.md
```

The `_resolve_template()` method recursively resolves all `{{...}}` template references up to 5 levels deep.

---

## What Gets Compiled Into the System Prompt

The final compiled prompt is structured in two phases:

### Phase 1 — `1-get-spec-requirements.md`

Ensures that `spec.md` or `requirements.md` files exist in the project. If not found, asks the user for the location.

Contains a `{{UNLESS compiled_single_command}}` block (stripped during compilation).

### Phase 2 — `2-create-tasks-list.md`

The core task creation logic. Inlines:

- `{{workflows/implementation/create-tasks-list}}` — the full task list creation workflow
- `{{standards/*}}` — conditionally inlines ALL standards files (inside an `{{UNLESS standards_as_claude_code_skills}}` block)

---

## Workflow: `create-tasks-list.md`

This is the main workflow (201 lines) that gets inlined into Phase 2. It defines 4 core responsibilities:

1. **Analyze spec** — Parse the specification document
2. **Plan execution order** — Determine the logical build sequence
3. **Group tasks by specialization** — Organize into task groups (Database Layer, API Layer, Frontend Components, Testing)
4. **Create tasks list** — Generate the final `tasks.md` file

### Key Constraints

- Limit tests to **2-8 focused tests** per task group during development
- Final test review group can add a maximum of **10 additional tests**
- Run ONLY newly written tests (not entire suite) during development
- Group related tasks by specialization

### Example Task Group Format

The workflow provides an extensive example format with task groups for:
- Database Layer
- API Layer
- Frontend Components
- Testing

---

## Standards Injection

The `{{standards/*}}` reference would expand to inline **every `.md` file** from `haikai-profiles/default/standards/`:

| Category | Files |
|----------|-------|
| **global/** | `coding-style.md`, `conventions.md`, `commenting.md`, `error-handling.md`, `tech-stack.md`, `validation.md` |
| **backend/** | `api.md`, `migrations.md`, `models.md`, `queries.md` |
| **frontend/** | `accessibility.md`, `components.md`, `css.md`, `responsive.md` |
| **testing/** | `test-writing.md` |

This is wrapped in a `{{UNLESS standards_as_claude_code_skills}}` block. When that flag is `true`, the standards are **not inlined** (they're expected to be available as separate Claude Code skills).

---

## Multi-Agent Version

A multi-agent variant also exists at:

```
haikai-profiles/default/commands/create-tasks/multi-agent/create-tasks.md
```

This version uses a **"tasks-list-creator"** subagent (defined in `agents/tasks-list-creator.md`) with tools: Write, Read, Bash, WebFetch. It follows a 3-phase process:
1. Get spec/requirements
2. Delegate task list creation to subagent
3. Inform user of completion

---

## Delivery Paths

### Claude CLI Path (`claude_chat_executor.py`)

The compiled template is passed via the `--add-dir` flag to the Claude CLI as a system prompt.

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

The create-tasks skill flattens a 2-phase prompt plus the 201-line task creation workflow into a single system prompt. Standards files are conditionally included based on the `standards_as_claude_code_skills` flag.
