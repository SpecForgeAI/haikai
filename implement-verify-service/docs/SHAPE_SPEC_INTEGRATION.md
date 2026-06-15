# Shape-Spec API Documentation

## Overview

The `/shape-spec` command is available as a **standalone API endpoint** for initializing specification folders with requirements. It is **NOT part of the orchestration workflow**.

## Important Clarification

**Shape-Spec is NOT in Orchestration:**
- The orchestration API (`POST /api/v1/orchestrations`) does **NOT** include shape-spec
- Orchestration starts directly with `/write-spec` (Step 1)
- Spec folders must be created by an upstream process before orchestration

**Shape-Spec is a Separate API:**
- Available at: `POST /api/v1/haikai/shape-specs`
- Used independently to create spec folders
- Can be used upstream before calling orchestration

## Current Orchestration Workflow

The orchestration workflow assumes specs already exist:

1. **Step 1**: `/write-spec` → creates `spec.md` (requires existing spec folder with `planning/requirements.md`)
2. **Step 2**: `/create-tasks` → creates `tasks.md`
3. **Step 3**: `/implement-tasks` → implements all tasks

**Prerequisites for Orchestration:**
- Spec folders must exist at `{workspace}/{company}/{project}/specs/{spec-name}/`
- Must include `planning/requirements.md`
- Created by upstream process (e.g., shape-spec API, manual creation, or other tooling)

## Shape-Spec API Endpoint

### Endpoint
```
POST /api/v1/haikai/shape-specs
```

### Purpose
Create specification folders with initial requirements from spec intents.

### Request Model
```json
{
  "company": "acme",
  "project": "backend",
  "spec_intents": [
    "title: User Registration\n\ncontext: Users need accounts...\n\ngoal: Implement registration...\n\nrequirements:\n  - Email validation\n  - Password hashing"
  ]
}
```

### Response Model
```json
{
  "success": true,
  "spec_names": ["user-registration"],
  "created_files": [
    "/app/api_workspace/acme/backend/specs/user-registration/planning/requirements.md"
  ]
}
```

### What Shape-Spec Does

1. **Analyzes spec intent** - Understands the feature description
2. **Generates spec name** - Creates a slugified directory name (e.g., `user-registration`)
3. **Creates directory structure**:
   ```
   specs/{spec-name}/
   ├── planning/
   │   ├── requirements.md
   │   └── visuals/
   ```
4. **Writes requirements.md** - Generates initial requirements document

### Prerequisites for Shape-Spec

For `/shape-spec` to work properly, the following files **should exist** in the project workspace (optional but recommended):

**Product Planning Files** (located at `{workspace}/{company}/{project}/haikai/product/`):

1. **`mission.md`** - Product mission statement
2. **`roadmap.md`** - Product roadmap
3. **`tech-stack.md`** - Technical stack documentation

These files help shape-spec generate better requirements by understanding the product context. They can be created using the `/plan-product` command.

## Usage Patterns

### Pattern 1: Shape-Spec → Orchestration

```bash
# Step 1: Create spec folders using shape-spec API
curl -X POST http://localhost:8000/api/v1/haikai/shape-specs \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "company": "acme",
    "project": "backend",
    "spec_intents": ["User authentication with OAuth2"]
  }'

# Step 2: Run orchestration (spec folders now exist)
curl -X POST http://localhost:8000/api/v1/orchestrations \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "company": "acme",
    "project": "backend",
    "spec_intents": ["User authentication with OAuth2"]
  }'
```

### Pattern 2: Manual Creation → Orchestration

```bash
# Step 1: Manually create spec folder and requirements.md
mkdir -p /app/api_workspace/acme/backend/specs/user-auth/planning
echo "# Requirements..." > /app/api_workspace/acme/backend/specs/user-auth/planning/requirements.md

# Step 2: Run orchestration
curl -X POST http://localhost:8000/api/v1/orchestrations \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "company": "acme",
    "project": "backend",
    "spec_intents": ["User authentication with OAuth2"]
  }'
```

### Pattern 3: Shape-Spec Only (No Orchestration)

```bash
# Just create spec folders without running full workflow
curl -X POST http://localhost:8000/api/v1/haikai/shape-specs \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "company": "acme",
    "project": "backend",
    "spec_intents": [
      "User registration",
      "Payment gateway",
      "Email notifications"
    ]
  }'
```

## API Comparison

| Feature | Shape-Spec API | Orchestration API |
|---------|---------------|-------------------|
| **Endpoint** | `POST /api/v1/haikai/shape-specs` | `POST /api/v1/orchestrations` |
| **Purpose** | Create spec folders | Run full workflow |
| **Input** | `spec_intents` array | `spec_intents` array |
| **Prerequisites** | Product files (optional) | Spec folders with requirements.md (required) |
| **Output** | Spec folders with requirements.md | spec.md, tasks.md, implementation files |
| **Steps** | 1. Create folders<br>2. Generate requirements | 1. Write spec<br>2. Create tasks<br>3. Implement tasks |
| **Duration** | ~30-60 seconds | ~5-15 minutes |

## Migration from Old Workflow

**Old Workflow (Before):**
- Orchestration included Step 0: `/shape-spec`
- Orchestration automatically created spec folders
- Product files were required

**New Workflow (Current):**
- Orchestration starts with Step 1: `/write-spec`
- Spec folders must exist before orchestration
- Use shape-spec API separately if needed

**Breaking Changes:**
- Orchestration no longer creates spec folders
- Orchestration no longer verifies product files
- Must create spec folders via upstream process

## See Also

- [Haikai CRUD API Documentation](./HAIKAI_CRUD_API.md) - Full API reference
- [API Design](./API_DESIGN.md) - Overall API architecture
- [Orchestration Changelog](./CHANGELOG.md) - Recent changes
