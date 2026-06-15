# SA Increment 5 – Wire Confirmation → Baseline Generation → Tool Execution + 'View and Extend Here' Link

## Title
SA Increment 5 – Wire Confirmation → Baseline Generation → Tool Execution + 'View and Extend Here' Link

## Intent
Complete the Solution Architect flow end-to-end: SA conducts structured architecture discovery, transitions to phase="ready", user confirms baseline creation, gateway generates architectureBaselineJson, gateway invokes MCP tool save_architecture_baseline, assistant responds with success message including link to Architecture & Design. This increment performs the first architecture meta-model write (no diagrams).

## Scope

### Include
- Gateway changes: confirmation detection (regex, phase check), baseline generation branch (4 steps: build prompt, OpenAI call with JSON enforcement + corrective retry, validate minimum requirements, invoke MCP tool), transcript rules (no architectureBaselineJson on disk), success response with link, failure response
- Frontend changes: SolutionArchitectChatPanel loading state, success message with clickable link
- Non-functional requirements
- Acceptance criteria

### Exclude
- Diagram generation (future increment)
- Advanced validation beyond minimum requirements
- User editing of baseline before save
- Multi-product support (single product context only)

## Systems Affected
- Gateway: chat route, prompt builder, tool executor, transcript writer
- Frontend: SolutionArchitectChatPanel component
- MCP Server: save_architecture_baseline tool (already implemented in Increment 4)

## Gateway Changes

### 1. Confirmation Detection
**Location**: `gateway/src/routes/chat.ts` (or new `solutionArchitectConfirmationDetector.ts`)

**Logic**:
- Check if mode is "solutionArchitect"
- Check if current phase is "ready"
- Use regex to detect confirmation keywords in user message
  - Patterns: "yes", "go ahead", "proceed", "create", "generate", "confirm", etc.
  - Case-insensitive
  - Should match common affirmative responses
- If all conditions met, trigger baseline generation branch

**Pseudo-code**:
```typescript
if (mode === 'solutionArchitect' && currentPhase === 'ready') {
  const confirmationRegex = /^(yes|y|go ahead|proceed|create|generate|confirm|ok|okay|sure|do it)/i;
  if (confirmationRegex.test(userMessage.trim())) {
    // Trigger baseline generation
    return await generateAndSaveBaseline(conversationHistory, productId);
  }
}
```

### 2. Baseline Generation Branch
**New function**: `generateAndSaveBaseline(conversationHistory, productId)`

**4 Steps**:

#### Step 1: Build Prompt
- Construct prompt that includes:
  - System role: "You are an architecture extraction assistant"
  - Task: "Based on the conversation history, generate a complete architectureBaselineJson"
  - Conversation history (filtered to relevant SA messages)
  - Schema reference or inline schema definition
  - Instructions to ensure all required fields are populated

#### Step 2: OpenAI Call with JSON Enforcement + Corrective Retry
- Call OpenAI API with:
  - Model: gpt-4 or gpt-4-turbo
  - Response format: `{ type: "json_object" }`
  - Temperature: 0.2 (low for consistency)
  - Max tokens: 4000
- Parse response as JSON
- If parse fails or invalid JSON:
  - Log error
  - Make one corrective retry with explicit error feedback in prompt
  - If second attempt fails, return error to user

#### Step 3: Validate Minimum Requirements
- Check generated JSON against minimum schema requirements:
  - Has at least one system defined
  - Has at least one component defined
  - Has productId field
  - Has name field
  - All required fields are present and non-empty
- If validation fails:
  - Log specific validation errors
  - Return error message to user (do not retry generation)

#### Step 4: Invoke MCP Tool
- Call `save_architecture_baseline` tool via toolExecutor
- Pass generated architectureBaselineJson as argument
- Handle tool response:
  - Success: proceed to success response
  - Failure: proceed to failure response

### 3. Transcript Rules
**Location**: `gateway/src/services/transcriptWriter.ts`

**Rule**:
- DO NOT write architectureBaselineJson to transcript
- Reason: Large JSON objects bloat transcript, already persisted in arch-model database
- Implementation: Filter out tool arguments containing architectureBaselineJson before writing to transcript
- Keep tool execution result (success/failure) in transcript

**Logic**:
```typescript
// When writing tool call to transcript
if (toolName === 'save_architecture_baseline') {
  // Write tool call with arguments redacted
  transcriptEntry = {
    role: 'tool',
    name: 'save_architecture_baseline',
    arguments: { _redacted: true },
    result: toolResult
  };
}
```

### 4. Success Response
**Format**:
```
Great! I've created your architecture baseline. You can now view and extend it here:

[View Architecture & Design](/products/{productId}/architecture)

The baseline includes:
- {systemCount} systems
- {componentCount} components
- {relationshipCount} relationships

Would you like me to help you with anything else?
```

**Implementation**:
- Extract counts from saved baseline or tool response
- Generate link using productId
- Return as assistant message
- Update conversation phase to "completed" or keep as "ready" for further SA work

### 5. Failure Response
**Format**:
```
I encountered an error while creating your architecture baseline:

{errorMessage}

Would you like to try again, or would you like me to help you refine the architecture details first?
```

**Error Cases**:
- JSON generation failed after retry
- Validation failed (specify which validation)
- MCP tool execution failed
- Database write failed

## Frontend Changes

### 1. SolutionArchitectChatPanel Loading State
**Location**: `frontend/src/components/ProductView/SolutionArchitectChatPanel.tsx`

**Requirements**:
- Show loading indicator when baseline generation is in progress
- Loading state should be triggered when:
  - User sends confirmation message while in "ready" phase
  - Gateway begins baseline generation
- Loading indicator should:
  - Disable message input
  - Show spinner or progress indicator
  - Display text: "Generating architecture baseline..."
- Loading state should clear when:
  - Success response received
  - Failure response received

**Implementation**:
```typescript
const [isGeneratingBaseline, setIsGeneratingBaseline] = useState(false);

// Detect baseline generation start
if (lastMessage?.content.includes("I've created your architecture baseline") ||
    lastMessage?.content.includes("encountered an error while creating")) {
  setIsGeneratingBaseline(false);
}
```

### 2. Success Message with Clickable Link
**Location**: `frontend/src/components/ProductView/SolutionArchitectChatPanel.tsx`

**Requirements**:
- Parse success message for architecture link
- Render link as clickable React Router Link component
- Link should:
  - Be visually distinct (button or prominent link styling)
  - Use client-side routing (no page reload)
  - Navigate to `/products/{productId}/architecture`
- Display baseline summary (system/component/relationship counts)

**Implementation**:
```tsx
// Detect architecture link in message
const architectureLinkRegex = /\[View Architecture & Design\]\((\/products\/\d+\/architecture)\)/;
const match = message.content.match(architectureLinkRegex);

if (match) {
  const linkPath = match[1];
  return (
    <div className={styles.successMessage}>
      <p>Great! I've created your architecture baseline.</p>
      <Link to={linkPath} className={styles.architectureLink}>
        View Architecture & Design
      </Link>
      {/* Render rest of message */}
    </div>
  );
}
```

## Non-Functional Requirements

### Performance
- Baseline generation should complete within 10 seconds under normal conditions
- OpenAI API timeout: 30 seconds
- Total user-facing timeout: 45 seconds (after which show error)

### Reliability
- Single retry for JSON generation failures
- Graceful degradation: if generation fails, user can retry or continue conversation
- No partial writes: baseline should be saved atomically (all-or-nothing)

### Observability
- Log each step of baseline generation with timing
- Log validation errors with specific field failures
- Log OpenAI API latency and token usage
- Track success/failure rates for baseline generation

### Security
- Ensure productId in baseline matches authenticated user's product access
- Validate all generated JSON fields against schema (prevent injection)
- Sanitize user input in confirmation detection (prevent regex DoS)

## Acceptance Criteria

### AC1: Confirmation Detection
- GIVEN SA is in "ready" phase
- WHEN user sends message matching confirmation pattern (e.g., "yes", "go ahead")
- THEN gateway triggers baseline generation branch
- AND user sees loading indicator

### AC2: Baseline Generation Success Path
- GIVEN confirmation detected
- WHEN baseline generation completes successfully
- THEN MCP tool save_architecture_baseline is invoked
- AND architectureBaselineJson is saved to database
- AND success message with link is returned to user
- AND architectureBaselineJson is NOT written to transcript

### AC3: Success Message Display
- GIVEN success response received
- WHEN user views message in SolutionArchitectChatPanel
- THEN message includes clickable link to /products/{productId}/architecture
- AND message includes system/component/relationship counts
- AND loading indicator is cleared

### AC4: Baseline Generation Failure Path
- GIVEN confirmation detected
- WHEN baseline generation fails (any step)
- THEN error message is returned to user
- AND error message includes specific failure reason
- AND user can retry or continue conversation
- AND loading indicator is cleared

### AC5: JSON Generation Retry
- GIVEN OpenAI returns invalid JSON
- WHEN first attempt fails
- THEN gateway makes one corrective retry with error feedback
- AND if second attempt fails, returns error to user

### AC6: Validation Enforcement
- GIVEN JSON generation succeeds
- WHEN generated JSON fails minimum requirements validation
- THEN gateway returns validation error to user
- AND does NOT invoke MCP tool
- AND does NOT retry generation automatically

### AC7: Transcript Cleanliness
- GIVEN baseline successfully saved
- WHEN transcript is written to disk
- THEN architectureBaselineJson is NOT included in transcript
- AND tool execution result (success/failure) IS included

### AC8: Link Navigation
- GIVEN success message displayed with architecture link
- WHEN user clicks link
- THEN browser navigates to /products/{productId}/architecture using client-side routing
- AND Architecture & Design page loads with saved baseline

## Notes
- This increment completes the end-to-end SA flow for first-time baseline creation
- Future increments will add diagram generation, baseline editing, and incremental updates
- Consider adding telemetry/analytics for baseline generation success rates
- May want to add user feedback mechanism for generated baselines (thumbs up/down)
