# Gateway Chat Orchestrator - Manual Verification Checklist

This document provides steps to manually verify the Gateway service with all dependencies running.

## Prerequisites

Ensure the following services are running:

1. **Architecture Model Service** (port 8080)
   ```bash
   cd architecture-model-service
   mvn spring-boot:run
   ```

2. **MCP Server** (port 8090)
   ```bash
   cd mcp-server
   npm run dev
   ```

3. **Gateway** (port 8081)
   ```bash
   cd gateway
   # Create .env file from .env.example and add your OPENAI_API_KEY
   cp .env.example .env
   # Edit .env and add your API key
   npm run dev
   ```

## Environment Setup

Create a `.env` file in the gateway directory with:

```
OPENAI_API_KEY=sk-your-actual-api-key
MCP_BASE_URL=http://localhost:8090
PORT=8081
ENABLE_TOOL_TRACE=true
```

## Verification Steps

### 1. Health Check

Verify all services are running:

```bash
# Gateway health
curl http://localhost:8081/health

# Expected response:
# {"status":"ok","timestamp":"2024-12-16T10:00:00.000Z"}

# MCP health
curl http://localhost:8090/health

# Architecture model service health
curl http://localhost:8080/actuator/health
```

### 2. Basic Chat Request

Send a simple chat message:

```bash
curl -X POST http://localhost:8081/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "test-session-1",
    "message": "Hello, what can you help me with?"
  }'
```

Expected: A response explaining the assistant's capabilities.

### 3. List Interfaces

Request to list interfaces (will trigger tool call):

```bash
curl -X POST http://localhost:8081/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "test-session-2",
    "message": "List all interfaces for the architecture model",
    "context": {
      "filename": "your-architecture-file.json"
    }
  }'
```

Expected: Response with list of interfaces from the architecture model.

### 4. Get Interface Context

Request interface details:

```bash
curl -X POST http://localhost:8081/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "test-session-3",
    "message": "Tell me about the User API interface",
    "context": {
      "interfaceId": "INT-001"
    }
  }'
```

Expected: Response with interface details including endpoints.

### 5. Compute OAS Gaps

Request gap analysis:

```bash
curl -X POST http://localhost:8081/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "test-session-4",
    "message": "What information is missing to generate an OpenAPI spec?",
    "context": {
      "interfaceId": "INT-001"
    }
  }'
```

Expected: Response detailing any gaps or missing information.

### 6. Generate and Save OAS Spec

Request to generate and save a spec (requires user confirmation first):

```bash
# First, generate the spec
curl -X POST http://localhost:8081/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "test-session-5",
    "message": "Generate an OpenAPI spec for this interface in YAML format",
    "context": {
      "filename": "your-architecture-file.json",
      "interfaceId": "INT-001",
      "preferredFormat": "yaml"
    }
  }'

# Then confirm saving
curl -X POST http://localhost:8081/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "test-session-5",
    "message": "Yes, please save the spec"
  }'
```

Expected: Response confirming spec was saved with path in artifacts.

### 7. SSE Streaming

Test streaming endpoint:

```bash
curl -N "http://localhost:8081/api/chat/stream?sessionId=stream-test&message=Hello"
```

Expected: SSE events streaming back:
- `event: token` with partial content
- `event: final` with complete message

### 8. Rate Limiting

Test rate limiting (send many requests quickly):

```bash
for i in {1..100}; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST http://localhost:8081/api/chat \
    -H "Content-Type: application/json" \
    -d "{\"sessionId\": \"rate-test-$i\", \"message\": \"test\"}"
done
```

Expected: Eventually see `429` status codes.

### 9. Validation Errors

Test validation:

```bash
# Missing sessionId
curl -X POST http://localhost:8081/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello"}'

# Expected: 400 Bad Request with error about sessionId

# Missing message
curl -X POST http://localhost:8081/api/chat \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "test"}'

# Expected: 400 Bad Request with error about message

# Invalid preferredFormat
curl -X POST http://localhost:8081/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "test",
    "message": "Hello",
    "context": {"preferredFormat": "xml"}
  }'

# Expected: 400 Bad Request with error about preferredFormat
```

### 10. CORS

Test CORS from browser console:

```javascript
fetch('http://localhost:8081/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    sessionId: 'browser-test',
    message: 'Hello'
  })
}).then(r => r.json()).then(console.log);
```

Expected: Works from allowed origins, fails from others.

## Verification Checklist

- [ ] Health endpoint returns OK
- [ ] Basic chat returns assistant response
- [ ] List interfaces triggers tool call and returns data
- [ ] Get interface context returns detailed information
- [ ] Compute gaps returns gap analysis
- [ ] Save spec creates file and returns artifacts
- [ ] Streaming returns SSE events
- [ ] Rate limiting returns 429 after limit
- [ ] Validation returns 400 for invalid requests
- [ ] CORS allows configured origins

## Troubleshooting

### OpenAI Errors
- Check OPENAI_API_KEY is set correctly
- Verify API key has sufficient quota
- Check network connectivity to api.openai.com

### MCP Errors
- Ensure MCP server is running on port 8090
- Check MCP_BASE_URL configuration
- Verify architecture-model-service is running

### Tool Call Failures
- Check the architecture file exists
- Verify interface IDs are correct
- Review MCP server logs for details

### Session Issues
- Sessions expire after 24 hours by default
- Each request should include sessionId
- Sessions are in-memory (lost on restart)
