# Specification: Implement Context Resolution - Iteration 3

## Goal
Enable the OpenAI Planner in implement_feature mode to receive resolved, structured details about architecture entities and diagrams linked to the selected work item, rather than only raw IDs, supporting more grounded exploratory discussions in steps 1a-1e without generating specs.

## User Stories
- As a Product Owner in the Implement screen, I want the AI assistant to understand the actual names and roles of my linked architecture entities so that it can ask relevant clarifying questions about my feature.
- As a Developer, I want the assistant to reference specific entity names and diagram titles when discussing implementation context so that our conversation is grounded in the actual architecture model.

## Specific Requirements

**Backend Resolution Service - ImplementContextResolutionService**
- Create a new service class in `architecture-model-service/src/main/java/.../service/` following patterns from WorkItemImplementContextService.java
- Accept projectId (String), selectedEntityIds (List of String), and selectedDiagramIds (List of String)
- Parse entity IDs in format "entityType::entityId" to extract the entity type and ID
- Query the appropriate entity repository based on the parsed entity type (services, classes, methods, interfaces, applications, etc.)
- Return a ResolvedImplementContextDto containing compact summaries for each resolved entity and diagram
- Omit any IDs that cannot be resolved (deleted entities/diagrams) gracefully without error
- Log a debug message for any unresolved IDs for troubleshooting

**Backend Resolution DTO - ResolvedImplementContextDto**
- Create DTO record in `model/dto/` containing: resolvedEntities (List of ResolvedEntitySummary), resolvedDiagrams (List of ResolvedDiagramSummary)
- ResolvedEntitySummary fields: id, name, entityType (service/class/method/interface/application/etc.), category (application/business/data), relevantFields (Map of key-value pairs like namespace, domain, applicationId)
- ResolvedDiagramSummary fields: id, name, diagramType (General/Sequence/ER/Activity/State/UI_Workflow/UI_SCREEN), referencedEntityIds (List of String from diagram nodes)
- Use @JsonProperty annotations with snake_case for API serialization consistency
- Keep payloads compact; include only fields meaningful for LLM reasoning

**Backend REST Endpoint - ImplementContextResolutionController**
- Create POST `/api/projects/{projectId}/implement-context/resolve` endpoint
- Request body DTO: ImplementContextResolveRequestDto with selectedEntityIds (List of String), selectedDiagramIds (List of String)
- Response body: ResolvedImplementContextDto
- Follow error handling patterns from existing controllers (IllegalArgumentException for validation, ResourceNotFoundException for missing project)
- Use @RequiredArgsConstructor for dependency injection and @Slf4j for logging

**Backend Entity Type Routing Logic**
- Parse "entityType::entityId" format where entityType maps to repository/collection name
- Support entity types: services, classes, methods, interfaces, applications, appComponents, endpoints, businessProcesses, businessPoints, logicalDataEntities, physicalDataEntities, uiScreens
- For each entity type, map to the corresponding repository to fetch by ID
- Return null for unknown entity types or IDs not found; filter out nulls from result
- Extract relevant fields based on entity type (e.g., namespace for classes, applicationId for services)

**Backend Diagram Resolution Logic**
- Query DiagramRepository to find diagram by ID within the model file
- Extract diagramType from the diagram entity
- Scan diagramNodes to collect referenced entity IDs (from entityId field on each node)
- Return null for diagram IDs not found; filter out nulls from result
- The model file is determined by projectId (filename) passed in the request

**Gateway Context Enrichment - chat.ts Route**
- When context.mode === 'implement_feature', extract entityIds and diagramIds from context.architectureContext
- Call architecture-model-service POST `/api/projects/{projectId}/implement-context/resolve` with the IDs
- Use projectId from context.filename (following existing patterns)
- Handle errors gracefully; if resolution fails, log warning and proceed with original IDs only
- Store the resolved context in a local variable for prompt injection

**Gateway Resolved Context Injection**
- Pass the ResolvedImplementContextDto to buildImplementPlannerPrompt function
- Update buildImplementPlannerPrompt in promptBuilder.ts to accept optional resolved context parameter
- If resolved context is present, format it as a structured JSON block in the system prompt
- Place resolved context after the "LINKED ARCHITECTURE CONTEXT" section, before "CONVERSATION PROCESS"
- Format as "RESOLVED ARCHITECTURE CONTEXT:" followed by a concise JSON representation

**Gateway System Prompt Updates**
- Modify IMPLEMENT_PLANNER_PROMPT_TEMPLATE to include placeholder for resolved context: {resolvedContext}
- Update the prompt text to instruct the model to use entity names and diagram titles from resolved context
- Add rule: "Reference entities by their names from the resolved context, not by raw IDs"
- Add rule: "Do not invent entities or capabilities that are not present in the resolved context"
- Keep the existing step 1a-1e process and prohibitions intact

**Gateway Backend API Client**
- Create a helper function in gateway/src/services/ to call the resolution endpoint
- Use fetch or axios to POST to the architecture-model-service endpoint
- Accept projectId and architectureContext (entityIds, diagramIds) as parameters
- Return the parsed ResolvedImplementContextDto or null on error
- Configure base URL from gateway config (architecture-model-service URL)

## Existing Code to Leverage

**WorkItemImplementContextService.java and WorkItemImplementContextController.java**
- Follow the same service/controller patterns for dependency injection, logging, and transactional behavior
- Reuse the project ID and work item ID handling patterns
- Similar error handling approach with meaningful exception messages

**ModelService.java loadEntities and loadDiagrams methods**
- Reference the repository patterns for querying individual entities by modelFileId
- Use EntityMapper patterns for accessing entity properties
- DiagramRepository and DiagramNodeRepository queries for diagram resolution

**gateway/src/services/promptBuilder.ts**
- Extend buildImplementPlannerPrompt to accept resolved context
- Follow the placeholder replacement pattern used for workItem fields
- Add new type for resolved context in types/chat.ts

**gateway/src/routes/chat.ts shouldBypassToolExecution pattern**
- Insert resolution logic before building the system prompt
- Follow the existing pattern for context extraction and API calls
- Use config for backend service URL

**frontend/src/api/implementContextApi.ts**
- Reference the entity ID parsing pattern (entityType::entityId format)
- No changes needed to frontend; it continues sending raw IDs

## Out of Scope
- Spec generation or parsing (Iteration 4)
- Execution pipeline or task running (Iteration 5)
- Visualizing resolved context in the frontend UI
- Changes to MCP tools or tool contracts
- Persisting resolved context to database (resolution is read-only)
- Streaming responses for implement chat
- Caching of resolved context in gateway
- Pagination or limiting resolved entity counts
- Frontend display of resolved entity details
- Changes to the ContextPickerModal or entity selection UI
