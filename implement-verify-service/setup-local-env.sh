#!/bin/bash
# Setup script for containerized local environment
# This script creates an isolated environment for running standards-extractor
# with its own Python virtual environment, Claude CLI, and configuration

set -e  # Exit on error

echo "=========================================="
echo "Standards Extractor - Local Environment Setup"
echo "=========================================="
echo ""

# Color codes for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo "Working directory: $SCRIPT_DIR"
echo ""

# Check for required tools
echo "Checking prerequisites..."

# Check Python
if ! command -v python &> /dev/null; then
    echo -e "${RED}Error: Python is not installed${NC}"
    exit 1
fi
PYTHON_VERSION=$(python --version | cut -d' ' -f2)
echo -e "${GREEN}✓${NC} Python found: $PYTHON_VERSION"

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js is not installed${NC}"
    echo "Please install Node.js from https://nodejs.org/"
    exit 1
fi
NODE_VERSION=$(node --version)
echo -e "${GREEN}✓${NC} Node.js found: $NODE_VERSION"

# Check npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}Error: npm is not installed${NC}"
    exit 1
fi
# Store npm path for later use (with proper quoting for paths with spaces)
NPM_CMD=$(command -v npm)
NPM_VERSION=$("$NPM_CMD" --version)
echo -e "${GREEN}✓${NC} npm found: $NPM_VERSION"

echo ""

# Create Python virtual environment
VENV_DIR=".venv-local"
if [ -d "$VENV_DIR" ]; then
    echo -e "${YELLOW}Virtual environment already exists at $VENV_DIR${NC}"
    read -p "Do you want to recreate it? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Removing existing virtual environment..."
        rm -rf "$VENV_DIR"
    else
        echo "Using existing virtual environment"
    fi
fi

if [ ! -d "$VENV_DIR" ]; then
    echo "Creating Python virtual environment..."
    python -m venv "$VENV_DIR"
    echo -e "${GREEN}✓${NC} Virtual environment created"
fi

# Activate virtual environment
echo "Activating virtual environment..."
# Detect OS and use appropriate activation script
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" || "$OSTYPE" == "cygwin" ]]; then
    # Windows (Git Bash/MINGW)
    source "$VENV_DIR/Scripts/activate"
    PYTHON_CMD="$VENV_DIR/Scripts/python"
    PIP_CMD="$VENV_DIR/Scripts/pip"
else
    # Linux/macOS
    source "$VENV_DIR/bin/activate"
    PYTHON_CMD="$VENV_DIR/bin/python"
    PIP_CMD="$VENV_DIR/bin/pip"
fi
echo -e "${GREEN}✓${NC} Virtual environment activated"

# Upgrade pip
echo "Upgrading pip..."
"$PYTHON_CMD" -m pip install --upgrade pip > /dev/null 2>&1
echo -e "${GREEN}✓${NC} pip upgraded"

# Install Python dependencies
echo "Installing Python dependencies..."
"$PYTHON_CMD" -m pip install -r requirements.txt
echo -e "${GREEN}✓${NC} Python dependencies installed"

# Install Claude CLI locally
echo "Installing Claude Code CLI..."
# Ensure bash is in PATH for npm scripts (Windows Git Bash fix)
export PATH="/usr/bin:$PATH"
if [ -d "node_modules" ]; then
    echo -e "${YELLOW}node_modules already exists${NC}"
    read -p "Do you want to reinstall Claude CLI? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        "$NPM_CMD" install
    else
        echo "Using existing Claude CLI installation"
    fi
else
    "$NPM_CMD" install
fi
echo -e "${GREEN}✓${NC} Claude Code CLI installed"

# Create local Claude config directory
CLAUDE_CONFIG_DIR="$HOME/.claude-local"
if [ ! -d "$CLAUDE_CONFIG_DIR" ]; then
    echo "Creating local Claude configuration directory..."
    mkdir -p "$CLAUDE_CONFIG_DIR"
    
    # Copy default config files if they exist
    if [ -f "config/claude/config.json" ]; then
        cp config/claude/config.json "$CLAUDE_CONFIG_DIR/"
    fi
    if [ -f "config/claude/settings.json" ]; then
        cp config/claude/settings.json "$CLAUDE_CONFIG_DIR/"
    fi
    echo -e "${GREEN}✓${NC} Claude configuration directory created"
else
    echo -e "${YELLOW}Claude configuration directory already exists${NC}"
fi

# Create workspace directories
echo "Creating workspace directories..."
mkdir -p api_workspace
mkdir -p workspace
mkdir -p logs/orchestration
mkdir -p output
echo -e "${GREEN}✓${NC} Workspace directories created"

# Check for .env.local file
if [ ! -f ".env.local" ]; then
    echo -e "${YELLOW}Warning: .env.local file not found${NC}"
    echo "Creating .env.local from template..."
    if [ -f ".env.example" ]; then
        cp .env.example .env.local
    fi
    echo -e "${RED}IMPORTANT: Please edit .env.local and add your API keys${NC}"
else
    echo -e "${GREEN}✓${NC} .env.local file found"
fi

echo ""
echo "=========================================="
echo -e "${GREEN}Setup Complete!${NC}"
echo "=========================================="
echo ""
echo "To run the standards extractor in the containerized local environment:"
echo ""
echo "  ./run-local.sh"
echo ""
echo "Or activate the environment manually:"
echo ""
echo "  # On Linux/macOS:"
echo "  source .venv-local/bin/activate"
echo ""
echo "  # On Windows (Git Bash):"
echo "  source .venv-local/Scripts/activate"
echo ""
echo "  # Then set environment variables:"
echo "  export HAIKAI_PROFILES_PATH=\$(pwd)/haikai-profiles"
echo "  export PATH=\$(pwd)/node_modules/.bin:\$PATH"
echo "  python -m src.entrypoints.run"
echo ""
echo -e "${YELLOW}Don't forget to configure your API keys in .env.local!${NC}"
echo ""
