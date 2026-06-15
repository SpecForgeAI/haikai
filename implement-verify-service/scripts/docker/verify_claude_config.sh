#!/bin/bash
# Diagnostic script to verify Claude Code CLI configuration

echo "========================================"
echo "Claude Code CLI Configuration Check"
echo "========================================"
echo ""

# Check 1: Claude CLI binary exists
echo "1. Checking if Claude CLI is installed..."
if command -v claude &> /dev/null; then
    echo "   ✓ Claude CLI found at: $(which claude)"
    claude --version 2>&1 || echo "   ⚠ Could not get version"
else
    echo "   ✗ Claude CLI not found in PATH"
    echo "   Looking for claude binary..."
    find /usr/local -name "claude" 2>/dev/null || echo "   Not found in /usr/local"
fi
echo ""

# Check 2: ANTHROPIC_API_KEY environment variable
echo "2. Checking ANTHROPIC_API_KEY environment variable..."
if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo "   ✗ ANTHROPIC_API_KEY is not set"
else
    # Show only first 10 and last 4 characters for security
    KEY_PREFIX="${ANTHROPIC_API_KEY:0:10}"
    KEY_SUFFIX="${ANTHROPIC_API_KEY: -4}"
    echo "   ✓ ANTHROPIC_API_KEY is set: ${KEY_PREFIX}...${KEY_SUFFIX}"
fi
echo ""

# Check 3: Haikai profiles directory
echo "3. Checking Haikai profiles..."
PROFILES_DIR="/app/haikai-profiles"
if [ -d "$PROFILES_DIR" ]; then
    echo "   ✓ Profiles directory exists: $PROFILES_DIR"
    echo "   Contents:"
    ls -la "$PROFILES_DIR" 2>/dev/null | head -10
    
    # Check for default profile
    if [ -d "$PROFILES_DIR/default" ]; then
        echo "   ✓ Default profile found"
        echo "   Commands available:"
        ls "$PROFILES_DIR/default/commands" 2>/dev/null | head -5
    else
        echo "   ✗ Default profile not found"
    fi
else
    echo "   ✗ Profiles directory not found: $PROFILES_DIR"
fi
echo ""

# Check 4: HAIKAI_PROFILES_PATH environment variable
echo "4. Checking HAIKAI_PROFILES_PATH environment variable..."
if [ -z "$HAIKAI_PROFILES_PATH" ]; then
    echo "   ✗ HAIKAI_PROFILES_PATH is not set"
    echo "   Claude will use default location: ~/.config/claude-code/profiles"
else
    echo "   ✓ HAIKAI_PROFILES_PATH is set to: $HAIKAI_PROFILES_PATH"
fi
echo ""

# Check 5: Try a simple Claude CLI command
echo "5. Testing Claude CLI with a simple command..."
if command -v claude &> /dev/null; then
    echo "   Running: claude --help"
    claude --help 2>&1 | head -20
    echo ""
    echo "   Testing authentication..."
    # Try to run a very simple command to test auth
    timeout 10s claude --print "Hello" 2>&1 | head -10 || echo "   ⚠ Command timed out or failed"
else
    echo "   ✗ Cannot test - Claude CLI not available"
fi
echo ""

# Check 6: Workspace directory
echo "6. Checking API workspace directory..."
WORKSPACE_DIR="${API_WORKSPACE_DIR:-/app/api_workspace}"
if [ -d "$WORKSPACE_DIR" ]; then
    echo "   ✓ Workspace directory exists: $WORKSPACE_DIR"
    ls -la "$WORKSPACE_DIR" 2>/dev/null | head -10
else
    echo "   ⚠ Workspace directory does not exist: $WORKSPACE_DIR"
    echo "   (This is normal if no operations have been run yet)"
fi
echo ""

echo "========================================"
echo "Configuration Check Complete"
echo "========================================"
