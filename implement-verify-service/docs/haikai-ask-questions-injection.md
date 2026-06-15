# Haikai: What Gets Injected Into Claude During `ask-questions`

## Overview

The `ask-questions` skill is a **supporting skill** — it is not typically invoked directly by the user but is called by other skills (primarily `shape-spec`) during their execution.

## Entry Point

```
haikai-profiles/default/commands/ask-questions/single-agent/ask-questions.md
```

This is a single file with no phases or template references. It serves as both documentation and the skill definition.

---

## What Gets Injected

The `ask-questions.md` file describes a structured mechanism for asking clarifying questions. When invoked, Claude receives instructions to:

1. Format questions as a markdown list with unique IDs in square brackets
2. Each question gets a unique identifier for tracking

### Question Format

```
/ask-questions
- [unique-id-1] First question text...
- [unique-id-2] Second question text...
```

---

## How It Works (Execution Pipeline)

### 1. Detection (`claude_chat_executor.py`, lines 458-479)

The executor monitors for tool invocations named `"ask-questions"` or `"Skill"` with `skill="ask-questions"`:
- Sets `is_collecting_questions = True`
- Buffers all subsequent content into `ask_questions_content[]`

### 2. Parsing (`claude_chat_executor.py`, lines 918-990)

Function `_parse_questions_from_content()` supports 3 formats:

| Format | Example |
|--------|---------|
| Bracket | `- [id] Question text...` |
| Colon | `- id: Question text...` |
| Numbered | `**1.** Question text...` |

All formats are parsed into JSON: `[{"id": "...", "question": "..."}, ...]`

### 3. Event Emission (`claude_chat_executor.py`, lines 810-819)

After the LLM finishes its response:
- If questions were collected, yields: `{"type": "questions", "questions": questions_buffer}`
- The client receives the structured questions event

### 4. Retry Mechanism (`claude_chat_executor.py`, lines 587-730)

If the skill was expected but NOT invoked (e.g., during a new `shape-spec` session):
- Retries up to **3 times** with an increasingly forceful prompt: `"You MUST now invoke the /ask-questions skill..."`
- If all retries fail, invokes `/explain-failure` skill to ask the LLM why it didn't comply

---

## Where `ask-questions` Gets Called

The primary caller is the `research-spec.md` workflow (used by `shape-spec`):

**Step 3 of research-spec.md:**
- Generate 4-8 targeted, numbered questions
- Must include a visual asset request at the end
- Must include a reusability check at the end
- Invoke `/ask-questions` and STOP

**Step 5 of research-spec.md:**
- Generate follow-up questions if needed (also via `/ask-questions`)

---

## No Standards Injection

The `ask-questions` skill does **not** inline any standards files. It is a lightweight utility skill focused purely on structured question delivery.

---

## No Multi-Agent Version

There is no multi-agent variant of `ask-questions`. It operates as a simple inline skill.

---

## Key Takeaway

The `ask-questions` skill is a lightweight utility that provides structured question formatting and delivery. Its real complexity lives in the `claude_chat_executor.py` parsing and retry logic rather than in the injected prompt content. It acts as a bridge between Claude's natural language output and the client's structured question UI.
