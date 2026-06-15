# Haikai: Complete Guide to What Gets Injected Into Claude Per Skill

This document describes everything Haikai injects into Claude's system prompt when each skill is invoked. All skills use the same template resolution system but differ in what content they compile.

---

## Table of Contents

1. [Template Resolution System](#template-resolution-system)
2. [Standards Reference](#standards-reference)
3. [Delivery Paths](#delivery-paths)
4. [Skill: `implement-tasks`](#skill-implement-tasks)
5. [Skill: `create-tasks`](#skill-create-tasks)
6. [Skill: `shape-spec`](#skill-shape-spec)
7. [Skill: `write-spec`](#skill-write-spec)
8. [Skill: `plan-product`](#skill-plan-product)
9. [Skill: `ask-questions`](#skill-ask-questions)
10. [Skill Comparison Matrix](#skill-comparison-matrix)

---

## Template Resolution System

All skills share the same template resolution mechanism, implemented in `_resolve_template()` within `claude_chat_executor.py` (and `api_command_executor.py`). Templates are recursively resolved up to 5 levels deep.

### Supported Template Patterns

| Pattern | Description |
|---------|-------------|
| `{{PHASE N: @haikai/commands/path/file.md}}` | Inline a file from the commands directory |
| `{{workflows/specification/file}}` | Inline from the workflows directory (`.md` appended) |
| `{{standards/global/*}}` | Inline ALL `.md` files matching the glob from the standards directory |
| `{{standards/*}}` | Inline ALL `.md` files from the entire standards directory |
| `{{UNLESS flag}}...{{ENDUNLESS flag}}` | Conditional blocks (stripped during compilation) |

### Conditional Flags

| Flag | Effect When `true` |
|------|-------------------|
| `compiled_single_command` | Strips display confirmation messages |
| `standards_as_claude_code_skills` | Strips inline standards (assumes they're available as separate Claude Code skills) |

---

## Standards Reference

When standards are inlined, they are sourced from `haikai-profiles/default/standards/`. Some skills inline **all** standards, others only **global** standards.

### All Standards (15 files)

| Category | Files | Summary |
|----------|-------|---------|
| **global/** | `coding-style.md` | Naming conventions, DRY, small focused functions, remove dead code |
| | `commenting.md` | Self-documenting code, minimal helpful comments |
| | `conventions.md` | Project structure, documentation, version control |
| | `error-handling.md` | User-friendly messages, fail fast, specific exceptions |
| | `tech-stack.md` | Template for defining framework, database, testing, deployment stack |
| | `validation.md` | Server-side validation, client-side for UX, sanitize input |
| **backend/** | `api.md` | RESTful design, consistent naming, versioning, HTTP status codes |
| | `migrations.md` | Reversible migrations, small focused changes, zero-downtime |
| | `models.md` | Clear naming, timestamps, data integrity, validation at multiple layers |
| | `queries.md` | Prevent SQL injection, avoid N+1, select only needed data |
| **frontend/** | `accessibility.md` | Semantic HTML, keyboard navigation, color contrast, screen reader testing |
| | `components.md` | Single responsibility, reusability, composability, minimal props |
| | `css.md` | Consistent methodology, avoid overriding framework, maintain design system |
| | `responsive.md` | Mobile-first, standard breakpoints, fluid layouts, touch-friendly |
| **testing/** | `test-writing.md` | Write minimal tests during development, test only core user flows, defer edge cases |

---

## Delivery Paths

All skills are delivered to Claude via one of two paths:

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

## Skill: `implement-tasks`

### Entry Point

```
haikai-profiles/default/commands/implement-tasks/single-agent/implement-tasks.md
```

### Phases

| Phase | File | Inlines |
|-------|------|---------|
| 1 | `1-determine-tasks.md` | Instructions for determining which task group(s) to implement |
| 2 | `2-implement-tasks.md` | `{{workflows/implementation/implement-tasks}}` + `{{standards/*}}` (all 15 standards) |
| 3 | `3-verify-implementation.md` | Instructions for producing a final verification report |

### Standards Scope

**All standards** (15 files) — global, backend, frontend, and testing.

Controlled by `{{UNLESS standards_as_claude_code_skills}}` block that gets stripped during compilation, meaning the standards are **always inlined**.

### Multi-Agent Version

Exists at `commands/implement-tasks/multi-agent/implement-tasks.md`.

### Key Takeaway

The entire multi-phase prompt plus all standards files get **flattened into a single large system prompt**. Claude sees the full implementation workflow instructions AND every coding standard in one shot.

---

## Skill: `create-tasks`

### Entry Point

```
haikai-profiles/default/commands/create-tasks/single-agent/create-tasks.md
```

### Phases

| Phase | File | Inlines |
|-------|------|---------|
| 1 | `1-get-spec-requirements.md` | Ensures `spec.md` or `requirements.md` exist; asks user for location if not found |
| 2 | `2-create-tasks-list.md` | `{{workflows/implementation/create-tasks-list}}` + `{{standards/*}}` (conditionally) |

### Workflow: `create-tasks-list.md`

This is the main workflow (201 lines) that gets inlined into Phase 2. It defines 4 core responsibilities:

1. **Analyze spec** — Parse the specification document
2. **Plan execution order** — Determine the logical build sequence
3. **Group tasks by specialization** — Organize into task groups (Database Layer, API Layer, Frontend Components, Testing)
4. **Create tasks list** — Generate the final `tasks.md` file

#### Key Constraints

- Limit tests to **2-8 focused tests** per task group during development
- Final test review group can add a maximum of **10 additional tests**
- Run ONLY newly written tests (not entire suite) during development
- Group related tasks by specialization

### Standards Scope

**All standards** (15 files) — conditionally included via `{{UNLESS standards_as_claude_code_skills}}`.

### Multi-Agent Version

Exists at `commands/create-tasks/multi-agent/create-tasks.md`. Uses a **"tasks-list-creator"** subagent with tools: Write, Read, Bash, WebFetch.

### Key Takeaway

Flattens a 2-phase prompt plus the 201-line task creation workflow into a single system prompt. Standards files are conditionally included based on the `standards_as_claude_code_skills` flag.

---

## Skill: `shape-spec`

### Entry Point

```
haikai-profiles/default/commands/shape-spec/single-agent/shape-spec.md
```

Critical constraint: Phase 2 MUST ask clarifying questions using `/ask-questions` and then STOP before proceeding.

### Phases

| Phase | File | Inlines |
|-------|------|---------|
| 1 | `1-initialize-spec.md` | `{{workflows/specification/initialize-spec}}` |
| 2 | `2-shape-spec.md` | `{{workflows/specification/research-spec}}` + `{{standards/global/*}}` (conditionally) |

### Workflow: `initialize-spec.md`

Creates the spec folder structure:
- `haikai/specs/[YYYY-MM-DD-spec-name]/planning/`
- `haikai/specs/[YYYY-MM-DD-spec-name]/planning/visuals/`
- `haikai/specs/[YYYY-MM-DD-spec-name]/implementation/`

No further template references — pure content.

### Workflow: `research-spec.md`

The core workflow that drives the shape-spec process. It has 7 main steps:

| Step | Action |
|------|--------|
| 1 | Read initial idea from `initialization.md` |
| 2 | Analyze product context (`mission.md`, `roadmap.md`, `tech-stack.md`) |
| 3 | **(MANDATORY)** Generate 4-8 questions, invoke `/ask-questions`, then STOP |
| 4 | Process answers + **mandatory** bash check for visual files |
| 5 | Generate follow-up questions if needed (also via `/ask-questions`) |
| 6 | Save requirements to `[spec-path]/planning/requirements.md` |
| 7 | Output completion message |

#### Question Format (Step 3)

```
/ask-questions
- [uuid-1] Based on your idea for [spec name], I assume...
- [uuid-2] I'm thinking [specific approach]...
- [uuid-reuse] Are there existing features...
- [uuid-visual] Do you have any design mockups...
```

#### Requirements Document Structure (Step 6)

- Initial Description
- Requirements Discussion (Q&A)
- Existing Code to Reference
- Follow-up Questions
- Visual Assets
- Requirements Summary

### Standards Scope

**Global standards only** (6 files) — not backend, frontend, or testing.

### Multi-Agent Version

Exists at `commands/shape-spec/multi-agent/shape-spec.md`. Uses subagents: **spec-initializer** (Phase 1) and **spec-shaper** (Phase 2).

### Key Takeaway

Compiles a 2-phase prompt that creates a spec folder structure, then drives a structured Q&A workflow via `/ask-questions`. The research-spec workflow mandates asking questions before writing requirements and includes mandatory visual file checks.

---

## Skill: `write-spec`

### Entry Point

```
haikai-profiles/default/commands/write-spec/single-agent/write-spec.md
```

### Phases

Single-phase command (no numbered sub-phases). The main workflow is inlined directly.

### Workflow: `write-spec.md`

| Step | Action |
|------|--------|
| 1 | **Analyze Requirements** — Read `planning/requirements.md`, check for visual assets |
| 2 | **Search for Reusable Code** — Find existing patterns, UI components, models, services, API patterns |
| 3 | **Create Core Specification** — Write `spec.md` following a strict template |

#### Spec Template Structure (Step 3)

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

### Related Workflows (Not Directly Inlined)

| Workflow | Used By | Purpose |
|----------|---------|---------|
| `initialize-spec.md` | `/shape-spec` Phase 1 | Creates dated folder structure |
| `research-spec.md` | `/shape-spec` Phase 2 | Gathers requirements via Q&A |
| `verify-spec.md` | Post-spec | Verifies accuracy, structure, visual alignment, reusability |

### Standards Scope

**All standards** (15 files) — conditionally included via `{{UNLESS standards_as_claude_code_skills}}`.

### Multi-Agent Version

Exists at `commands/write-spec/multi-agent/write-spec.md`. Delegates to a **"spec-writer"** subagent.

### Key Takeaway

Compiles a focused prompt that instructs Claude to analyze existing requirements (from `/shape-spec`), search for reusable code, and produce a structured `spec.md`. It does NOT write code — only specification documents.

---

## Skill: `plan-product`

### Entry Point

```
haikai-profiles/default/commands/plan-product/single-agent/plan-product.md
```

This orchestrates a **4-phase** sequential process — the most phases of any Haikai skill.

### Phases

| Phase | File | Inlines |
|-------|------|---------|
| 1 | `1-product-concept.md` | `{{workflows/planning/gather-product-info}}` + `{{standards/global/*}}` |
| 2 | `2-create-mission.md` | `{{workflows/planning/create-product-mission}}` + `{{standards/global/*}}` |
| 3 | `3-create-roadmap.md` | `{{workflows/planning/create-product-roadmap}}` + `{{standards/global/*}}` |
| 4 | `4-create-tech-stack.md` | `{{workflows/planning/create-product-tech-stack}}` + `{{standards/global/*}}` |

### Workflow: `gather-product-info.md`

Collects comprehensive product information from the user:
- **Product Idea** — core concept and purpose
- **Key Features** — minimum 3 with descriptions
- **Target Users** — at least 1 user segment with use cases
- **Tech stack confirmation**

Includes a bash script to check if `haikai/product/` folder already exists.

### Workflow: `create-product-mission.md`

Creates `haikai/product/mission.md` with this structure:
- **Pitch** — product name, type, target users, value proposition
- **Users** — primary customers, user personas with roles/context/pain points/goals
- **The Problem** — problem description, quantifiable impact, solution
- **Differentiators** — competitive advantages, measurable benefits
- **Key Features** — Core, Collaboration, Advanced categories

Constraints: Focus on user benefits (not technical details), keep it concise and scannable.

### Workflow: `create-product-roadmap.md`

Generates `haikai/product/roadmap.md` with an ordered feature checklist.

**Roadmap Item Format:**
```markdown
1. [ ] [FEATURE_NAME] — [1-2 SENTENCE DESCRIPTION] `[EFFORT]`
```

**Effort Scale:**

| Label | Duration |
|-------|----------|
| XS | 1 day |
| S | 2-3 days |
| M | 1 week |
| L | 2 weeks |
| XL | 3+ weeks |

Does NOT include tasks for initializing the codebase. Each item represents an end-to-end (frontend + backend) functional feature.

### Workflow: `create-product-tech-stack.md`

Creates `haikai/product/tech-stack.md` via a three-step process:
1. **Note User Input** — user-provided tech stack info takes precedence
2. **Gather Default Tech Stack** — read from user standards, `claude.md`, `agents.md`
3. **Create Document** — reconcile all sources into a final tech stack list

### Output Files

| File | Content |
|------|---------|
| `haikai/product/mission.md` | Product mission, users, problem, differentiators, features |
| `haikai/product/roadmap.md` | Ordered feature checklist with effort estimates |
| `haikai/product/tech-stack.md` | Technology stack choices |

### Standards Scope

**Global standards only** (6 files) — re-inlined in each phase (when enabled).

### Multi-Agent Version

Exists at `commands/plan-product/multi-agent/plan-product.md`. Uses a **"product-planner"** subagent.

### Key Takeaway

The most phase-heavy skill (4 phases). Compiles a comprehensive prompt that walks Claude through gathering product info, then sequentially creating mission, roadmap, and tech stack documents. Each phase re-inlines the global standards (when enabled), resulting in a large compiled prompt.

---

## Skill: `ask-questions`

### Overview

The `ask-questions` skill is a **supporting skill** — it is not typically invoked directly by the user but is called by other skills (primarily `shape-spec`) during their execution.

### Entry Point

```
haikai-profiles/default/commands/ask-questions/single-agent/ask-questions.md
```

This is a single file with no phases or template references.

### What Gets Injected

Instructions to format questions as a markdown list with unique IDs:

```
/ask-questions
- [unique-id-1] First question text...
- [unique-id-2] Second question text...
```

### Execution Pipeline

#### 1. Detection (`claude_chat_executor.py`)

The executor monitors for tool invocations named `"ask-questions"` or `"Skill"` with `skill="ask-questions"`:
- Sets `is_collecting_questions = True`
- Buffers all subsequent content into `ask_questions_content[]`

#### 2. Parsing (`claude_chat_executor.py`)

Function `_parse_questions_from_content()` supports 3 formats:

| Format | Example |
|--------|---------|
| Bracket | `- [id] Question text...` |
| Colon | `- id: Question text...` |
| Numbered | `**1.** Question text...` |

All formats are parsed into JSON: `[{"id": "...", "question": "..."}, ...]`

#### 3. Event Emission

After the LLM finishes its response:
- If questions were collected, yields: `{"type": "questions", "questions": questions_buffer}`
- The client receives the structured questions event

#### 4. Retry Mechanism

If the skill was expected but NOT invoked (e.g., during a new `shape-spec` session):
- Retries up to **3 times** with an increasingly forceful prompt
- If all retries fail, invokes `/explain-failure` skill

### Where `ask-questions` Gets Called

| Caller | Step | Action |
|--------|------|--------|
| `research-spec.md` | Step 3 | Generate 4-8 questions, invoke `/ask-questions`, STOP |
| `research-spec.md` | Step 5 | Generate follow-up questions if needed |

### Standards Scope

**None** — no standards files are inlined.

### No Multi-Agent Version

There is no multi-agent variant. It operates as a simple inline skill.

### Key Takeaway

A lightweight utility that provides structured question formatting and delivery. Its real complexity lives in the `claude_chat_executor.py` parsing and retry logic rather than in the injected prompt content. Acts as a bridge between Claude's natural language output and the client's structured question UI.

---

## Skill Comparison Matrix

| Skill | Phases | Standards Scope | Workflows Inlined | Multi-Agent | Output |
|-------|--------|----------------|-------------------|-------------|--------|
| `implement-tasks` | 3 | All (15 files) | `implement-tasks` | Yes | Code changes |
| `create-tasks` | 2 | All (15 files, conditional) | `create-tasks-list` | Yes | `tasks.md` |
| `shape-spec` | 2 | Global only (6 files, conditional) | `initialize-spec`, `research-spec` | Yes | Folder structure + `requirements.md` |
| `write-spec` | 1 | All (15 files, conditional) | `write-spec` | Yes | `spec.md` |
| `plan-product` | 4 | Global only (6 files, conditional, per-phase) | `gather-product-info`, `create-product-mission`, `create-product-roadmap`, `create-product-tech-stack` | Yes | `mission.md`, `roadmap.md`, `tech-stack.md` |
| `ask-questions` | 0 | None | None | No | Structured questions event |

### Typical Workflow Order

```
plan-product → shape-spec → write-spec → create-tasks → implement-tasks
                    ↑
              ask-questions (supporting)
```

### Note on `keybindings-help`

`keybindings-help` is a **built-in Claude Code CLI skill**, not an Haikai skill. It has no files in `haikai-profiles/` and nothing custom gets injected by this system.
