# Standards Extractor - Test Order (Canonical)

Run tests in this order for proper workflow validation.

## Test Sequence

| # | Endpoint | Auth | Notes |
|---|----------|------|-------|
| 1 | `/health` | Bearer changeit | Health check |
| 2 | `standards/global/generate` | Bearer changeit | Global standards |
| 3 | `plan-product/stream` | Bearer changeit | Product plan (SSE) |
| 4 | `standards/product/generate` | Bearer changeit | tech-stack.md |
| 5a | `shape-spec/stream` (Questions) | Bearer changeit | Step 1: Claude asks questions |
| 5b | `shape-spec/stream` (Answers) | Bearer changeit | Step 2: Answer & get spec |
| 5 | `shape-spec/stream` (Total) | Bearer changeit | 2-step interactive flow |

## Authentication

All endpoints require Bearer token authentication:
```
Authorization: Bearer changeit
```

## Endpoint Details

### 1. Health Check
```bash
curl -s "http://localhost:8000/health"
```

### 2. Global Standards
```bash
curl -X POST "http://localhost:8000/api/v1/standards/global/generate" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer changeit" \
  -d '{"company": "test"}'
```

### 3. Plan Product (Streaming)
```bash
curl -N -X POST "http://localhost:8000/api/v1/plan-product/stream" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer changeit" \
  -d '{"company": "test", "project": "myproject", "message": "I want to build...", "session_mode": "new"}'
```

### 4. Product Standards
```bash
curl -X POST "http://localhost:8000/api/v1/standards/product/generate" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer changeit" \
  -d '{"company": "test", "project": "myproject"}'
```

### 5. Shape Spec (2-step interactive)

**Step 5a - Initial request (Claude asks questions):**
```bash
curl -N -X POST "http://localhost:8000/api/v1/shape-spec/stream" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer changeit" \
  -d '{"company": "test", "project": "myproject", "message": "I need a user registration feature", "session_mode": "new"}'
```

**Step 5b - Answer questions:**
```bash
curl -N -X POST "http://localhost:8000/api/v1/shape-spec/stream" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer changeit" \
  -d '{"company": "test", "project": "myproject", "message": "Here are my answers: ...", "session_mode": "resume"}'
```
