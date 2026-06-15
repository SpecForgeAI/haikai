# Setup script for containerized local environment (Windows PowerShell)
# This script creates an isolated environment for running standards-extractor
# with its own Python virtual environment, Claude CLI, and configuration

$ErrorActionPreference = "Stop"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Standards Extractor - Local Environment Setup" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Get the directory where this script is located
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $SCRIPT_DIR

Write-Host "Working directory: $SCRIPT_DIR"
Write-Host ""

# Check for required tools
Write-Host "Checking prerequisites..."

# Check Python
try {
    $pythonVersion = python --version 2>&1
    Write-Host "[OK] Python found: $pythonVersion" -ForegroundColor Green
}
catch {
    Write-Host "Error: Python is not installed" -ForegroundColor Red
    Write-Host "Please install Python 3.11+ from https://www.python.org/"
    exit 1
}

# Check Node.js
try {
    $nodeVersion = node --version
    Write-Host "[OK] Node.js found: $nodeVersion" -ForegroundColor Green
}
catch {
    Write-Host "Error: Node.js is not installed" -ForegroundColor Red
    Write-Host "Please install Node.js from https://nodejs.org/"
    exit 1
}

# Check npm
try {
    $npmVersion = npm --version
    Write-Host "[OK] npm found: v$npmVersion" -ForegroundColor Green
}
catch {
    Write-Host "Error: npm is not installed" -ForegroundColor Red
    exit 1
}

Write-Host ""

# Create Python virtual environment
$VENV_DIR = ".venv-local"
if (Test-Path $VENV_DIR) {
    Write-Host "Virtual environment already exists at $VENV_DIR" -ForegroundColor Yellow
    $response = Read-Host "Do you want to recreate it? (y/N)"
    if ($response -eq "y" -or $response -eq "Y") {
        Write-Host "Removing existing virtual environment..."
        Remove-Item -Recurse -Force $VENV_DIR
    }
    else {
        Write-Host "Using existing virtual environment"
    }
}

if (-not (Test-Path $VENV_DIR)) {
    Write-Host "Creating Python virtual environment..."
    python -m venv $VENV_DIR
    Write-Host "[OK] Virtual environment created" -ForegroundColor Green
}

# Activate virtual environment
Write-Host "Activating virtual environment..."
& "$VENV_DIR\Scripts\Activate.ps1"
Write-Host "[OK] Virtual environment activated" -ForegroundColor Green

# Upgrade pip
Write-Host "Upgrading pip..."
python -m pip install --upgrade pip --quiet
Write-Host "[OK] pip upgraded" -ForegroundColor Green

# Install Python dependencies
Write-Host "Installing Python dependencies..."
pip install -r requirements.txt --quiet
Write-Host "[OK] Python dependencies installed" -ForegroundColor Green

# Install Claude CLI locally
Write-Host "Installing Claude Code CLI..."
if (Test-Path "node_modules") {
    Write-Host "node_modules already exists" -ForegroundColor Yellow
    $response = Read-Host "Do you want to reinstall Claude CLI? (y/N)"
    if ($response -eq "y" -or $response -eq "Y") {
        npm install @anthropic-ai/claude-code
    }
    else {
        Write-Host "Using existing Claude CLI installation"
    }
}
else {
    npm install @anthropic-ai/claude-code
}
Write-Host "[OK] Claude Code CLI installed" -ForegroundColor Green

# Create local Claude config directory
$CLAUDE_CONFIG_DIR = "$env:USERPROFILE\.claude-local"
if (-not (Test-Path $CLAUDE_CONFIG_DIR)) {
    Write-Host "Creating local Claude configuration directory..."
    New-Item -ItemType Directory -Path $CLAUDE_CONFIG_DIR -Force | Out-Null
    
    # Copy default config files if they exist
    if (Test-Path "config\claude\config.json") {
        Copy-Item "config\claude\config.json" "$CLAUDE_CONFIG_DIR\"
    }
    if (Test-Path "config\claude\settings.json") {
        Copy-Item "config\claude\settings.json" "$CLAUDE_CONFIG_DIR\"
    }
    Write-Host "[OK] Claude configuration directory created" -ForegroundColor Green
}
else {
    Write-Host "Claude configuration directory already exists" -ForegroundColor Yellow
}

# Create workspace directories
Write-Host "Creating workspace directories..."
New-Item -ItemType Directory -Path "api_workspace" -Force | Out-Null
New-Item -ItemType Directory -Path "workspace" -Force | Out-Null
New-Item -ItemType Directory -Path "logs\orchestration" -Force | Out-Null
New-Item -ItemType Directory -Path "output" -Force | Out-Null
Write-Host "[OK] Workspace directories created" -ForegroundColor Green

# Check for .env.local file
if (-not (Test-Path ".env.local")) {
    Write-Host "Warning: .env.local file not found" -ForegroundColor Yellow
    Write-Host "Creating .env.local from template..."
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env.local"
    }
    Write-Host "IMPORTANT: Please edit .env.local and add your API keys" -ForegroundColor Red
}
else {
    Write-Host "[OK] .env.local file found" -ForegroundColor Green
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Setup Complete!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "To run the standards extractor in the containerized local environment:"
Write-Host ""
Write-Host "  .\run-local.ps1"
Write-Host ""
Write-Host "Or activate the environment manually:"
Write-Host ""
Write-Host "  .\.venv-local\Scripts\Activate.ps1"
Write-Host "  `$env:HAIKAI_PROFILES_PATH = `"`$(Get-Location)\haikai-profiles`""
Write-Host "  `$env:PATH = `"`$(Get-Location)\node_modules\.bin;`$env:PATH`""
Write-Host "  python -m src.entrypoints.run"
Write-Host ""
Write-Host "Remember to configure your API keys in .env.local!" -ForegroundColor Yellow
Write-Host ""
