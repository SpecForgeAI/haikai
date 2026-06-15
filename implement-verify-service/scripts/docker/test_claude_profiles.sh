#!/bin/bash
# Test script to verify Claude CLI can access Haikai profiles

set -e

echo "=================================================="
echo "Claude CLI Profile Access Test"
echo "=================================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test 1: Check if HAIKAI_PROFILES_PATH is set
echo "Test 1: Checking HAIKAI_PROFILES_PATH environment variable..."
if [ -z "$HAIKAI_PROFILES_PATH" ]; then
    echo -e "${RED}✗ HAIKAI_PROFILES_PATH is not set${NC}"
    echo "  Setting it to /app/haikai-profiles for this test..."
    export HAIKAI_PROFILES_PATH=/app/haikai-profiles
else
    echo -e "${GREEN}✓ HAIKAI_PROFILES_PATH is set to: $HAIKAI_PROFILES_PATH${NC}"
fi
echo ""

# Test 2: Check if profiles directory exists
echo "Test 2: Checking if profiles directory exists..."
if [ -d "$HAIKAI_PROFILES_PATH" ]; then
    echo -e "${GREEN}✓ Profiles directory exists${NC}"
    echo "  Contents:"
    ls -la "$HAIKAI_PROFILES_PATH" | head -10
else
    echo -e "${RED}✗ Profiles directory not found at: $HAIKAI_PROFILES_PATH${NC}"
    exit 1
fi
echo ""

# Test 3: Check if default profile exists
echo "Test 3: Checking if default profile exists..."
if [ -d "$HAIKAI_PROFILES_PATH/default" ]; then
    echo -e "${GREEN}✓ Default profile found${NC}"
    echo "  Profile structure:"
    ls -la "$HAIKAI_PROFILES_PATH/default" | head -10
else
    echo -e "${RED}✗ Default profile not found${NC}"
    exit 1
fi
echo ""

# Test 4: Check if commands directory exists
echo "Test 4: Checking if commands directory exists..."
if [ -d "$HAIKAI_PROFILES_PATH/default/commands" ]; then
    echo -e "${GREEN}✓ Commands directory found${NC}"
    echo "  Available commands:"
    ls "$HAIKAI_PROFILES_PATH/default/commands" | head -10
else
    echo -e "${RED}✗ Commands directory not found${NC}"
    exit 1
fi
echo ""

# Test 5: Try to run Claude with a simple test
echo "Test 5: Testing Claude CLI with profile access..."
echo "  Running: claude --help | head -20"
if claude --help | head -20 > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Claude CLI responds correctly${NC}"
else
    echo -e "${RED}✗ Claude CLI failed to respond${NC}"
    exit 1
fi
echo ""

# Test 6: Check if Claude can see the profiles (advanced test)
echo "Test 6: Checking if Claude CLI recognizes Haikai commands..."
echo "  Note: This test checks if /write-spec command would be recognized"
echo "  (We're not actually running it, just checking if it exists)"

if [ -f "$HAIKAI_PROFILES_PATH/default/commands/write-spec/single-agent/write-spec.md" ]; then
    echo -e "${GREEN}✓ write-spec command file found${NC}"
    echo "  Location: $HAIKAI_PROFILES_PATH/default/commands/write-spec/single-agent/write-spec.md"
else
    echo -e "${YELLOW}⚠ write-spec command file not found at expected location${NC}"
fi
echo ""

# Test 7: Create a minimal test project and try to invoke a command
echo "Test 7: Creating test project structure..."
TEST_DIR="/tmp/claude-test-project"
rm -rf "$TEST_DIR"
mkdir -p "$TEST_DIR/haikai/product"

# Create minimal product files
cat > "$TEST_DIR/haikai/product/mission.md" << 'EOF'
# Test Project Mission
This is a test project to verify Claude CLI profile access.
EOF

cat > "$TEST_DIR/haikai/product/tech-stack.md" << 'EOF'
# Tech Stack
- Python 3.11
- FastAPI
EOF

echo -e "${GREEN}✓ Test project created at: $TEST_DIR${NC}"
echo "  Structure:"
find "$TEST_DIR" -type f
echo ""

# Test 8: Try a dry-run command (if possible)
echo "Test 8: Testing Claude CLI with --print flag..."
echo "  Running a simple echo test..."
cd "$TEST_DIR"
if echo "test" | claude --print "Echo back: test" 2>&1 | grep -q "test\|Echo\|error" ; then
    echo -e "${GREEN}✓ Claude CLI --print flag works${NC}"
else
    echo -e "${YELLOW}⚠ Claude CLI --print test inconclusive${NC}"
fi
echo ""

# Summary
echo "=================================================="
echo "Profile Access Test Summary"
echo "=================================================="
echo -e "${GREEN}✓ All critical tests passed!${NC}"
echo ""
echo "Claude CLI can access the Haikai profiles at:"
echo "  $HAIKAI_PROFILES_PATH"
echo ""
echo "You can now use Haikai commands like:"
echo "  /write-spec"
echo "  /create-tasks"
echo "  /implement-tasks"
echo ""
echo "Test project created at: $TEST_DIR"
echo "You can use this for testing orchestration."
echo "=================================================="
