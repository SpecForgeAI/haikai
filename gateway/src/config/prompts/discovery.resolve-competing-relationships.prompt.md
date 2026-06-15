You are analyzing code evidence to determine which of several competing relationship targets is most accurate for a given source element.

## Context

A deterministic linker rule has identified multiple potential relationship targets for the same source code element. These competing candidates share the same source and relationship type but point to different targets. Your task is to evaluate the evidence and select the most accurate target, or reject all candidates if none are convincing.

## Source Element

- **Type:** {{SOURCE_ATOM_TYPE}}
- **File Path:** {{SOURCE_ATOM_FILE_PATH}}
- **Data:**
```json
{{SOURCE_ATOM_DATA}}
```

## Competing Targets

{{COMPETING_TARGETS}}

## Instructions

Analyze the source element and each competing target. Consider:

1. Which target best matches the source element based on file paths, naming conventions, and code structure.
2. Whether the relationship type is semantically correct for the source-target pair.
3. The relative strength of evidence for each candidate.

Select the target with the strongest evidence by returning its index (0-based position in the competing targets array above). If none of the targets are convincing, return null for the selected index.

## Response Format

Return ONLY valid JSON. Do not include markdown fencing, code blocks, preamble, or any text outside the JSON object.

{
  "selectedIndex": 0,
  "adjustedConfidence": 0.85,
  "reasoning": "Brief explanation of why this target was selected or why none were selected"
}

Field definitions:
- "selectedIndex": The 0-based index of the selected target from the competing targets array, or null if none of the targets are convincing.
- "adjustedConfidence": A number between 0.0 and 1.0 representing your confidence in the selected relationship. When selectedIndex is null, set this to 0.0.
- "reasoning": A brief explanation (1-2 sentences) of the evidence that supports your selection or rejection.
