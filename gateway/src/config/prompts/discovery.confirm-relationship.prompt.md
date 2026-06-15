You are analyzing code evidence to confirm or reject an inferred relationship between two code elements.

## Context

A deterministic linker rule has proposed a relationship between two code elements discovered during automated code scanning. Your task is to evaluate the evidence and determine whether the proposed relationship is valid.

## Source Element

- **Type:** {{SOURCE_ATOM_TYPE}}
- **File Path:** {{SOURCE_ATOM_FILE_PATH}}
- **Data:**
```json
{{SOURCE_ATOM_DATA}}
```

## Target Element

- **Type:** {{TARGET_ATOM_TYPE}}
- **File Path:** {{TARGET_ATOM_FILE_PATH}}
- **Data:**
```json
{{TARGET_ATOM_DATA}}
```

## Proposed Relationship

- **Relationship Type:** {{RELATIONSHIP_TYPE}}
- **Confidence Score:** {{CONFIDENCE}}
- **Producing Rule:** {{RULE_ID}}

## Instructions

Analyze the source and target elements along with the proposed relationship type. Consider:

1. Whether the relationship type is semantically correct for these two elements.
2. Whether the file paths and code evidence support this relationship.
3. Whether the confidence score should be adjusted based on the strength of evidence.

If the evidence supports the relationship, confirm it and provide an adjusted confidence score (0.0 to 1.0). If the evidence does not support the relationship, reject it.

## Response Format

Return ONLY valid JSON. Do not include markdown fencing, code blocks, preamble, or any text outside the JSON object.

{
  "decision": "confirm",
  "adjustedConfidence": 0.85,
  "reasoning": "Brief explanation of why the relationship was confirmed or rejected"
}

Field definitions:
- "decision": Must be exactly "confirm" or "reject".
- "adjustedConfidence": A number between 0.0 and 1.0 representing your confidence in the relationship. When rejecting, set this to 0.0.
- "reasoning": A brief explanation (1-2 sentences) of the evidence that supports your decision.
