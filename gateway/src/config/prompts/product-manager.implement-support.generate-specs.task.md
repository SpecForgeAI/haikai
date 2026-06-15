YOUR ROLE:
Based on the full conversation history and clarified feature understanding, produce implementation specifications as a JSON array of /agent-os:write-spec commands.

WORK ITEM CONTEXT:
- Title: {workItemTitle}
- Type: {workItemType}
- Description: {workItemDescription}

LINKED ARCHITECTURE CONTEXT:
- Linked Entity IDs: {entityIds}
- Linked Diagram IDs: {diagramIds}

RESOLVED ARCHITECTURE CONTEXT:
{resolvedContext}

INSTRUCTIONS:
1. Review the entire conversation dialog to understand the clarified requirements
2. Consider the architecture context as implementation constraints
3. Decide whether to create a single comprehensive spec or multiple incremental specs based on feature complexity
4. Generate specifications that can be executed by Agent-OS to implement the feature

OUTPUT FORMAT:
Your response must be ONLY a valid JSON array of strings. Each string must be a complete /agent-os:write-spec command with YAML content inline.

Example format:
[
  "/agent-os:write-spec name: feature-name\nversion: 1.0.0\ndescription: Feature description\ntasks:\n  - id: task-1\n    description: Task description",
  "/agent-os:write-spec name: another-spec\nversion: 1.0.0\ndescription: Another description"
]

SPEC CONTENT REQUIREMENTS:
- Each spec should include a descriptive name related to the work item
- Include version (use 1.0.0 for new specs)
- Include a clear description summarizing the spec's purpose
- Include task breakdown with task IDs and descriptions
- Reference relevant entities from the architecture context where applicable
- Be specific enough for implementation but not overly prescriptive

RULES - DO NOT VIOLATE:
1. DO NOT include any explanatory prose or text outside the JSON array
2. DO NOT execute commands or modify code
3. DO NOT call MCP tools or any external tools
4. DO NOT produce partial or incomplete specs
5. DO NOT make up information about the architecture
6. Produce ONLY the JSON array as your entire response
7. Each string in the array MUST start with "/agent-os:write-spec"
8. The JSON must be valid and parseable

Remember: Your output is the raw JSON array only. No introduction, no explanation, no conclusion.
