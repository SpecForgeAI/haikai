# Haikai: What Gets Injected Into Claude During `shape-spec`

## Injection Mechanism

The entry point is:

```
haikai-profiles/default/commands/shape-spec/single-agent/shape-spec.md
```

The main file orchestrates a multi-phase process with a critical constraint: Phase 2 MUST ask clarifying questions using `/ask-questions` and then STOP before proceeding.

---

## What Gets Compiled Into the System Prompt

### Phase 1 — `1-initialize-spec.md`

Inlines the workflow: `{{workflows/specification/initialize-spec}}`

**Purpose:** Creates the spec folder structure:
- `haikai/specs/[YYYY-MM-DD-spec-name]/planning/`
- `haikai/specs/[YYYY-MM-DD-spec-name]/planning/visuals/`
- `haikai/specs/[YYYY-MM-DD-spec-name]/implementation/`

Contains a `{{UNLESS compiled_single_command}}` block for a display confirmation message (stripped during compilation).

### Phase 2 — `2-shape-spec.md`

Inlines two things:
- `{{workflows/specification/research-spec}}` — the core research and Q&A workflow
- `{{standards/global/*}}` — ALL global standards files (conditionally, inside `{{UNLESS standards_as_claude_code_skills}}`)

---

## Workflow: `initialize-spec.md`

Responsibilities:
1. Get the feature description from user or roadmap
2. Create a dated spec folder using kebab-case naming (`YYYY-MM-DD-spec-name`)
3. Create the folder structure with `planning/`, `planning/visuals/`, and `implementation/` subdirectories
4. Output confirmation to the user

No further template references — pure content.

---

## Workflow: `research-spec.md`

This is the core workflow that drives the shape-spec process. It has 7 main steps:

### Step 1: Read Initial Idea
Read the initial idea from `initialization.md` in the spec's planning folder.

### Step 2: Analyze Product Context
Analyze existing product context files: `mission.md`, `roadmap.md`, `tech-stack.md`.

### Step 3: Generate & Ask Questions (MANDATORY)
- Generate **4-8 targeted, numbered** clarifying questions
- Must include a **visual asset request** at the end
- Must include a **reusability check** at the end
- **OUTPUT format:** Invoke `/ask-questions` skill with unique IDs:

```
/ask-questions
- [uuid-1] Based on your idea for [spec name], I assume...
- [uuid-2] I'm thinking [specific approach]...
- [uuid-reuse] Are there existing features...
- [uuid-visual] Do you have any design mockups...
```

- Then **STOP and wait** for user response

### Step 4: Process Answers
- Process the user's answers
- **MANDATORY** bash check for visual files:

```bash
ls -la [spec-path]/planning/visuals/ | grep -E '\.(png|jpg|jpeg|gif|svg|pdf)$' || echo "No visual files found"
```

### Step 5: Follow-up Questions (if needed)
Generate follow-up questions based on:
- Visual-triggered follow-ups (lofi indicators, missing features)
- Reusability follow-ups
- User's answers-triggered follow-ups

### Step 6: Save Requirements
Save complete requirements to `[spec-path]/planning/requirements.md` with this structure:
- Initial Description
- Requirements Discussion (Q&A)
- Existing Code to Reference
- Follow-up Questions
- Visual Assets
- Requirements Summary

### Step 7: Output Completion
Display completion message to the user.

---

## Standards Injection

When `{{standards/global/*}}` is expanded (only if `standards_as_claude_code_skills=false`), these 6 files are inlined:

| File | Content |
|------|---------|
| `coding-style.md` | Naming conventions, DRY, small focused functions, remove dead code |
| `commenting.md` | Self-documenting code, minimal helpful comments |
| `conventions.md` | Project structure, documentation, version control |
| `error-handling.md` | User-friendly messages, fail fast, specific exceptions |
| `tech-stack.md` | Template for defining framework, database, testing, deployment stack |
| `validation.md` | Server-side validation, client-side for UX, sanitize input |

Note: Only **global** standards are injected for shape-spec (not backend, frontend, or testing).

---

## Supporting Skill: `ask-questions`

The shape-spec workflow depends heavily on the `/ask-questions` skill:

**File:** `haikai-profiles/default/commands/ask-questions/single-agent/ask-questions.md`

- Parses questions from markdown list format with unique IDs
- Converts to JSON: `[{"id": "...", "question": "..."}, ...]`
- Buffers until LLM finishes, then sends as `questions` event to client
- Supports 3 parsing formats: bracket `[id]`, colon `id:`, and numbered `**1.**`

### Retry Mechanism

In `claude_chat_executor.py`, if `/ask-questions` is NOT invoked in a new session:
- Retries up to **3 times** with forceful prompt
- If all retries fail, invokes `/explain-failure` skill

---

## Multi-Agent Version

A multi-agent variant exists at:

```
haikai-profiles/default/commands/shape-spec/multi-agent/shape-spec.md
```

Uses subagents:
- **spec-initializer** for Phase 1
- **spec-shaper** for Phase 2
- Orchestrator relays questions between spec-shaper and user

---

## Key Takeaway

The shape-spec skill compiles a 2-phase prompt that creates a spec folder structure, then drives a structured Q&A workflow via the `/ask-questions` skill. The research-spec workflow is the heart of the process — it mandates asking questions before writing requirements and includes mandatory visual file checks.
