# Haikai Shape-Spec API Documentation

## Overview

The Shape-Spec API provides endpoints for creating and managing specification folders through the `/shape-spec` workflow. These endpoints allow you to initialize spec folders and gather requirements without running the full orchestration workflow.

## Prerequisites

Before using these endpoints, ensure you have:

1. **Product Planning Files** (Optional but recommended):
   - `haikai/product/mission.md`
   - `haikai/product/roadmap.md`
   - `haikai/product/tech-stack.md`
   
   These files help generate better requirements. Create them using `/plan-product` command.

2. **API Authentication**: Valid API key in the `Authorization` header.

## Endpoints

### 1. Create Shape-Specs

**Endpoint:** `POST /api/v1/haikai/shape-specs`

Creates one or more shape-specs by running the `/shape-spec` command for each feature description.

#### Request Body

```json
{
  "company": "string",
  "project": "string",
  "spec_intents": ["string"],
  "context_files": ["string"] // Optional
}
```

**Fields:**
- `company` (required): Company name
- `project` (required): Project name
- `spec_intents` (required): Array of spec intents describing features with context, goals, and requirements
- `context_files` (optional): Array of file paths to include as context

#### Response

```json
{
  "success": true,
  "results": [
    {
      "spec_name": "user-registration",
      "feature_description": "Add user registration with email verification",
      "status": "success",
      "spec_path": "/app/api_workspace/acme/backend/haikai/specs/user-registration",
      "requirements_path": "/app/api_workspace/acme/backend/haikai/specs/user-registration/planning/requirements.md",
      "initialization_path": "/app/api_workspace/acme/backend/haikai/specs/user-registration/planning/initialization.md",
      "execution_time_seconds": 45.2,
      "error_message": null
    }
  ],
  "total_execution_time_seconds": 45.2,
  "timestamp": "2026-01-15T14:30:22.123456"
}
```

**Response Fields:**
- `success`: True if all shape-specs completed successfully
- `results`: Array of results for each feature description
  - `spec_name`: Generated spec directory name (format: YYYY-MM-DD-feature-name)
  - `feature_description`: Original feature description
  - `status`: "success" or "failure"
  - `spec_path`: Full path to the spec directory
  - `requirements_path`: Path to generated requirements.md (null if failed)
  - `initialization_path`: Path to generated initialization.md (null if failed)
  - `execution_time_seconds`: Time taken for this shape-spec
  - `error_message`: Error details if failed
- `total_execution_time_seconds`: Total time for all shape-specs
- `timestamp`: ISO timestamp when operation completed

#### Example Request

```bash
curl -X POST http://localhost:8000/api/v1/haikai/shape-specs \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "company": "acme",
    "project": "backend",
    "spec_intents": [
      "Add user registration with email verification",
      "Implement payment gateway integration with Stripe"
    ]
  }'
```

#### Error Responses

**400 Bad Request** - Invalid request:
```json
{
  "error": "Invalid request: [error details]"
}
```

**422 Unprocessable Entity** - Invalid feature description:
```json
{
  "error": "Feature description at index 0 is too short. Must be at least 10 characters."
}
```

**500 Internal Server Error** - Server error:
```json
{
  "error": "Failed to create shape-specs: [error details]"
}
```

---

### 2. Get All Specs

**Endpoint:** `GET /api/v1/haikai/shape-specs/{company}/{project}`

Retrieves information about all spec folders in a project, including their status.

#### Path Parameters

- `company` (required): Company name
- `project` (required): Project name

#### Response

```json
{
  "company": "acme",
  "project": "backend",
  "specs": [
    {
      "spec_name": "user-registration",
      "spec_path": "/app/api_workspace/acme/backend/haikai/specs/user-registration",
      "has_requirements": true,
      "has_spec": true,
      "has_tasks": true,
      "has_implementation": false,
      "created_date": "2026-01-15",
      "feature_name": "user-registration"
    },
    {
      "spec_name": "payment-gateway",
      "spec_path": "/app/api_workspace/acme/backend/haikai/specs/payment-gateway",
      "has_requirements": true,
      "has_spec": false,
      "has_tasks": false,
      "has_implementation": false,
      "created_date": "2026-01-15",
      "feature_name": "payment-gateway"
    }
  ],
  "total_specs": 2,
  "timestamp": "2026-01-15T14:35:00.123456"
}
```

**Response Fields:**
- `company`: Company name
- `project`: Project name
- `specs`: Array of spec information
  - `spec_name`: Spec directory name
  - `spec_path`: Full path to spec directory
  - `has_requirements`: Whether planning/requirements.md exists
  - `has_spec`: Whether spec.md exists
  - `has_tasks`: Whether tasks.md exists
  - `has_implementation`: Whether implementation folder has content
  - `created_date`: Date extracted from spec name (YYYY-MM-DD)
  - `feature_name`: Feature name extracted from spec name
- `total_specs`: Total number of specs found
- `timestamp`: ISO timestamp when query was made

#### Example Request

```bash
curl -X GET http://localhost:8000/api/v1/haikai/shape-specs/acme/backend \
  -H "Authorization: Bearer YOUR_API_KEY"
```

#### Use Cases

This endpoint is useful for:
- **Dashboard displays**: Show all features and their progress
- **Status monitoring**: Check which specs have completed which steps
- **Workflow decisions**: Determine which specs need write-spec, create-tasks, or implement-tasks
- **Cleanup operations**: Identify incomplete or abandoned specs

#### Empty Response

If no specs exist for the project:

```json
{
  "company": "acme",
  "project": "backend",
  "specs": [],
  "total_specs": 0,
  "timestamp": "2026-01-15T14:35:00.123456"
}
```

---

## Workflow Comparison

### Shape-Spec Only (These Endpoints)

```
POST /api/v1/haikai/shape-specs
  ↓
Creates spec folder + requirements.md
  ↓
Done (ready for orchestration)
```

### Full Orchestration (Separate API)

**Important**: Orchestration does NOT include shape-spec. Spec folders must exist before orchestration.

```
POST /api/v1/orchestrations
  ↓
Step 1: /write-spec → spec.md (requires existing spec folder)
  ↓
Step 2: /create-tasks → tasks.md
  ↓
Step 3: /implement-tasks → implementation files
  ↓
Done (fully implemented)
```

### Combined Workflow

```
1. POST /api/v1/haikai/shape-specs (create spec folders)
   ↓
2. POST /api/v1/orchestrations (run full workflow)
```

## Common Use Cases

### Use Case 1: Create Multiple Shape-Specs for Review

Create shape-specs for multiple features, then review requirements before proceeding:

```bash
# Step 1: Create shape-specs
curl -X POST http://localhost:8000/api/v1/haikai/shape-specs \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "company": "acme",
    "project": "backend",
    "spec_intents": [
      "Add user registration with email verification",
      "Implement payment gateway with Stripe",
      "Create admin dashboard for user management"
    ]
  }'

# Step 2: Review the generated requirements.md files manually

# Step 3: Continue with individual write-spec calls for approved features
```

### Use Case 2: Monitor Feature Progress

Check the status of all features in a project:

```bash
# Get all specs
curl -X GET http://localhost:8000/api/v1/haikai/shape-specs/acme/backend \
  -H "Authorization: Bearer YOUR_API_KEY"

# Response shows which features are at which stage:
# - has_requirements only: Just shaped, needs write-spec
# - has_requirements + has_spec: Spec written, needs create-tasks
# - has_requirements + has_spec + has_tasks: Tasks created, needs implement-tasks
# - All true: Fully implemented
```

### Use Case 3: Batch Shape-Spec Creation

Create shape-specs for an entire roadmap:

```bash
curl -X POST http://localhost:8000/api/v1/haikai/shape-specs \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "company": "acme",
    "project": "backend",
    "spec_intents": [
      "User authentication with OAuth2 and JWT",
      "Email notification system with templates",
      "File upload with S3 integration",
      "Real-time notifications with WebSockets",
      "API rate limiting and throttling",
      "Audit logging for all user actions"
    ]
  }'
```

## Integration Examples

### Python

```python
import requests

API_BASE = "http://localhost:8000"
API_KEY = "your-api-key"

headers = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json"
}

# Create shape-specs
response = requests.post(
    f"{API_BASE}/api/v1/haikai/shape-specs",
    headers=headers,
    json={
        "company": "acme",
        "project": "backend",
        "spec_intents": [
            "Add user registration with email verification"
        ]
    }
)

if response.status_code == 200:
    data = response.json()
    if data["success"]:
        for result in data["results"]:
            print(f"Created: {result['spec_name']}")
            print(f"Requirements: {result['requirements_path']}")
    else:
        print("Some shape-specs failed")
else:
    print(f"Error: {response.json()['error']}")

# Get all specs
response = requests.get(
    f"{API_BASE}/api/v1/haikai/shape-specs/acme/backend",
    headers=headers
)

if response.status_code == 200:
    data = response.json()
    print(f"Found {data['total_specs']} specs:")
    for spec in data["specs"]:
        status = []
        if spec["has_requirements"]: status.append("requirements")
        if spec["has_spec"]: status.append("spec")
        if spec["has_tasks"]: status.append("tasks")
        if spec["has_implementation"]: status.append("implementation")
        print(f"  {spec['spec_name']}: {', '.join(status)}")
```

### JavaScript/TypeScript

```typescript
const API_BASE = "http://localhost:8000";
const API_KEY = "your-api-key";

const headers = {
  "Authorization": `Bearer ${API_KEY}`,
  "Content-Type": "application/json"
};

// Create shape-specs
async function createShapeSpecs(company: string, project: string, features: string[]) {
  const response = await fetch(`${API_BASE}/api/v1/haikai/shape-specs`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      company,
      project,
      spec_intents: features
    })
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error);
  }
  
  return await response.json();
}

// Get all specs
async function getSpecs(company: string, project: string) {
  const response = await fetch(
    `${API_BASE}/api/v1/haikai/shape-specs/${company}/${project}`,
    { headers }
  );
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error);
  }
  
  return await response.json();
}

// Usage
try {
  const result = await createShapeSpecs("acme", "backend", [
    "Add user registration with email verification"
  ]);
  console.log("Created specs:", result.results.map(r => r.spec_name));
  
  const specs = await getSpecs("acme", "backend");
  console.log(`Found ${specs.total_specs} specs`);
} catch (error) {
  console.error("Error:", error.message);
}
```

## Best Practices

1. **Validate Product Files First**: Always ensure mission.md, roadmap.md, and tech-stack.md exist before creating shape-specs.

2. **Batch Related Features**: Create shape-specs for related features together to maintain context and consistency.

3. **Review Before Proceeding**: Use the GET endpoint to review requirements before running write-spec or full orchestration.

4. **Monitor Progress**: Regularly check spec status to track which features are at which stage of development.

5. **Error Handling**: Always check the `status` field in each result, as some shape-specs may succeed while others fail.

6. **Descriptive Feature Descriptions**: Provide clear, detailed feature descriptions (minimum 10 characters) for better requirements generation.

## Related Documentation

- [Full Orchestration API](API.md#haikai-orchestrator) - Complete workflow from feature description to implementation
- [Shape-Spec Integration Guide](SHAPE_SPEC_INTEGRATION.md) - Technical details of shape-spec integration
- [Haikai Commands](../haikai-profiles/default/README.md) - Documentation for all Haikai commands
