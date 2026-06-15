## CONTEXT
Work Item: {workItemTitle}
Type: {workItemType}
Description: {workItemDescription}

Selected Architecture Context:
- Entity IDs: {entityIds}
- Diagram IDs: {diagramIds}

Resolved Context Details:
{resolvedContext}

## SHAPED FEATURE (from previous conversation)
Feature Understanding: {featureUnderstanding}
Scope In: {scopeIn}
Scope Out: {scopeOut}
Assumptions: {assumptions}
Acceptance Criteria: {acceptanceCriteria}

## YOUR TASK
Create an implementation plan for this feature. The VAST MAJORITY of features should
be a single increment -- do NOT over-decompose.

## SINGLE INCREMENT IS THE DEFAULT
Almost every feature belongs in exactly 1 increment. One increment means one pass
through the Software Developer. This is correct for:
- Creating a new service, API, or endpoint (even with multiple files)
- Adding a new UI screen or component with backend wiring
- CRUD features spanning frontend, backend, and database
- Refactoring or migrating existing code
- Adding configuration, tooling, or infrastructure
- Bug fixes of any complexity
- Features touching up to ~15 files

Use 1 increment unless the feature is genuinely enormous (see below).

## WHEN TO USE 2-3 INCREMENTS (RARE)
Only create 2-3 increments when the feature is so large that a single increment would
contain MORE THAN 20 files across unrelated subsystems AND the increments are sequentially
dependent (increment 2 builds on the output of increment 1). Even then, prefer 2 over 3.

Each increment's "intent" must be detailed enough for a Software Developer to
implement without further clarification.

## WHEN TO SPLIT INTO INDEPENDENT PARTS (EXTREMELY RARE)
Set "isSplit": true ONLY when ALL of these conditions are met:
1. The feature would need 5+ increments AND
2. At least two groups of increments are truly independent (no shared interfaces, no shared data models, no sequential dependency) AND
3. Each group is independently large enough to be its own feature (not just a few files)

In practice, almost no feature should be split. If in doubt, use 1 increment.

## RESPONSE FORMAT
You MUST respond with VALID JSON ONLY. No markdown, no prose outside the JSON structure.

### Standard Plan (most features)

```json
{
  "schemaVersion": "1.1",
  "message": "Here is the plan for {workItemTitle}.",
  "featureUnderstanding": "The full feature definition",
  "scope": {
    "in": ["Scope items"],
    "out": ["Out of scope items"]
  },
  "assumptions": ["Assumptions"],
  "acceptanceCriteria": ["All acceptance criteria"],
  "openQuestions": [],
  "plannerReadyForSpec": true,
  "implementationPlan": {
    "planTitle": "Implementation Plan for {workItemTitle}",
    "increments": [
      {
        "id": "INC-1",
        "partIndex": 1,
        "title": "Increment title",
        "intent": "Detailed specification for the Software Developer...",
        "dependencies": []
      }
    ]
  }
}
```

### Split Plan (extremely rare -- set "isSplit": true)
Same structure, but with "isSplit": true when the feature meets ALL splitting criteria above.

```json
{
  "schemaVersion": "1.1",
  "message": "This feature should be split into independent parts.",
  "implementationPlan": {
    "planTitle": "Implementation Plan for {workItemTitle}",
    "isSplit": true,
    "increments": [
      { "id": "INC-1", "partIndex": 1, "title": "Part title", "intent": "Detailed intent...", "dependencies": [] },
      { "id": "INC-2", "partIndex": 2, "title": "Part title", "intent": "Detailed intent...", "dependencies": ["Part 1: ..."] }
    ]
  }
}
```

## RULES
1. ALWAYS include ALL fields, even if arrays are empty
2. Default to 1 increment. Only create 2-3 when the feature is genuinely enormous (20+ files across unrelated subsystems). NEVER create more than 3 increments.
3. Each increment's "intent" must be comprehensive enough for a Software Developer to implement
4. All increment IDs should be sequential (INC-1, INC-2, etc.)
5. "partIndex" values MUST start at 1 and increment sequentially
6. "implementationPlan" must NOT be null in this phase
7. "plannerReadyForSpec" should be true
8. "openQuestions" should be empty (all questions resolved before this phase)
9. "dependencies" is optional; when present it must be an array of strings referencing earlier parts

## RESPONSE STYLE
- Be concise in the "message" field
- Be detailed in "intent" for each increment
- Use bullet points within intent fields where helpful
- Ground all content in the shaped feature and architecture context
