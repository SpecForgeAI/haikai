# Haikai: What Gets Injected Into Claude During `write-spec`

## Injection Mechanism

The entry point is:

```
haikai-profiles/default/commands/write-spec/single-agent/write-spec.md
```

This file contains:
- A reference to `{{workflows/specification/write-spec}}` which gets expanded
- A display confirmation message for the user
- A conditional `{{UNLESS standards_as_claude_code_skills}}` section that inlines all standards via `{{standards/*}}`

---

## What Gets Compiled Into the System Prompt

The write-spec skill is a single-phase command (no numbered sub-phases). The main workflow is inlined directly.

### Workflow: `write-spec.md`

**File:** `haikai-profiles/default/workflows/specification/write-spec.md`

This workflow has 3 steps:

#### Step 1: Analyze Requirements and Context
- Read `haikai/specs/[current-spec]/planning/requirements.md`
- Check for visual assets in `planning/visuals/`
- Parse the user's feature description, requirements, visual mockups, constraints, and out-of-scope items

#### Step 2: Search for Reusable Code
- Search the codebase for existing patterns and components
- Find similar features, UI components, models, services, API patterns
- Document findings for use in the specification

#### Step 3: Create Core Specification
- Write to `haikai/specs/[current-spec]/spec.md`
- Follow a strict template structure:
  - **Goal** (1-2 sentences)
  - **User Stories** (max 3)
  - **Specific Requirements** (up to 10, each with up to 8 sub-bullets)
  - **Visual Design** (references to planning/visuals files)
  - **Existing Code to Leverage** (up to 5 entries)
  - **Out of Scope** (up to 10 items)

#### Important Constraints
- Do NOT write actual code
- Keep each section short
- Do NOT deviate from the template
- Always search for reusable code first

---

## Standards Injection

The `{{standards/*}}` reference expands to inline **every `.md` file** from `haikai-profiles/default/standards/`:

| Category | Files |
|----------|-------|
| **global/** | `coding-style.md`, `conventions.md`, `commenting.md`, `error-handling.md`, `tech-stack.md`, `validation.md` |
| **backend/** | `api.md`, `migrations.md`, `models.md`, `queries.md` |
| **frontend/** | `accessibility.md`, `components.md`, `css.md`, `responsive.md` |
| **testing/** | `test-writing.md` |

This is wrapped in a `{{UNLESS standards_as_claude_code_skills}}` block. When that flag is `true`, the standards are **not inlined**.

---

## Related Workflows (Referenced But Not Directly Inlined)

These workflows are part of the broader spec lifecycle but are NOT inlined into write-spec:

### `initialize-spec.md`
- Runs during `/shape-spec` (Phase 1)
- Creates the dated folder structure

### `research-spec.md`
- Runs during `/shape-spec` (Phase 2)
- Gathers requirements via Q&A

### `verify-spec.md`
- Verifies requirements accuracy against Q&A
- Checks structural integrity
- Analyzes visual alignment
- Validates reusability
- Ensures limited testing approach (2-8 tests per task group)
- Creates a verification report

---

## Multi-Agent Version

A multi-agent variant exists at:

```
haikai-profiles/default/commands/write-spec/multi-agent/write-spec.md
```

This version delegates spec writing to a **"spec-writer"** subagent.

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

The write-spec skill compiles a focused prompt that instructs Claude to analyze existing requirements (gathered during `/shape-spec`), search for reusable code in the codebase, and produce a structured `spec.md` file following a strict template. It does NOT write code — only specification documents.
