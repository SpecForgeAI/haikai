#!/bin/bash

# Standards Extractor Setup Script

set -e

echo "========================================="
echo "Standards Extractor Setup"
echo "========================================="
echo ""

# Check Python version
echo "Checking Python version..."
python --version

if ! command -v python &> /dev/null; then
    echo "Error: Python is not installed"
    exit 1
fi

# Create virtual environment
echo ""
echo "Creating virtual environment..."
python -m venv venv

# Activate virtual environment
echo "Activating virtual environment..."
source venv/bin/activate

# Install dependencies
echo ""
echo "Installing dependencies..."
pip3 install -q -r requirements.txt

# Create .env if it doesn't exist
if [ ! -f .env ]; then
    echo ""
    echo "Creating .env file from template..."
    cp .env.example .env
    echo "✓ .env file created"
    echo ""
    echo "⚠️  IMPORTANT: Edit .env and add your API keys before running!"
else
    echo ""
    echo "✓ .env file already exists"
fi

echo ""
echo "========================================="
echo "Setup Complete!"
echo "========================================="
echo ""
echo "Next steps:"
echo "  1. Edit .env and add your API keys"
echo "  2. Activate the virtual environment:"
echo "     source venv/bin/activate"
echo "  3. Run the extractor:"
echo "     python -m src.cli -s /path/to/project -p project-name"
echo ""
echo "See QUICKSTART.md for more details."
echo ""
