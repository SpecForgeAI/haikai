#!/bin/bash
# Test Haikai commands in local containerized environment
set -e

# Get project root directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "=== Setting up Haikai Test Environment (Local) ==="
echo "Project root: $PROJECT_ROOT"
echo ""

# Load .env.local if it exists
if [ -f "$PROJECT_ROOT/.env.local" ]; then
    echo "Loading environment from .env.local..."
    export $(grep -v '^#' "$PROJECT_ROOT/.env.local" | xargs)
fi

# Set HAIKAI_PROFILES_PATH if not set
if [ -z "$HAIKAI_PROFILES_PATH" ]; then
    export HAIKAI_PROFILES_PATH="$PROJECT_ROOT/haikai-profiles"
fi

# Create test directory
TEST_DIR="$PROJECT_ROOT/api_workspace/haikai-test"
SPEC_NAME="user-registration"
rm -rf "$TEST_DIR"
mkdir -p "$TEST_DIR"
cd "$TEST_DIR"

echo "Test directory: $TEST_DIR"
echo ""

# Create Haikai directory structure
mkdir -p haikai/product
mkdir -p haikai/specs
mkdir -p "haikai/specs/$SPEC_NAME/planning"
mkdir -p "haikai/specs/$SPEC_NAME/planning/visuals"

# Create product context files
cat > haikai/product/mission.md << 'EOF'
# Test Project Mission

Build a simple REST API for user management.

## Goals
- User registration
- User authentication  
- Profile management
EOF

cat > haikai/product/tech-stack.md << 'EOF'
# Tech Stack

## Backend
- Python 3.11
- FastAPI
- SQLAlchemy
- PostgreSQL

## Authentication
- JWT tokens
- OAuth2
EOF

cat > haikai/product/roadmap.md << 'EOF'
# Product Roadmap

## Phase 1: MVP
- User registration endpoint
- Login with JWT
- Basic profile CRUD

## Phase 2: Enhanced Features
- Email verification
- Password reset
- OAuth2 social login
EOF

# Create requirements.md file
cat > "haikai/specs/$SPEC_NAME/planning/requirements.md" << 'EOF'
# User Registration Endpoint Requirements

## Feature Description
Create a REST API endpoint that allows new users to register for an account by providing their email, password, and optional username.

## User Goals
1. As a new user, I want to create an account so that I can access the system
2. As a system administrator, I want to ensure only valid emails and strong passwords are accepted
3. As a developer, I want clear error messages when registration fails

## Functional Requirements

### Input Validation
- Email must be valid format (RFC 5322)
- Password must be at least 8 characters
- Password must contain: uppercase, lowercase, number, special character
- Username is optional, but if provided must be 3-20 characters
- Email must be unique (no duplicates)
- Username must be unique if provided

### API Endpoint
- Method: POST
- Path: /api/v1/users/register
- Content-Type: application/json

### Request Body
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "username": "johndoe"  // optional
}
```

### Response (Success - 201 Created)
```json
{
  "id": "uuid-string",
  "email": "user@example.com",
  "username": "johndoe",
  "created_at": "2024-01-15T10:30:00Z"
}
```

### Response (Error - 400 Bad Request)
```json
{
  "error": "validation_error",
  "details": {
    "email": ["Invalid email format"],
    "password": ["Password must contain at least one uppercase letter"]
  }
}
```

## Non-Functional Requirements
- Response time < 500ms
- Password must be hashed (bcrypt, cost factor 12)
- Email verification token sent after registration
- Rate limiting: 5 attempts per IP per minute
EOF

echo "✓ Test project structure created"
echo ""
echo "Directory structure:"
find "$TEST_DIR/haikai" -type f
echo ""

# Check if Claude CLI is available
CLAUDE_CMD=""
if [ -f "$PROJECT_ROOT/node_modules/.bin/claude" ]; then
    CLAUDE_CMD="$PROJECT_ROOT/node_modules/.bin/claude"
elif command -v claude &> /dev/null; then
    CLAUDE_CMD="claude"
else
    echo "✗ Claude CLI not found"
    echo "  Run ./setup-local-env.sh to install it"
    exit 1
fi

echo "✓ Claude CLI found: $CLAUDE_CMD"
echo "✓ HAIKAI_PROFILES_PATH: $HAIKAI_PROFILES_PATH"
echo ""

echo "=== Test Environment Ready ==="
echo ""
echo "You can now test Haikai commands manually:"
echo ""
echo "1. Navigate to test directory:"
echo "   cd $TEST_DIR"
echo ""
echo "2. Run Claude with Haikai commands:"
echo "   $CLAUDE_CMD /write-spec"
echo "   $CLAUDE_CMD /create-tasks"
echo "   $CLAUDE_CMD /implement-tasks"
echo ""
echo "3. Or use the API endpoint:"
echo "   curl -X POST http://localhost:8000/api/v1/haikai/orchestrate \\"
echo "     -H \"Content-Type: application/json\" \\"
echo "     -d '{\"feature_description\": \"User registration\", \"project_dir\": \"$TEST_DIR\"}'"
echo ""
echo "Test project location: $TEST_DIR"
echo "==="
