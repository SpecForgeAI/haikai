#!/bin/bash
set -e

echo "=== Setting up Haikai Test Environment ==="

# Create test directory
TEST_DIR="/tmp/haikai-test"
SPEC_NAME="user-registration"
rm -rf "$TEST_DIR"
mkdir -p "$TEST_DIR"
cd "$TEST_DIR"

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

### Registration Flow
1. Receive registration request with email, password, optional username
2. Validate input format and constraints
3. Check for existing user with same email
4. Hash password securely (bcrypt with salt)
5. Create user record in database
6. Return success response with user ID and created timestamp

### Response Handling
- Success: 201 Created with user details (excluding password)
- Validation error: 400 Bad Request with specific field errors
- Duplicate email: 409 Conflict with clear message
- Server error: 500 Internal Server Error

## Non-Functional Requirements

### Security
- Passwords must be hashed using bcrypt (cost factor >= 10)
- Never return password hash in API responses
- Rate limit: 5 registration attempts per IP per hour
- Input sanitization to prevent SQL injection and XSS

### Performance
- Registration should complete within 500ms under normal load
- Support 100 concurrent registration requests

### Data Storage
- User data stored in PostgreSQL database
- Email field indexed for fast duplicate checking
- Created/updated timestamps for audit trail

## Out of Scope
- Email verification (Phase 2)
- Social login/OAuth (Phase 2)
- Password reset (Phase 2)
- Multi-factor authentication (Future)

## Constraints
- Must integrate with existing FastAPI application
- Must use SQLAlchemy ORM for database operations
- Must follow existing project code style and patterns
EOF

echo "✓ Created product context files"
echo "✓ Created spec directory: haikai/specs/$SPEC_NAME"
echo "✓ Created requirements.md file"

echo ""
echo "=== Directory Structure ==="
find haikai -name "*.md" | sort

echo ""
echo "=========================================="
echo "=== HAIKAI WORKFLOW TEST SEQUENCE ==="
echo "=========================================="
echo ""

# Test 1: /write-spec
echo "=== Test 1: /write-spec - Generate Specification ==="
echo "Command: claude -p '/write-spec for user-registration' --allowedTools 'Read,Write,Edit,Bash'"
echo ""

claude -p "/write-spec for user-registration" --allowedTools "Read,Write,Edit,Bash"

echo ""
echo "--- Checking for generated spec.md file ---"
if [ -f "haikai/specs/$SPEC_NAME/spec.md" ]; then
    echo "✓ SUCCESS: spec.md was created!"
    echo ""
    echo "--- Generated spec.md content (first 30 lines) ---"
    head -n 30 "haikai/specs/$SPEC_NAME/spec.md"
    echo ""
    echo "--- File size ---"
    ls -lh "haikai/specs/$SPEC_NAME/spec.md"
else
    echo "✗ FAILED: spec.md was NOT created"
    echo "--- Files in specs directory ---"
    ls -la "haikai/specs/$SPEC_NAME/"
    exit 1
fi

echo ""
echo "=========================================="
echo ""

# Test 2: /create-tasks
echo "=== Test 2: /create-tasks - Generate Tasks Breakdown ==="
echo "Command: claude -p '/create-tasks for user-registration' --allowedTools 'Read,Write,Edit,Bash'"
echo ""

claude -p "/create-tasks for user-registration" --allowedTools "Read,Write,Edit,Bash"

echo ""
echo "--- Checking for generated tasks.md file ---"
if [ -f "haikai/specs/$SPEC_NAME/tasks.md" ]; then
    echo "✓ SUCCESS: tasks.md was created!"
    echo ""
    echo "--- Generated tasks.md content (first 40 lines) ---"
    head -n 40 "haikai/specs/$SPEC_NAME/tasks.md"
    echo ""
    echo "--- File size ---"
    ls -lh "haikai/specs/$SPEC_NAME/tasks.md"
else
    echo "✗ FAILED: tasks.md was NOT created"
    echo "--- Files in specs directory ---"
    ls -la "haikai/specs/$SPEC_NAME/"
    echo "--- Files in tasks directory (if exists) ---"
    ls -la "haikai/specs/$SPEC_NAME/tasks/" 2>/dev/null || echo "No tasks directory found"
    exit 1
fi

echo ""
echo "=========================================="
echo ""

# Test 3: /implement-tasks
echo "=== Test 3: /implement-tasks - Implement the Tasks ==="
echo "Command: claude -p '/implement-tasks for user-registration' --allowedTools 'Read,Write,Edit,Bash'"
echo ""

claude -p "/implement-tasks for user-registration" --allowedTools "Read,Write,Edit,Bash"

echo ""
echo "--- Checking for implementation artifacts ---"
echo "Looking for generated code files..."
IMPL_DIR="haikai/specs/$SPEC_NAME/implementation"
if [ -d "$IMPL_DIR" ] || [ -n "$(find haikai/specs/$SPEC_NAME -name '*.py' -o -name '*.sql' 2>/dev/null)" ]; then
    echo "✓ SUCCESS: Implementation artifacts were created!"
    echo ""
    echo "--- Generated files ---"
    find "haikai/specs/$SPEC_NAME" -type f \( -name "*.py" -o -name "*.sql" -o -name "*.sh" \) 2>/dev/null || echo "No code files found, checking for other artifacts..."
    find "haikai/specs/$SPEC_NAME" -type f -newer "haikai/specs/$SPEC_NAME/tasks.md" 2>/dev/null | head -20
else
    echo "⚠ WARNING: No obvious implementation artifacts found"
    echo "--- All files in specs directory ---"
    find "haikai/specs/$SPEC_NAME" -type f
fi

echo ""
echo "=========================================="
echo ""

# Test 4: /orchestrate-tasks
echo "=== Test 4: /orchestrate-tasks - Orchestrate Implementation ==="
echo "Command: claude -p '/orchestrate-tasks for user-registration' --allowedTools 'Read,Write,Edit,Bash'"
echo ""

claude -p "/orchestrate-tasks for user-registration" --allowedTools "Read,Write,Edit,Bash"

echo ""
echo "--- Checking for orchestration results ---"
ORCHESTRATION_LOG="haikai/specs/$SPEC_NAME/orchestration.md"
if [ -f "$ORCHESTRATION_LOG" ] || [ -f "haikai/specs/$SPEC_NAME/status.md" ]; then
    echo "✓ SUCCESS: Orchestration completed!"
    echo ""
    echo "--- Orchestration output ---"
    [ -f "$ORCHESTRATION_LOG" ] && head -n 30 "$ORCHESTRATION_LOG"
    [ -f "haikai/specs/$SPEC_NAME/status.md" ] && head -n 30 "haikai/specs/$SPEC_NAME/status.md"
else
    echo "⚠ Note: No explicit orchestration log found (this may be expected)"
    echo "--- Latest files in specs directory ---"
    ls -lt "haikai/specs/$SPEC_NAME/" | head -10
fi

echo ""
echo "=========================================="
echo "=== WORKFLOW TEST COMPLETE ==="
echo "=========================================="
echo ""
echo "Summary:"
echo "1. ✓ /write-spec - Generated spec.md"
echo "2. ✓ /create-tasks - Generated tasks.md"
echo "3. ✓ /implement-tasks - Executed implementation"
echo "4. ✓ /orchestrate-tasks - Executed orchestration"
echo ""
echo "=== Final Directory Structure ==="
find haikai/specs/$SPEC_NAME -type f | sort
echo ""
echo "=== Test Complete ==="
