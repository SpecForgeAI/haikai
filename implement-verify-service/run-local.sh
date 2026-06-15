#!/bin/bash
# Run script for containerized local environment
# This script activates the isolated environment and runs the standards-extractor

set -e  # Exit on error

# Color codes for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

VENV_DIR=".venv-local"

# Check if virtual environment exists
if [ ! -d "$VENV_DIR" ]; then
    echo -e "${RED}Error: Virtual environment not found${NC}"
    echo "Please run ./setup-local-env.sh first"
    exit 1
fi

# Check if .env.local exists
if [ ! -f ".env.local" ]; then
    echo -e "${RED}Error: .env.local file not found${NC}"
    echo "Please create .env.local with your configuration"
    exit 1
fi

echo "=========================================="
echo "Standards Extractor - Local Environment"
echo "=========================================="
echo ""

# Activate virtual environment
echo "Activating containerized local environment..."
# Detect OS and use appropriate activation script
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" || "$OSTYPE" == "cygwin" ]]; then
    # Windows (Git Bash/MINGW)
    source "$VENV_DIR/Scripts/activate"
    PYTHON_CMD="$VENV_DIR/Scripts/python"
else
    # Linux/macOS
    source "$VENV_DIR/bin/activate"
    PYTHON_CMD="$VENV_DIR/bin/python"
fi

# Set environment variables for isolated execution
export HAIKAI_PROFILES_PATH="$SCRIPT_DIR/haikai-profiles"
export PATH="$SCRIPT_DIR/node_modules/.bin:$PATH"
export NODE_PATH="$SCRIPT_DIR/node_modules"

# Load .env.local
export $(grep -v '^#' .env.local | xargs)

echo -e "${GREEN}✓${NC} Environment activated"
echo ""
echo "Environment details:"
echo "  Python: $($PYTHON_CMD --version)"
echo "  Virtual env: $VENV_DIR"
echo "  Claude profiles: $HAIKAI_PROFILES_PATH"
echo "  Working directory: $SCRIPT_DIR"
echo ""

# Check what the user wants to run
if [ "$1" == "example" ]; then
    echo "Running example script..."
    echo ""
    "$PYTHON_CMD" -m src.entrypoints.run "${@:2}"
elif [ "$1" == "test" ]; then
    echo "Running tests..."
    echo ""
    "$PYTHON_CMD" -m pytest tests/
elif [ "$1" == "shell" ]; then
    echo "Starting interactive shell..."
    echo "Type exit to leave the shell"
    echo ""
    bash
else
    # Default: start the API server
    echo "Starting FastAPI server..."
    echo "API will be available at http://localhost:8000"
    echo "API docs at http://localhost:8000/docs"
    echo ""
    "$PYTHON_CMD" -m src.entrypoints.run_api --host 0.0.0.0 --port 8000 "$@"
fi
