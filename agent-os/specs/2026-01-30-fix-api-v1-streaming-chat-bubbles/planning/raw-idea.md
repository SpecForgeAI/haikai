# Raw Idea

## Title
Fix /api/v1 streaming chat bubbles — force "Software Architect" persona and split stream into multiple bubbles

## Intent
For all messages from /api/v1/* endpoints (e.g., /api/v1/shape-spec/stream), ensure:
1) Chat bubbles are consistently labeled "Software Architect" (never "Product Owner", never phase-dependent)
2) Streaming content renders as multiple distinct message bubbles (one per streamed content event), rather than a single growing bubble
