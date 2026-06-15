# Haikai Skill: /explain-failure

**Author:** Ozzie Belazi
**Date:** 2026-02-14
**Version:** 1.0

## 1. Description

This skill is invoked by the system when the LLM fails to complete a required step after multiple retries. It asks the LLM to reflect on why it was unable to perform the requested action and provide a short, user-facing explanation.

This skill is used internally by the `ClaudeChatExecutor` retry mechanism. It is NOT intended to be invoked directly by the user.

## 2. Usage

This skill is invoked automatically when the retry loop in `ClaudeChatExecutor` exhausts all attempts without the expected skill (e.g., `/ask-questions`) being invoked.

### 2.1. Behavior

When this skill is invoked, you must:

1. Reflect on the conversation so far and identify why you were unable to complete the requested action.
2. Respond with a **single short sentence** explaining the reason in plain, user-friendly language.
3. Do NOT invoke any tools — reply with text only.
4. Do NOT apologize excessively — be direct and factual.

### 2.2. Examples

Good responses:
- "The spec description did not contain enough detail to formulate specific questions."
- "The product context files were missing, so there was insufficient context to ask targeted questions."
- "The feature description was too broad to identify specific areas needing clarification."

Bad responses:
- "I'm so sorry, I was unable to generate questions because..." (too verbose)
- "Error: skill not found" (too technical)

## 3. Rationale

By using a dedicated skill, the failure explanation prompt is managed alongside other Haikai skills rather than being hardcoded in the executor. This makes it easy to iterate on the prompt wording without modifying backend code.
