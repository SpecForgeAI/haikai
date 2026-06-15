#!/bin/bash

# Example usage scripts for Standards Extractor

# Make sure you're in the virtual environment
# source venv/bin/activate

echo "Standards Extractor - Example Usage"
echo "===================================="
echo ""

# Example 1: Analyze a local project
echo "Example 1: Analyze a local project"
echo "-----------------------------------"
echo "python -m src.cli -s ./my-project -p my-project"
echo ""

# Example 2: Analyze a GitHub repository
echo "Example 2: Analyze a GitHub repository"
echo "--------------------------------------"
echo "python -m src.cli -s https://github.com/facebook/react -p react"
echo ""

# Example 3: Analyze multiple directories
echo "Example 3: Analyze multiple directories"
echo "---------------------------------------"
echo "python -m src.cli \\"
echo "  -s ./backend \\"
echo "  -s ./frontend \\"
echo "  -s ./shared \\"
echo "  -p my-monorepo"
echo ""

# Example 4: Custom output directory
echo "Example 4: Custom output directory"
echo "----------------------------------"
echo "python -m src.cli \\"
echo "  -s ./my-project \\"
echo "  -p my-project \\"
echo "  -o ./extracted-standards"
echo ""

# Example 5: Non-recursive scan
echo "Example 5: Non-recursive scan (top-level only)"
echo "----------------------------------------------"
echo "python -m src.cli \\"
echo "  -s ./my-project \\"
echo "  -p my-project \\"
echo "  --no-recursive"
echo ""

# Example 6: Larger file size limit
echo "Example 6: Larger file size limit"
echo "---------------------------------"
echo "python -m src.cli \\"
echo "  -s ./my-project \\"
echo "  -p my-project \\"
echo "  --max-file-size 1000"
echo ""

echo "To run any of these examples, copy the command and execute it."
echo "Make sure to:"
echo "  1. Activate the virtual environment: source venv/bin/activate"
echo "  2. Configure your .env file with API keys"
echo "  3. Replace paths/URLs with your actual project"
