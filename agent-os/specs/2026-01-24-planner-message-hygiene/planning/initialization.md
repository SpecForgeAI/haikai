# Spec Initialization

## Title
Implement Screen Change 3 — Enforce Planner `message` Hygiene (No Structured Content Duplication)

## Description
Ensure the Planner (Product Owner) LLM's `message` field is a short, high-level progress update only,
and does not duplicate any structured content that belongs in other JSON fields (especially
openQuestions, scope, acceptanceCriteria, assumptions, featureUnderstanding). Prevent verbose or
duplicative planner messages from bloating Team Chat bubbles.

## Scope Includes
- Strengthen Planner system prompt to constrain `message` content
- Add a gateway-side "sanitization" safety net to rewrite `message` when it violates the rule
- Ensure Team Chat uses the sanitized `message` field

## Out of Scope
- Any changes to planner JSON schema fields (beyond existing fields)
- Any UI layout changes
- Any changes to question/table mechanics

## Key Behavior
- `message` must be single-paragraph, short (1-2 sentences), high-level progress summary
- If openQuestions present, message should be like: "I have N questions for you to answer."
- Gateway rewrites message if it contains duplicated structured content

## Date Created
2026-01-24
