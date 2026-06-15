#!/bin/bash
# Setup Claude Code commands from Haikai profiles
# This script transforms Haikai command structure into Claude Code CLI expected format

set -e

HAIKAI_PROFILES="/app/haikai-profiles/default"
CLAUDE_COMMANDS_DIR="/root/.claude/commands"

echo "===================================================="
echo "Setting up Claude Code commands from Haikai"
echo "===================================================="

# Create Claude commands directory
mkdir -p "$CLAUDE_COMMANDS_DIR"

# Function to copy and transform a command
setup_command() {
    local command_name=$1
    local source_file=$2
    local dest_file="$CLAUDE_COMMANDS_DIR/${command_name}.md"
    
    echo "Setting up /${command_name}..."
    
    if [ -f "$source_file" ]; then
        # Copy the command file
        cp "$source_file" "$dest_file"
        echo "  ✓ Copied ${command_name}.md"
    else
        echo "  ✗ Source file not found: $source_file"
        return 1
    fi
}

# Setup Haikai commands
echo ""
echo "Copying Haikai commands..."

# Write-spec command
if [ -d "$HAIKAI_PROFILES/commands/write-spec" ]; then
    setup_command "write-spec" "$HAIKAI_PROFILES/commands/write-spec/single-agent/write-spec.md"
fi

# Create-tasks command
if [ -d "$HAIKAI_PROFILES/commands/create-tasks" ]; then
    setup_command "create-tasks" "$HAIKAI_PROFILES/commands/create-tasks/single-agent/create-tasks.md"
fi

# Implement-tasks command
if [ -d "$HAIKAI_PROFILES/commands/implement-tasks" ]; then
    setup_command "implement-tasks" "$HAIKAI_PROFILES/commands/implement-tasks/single-agent/implement-tasks.md"
fi

# Shape-spec command (optional, for completeness)
if [ -d "$HAIKAI_PROFILES/commands/shape-spec" ]; then
    setup_command "shape-spec" "$HAIKAI_PROFILES/commands/shape-spec/single-agent/shape-spec.md"
fi

# Plan-product command (optional)
if [ -d "$HAIKAI_PROFILES/commands/plan-product" ]; then
    setup_command "plan-product" "$HAIKAI_PROFILES/commands/plan-product/single-agent/plan-product.md"
fi

# Git-commit-preparation command (optional)
if [ -d "$HAIKAI_PROFILES/commands/git-commit-preparation" ]; then
    setup_command "git-commit-preparation" "$HAIKAI_PROFILES/commands/git-commit-preparation/single-agent/git-commit-preparation.md"
fi

# Orchestrate-tasks command (optional) - check both locations
if [ -d "$HAIKAI_PROFILES/commands/orchestrate-tasks" ]; then
    if [ -f "$HAIKAI_PROFILES/commands/orchestrate-tasks/single-agent/orchestrate-tasks.md" ]; then
        setup_command "orchestrate-tasks" "$HAIKAI_PROFILES/commands/orchestrate-tasks/single-agent/orchestrate-tasks.md"
    elif [ -f "$HAIKAI_PROFILES/commands/orchestrate-tasks/orchestrate-tasks.md" ]; then
        setup_command "orchestrate-tasks" "$HAIKAI_PROFILES/commands/orchestrate-tasks/orchestrate-tasks.md"
    fi
fi

# Improve-skills command (optional) - check both locations
if [ -d "$HAIKAI_PROFILES/commands/improve-skills" ]; then
    if [ -f "$HAIKAI_PROFILES/commands/improve-skills/single-agent/improve-skills.md" ]; then
        setup_command "improve-skills" "$HAIKAI_PROFILES/commands/improve-skills/single-agent/improve-skills.md"
    elif [ -f "$HAIKAI_PROFILES/commands/improve-skills/improve-skills.md" ]; then
        setup_command "improve-skills" "$HAIKAI_PROFILES/commands/improve-skills/improve-skills.md"
    fi
fi

echo ""
echo "===================================================="
echo "Claude Code commands setup complete!"
echo "===================================================="
echo ""
echo "Available commands:"
ls -1 "$CLAUDE_COMMANDS_DIR" | sed 's/\.md$//' | sed 's/^/  \//'
echo ""
echo "Commands are installed in: $CLAUDE_COMMANDS_DIR"
echo ""
echo "You can now use these commands with:"
echo "  claude --print \"/command-name\""
echo ""
