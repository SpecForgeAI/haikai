#!/bin/bash
set -e

echo "=========================================="
echo "=== API Integration Test Data Setup ==="
echo "=========================================="
echo ""

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DATA_DIR="$SCRIPT_DIR/test_data"
API_WORKSPACE="${API_WORKSPACE_DIR:-/app/api_workspace}"
COMPANY="company_integration_test"
PROJECT="backend"

echo "Configuration:"
echo "  Test Data Dir: $TEST_DATA_DIR"
echo "  API Workspace: $API_WORKSPACE"
echo "  Company: $COMPANY"
echo "  Project: $PROJECT"
echo ""

# Check if test data directory exists
if [ ! -d "$TEST_DATA_DIR/$COMPANY/$PROJECT" ]; then
    echo "❌ ERROR: Test data directory not found at $TEST_DATA_DIR/$COMPANY/$PROJECT"
    exit 1
fi

# Create target directory in api_workspace
TARGET_DIR="$API_WORKSPACE/$COMPANY/$PROJECT"
echo "Creating target directory: $TARGET_DIR"
mkdir -p "$TARGET_DIR"

# Copy all test data
echo ""
echo "Copying test data..."
echo "  Source: $TEST_DATA_DIR/$COMPANY/$PROJECT/"
echo "  Target: $TARGET_DIR/"
cp -r "$TEST_DATA_DIR/$COMPANY/$PROJECT/"* "$TARGET_DIR/"

# Verify the copy
echo ""
echo "Verifying copied data..."

# Check for product files
if [ -f "$TARGET_DIR/haikai/product/mission.md" ]; then
    echo "  ✓ Product mission.md"
else
    echo "  ✗ Product mission.md NOT FOUND"
fi

if [ -f "$TARGET_DIR/haikai/product/tech-stack.md" ]; then
    echo "  ✓ Product tech-stack.md"
else
    echo "  ✗ Product tech-stack.md NOT FOUND"
fi

if [ -f "$TARGET_DIR/haikai/product/roadmap.md" ]; then
    echo "  ✓ Product roadmap.md"
else
    echo "  ✗ Product roadmap.md NOT FOUND"
fi

# Check for spec files
if [ -f "$TARGET_DIR/haikai/specs/user-registration/spec.md" ]; then
    echo "  ✓ Spec spec.md"
else
    echo "  ✗ Spec spec.md NOT FOUND"
fi

if [ -f "$TARGET_DIR/haikai/specs/user-registration/tasks/tasks.md" ]; then
    echo "  ✓ Spec tasks/tasks.md"
else
    echo "  ✗ Spec tasks/tasks.md NOT FOUND"
fi

if [ -f "$TARGET_DIR/haikai/specs/user-registration/planning/requirements.md" ]; then
    echo "  ✓ Spec planning/requirements.md"
else
    echo "  ✗ Spec planning/requirements.md NOT FOUND"
fi

# Check for metamodel
if [ -f "$TARGET_DIR/metamodel/architecture.json" ]; then
    echo "  ✓ Metamodel architecture.json"
else
    echo "  ✗ Metamodel architecture.json NOT FOUND"
fi

# Check for standards
if [ -f "$TARGET_DIR/haikai/profiles/default/standards/global/coding-style.md" ]; then
    echo "  ✓ Global standards coding-style.md"
else
    echo "  ✗ Global standards coding-style.md NOT FOUND"
fi

echo ""
echo "=========================================="
echo "=== Directory Structure ==="
echo "=========================================="
echo ""
find "$TARGET_DIR" -type f | sort

echo ""
echo "=========================================="
echo "=== Setup Complete ==="
echo "=========================================="
echo ""
echo "Test data has been copied to: $TARGET_DIR"
echo ""
echo "You can now test the following API endpoints:"
echo ""
echo "Product Context:"
echo "  GET /api/v1/product/$COMPANY/$PROJECT/mission"
echo "  GET /api/v1/product/$COMPANY/$PROJECT/tech-stack"
echo "  GET /api/v1/product/$COMPANY/$PROJECT/roadmap"
echo ""
echo "Specs:"
echo "  GET /api/v1/specs/$COMPANY/$PROJECT"
echo "  GET /api/v1/specs/$COMPANY/$PROJECT/user-registration"
echo "  POST /api/v1/specs/$COMPANY/$PROJECT/write-spec"
echo ""
echo "Tasks:"
echo "  GET /api/v1/specs/$COMPANY/$PROJECT/user-registration/tasks"
echo ""
echo "Metamodel:"
echo "  GET /api/v1/metamodels/$COMPANY/$PROJECT"
echo "  POST /api/v1/metamodels/$COMPANY/$PROJECT/extract"
echo ""
echo "Standards:"
echo "  GET /api/v1/standards/$COMPANY/$PROJECT"
echo "  GET /api/v1/standards/$COMPANY/global"
echo ""
echo "Orchestration:"
echo "  POST /api/v1/orchestrations"
echo ""
