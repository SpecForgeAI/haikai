# Haikai Skill: /ask-questions

**Author:** Ozzie Belazi  
**Date:** 2026-01-28  
**Version:** 1.0

## 1. Description

This skill allows the Implementation LLM (Software Architect) to explicitly ask clarifying questions during the `shape-spec` workflow. It provides a structured mechanism for gathering additional information from the user before proceeding with specification creation.

When this skill is invoked, the questions are parsed and sent to the client application in a structured `questions` event, enabling the client to display them to the user and gather responses.

## 2. Usage

To use this skill, the LLM should invoke it with a list of questions in Markdown format. Each question must have a unique ID in square brackets.

### 2.1. Syntax

```
/ask-questions
- [unique-id-1] First question...
- [unique-id-2] Second question...
- [unique-id-3] Third question...
```

### 2.2. Parameters

- **Questions:** A Markdown list of questions, where each list item is a question with a unique ID in square brackets.

### 2.3. Example

```
/ask-questions
- [c3879034-347e-444d-93c2-e1671b885aab] How should created_at/updated_at be managed—database defaults/triggers or application-managed timestamps?
- [a1b2c3d4-e5f6-7890-1234-567890abcdef] Should we implement soft deletes or hard deletes for user records?
```

## 3. Behavior

- When this skill is invoked, the `ClaudeChatExecutor` will parse the questions from the Markdown list.
- Each question will be converted into a JSON object with `id` and `question` fields.
- The list of questions will be buffered until the LLM has finished its response.
- After the `done` event, a `questions` event will be sent to the client with the structured list of questions.

## 4. Rationale

This skill provides a reliable and structured mechanism for asking questions, which is preferable to parsing natural language from the LLM response. It ensures that questions are always in a predictable format, making it easier for client applications to process and display them.

By using a dedicated skill, we create a clear separation of concerns and make the question-asking process more explicit and robust.
