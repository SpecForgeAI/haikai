# Raw Idea

Title: Normalize /api/v1 request identifiers, sanitize spec intent newlines, and correct streaming chat persona + bubble splitting

Intent: Improve the Implement (Software Architect) streaming flow so that:
- All requests to /api/v1/* use normalized company/project identifiers matching folder naming
- The spec-intent message sent to the implementation LLM contains no newline characters
- Streaming responses are always rendered as "Software Architect" (never "Product Owner")
- Each streamed content message is displayed as its own chat bubble (no single growing bubble)
